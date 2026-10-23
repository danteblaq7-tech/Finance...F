import nodemailer from 'nodemailer';
import { config } from './config.js';
import { query } from './db.js';

const transporter = config.smtp ? nodemailer.createTransport(config.smtp) : null;

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Replace {{var}} placeholders; values are HTML-escaped so user-supplied data can't inject markup. */
export const renderTemplate = (tpl, vars) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => escapeHtml(vars[k] ?? ''));

/**
 * Store the email in the sent_emails outbox and, when SMTP is configured, deliver it.
 * Delivery failure never throws: the outbox row stays with delivered = 0 so it can be retried.
 */
export async function sendEmail({ type, toEmail, toName, semester, academicYear, cardNumber, subject, html, createdBy }) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO sent_emails (id, email_type, to_email, to_name, semester, academic_year, card_number, html, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, type, toEmail, toName ?? null, semester ?? null, academicYear ?? null, cardNumber ?? null, html, createdBy ?? null],
  );
  if (!transporter) return { id, delivered: false };
  try {
    await transporter.sendMail({ from: config.mailFrom, to: toEmail, subject, html });
    await query('UPDATE sent_emails SET delivered = 1 WHERE id = ?', [id]);
    return { id, delivered: true };
  } catch (e) {
    console.error('Email delivery failed:', e.message);
    return { id, delivered: false };
  }
}
