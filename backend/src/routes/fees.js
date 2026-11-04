import { Router } from 'express';
import { z } from 'zod';
import { bind, query, queryOne, withTransaction } from '../db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

// The signed-in student's own fee records.
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT * FROM fee_records WHERE student_id = $1 ORDER BY academic_year DESC, semester DESC',
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
    if (academicYear) where.push(`academic_year = ${bind(params, academicYear)}`);
    if (semester) where.push(`semester = ${bind(params, semester)}`);
    if (search) {
      const like = bind(params, `%${search}%`);
      where.push(`(student_id ILIKE ${like} OR student_name ILIKE ${like})`);
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

const IMPORT_CHUNK = 500; // 500 rows x 11 values = 5,500 parameters, far below Postgres' 65,535 limit

// Bulk upsert. Balance and clearance are computed HERE, never trusted from the client.
// Rows go in batches, not one by one: the database is across the internet now, so every round trip counts.
router.post(
  '/import',
  asyncHandler(async (req, res) => {
    const b = importSchema.parse(req.body);

    // A file that lists the same student twice: the last line wins (same as inserting row by row).
    const unique = [...new Map(b.rows.map((r) => [r.student_id, r])).values()];

    await withTransaction(async (client) => {
      for (let i = 0; i < unique.length; i += IMPORT_CHUNK) {
        const params = [];
        const tuples = unique.slice(i, i + IMPORT_CHUNK).map((r) => {
          const balance = Math.max(0, r.total_fee - r.amount_paid);
          const values = [r.student_id, r.student_name, r.email, r.course, b.academicYear, b.semester,
            r.total_fee, r.amount_paid, balance, balance <= 0, r.payment_ref];
          return `(${values.map((v) => bind(params, v)).join(',')})`;
        });
        await client.query(
          `INSERT INTO fee_records
             (student_id, student_name, email, course, academic_year, semester,
              total_fee, amount_paid, balance, is_cleared_for_exam, payment_ref)
           VALUES ${tuples.join(',')}
           ON CONFLICT (student_id, academic_year, semester) DO UPDATE SET
             student_name = EXCLUDED.student_name, email = EXCLUDED.email, course = EXCLUDED.course,
             total_fee = EXCLUDED.total_fee, amount_paid = EXCLUDED.amount_paid, balance = EXCLUDED.balance,
             payment_ref = EXCLUDED.payment_ref,
             is_cleared_for_exam = CASE WHEN fee_records.exception_granted_by IS NOT NULL THEN true
                                        ELSE EXCLUDED.is_cleared_for_exam END`,
          params,
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
    const rec = await queryOne(
      `UPDATE fee_records SET is_cleared_for_exam = true, exception_granted_by = $1, exception_note = $2
        WHERE id = $3 RETURNING *`,
      [req.user.id, note, req.params.id],
    );
    if (!rec) throw new HttpError(404, 'Fee record not found.');
    res.json({ feeRecord: rec });
  }),
);

export default router;
