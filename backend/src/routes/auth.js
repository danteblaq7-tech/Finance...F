import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { queryOne } from '../db.js';
import { PUBLIC_USER_COLUMNS, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createAnonClient, supabaseAdmin } from '../supabase.js';

// Sign-IN is handled by Supabase Auth directly from the web/mobile apps (supabase.auth.signInWithPassword),
// which also gives them automatic token refresh. This router covers what must stay on the server:
//   register        – validate, de-duplicate, create the user with the admin API (no confirmation e-mail needed)
//   me              – the signed-in user's profile (role etc.)
//   change-password – verify the current password, then set the new one
const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(190),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  studentId: z.string().trim().min(3).max(40).transform((s) => s.toUpperCase()),
  university: z.string().trim().max(150).optional(),
  course: z.string().trim().max(150).optional(),
  yearOfStudy: z.string().trim().max(10).optional(),
});

router.post(
  '/register',
  limiter,
  asyncHandler(async (req, res) => {
    const b = registerSchema.parse(req.body);
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
      if (error.code === 'weak_password') throw new HttpError(400, error.message || 'That password is too weak.');
      console.error('Supabase createUser failed:', error.code, error.message);
      throw new HttpError(502, 'Could not create the account right now. Please try again.');
    }

    const user = await queryOne(`SELECT ${PUBLIC_USER_COLUMNS} FROM profiles WHERE id = $1`, [data.user.id]);
    if (!user) {
      // The auth user exists but the trigger didn't build a profile (schema not applied?). Don't leave a ghost account.
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
      console.error('Profile row missing after sign-up. Has database/supabase/schema.sql been applied? (npm run db:schema)');
      throw new HttpError(500, 'Account setup failed. Please contact the finance office.');
    }
    // The app now signs in with Supabase using the same email + password.
    res.status(201).json({ user });
  }),
);

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post(
  '/change-password',
  requireAuth,
  limiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(100) })
      .parse(req.body);

    const { error: wrong } = await createAnonClient().auth.signInWithPassword({ email: req.user.email, password: currentPassword });
    if (wrong) {
      if (wrong.status && wrong.status >= 500) throw new HttpError(503, 'Could not reach the sign-in service. Please try again.');
      throw new HttpError(400, 'Current password is incorrect.');
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { password: newPassword });
    if (error) {
      if (error.code === 'weak_password') throw new HttpError(400, error.message || 'That password is too weak.');
      if (error.code === 'same_password') throw new HttpError(400, 'Choose a password different from your current one.');
      console.error('Supabase updateUserById failed:', error.code, error.message);
      throw new HttpError(502, 'Could not change the password right now. Please try again.');
    }
    res.json({ ok: true });
  }),
);

export default router;
