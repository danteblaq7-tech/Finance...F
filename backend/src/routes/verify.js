import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { queryOne } from '../db.js';
import { asyncHandler } from '../middleware/errors.js';

// PUBLIC: no sign-in. An invigilator scans the QR code on a printed exam card and sees whether it is genuine.
// Only what is needed to compare the card with the person holding it is returned (name, student ID, course, exam dates).
const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.nodeEnv === 'test' ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checks. Please wait a minute.' },
});

router.get(
  '/:code',
  limiter,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = String(req.params.code).toUpperCase();
    // Same response for "malformed" and "unknown": nothing to learn by probing.
    const notFound = () => res.json({ state: 'not_found', valid: false });
    if (!/^[A-Z0-9]{8,16}$/.test(code)) return notFound();

    const a = await queryOne(
      `SELECT a.student_name, a.student_id, a.course, a.semester, a.academic_year, a.status, a.card_issued_at,
              a.revoked_at, a.decision_source, a.manually_approved_by, p.exam_start_date, p.exam_end_date,
              (SELECT app_today()) AS today
         FROM exam_card_applications a JOIN exam_periods p ON p.id = a.exam_period_id
        WHERE a.verification_code = $1`,
      [code],
    );
    if (!a || a.status !== 'issued') return notFound();

    // revoked → expired → provisional (statement not yet verified by staff) → valid
    const provisional = a.decision_source === 'statement' && !a.manually_approved_by;
    const state = a.revoked_at ? 'revoked' : a.today > a.exam_end_date ? 'expired' : provisional ? 'provisional' : 'valid';
    res.json({
      state,
      valid: state === 'valid' || state === 'provisional',
      studentName: a.student_name,
      studentId: a.student_id,
      course: a.course,
      semester: a.semester,
      academicYear: a.academic_year,
      examStartDate: a.exam_start_date,
      examEndDate: a.exam_end_date,
      issuedAt: a.card_issued_at,
    });
  }),
);

export default router;
