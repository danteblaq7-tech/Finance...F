import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db.js';
import { PUBLIC_USER_COLUMNS, requireAdmin, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { supabaseAdmin } from '../supabase.js';
import { auditStaffAction } from '../auditLog.js';
import { logger } from '../logger.js';
import { listAuthFactors } from '../mfa.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const staffRoles = ['staff', 'admin', 'lecturer'];
const createSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(190),
  role: z.enum(staffRoles),
});
const updateSchema = z.object({
  role: z.enum(staffRoles).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => value.role !== undefined || value.isActive !== undefined, 'Provide a role or active-state change.');
const mfaPolicySchema = z.object({ required: z.boolean() }).strict();

async function setAuthBan(userId, duration) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: duration });
  if (error) {
    logger.error('staff_auth_ban_sync_failed', { errorCode: error.code });
    throw new HttpError(502, 'The account access flag was updated, but Supabase Auth could not be synchronized. Retry the action.');
  }
}

router.get(
  '/mfa-policy',
  asyncHandler(async (_req, res) => {
    const policy = await queryOne(
      'SELECT require_staff_mfa FROM public.auth_security_settings WHERE singleton = true',
    );
    if (!policy) throw new HttpError(500, 'The staff MFA setting is missing. Apply the staff MFA migration.');
    res.json({ required: policy.require_staff_mfa });
  }),
);

router.patch(
  '/mfa-policy',
  asyncHandler(async (req, res) => {
    const body = mfaPolicySchema.parse(req.body);
    const policy = await withTransaction(async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE public.auth_security_settings
         SET require_staff_mfa = $1, updated_by = $2, updated_at = now()
         WHERE singleton = true
         RETURNING require_staff_mfa`,
        [body.required, req.user.id],
      );
      if (!updated) throw new HttpError(500, 'The staff MFA setting is missing. Apply the staff MFA migration.');
      await auditStaffAction(client, {
        actorId: req.user.id,
        action: 'staff_mfa_policy_changed',
        entityType: 'auth_security_settings',
        entityId: req.user.id,
        metadata: { required: updated.require_staff_mfa },
      });
      return updated;
    });
    res.json({ required: policy.require_staff_mfa });
  }),
);

router.post(
  '/:id/mfa-reset',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (id === req.user.id) throw new HttpError(409, 'Ask another admin to reset your authenticator.');
    const target = await queryOne('SELECT id, role FROM profiles WHERE id = $1', [id]);
    if (!target || !['staff', 'admin'].includes(target.role)) throw new HttpError(404, 'Staff or admin account not found.');

    const factors = await listAuthFactors(id);
    for (const factor of factors) {
      const { error } = await supabaseAdmin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: id });
      if (error) {
        logger.error('staff_mfa_reset_failed', { errorCode: error.code });
        throw new HttpError(502, "Could not remove the account's authenticator. No database enrollment state was changed.");
      }
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM public.staff_mfa_enrollments WHERE user_id = $1', [id]);
      await auditStaffAction(client, {
        actorId: req.user.id,
        action: 'staff_mfa_reset',
        entityType: 'profile',
        entityId: id,
        metadata: { factorsRemoved: factors.length },
      });
    });
    res.json({ ok: true, removedFactors: factors.length });
  }),
);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const staff = await query(
      `SELECT ${PUBLIC_USER_COLUMNS}, is_active,
              COALESCE((SELECT e.enrollment_status = 'verified' FROM public.staff_mfa_enrollments e WHERE e.user_id = profiles.id), false) AS mfa_enrolled,
              COALESCE((SELECT e.enrollment_status = 'pending' FROM public.staff_mfa_enrollments e WHERE e.user_id = profiles.id), false) AS mfa_pending
       FROM profiles
       WHERE role = ANY($1::text[])
       ORDER BY name`,
      [staffRoles],
    );
    res.json({ staff });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (await queryOne('SELECT 1 FROM profiles WHERE lower(email) = $1', [body.email])) {
      throw new HttpError(409, 'An account with this email already exists.');
    }

    const temporaryPassword = `${randomBytes(24).toString('base64url')}A1!`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { name: body.name },
      app_metadata: { role: body.role, must_change_password: true },
    });
    if (error) {
      if (error.code === 'email_exists' || error.code === 'user_already_exists') {
        throw new HttpError(409, 'An account with this email already exists.');
      }
      if (error.code === 'weak_password') throw new HttpError(400, error.message || 'The generated password was rejected.');
      logger.error('staff_auth_create_failed', { errorCode: error.code });
      throw new HttpError(502, 'Could not create the staff account right now. Please try again.');
    }

    let user;
    try {
      user = await withTransaction(async (client) => {
        const { rows: [profile] } = await client.query(
          `UPDATE profiles
           SET role = $1, is_active = true, must_change_password = true
           WHERE id = $2
           RETURNING ${PUBLIC_USER_COLUMNS}, is_active`,
          [body.role, data.user.id],
        );
        if (!profile) throw new Error('The Auth user was created without a profile.');
        await auditStaffAction(client, {
          actorId: req.user.id,
          action: 'staff_account_created',
          entityType: 'profile',
          entityId: data.user.id,
          metadata: { role: body.role },
        });
        return profile;
      });
    } catch (error) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.user.id);
      if (deleteError) logger.error('staff_auth_cleanup_failed', { errorCode: deleteError.code });
      if (error instanceof HttpError) throw error;
      logger.error('staff_profile_setup_failed');
      throw new HttpError(500, 'The account could not be set up. Please contact the system administrator.');
    }

    res.status(201).json({ staff: user, temporaryPassword });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = updateSchema.parse(req.body);
    if (id === req.user.id && body.isActive === false) {
      throw new HttpError(409, 'You cannot deactivate your own account.');
    }
    if (id === req.user.id && body.role !== undefined && body.role !== 'admin') {
      throw new HttpError(409, 'You cannot demote your own account.');
    }

    const changed = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('finesse_staff_lifecycle'))");
      const { rows: [target] } = await client.query(
        'SELECT id, role, is_active FROM profiles WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!target || !staffRoles.includes(target.role)) throw new HttpError(404, 'Staff account not found.');

      const nextRole = body.role ?? target.role;
      const nextActive = body.isActive ?? target.is_active;
      const removingActiveAdmin = target.role === 'admin'
        && target.is_active
        && (nextRole !== 'admin' || !nextActive);
      if (removingActiveAdmin) {
        const { rows: [{ count }] } = await client.query(
          "SELECT count(*)::int AS count FROM profiles WHERE role = 'admin' AND is_active",
        );
        if (count <= 1) throw new HttpError(409, 'The last active admin cannot be demoted or deactivated.');
      }

      if (!target.is_active && nextActive) await setAuthBan(id, 'none');

      const { rows: [updated] } = await client.query(
        `UPDATE profiles SET role = $1, is_active = $2
         WHERE id = $3
         RETURNING ${PUBLIC_USER_COLUMNS}, is_active`,
        [nextRole, nextActive, id],
      );
      if (target.role !== nextRole) {
        await auditStaffAction(client, {
          actorId: req.user.id,
          action: 'staff_role_changed',
          entityType: 'profile',
          entityId: id,
          metadata: { fromRole: target.role, toRole: nextRole },
        });
      }
      if (target.is_active !== nextActive) {
        await auditStaffAction(client, {
          actorId: req.user.id,
          action: nextActive ? 'staff_reactivated' : 'staff_deactivated',
          entityType: 'profile',
          entityId: id,
        });
      }
      return { target, updated };
    });

    if (changed.target.is_active && !changed.updated.is_active) await setAuthBan(id, '876000h');
    res.json({ staff: changed.updated });
  }),
);

export default router;
