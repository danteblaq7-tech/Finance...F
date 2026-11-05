-- ============================================================================
--  FINESSE · RESET  (⚠ DESTRUCTIVE)
--  Drops every Finesse table, view and function from the `public` schema.
--  Your Supabase Auth users are NOT touched (delete them in Authentication ▸ Users).
--  Afterwards run:  npm run db:setup
--
--  Run with:  npm run db:reset      (asks you to confirm)
-- ============================================================================
drop view     if exists public.v_staff_queue, public.v_exam_applications, public.v_fee_clearance_summary;
drop table    if exists public.daily_activity, public.fee_statements,
                        public.sent_emails, public.email_templates, public.exam_card_applications,
                        public.exam_periods, public.fee_records, public.slot_bookings,
                        public.tickets, public.slots, public.profiles cascade;
drop function if exists public.book_slot(uuid, uuid, text, uuid);
drop function if exists public.unbook_slot(uuid);
drop function if exists public.generate_slots_for_date(date);
drop function if exists public.trg_application_reconcile();
drop function if exists public.trg_ticket_lifecycle();
drop function if exists public.is_staff();
drop function if exists public.my_student_id();
drop function if exists public.app_today();
drop function if exists public.app_day(timestamptz);
drop function if exists public.set_updated_at();
drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
