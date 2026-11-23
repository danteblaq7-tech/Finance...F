import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { auditStaffAction } from '../auditLog.js';
import { config } from '../config.js';
import { query, queryOne, withTransaction } from '../db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { logger } from '../logger.js';
import { renderTemplate, sendEmail } from '../mailer.js';
import { supabaseAdmin } from '../supabase.js';

const router = Router();
router.use(requireAuth);

const limiter = (limit) => rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.nodeEnv === 'test' ? 1000 : limit,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const listLimiter = limiter(60);
const accountLimiter = limiter(20);
const resetLimiter = limiter(5);

const listSchema = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});

const updateSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().min(5, 'Enter a short reason for deactivation.').max(300).optional(),
}).superRefine((value, context) => {
  if (!value.isActive && !value.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required to deactivate a student.' });
  }
});

const STUDENT_COLUMNS = 'id, name, email, student_id, is_active, created_at';

async function setAuthBan(userId, duration) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: duration });
  if (error) {
    logger.error('student_auth_ban_sync_failed', { errorCode: error.code });
    throw new HttpError(502, 'The account status was updated, but Supabase Auth could not be synchronized. Retry the action.');
  }
}

router.get(
  '/',
  listLimiter,
  asyncHandler(async (req, res) => {
    if (!['admin', 'staff'].includes(req.user.role)) throw new HttpError(403, 'Finance staff access only.');
    const { q, status, page, pageSize } = listSchema.parse(req.query);
    const active = status === 'all' ? null : status === 'active';
    const values = [active, q];
    const where = `role = 'student'
      AND ($1::boolean IS NULL OR is_active = $1)
      AND (
        $2 = ''
        OR POSITION(LOWER($2) IN LOWER(COALESCE(name, ''))) > 0
        OR POSITION(LOWER($2) IN LOWER(COALESCE(email, ''))) > 0
        OR POSITION(LOWER($2) IN LOWER(COALESCE(student_id, ''))) > 0
      )`;
    const [count, rows] = await Promise.all([
      queryOne(`SELECT count(*)::int AS total FROM profiles WHERE ${where}`, values),
      query(
        `SELECT ${STUDENT_COLUMNS} FROM profiles
         WHERE ${where}
         ORDER BY created_at DESC, id
         LIMIT $3 OFFSET $4`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
    ]);

    const students = await Promise.all(rows.map(async (student) => {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(student.id);
      if (error) {
        logger.warn('student_last_signin_unavailable', { errorCode: error.code });
        return { ...student, last_sign_in_at: null };
      }
      return { ...student, last_sign_in_at: data.user?.last_sign_in_at ?? null };
    }));

    res.json({
      students,
      page,
      pageSize,
      total: count.total,
      totalPages: Math.ceil(count.total / pageSize),
    });
  }),
);

router.patch(
  '/:id',
  requireAdmin,
  accountLimiter,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = updateSchema.parse(req.body);
    const result = await withTransaction(async (client) => {
      const { rows: [target] } = await client.query(
        'SELECT id, role, is_active FROM profiles WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!target || target.role !== 'student') throw new HttpError(404, 'Student account not found.');
      if (target.is_active === body.isActive) return { target, updated: target, changed: false };

      await setAuthBan(id, body.isActive ? 'none' : '876000h');
      const { rows: [updated] } = await client.query(
        `UPDATE profiles SET is_active = $1
         WHERE id = $2
         RETURNING ${STUDENT_COLUMNS}`,
        [body.isActive, id],
      );
      await auditStaffAction(client, {
        actorId: req.user.id,
        action: body.isActive ? 'student_reactivated' : 'student_deactivated',
        entityType: 'profile',
        entityId: id,
        metadata: body.isActive ? {} : { reason: body.reason },
      });
      return { target, updated, changed: true };
    });
    res.json({ student: result.updated });
  }),
);

router.post(
  '/:id/password-reset',
  requireAdmin,
  resetLimiter,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const student = await queryOne(
      "SELECT id, name, email FROM profiles WHERE id = $1 AND role = 'student'",
      [id],
    );
    if (!student) throw new HttpError(404, 'Student account not found.');
    if (!config.smtp) throw new HttpError(503, 'Password reset email is unavailable because backend SMTP is not configured.');

    await withTransaction((client) => auditStaffAction(client, {
      actorId: req.user.id,
      action: 'student_password_reset_requested',
      entityType: 'profile',
      entityId: id,
    }));
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: student.email,
      options: { redirectTo: `${config.publicWebUrl}/reset-password` },
    });
    if (error || !data?.properties?.action_link) {
      logger.error('student_password_reset_link_failed', { errorCode: error?.code });
      throw new HttpError(502, 'Could not create a password-reset link. Please try again.');
    }

    const delivery = await sendEmail({
      type: 'student_password_reset',
      toEmail: student.email,
      toName: student.name,
      subject: 'Reset your Finesse password',
      html: renderTemplate(
        '<p>A password reset was requested for your Finesse account.</p><p><a href="{{actionUrl}}">Set a new password</a></p><p>If you did not request this, you can ignore this email.</p>',
        { actionUrl: data.properties.action_link },
      ),
      outboxHtml: '<p>Password-reset email; the one-time recovery link is intentionally not stored in the outbox.</p>',
      createdBy: req.user.id,
    });
    if (!delivery.delivered) throw new HttpError(502, 'The password-reset email could not be delivered. You can safely retry.');
    res.json({ ok: true, delivered: true });
  }),
);

export default router;