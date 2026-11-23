import { config } from './config.js';
import { queryOne } from './db.js';
import { renderTemplate, sendEmail } from './mailer.js';
import { logger } from './logger.js';

const templates = {
  ticket_response: {
    subject: 'Finesse ticket update',
    message: 'A Finance Office response has been added to one of your tickets.',
  },
  appointment_confirmed: {
    subject: 'Finesse appointment confirmed',
    message: 'Your appointment has been confirmed.',
  },
  appointment_changed: {
    subject: 'Finesse appointment changed',
    message: 'Your appointment has changed.',
  },
  appointment_cancelled: {
    subject: 'Finesse appointment cancelled',
    message: 'Your appointment has been cancelled.',
  },
};

export async function deliverTicketNotification({ ticketId, event, actorId }) {
  const template = templates[event];
  if (!template) return false;
  try {
    const recipient = await queryOne(
      `SELECT p.email
       FROM public.tickets t
       JOIN public.profiles p ON p.id = t.student_id
       WHERE t.id = $1`,
      [ticketId],
    );
    if (!recipient?.email) throw new Error('recipient_missing');
    const html = renderTemplate(
      '<p>{{message}}</p><p><a href="{{appUrl}}">Sign in to Finesse</a> to review the update.</p>',
      { message: template.message, appUrl: config.publicWebUrl },
    );
    await sendEmail({
      type: event,
      toEmail: recipient.email,
      subject: template.subject,
      html,
      createdBy: actorId,
    });
    return true;
  } catch (error) {
    logger.error('ticket_notification_failed', { errorCode: error?.code });
    return false;
  }
}

export function notifyTicketOwner(ticketId, event, actorId) {
  void deliverTicketNotification({ ticketId, event, actorId });
}
