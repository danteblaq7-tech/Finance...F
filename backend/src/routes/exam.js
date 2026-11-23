import { Router } from 'express';
import { z } from 'zod';
import { bind, query, queryOne, withTransaction } from '../db.js';
import { isStaff, requireAuth, requireStaff, requireStudent } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { config } from '../config.js';
import { renderTemplate, sendEmail } from '../mailer.js';
import { APP_SELECT, canReplace, cardNumber, loadOpenPeriod, newVerificationCode, sendRejectionEmail } from '../services/applications.js';
import { academicYearSchema, dateSchema, uuidSchema } from '../validation.js';
import { auditStaffAction } from '../auditLog.js';

export const periodsRouter = Router();
export const applicationsRouter = Router();
periodsRouter.use(requireAuth);
applicationsRouter.use(requireAuth);

const periodSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    academicYear: academicYearSchema,
    semester: z.string().trim().min(1).max(20),
    examStartDate: dateSchema,
    examEndDate: dateSchema,
    applicationOpen: dateSchema,
    applicationClose: dateSchema,
    minPaymentPercent: z.number().int().min(1).max(100).default(100),
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
    const period = await queryOne(
      `INSERT INTO exam_periods (title, academic_year, semester, exam_start_date, exam_end_date,
         application_open, application_close, min_payment_percent, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [p.title, p.academicYear, p.semester, p.examStartDate, p.examEndDate, p.applicationOpen, p.applicationClose, p.minPaymentPercent, p.isActive],
    );
    res.status(201).json({ period });
  }),
);

periodsRouter.patch(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    const id = uuidSchema.parse(req.params.id);
    const period = await queryOne('UPDATE exam_periods SET is_active = $1 WHERE id = $2 RETURNING *', [isActive, id]);
    if (!period) throw new HttpError(404, 'Exam period not found.');
    res.json({ period });
  }),
);

// ── Applications ─────────────────────────────────────────────

async function getTemplate(key) {
  return queryOne('SELECT subject, html FROM email_templates WHERE template_key = $1', [key]);
}

applicationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'issued']).optional() }).parse(req.query);
    const where = [];
    const params = [];
    if (!isStaff(req.user)) where.push(`a.student_uid = ${bind(params, req.user.id)}`);
    if (status) where.push(`a.status = ${bind(params, status)}`);
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

    const period = await loadOpenPeriod(examPeriodId);

    const existing = await queryOne(
      'SELECT id, status, decision_source FROM exam_card_applications WHERE student_uid = $1 AND exam_period_id = $2',
      [user.id, period.id],
    );
    if (existing && !canReplace(existing)) throw new HttpError(409, 'You have already applied for this exam period.');
    // A rejected student who has since paid may re-apply: replace the old attempt.
    if (existing) await query('DELETE FROM exam_card_applications WHERE id = $1', [existing.id]);

    const id = crypto.randomUUID();
    await query(
      `INSERT INTO exam_card_applications
         (id, student_uid, student_id, student_name, email, course, year_of_study, exam_period_id, academic_year, semester, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, 'pending')`,
      [id, user.id, user.student_id, user.name, user.email, user.course, user.year_of_study, period.id, period.academic_year, period.semester],
    );
    const app = await queryOne(`${APP_SELECT} WHERE a.id = $1`, [id]);

    if (app.status === 'rejected') await sendRejectionEmail(app, user.id);
    res.status(201).json({ application: app });
  }),
);

// Staff override: approve a rejected/pending application with a recorded reason.
applicationsRouter.post(
  '/:id/approve',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().min(5, 'Please record a reason.').max(1000) }).parse(req.body);
    const id = uuidSchema.parse(req.params.id);
    const appId = await withTransaction(async (client) => {
      const { rows: [app] } = await client.query('SELECT id, status FROM exam_card_applications WHERE id = $1 FOR UPDATE', [id]);
      if (!app) throw new HttpError(404, 'Application not found.');
      if (!['pending', 'rejected'].includes(app.status)) throw new HttpError(409, `Application is already ${app.status}.`);
      await client.query(
        `UPDATE exam_card_applications
            SET status = 'approved', rejection_reason = NULL, status_note = NULL, decision_source = 'manual',
                manually_approved_by = $1, manual_approval_note = $2
          WHERE id = $3`,
        [req.user.id, note, app.id],
      );
      await auditStaffAction(client, {
        actorId: req.user.id,
        action: 'exam_card_approved',
        entityType: 'exam_card_application',
        entityId: app.id,
      });
      return app.id;
    });
    res.json({ application: await queryOne(`${APP_SELECT} WHERE a.id = $1`, [appId]) });
  }),
);

// Student generates their approved card: marks it issued and emails it (templated HTML).
applicationsRouter.post(
  '/:id/issue',
  requireStudent,
  asyncHandler(async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const app = await queryOne(`${APP_SELECT} WHERE a.id = $1 AND a.student_uid = $2`, [id, req.user.id]);
    if (!app) throw new HttpError(404, 'Application not found.');
    if (app.status === 'issued') return res.json({ application: app });
    if (app.status !== 'approved') throw new HttpError(409, 'Only an approved application can be issued.');
    if (app.revoked_at) throw new HttpError(409, 'This card has been revoked. Contact the finance office.');

    const tpl = await getTemplate('exam_card');
    if (!tpl) throw new HttpError(500, 'Exam card email template is missing.');
    const num = cardNumber(app.id);
    const code = newVerificationCode();
    const vars = {
      to_name: app.student_name, semester: app.semester, academic_year: app.academic_year, card_number: num,
      verify_url: `${config.publicWebUrl}/verify/${code}`,
    };
    const delivery = await sendEmail({
      type: 'exam_card', toEmail: app.email, toName: app.student_name, semester: app.semester,
      academicYear: app.academic_year, cardNumber: num, subject: renderTemplate(tpl.subject, vars),
      html: renderTemplate(tpl.html, vars), createdBy: req.user.id,
    });
    await query(
      "UPDATE exam_card_applications SET status = 'issued', card_issued_at = now(), email_sent_at = now(), verification_code = COALESCE(verification_code, $2) WHERE id = $1",
      [app.id, code],
    );
    res.json({ application: await queryOne(`${APP_SELECT} WHERE a.id = $1`, [app.id]), cardNumber: num, emailDelivered: delivery.delivered });
  }),
);

// Staff: withdraw an issued card (e.g. the statement turned out to be forged, or a payment bounced).
// The card's QR code then shows "revoked" to invigilators, and the student cannot print it any more.
applicationsRouter.post(
  '/:id/revoke',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(5, 'Please record a reason.').max(1000) }).parse(req.body);
    const id = uuidSchema.parse(req.params.id);
    const appId = await withTransaction(async (client) => {
      const { rows: [app] } = await client.query(
        'SELECT id, status, revoked_at FROM exam_card_applications WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!app) throw new HttpError(404, 'Application not found.');
      if (app.status !== 'issued') throw new HttpError(409, 'Only an issued card can be revoked.');
      if (app.revoked_at) throw new HttpError(409, 'This card is already revoked.');
      await client.query(
        'UPDATE exam_card_applications SET revoked_at = now(), revoked_by = $1, revoked_reason = $2 WHERE id = $3',
        [req.user.id, reason, app.id],
      );
      await auditStaffAction(client, {
        actorId: req.user.id,
        action: 'exam_card_revoked',
        entityType: 'exam_card_application',
        entityId: app.id,
      });
      return app.id;
    });
    res.json({ application: await queryOne(`${APP_SELECT} WHERE a.id = $1`, [appId]) });
  }),
);
