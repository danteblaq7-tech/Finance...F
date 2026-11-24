import { withTransaction } from './db.js';
import { auditStaffAction } from './auditLog.js';
import { HttpError } from './middleware/errors.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';

export async function listAuthFactors(userId) {
  const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
  if (error) {
    logger.error('staff_mfa_factor_lookup_failed', { errorCode: error.code });
    throw new HttpError(503, "Could not verify the account's authenticator status. Please try again.");
  }
  return data?.factors ?? [];
}

export async function listVerifiedTotpFactors(userId) {
  const factors = await listAuthFactors(userId);
  return factors.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
}

export async function markMfaEnrollmentPending(userId) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO public.staff_mfa_enrollments (user_id, enrollment_status)
       VALUES ($1, 'pending')
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id`,
      [userId],
    );
    if (rows.length) {
      await auditStaffAction(client, {
        actorId: userId,
        action: 'staff_mfa_enrollment_started',
        entityType: 'profile',
        entityId: userId,
      });
    }
  });
}

export async function markMfaEnrolled(userId) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO public.staff_mfa_enrollments (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE
         SET enrollment_status = 'verified', verified_at = COALESCE(public.staff_mfa_enrollments.verified_at, now())
         WHERE public.staff_mfa_enrollments.enrollment_status <> 'verified'
       RETURNING user_id`,
      [userId],
    );
    if (rows.length) {
      await auditStaffAction(client, {
        actorId: userId,
        action: 'staff_mfa_enrolled',
        entityType: 'profile',
        entityId: userId,
      });
    }
  });
}
