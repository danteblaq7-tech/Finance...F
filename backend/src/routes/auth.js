import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { PUBLIC_USER_COLUMNS, requireAuth, signToken } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

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

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// A real hash to compare against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post(
  '/register',
  limiter,
  asyncHandler(async (req, res) => {
    const b = registerSchema.parse(req.body);
    if (await queryOne('SELECT 1 FROM users WHERE email = ? OR student_id = ?', [b.email, b.studentId])) {
      throw new HttpError(409, 'An account with this email or student ID already exists.');
    }
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(b.password, 10);
    // Role is always 'student' here: clients can never choose their own role.
    await query(
      `INSERT INTO users (id, name, email, password_hash, student_id, university, course, year_of_study, role)
       VALUES (?,?,?,?,?,?,?,?, 'student')`,
      [id, b.name, b.email, hash, b.studentId, b.university ?? null, b.course ?? null, b.yearOfStudy ?? null],
    );
    const user = await queryOne(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [id]);
    res.status(201).json({ token: signToken(user), user });
  }),
);

router.post(
  '/login',
  limiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const row = await queryOne('SELECT id, password_hash FROM users WHERE email = ?', [email]);
    const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, 'Incorrect email or password.');
    const user = await queryOne(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [row.id]);
    res.json({ token: signToken(user), user });
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
    const row = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
      throw new HttpError(400, 'Current password is incorrect.');
    }
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), req.user.id]);
    res.json({ ok: true });
  }),
);

export default router;
