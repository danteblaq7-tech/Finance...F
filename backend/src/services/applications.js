import { randomBytes } from 'node:crypto';
import { queryOne } from '../db.js';
import { HttpError } from '../middleware/errors.js';
import { renderTemplate, sendEmail } from '../mailer.js';

export const APP_SELECT = `SELECT a.*, p.title AS period_title, p.exam_start_date, p.exam_end_date, p.min_payment_percent
                             FROM exam_card_applications a JOIN exam_periods p ON p.id = a.exam_period_id`;

export const cardNumber = (id) => `FC-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** 12 random characters from an alphabet without look-alikes (no 0/O, 1/I): safe to read aloud or type from a printout. */
export function newVerificationCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
}

/** The exam period a student wants to apply to; throws a friendly error if applications aren't open. */
export async function loadOpenPeriod(periodId) {
  const period = await queryOne('SELECT * FROM exam_periods WHERE id = $1', [periodId]);
  if (!period || !period.is_active) throw new HttpError(404, 'That exam period is not available.');
  const today = await queryOne('SELECT app_today() AS d');
  if (today.d < period.application_open) throw new HttpError(409, `Applications open on ${period.application_open}.`);
  if (today.d > period.application_close) throw new HttpError(409, `Applications closed on ${period.application_close}.`);
  return period;
}

/** An earlier attempt can be replaced if it was rejected, or is a statement-based application still waiting for review. */
export const canReplace = (existing) =>
  existing.status === 'rejected' || (existing.status === 'pending' && existing.decision_source === 'statement');

export async function sendRejectionEmail(app, createdBy) {
  const tpl = await queryOne('SELECT subject, html FROM email_templates WHERE template_key = $1', ['rejection']);
  if (!tpl) return;
  const vars = { to_name: app.student_name, semester: app.semester, academic_year: app.academic_year, reason: app.rejection_reason };
  await sendEmail({
    type: 'rejection', toEmail: app.email, toName: app.student_name, semester: app.semester, academicYear: app.academic_year,
    subject: renderTemplate(tpl.subject, vars), html: renderTemplate(tpl.html, vars), createdBy,
  });
}
