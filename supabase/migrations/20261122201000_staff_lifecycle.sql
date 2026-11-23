begin;

alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists must_change_password boolean not null default false;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
      and not must_change_password
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('staff', 'admin')
      and is_active
      and not must_change_password
  );
$$;

revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_staff() to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active_user() and (id = (select auth.uid()) or public.is_staff()));

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using (public.is_active_user() and (student_id = (select auth.uid()) or public.is_staff()));

drop policy if exists slots_select on public.slots;
create policy slots_select on public.slots for select to authenticated
  using (public.is_active_user());

drop policy if exists slot_bookings_select on public.slot_bookings;
create policy slot_bookings_select on public.slot_bookings for select to authenticated
  using (public.is_staff());

drop policy if exists fee_records_select on public.fee_records;
create policy fee_records_select on public.fee_records for select to authenticated
  using (public.is_active_user() and (public.is_staff() or student_id = public.my_student_id()));

drop policy if exists exam_periods_select on public.exam_periods;
create policy exam_periods_select on public.exam_periods for select to authenticated
  using (public.is_active_user());

drop policy if exists applications_select on public.exam_card_applications;
create policy applications_select on public.exam_card_applications for select to authenticated
  using (public.is_active_user() and (student_uid = (select auth.uid()) or public.is_staff()));

drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates for select to authenticated
  using (public.is_staff());

drop policy if exists sent_emails_select on public.sent_emails;
create policy sent_emails_select on public.sent_emails for select to authenticated
  using (public.is_staff());

drop policy if exists fee_statements_select on public.fee_statements;
create policy fee_statements_select on public.fee_statements for select to authenticated
  using (public.is_active_user() and (student_uid = (select auth.uid()) or public.is_staff()));

drop policy if exists daily_activity_select on public.daily_activity;
create policy daily_activity_select on public.daily_activity for select to authenticated
  using (public.is_staff());

drop policy if exists exam_units_select on public.exam_units;
create policy exam_units_select on public.exam_units for select to authenticated
  using (public.is_staff());

drop policy if exists exam_unit_lecturers_select on public.exam_unit_lecturers;
create policy exam_unit_lecturers_select on public.exam_unit_lecturers for select to authenticated
  using (public.is_staff());

drop policy if exists unit_registrations_select on public.unit_registrations;
create policy unit_registrations_select on public.unit_registrations for select to authenticated
  using (public.is_active_user() and (public.is_staff() or student_id = public.my_student_id()));

drop policy if exists unit_sign_log_select on public.unit_sign_log;
create policy unit_sign_log_select on public.unit_sign_log for select to authenticated
  using (public.is_staff());

drop policy if exists ticket_responses_select on public.ticket_responses;
create policy ticket_responses_select on public.ticket_responses for select to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1
      from public.tickets t
      where t.id = ticket_id
        and (t.student_id = (select auth.uid()) or public.is_staff())
    )
  );

drop policy if exists ticket_responses_insert on public.ticket_responses;
create policy ticket_responses_insert on public.ticket_responses for insert to authenticated
  with check (
    public.is_staff()
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id and t.status <> 'cancelled'
    )
  );

revoke all on public.ticket_responses from public, anon, authenticated;
grant select, insert on public.ticket_responses to authenticated;

commit;
