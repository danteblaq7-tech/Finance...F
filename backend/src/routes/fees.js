import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

// The signed-in student's own fee records.
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT * FROM fee_records WHERE student_id = ? ORDER BY academic_year DESC, semester DESC',
      [req.user.student_id ?? ''],
    );
    res.json({ feeRecords: rows });
  }),
);

router.use(requireStaff);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { academicYear, semester, search } = z
      .object({ academicYear: z.string().optional(), semester: z.string().optional(), search: z.string().max(100).optional() })
      .parse(req.query);
    const where = [];
    const params = [];
    if (academicYear) { where.push('academic_year = ?'); params.push(academicYear); }
    if (semester) { where.push('semester = ?'); params.push(semester); }
    if (search) {
      where.push('(student_id LIKE ? OR student_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const rows = await query(
      `SELECT * FROM fee_records ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY academic_year DESC, semester DESC, student_id LIMIT 1000`,
      params,
    );
    res.json({ feeRecords: rows });
  }),
);

const importSchema = z.object({
  academicYear: z.string().trim().min(4).max(12),
  semester: z.string().trim().min(1).max(20),
  rows: z
    .array(
      z.object({
        student_id: z.string().trim().min(1).max(40).transform((s) => s.toUpperCase()),
        student_name: z.string().trim().max(150).default(''),
        email: z.string().trim().max(190).default(''),
        course: z.string().trim().max(150).default(''),
        total_fee: z.number().min(0),
        amount_paid: z.number().min(0),
        payment_ref: z.string().trim().max(80).default(''),
      }),
    )
    .min(1)
    .max(5000),
});

// Bulk upsert. Balance and clearance are computed HERE, never trusted from the client.
router.post(
  '/import',
  asyncHandler(async (req, res) => {
    const b = importSchema.parse(req.body);
    await withTransaction(async (conn) => {
      for (const r of b.rows) {
        const balance = Math.max(0, r.total_fee - r.amount_paid);
        await conn.query(
          `INSERT INTO fee_records
             (id, student_id, student_name, email, course, academic_year, semester,
              total_fee, amount_paid, balance, is_cleared_for_exam, payment_ref)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             student_name = VALUES(student_name), email = VALUES(email), course = VALUES(course),
             total_fee = VALUES(total_fee), amount_paid = VALUES(amount_paid), balance = VALUES(balance),
             payment_ref = VALUES(payment_ref),
             is_cleared_for_exam = IF(exception_granted_by IS NOT NULL, 1, VALUES(is_cleared_for_exam))`,
          [crypto.randomUUID(), r.student_id, r.student_name, r.email, r.course, b.academicYear, b.semester,
           r.total_fee, r.amount_paid, balance, balance <= 0 ? 1 : 0, r.payment_ref],
        );
      }
    });
    res.status(201).json({ imported: b.rows.length });
  }),
);

// Clear a student for exams despite an outstanding balance (recorded with who and why).
router.post(
  '/:id/exception',
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().min(5, 'Please record a reason.').max(1000) }).parse(req.body);
    const rec = await queryOne('SELECT id FROM fee_records WHERE id = ?', [req.params.id]);
    if (!rec) throw new HttpError(404, 'Fee record not found.');
    await query(
      'UPDATE fee_records SET is_cleared_for_exam = 1, exception_granted_by = ?, exception_note = ? WHERE id = ?',
      [req.user.id, note, req.params.id],
    );
    res.json({ feeRecord: await queryOne('SELECT * FROM fee_records WHERE id = ?', [req.params.id]) });
  }),
);

export default router;
