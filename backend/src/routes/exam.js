import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { isStaff, requireAuth, requireStaff, requireStudent } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { renderTemplate, sendEmail } from '../mailer.js';

export const periodsRouter = Router();
export const applicationsRouter = Router();
periodsRouter.use(requireAuth);
applicationsRouter.use(requireAuth);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const periodSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    academicYear: z.string().trim().min(4).max(12),
    semester: z.string().trim().min(1).max(20),
    examStartDate: date,
    examEndDate: date,
    applicationOpen: date,
    applicationClose: date,
    minPaymentPercent: z.number().int().min(0).max(100).default(100),
    isActive: z.boolean().default(true),
  })
  .refine((p) => p.examEndDate >= p.examStartDate, { message: 'Exam end must be on/after exam start', path: ['examEndDate'] })
  .refine((p) => p.applicationClose >= p.applicationOpen, {
    message: 'Applications must close on/after they open',
    path: ['applicationClose'],
  });

// ── Exam periods ─────────────────────────────────────────────

periodsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ periods: await query('SELECT * FROM exam_periods ORDER BY exam_start_date DESC') });
  }),
);

periodsRouter.post(
  '/',
  requireStaff,
  asyncHandler(async (req, res) => {
    const p = periodSchema.parse(req.body);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO exam_periods (id, title, academic_year, semester, exam_start_date, exam_end_date,
         application_open, application_close, min_payment_percent, is_active) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, p.title, p.academicYear, p.semester, p.examStartDate, p.examEndDate, p.applicationOpen, p.applicationClose, p.minPaymentPercent, p.isActive ? 1 : 0],
    );
    res.status(201).json({ period: await queryOne('SELECT * FROM exam_periods WHERE id = ?', [id]) });
  }),
);

periodsRouter.patch(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    const r = await query('UPDATE exam_periods SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, req.params.id]);
    if (!r.affectedRows) throw new HttpError(404, 'Exam period not found.');
    res.json({ period: await queryOne('SELECT * FROM exam_periods WHERE id = ?', [req.params.id]) });
  }),
);

// ── Applications ─────────────────────────────────────────────

const APP_SELECT = `SELECT a.*, p.title AS period_title, p.exam_start_date, p.exam_end_date
                      FROM exam_card_applications a JOIN exam_periods p ON p.id = a.exam_period_id`;

const cardNumber = (id) => `FC-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

async function getTemplate(key) {
  return queryOne('SELECT subject, html FROM email_templates WHERE template_key = ?', [key]);
}

applicationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = z.enum(['pending', 'approved', 'rejected', 'issued']).optional().parse(req.query.status);
    const where = [];
    const params = [];
    if (!isStaff(req.user)) { where.push('a.student_uid = ?'); params.push(req.user.id); }
    if (status) { where.push('a.status = ?'); params.push(status); }
    const rows = await query(
      `${APP_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC LIMIT 500`,
      params,
    );
    res.json({ applications: rows });
  }),
);

// Student applies. The database trigger decides approved / rejected from the fee record.
applicationsRouter.post(
  '/',
  requireStudent,
  asyncHandler(async (req, res) => {
    const { examPeriodId } = z.object({ examPeriodId: z.string().uuid() }).parse(req.body);
    const user = req.user;
    if (!user.student_id) throw new HttpError(400, 'Your profile has no student ID. Contact the finance office.');

    const period = await queryOne('SELECT * FROM exam_periods WHERE id = ?', [examPeriodId]);
    if (!period || !period.is_active) throw new HttpError(404, 'That exam period is not available.');
    const today = await queryOne('SELECT CURDATE() AS d');
    if (today.d < period.application_open) throw new HttpError(409, `Applications open on ${period.application_open}.`);
    if (today.d > period.application_close) throw new HttpError(409, `Applications closed on ${period.application_close}.`);

    const existing = await queryOne(
      'SELECT id, status FROM exam_card_applications WHERE student_uid = ? AND exam_period_id = ?',
      [user.id, period.id],
    );
    if (existing && existing.status !== 'rejected') throw new HttpError(409, 'You have already applied for this exam period.');
    // A rejected student who has since paid may re-apply: replace the old attempt.
    if (existing) await query('DELETE FROM exam_card_applications WHERE id = ?', [existing.id]);

    const id = crypto.randomUUID();
    await query(
      `INSERT INTO exam_card_applications
         (id, student_uid, student_id, student_name, email, course, year_of_study, exam_period_id, academic_year, semester, status)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'pending')`,
      [id, user.id, user.student_id, user.name, user.email, user.course, user.year_of_study, period.id, period.academic_year, period.semester],
    );
    const app = await queryOne(`${APP_SELECT} WHERE a.id = ?`, [id]);

    if (app.status === 'rejected') {
      const tpl = await getTemplate('rejection');
      if (tpl) {
        const vars = { to_name: app.student_name, semester: app.semester, academic_year: app.academic_year, reason: app.rejection_reason };
        await sendEmail({
          type: 'rejection', toEmail: app.email, toName: app.student_name, semester: app.semester,
          academicYear: app.academic_year, subject: renderTemplate(tpl.subject, vars),
          html: renderTemplate(tpl.html, vars), createdBy: user.id,
        });
      }
    }
    res.status(201).json({ application: app });
  }),
);

// Staff override: approve a rejected/pending application with a recorded reason.
applicationsRouter.post(
  '/:id/approve',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().min(5, 'Please record a reason.').max(1000) }).parse(req.body);
    const app = await queryOne('SELECT id, status FROM exam_card_applications WHERE id = ?', [req.params.id]);
    if (!app) throw new HttpError(404, 'Application not found.');
    if (!['pending', 'rejected'].includes(app.status)) throw new HttpError(409, `Application is already ${app.status}.`);
    await query(
      `UPDATE exam_card_applications
          SET status = 'approved', rejection_reason = NULL, manually_approved_by = ?, manual_approval_note = ?
        WHERE id = ?`,
      [req.user.id, note, app.id],
    );
    res.json({ application: await queryOne(`${APP_SELECT} WHERE a.id = ?`, [app.id]) });
  }),
);

// Student generates their approved card: marks it issued and emails it (templated HTML).
applicationsRouter.post(
  '/:id/issue',
  requireStudent,
  asyncHandler(async (req, res) => {
    const app = await queryOne(`${APP_SELECT} WHERE a.id = ? AND a.student_uid = ?`, [req.params.id, req.user.id]);
    if (!app) throw new HttpError(404, 'Application not found.');
    if (app.status === 'issued') return res.json({ application: app });
    if (app.status !== 'approved') throw new HttpError(409, 'Only an approved application can be issued.');

    const tpl = await getTemplate('exam_card');
    if (!tpl) throw new HttpError(500, 'Exam card email template is missing.');
    const num = cardNumber(app.id);
    const vars = { to_name: app.student_name, semester: app.semester, academic_year: app.academic_year, card_number: num };
    const delivery = await sendEmail({
      type: 'exam_card', toEmail: app.email, toName: app.student_name, semester: app.semester,
      academicYear: app.academic_year, cardNumber: num, subject: renderTemplate(tpl.subject, vars),
      html: renderTemplate(tpl.html, vars), createdBy: req.user.id,
    });
    await query(
      "UPDATE exam_card_applications SET status = 'issued', card_issued_at = NOW(), email_sent_at = NOW() WHERE id = ?",
      [app.id],
    );
    res.json({ application: await queryOne(`${APP_SELECT} WHERE a.id = ?`, [app.id]), cardNumber: num, emailDelivered: delivery.delivered });
  }),
);
