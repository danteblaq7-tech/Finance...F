import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { queryOne } from '../db.js';
import { PUBLIC_USER_COLUMNS, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createAnonClient, supabaseAdmin } from '../supabase.js';
import { assertStudentNumberAllowed } from '../studentRegistration.js';
import { normalizeStudentNumber } from '../normalizeStudentNumber.js';
import { logger } from '../logger.js';
import { listVerifiedTotpFactors, markMfaEnrolled, markMfaEnrollmentPending } from '../mfa.js';

// Sign-IN is handled by Supabase Auth directly from the web/mobile apps (supabase.auth.signInWithPassword),
// which also gives them automatic token refresh. This router covers what must stay on the server:
//   register        – validate, de-duplicate, create the user with the admin API (no confirmation e-mail needed)
//   me              – the signed-in user's profile (role etc.)
//   change-password – verify the current password, then set the new one
const router = Router();

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again later.' },
});
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});
const mfaEnrollmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authenticator setup attempts. Please try again later.' },
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(190),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  studentId: z.string().trim().min(3).max(40).transform(normalizeStudentNumber),
  university: z.string().trim().max(150).optional(),
  course: z.string().trim().max(150).optional(),
  yearOfStudy: z.enum(['1', '2', '3', '4', '5', '6']).optional(),
});

router.post(
  '/register',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const b = registerSchema.parse(req.body);
    await assertStudentNumberAllowed(b.studentId, config.studentIdPattern);
    if (await queryOne('SELECT 1 FROM profiles WHERE lower(email) = $1 OR student_id = $2', [b.email, b.studentId])) {
      throw new HttpError(409, 'An account with this email or student ID already exists.');
    }

    // The role is NOT part of user_metadata and the database trigger always creates a 'student':
    // clients can never choose their own role.
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: b.email,
      password: b.password,
      email_confirm: true,
      user_metadata: {
        name: b.name,
        student_id: b.studentId,
        university: b.university ?? null,
        course: b.course ?? null,
        year_of_study: b.yearOfStudy ?? null,
      },
    });
    if (error) {
      if (error.code === 'email_exists' || error.code === 'user_already_exists') {
        throw new HttpError(409, 'An account with this email or student ID already exists.');
      }
      if (await queryOne('SELECT 1 FROM profiles WHERE student_id = $1', [b.studentId])) {
        throw new HttpError(409, 'An account with this email or student number already exists.');
      }
      if (error.code === 'weak_password') throw new HttpError(400, error.message || 'That password is too weak.');
      logger.error('student_signup_failed', { errorCode: error.code });
      throw new HttpError(502, 'Could not create the account right now. Please try again.');
    }

    const user = await queryOne(`SELECT ${PUBLIC_USER_COLUMNS} FROM profiles WHERE id = $1`, [data.user.id]);
    if (!user) {
      // The auth user exists but the trigger didn't build a profile (schema not applied?). Don't leave a ghost account.
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
      logger.error('student_profile_missing_after_signup');
      throw new HttpError(500, 'Account setup failed. Please contact the finance office.');
    }
    // The app now signs in with Supabase using the same email + password.
    res.status(201).json({ user });
  }),
);

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.get(
  '/mfa/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!['staff', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Two-factor authentication is available to staff and admins only.');
    const factors = await listVerifiedTotpFactors(req.user.id);
    if (factors.length && !req.user.mfa.enrolled) await markMfaEnrolled(req.user.id);
    res.json({
      mfa: {
        ...req.user.mfa,
        enrolled: req.user.mfa.enrolled || factors.length > 0,
        pending: req.user.mfa.pending && factors.length === 0,
        factorId: factors[0]?.id ?? null,
      },
    });
  }),
);

router.post(
  '/mfa/begin-enrollment',
  requireAuth,
  mfaEnrollmentLimiter,
  asyncHandler(async (req, res) => {
    if (!['staff', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Two-factor authentication is available to staff and admins only.');
    if (req.user.mfa.enrolled) throw new HttpError(409, 'An authenticator is already active. Verify a code instead.');
    await markMfaEnrollmentPending(req.user.id);
    res.json({ pending: true });
  }),
);

router.post(
  '/mfa/complete-enrollment',
  requireAuth,
  mfaEnrollmentLimiter,
  asyncHandler(async (req, res) => {
    if (!['staff', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Two-factor authentication is available to staff and admins only.');
    if (req.user.mfa.assuranceLevel !== 'aal2') throw new HttpError(403, 'Verify your authenticator code before completing setup.');
    const factors = await listVerifiedTotpFactors(req.user.id);
    if (!factors.length) throw new HttpError(400, 'No verified authenticator was found. Complete the verification step and try again.');
    await markMfaEnrolled(req.user.id);
    res.json({ mfa: { enrolled: true, required: true, assuranceLevel: req.user.mfa.assuranceLevel } });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(100) })
      .parse(req.body);

    const { error: wrong } = await createAnonClient().auth.signInWithPassword({ email: req.user.email, password: currentPassword });
    if (wrong) {
      if (wrong.status && wrong.status >= 500) throw new HttpError(503, 'Could not reach the sign-in service. Please try again.');
      throw new HttpError(400, 'Current password is incorrect.');
    }
    const { data: authData, error: authLookupError } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
    if (authLookupError || !authData?.user) throw new HttpError(502, 'Could not load the account to change its password. Please try again.');
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
      password: newPassword,
      app_metadata: {
        ...authData.user.app_metadata,
        role: req.user.role,
        must_change_password: false,
      },
    });
    if (error) {
      if (error.code === 'weak_password') throw new HttpError(400, error.message || 'That password is too weak.');
      if (error.code === 'same_password') throw new HttpError(400, 'Choose a password different from your current one.');
      logger.error('password_update_failed', { errorCode: error.code });
      throw new HttpError(502, 'Could not change the password right now. Please try again.');
    }
    const updated = await queryOne(
      `UPDATE profiles SET must_change_password = false
       WHERE id = $1
       RETURNING ${PUBLIC_USER_COLUMNS}`,
      [req.user.id],
    );
    if (!updated) throw new HttpError(500, 'The password changed, but the account profile could not be updated. Contact the administrator.');
    res.json({ ok: true, user: updated });
  }),
);

export default router;
