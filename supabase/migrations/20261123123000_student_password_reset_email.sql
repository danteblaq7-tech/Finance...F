begin;

alter table public.sent_emails
  drop constraint if exists sent_emails_email_type_check;

alter table public.sent_emails
  add constraint sent_emails_email_type_check
  check (email_type in (
    'exam_card',
    'rejection',
    'ticket_response',
    'appointment_confirmed',
    'appointment_changed',
    'appointment_cancelled',
    'student_password_reset'
  ));

commit;