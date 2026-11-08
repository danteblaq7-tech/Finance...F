-- ============================================================================
--  FINESSE · Campus Finance Management System
--  Supabase (PostgreSQL) schema, security policies and realtime setup
--
--  SAFE TO RE-RUN: every statement is idempotent and NOTHING here deletes data.
--
--  HOW TO APPLY (pick one)
--    A) From the project root:        npm run db:schema
--       (needs DATABASE_URL in backend/.env — see README "Supabase setup")
--    B) In the Supabase dashboard:    SQL Editor ▸ New query ▸ paste this file ▸ Run
--
--  Users live in Supabase Auth (auth.users). public.profiles holds the app data for
--  each user (name, student ID, role…) and is filled automatically by a trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  HELPERS
-- ----------------------------------------------------------------------------

-- "Today" in the university's time zone (Supabase servers run in UTC).
-- Change 'Africa/Nairobi' here if the campus is elsewhere.
create or replace function public.app_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

-- The university-local calendar day of a timestamp (used by the dashboard statistics).
create or replace function public.app_day(ts timestamptz) returns date
language sql stable as $$ select (ts at time zone 'Africa/Nairobi')::date $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
--  TABLES
-- ----------------------------------------------------------------------------

-- profiles: one row per Supabase Auth user (students, finance staff, admins)
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  email           text not null,
  student_id      text,                       -- institutional ID, e.g. EGM/027/2024
  university      text,
  course          text,
  year_of_study   text,
  role            text not null default 'student' check (role in ('student','staff','admin')),
  avatar_url      text,
  expo_push_token text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_profiles_email      on public.profiles (lower(email));
create unique index if not exists uq_profiles_student_id on public.profiles (student_id);
create index        if not exists idx_profiles_role       on public.profiles (role);

-- slots: 30-minute appointment slots. Only availability lives here, so it is safe to
-- show to every signed-in user (and to stream over realtime).
create table if not exists public.slots (
  id           uuid primary key default gen_random_uuid(),
  slot_date    date not null,
  start_time   timestamp(0) not null,         -- wall-clock campus time (no zone, on purpose)
  end_time     timestamp(0) not null,
  display_time text,                          -- e.g. 09:00 AM
  is_booked    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint uq_slots_start unique (start_time)
);
create index if not exists idx_slots_date on public.slots (slot_date, start_time);

-- tickets: finance support requests
create table if not exists public.tickets (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.profiles(id) on delete cascade,
  student_name        text not null,
  issue_type          text not null,          -- fee_dispute, payment_plan, sponsorship, helb, bursary, fee_statement, other
  description         text not null check (length(btrim(description)) > 0),
  attachment_url      text,
  priority            text not null default 'medium' check (priority in ('low','medium','high')),
  status              text not null default 'pending' check (status in ('pending','in_review','resolved','cancelled')),
  appointment_slot    timestamp(0),
  appointment_slot_id uuid references public.slots(id) on delete set null,
  staff_notes         text not null default '',
  assigned_staff_id   uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_tickets_student on public.tickets (student_id, created_at);
create index if not exists idx_tickets_status  on public.tickets (status, created_at);

-- slot_bookings: WHO holds a slot. Staff-only: students never get to read other people's bookings.
create table if not exists public.slot_bookings (
  slot_id        uuid primary key references public.slots(id) on delete cascade,
  booked_by      uuid references public.profiles(id) on delete set null,
  booked_by_name text,
  ticket_id      uuid references public.tickets(id) on delete set null,
  booked_at      timestamptz not null default now()
);

-- fee_records: one row per student per semester (imported from the finance system)
create table if not exists public.fee_records (
  id                   uuid primary key default gen_random_uuid(),
  student_id           text not null,         -- institutional ID (profiles.student_id), not profiles.id
  student_name         text,
  email                text,
  course               text,
  academic_year        text not null,         -- e.g. 2026/2027
  semester             text not null,         -- e.g. Semester 1
  total_fee            numeric(12,2) not null default 0,
  amount_paid          numeric(12,2) not null default 0,
  balance              numeric(12,2) not null default 0,
  is_cleared_for_exam  boolean not null default false,
  payment_ref          text,
  exception_granted_by uuid references public.profiles(id) on delete set null,
  exception_note       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_fee_student_term unique (student_id, academic_year, semester),
  constraint chk_fee_amounts check (total_fee >= 0 and amount_paid >= 0 and balance >= 0)
);

-- exam_periods: windows in which students may apply for an exam card
create table if not exists public.exam_periods (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  academic_year       text not null,
  semester            text not null,
  exam_start_date     date not null,
  exam_end_date       date not null,
  application_open    date not null,
  application_close   date not null,
  min_payment_percent integer not null default 100,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_period_pct   check (min_payment_percent between 0 and 100),
  constraint chk_period_exam  check (exam_end_date >= exam_start_date),
  constraint chk_period_apply check (application_close >= application_open)
);
create index if not exists idx_periods_active on public.exam_periods (is_active);

-- exam_card_applications: one per student per exam period
create table if not exists public.exam_card_applications (
  id                   uuid primary key default gen_random_uuid(),
  student_uid          uuid not null references public.profiles(id) on delete cascade,
  student_id           text not null,         -- institutional ID
  student_name         text not null,
  email                text,
  course               text,
  year_of_study        text,
  exam_period_id       uuid not null references public.exam_periods(id) on delete cascade,
  academic_year        text not null,
  semester             text not null,
  status               text not null default 'pending' check (status in ('pending','approved','rejected','issued')),
  rejection_reason     text,
  fee_record_id        uuid references public.fee_records(id) on delete set null,
  amount_paid          numeric(12,2) not null default 0,
  total_fee            numeric(12,2) not null default 0,
  balance              numeric(12,2) not null default 0,
  manually_approved_by uuid references public.profiles(id) on delete set null,
  manual_approval_note text,
  card_issued_at       timestamptz,
  email_sent_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_app_student_period unique (student_uid, exam_period_id)
);
create index if not exists idx_app_status on public.exam_card_applications (status, created_at);

-- email_templates: editable HTML for outgoing emails ({{placeholders}})
create table if not exists public.email_templates (
  template_key text primary key check (template_key in ('exam_card','rejection')),
  subject      text not null,
  html         text not null,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- sent_emails: outbox of every exam-card / rejection email generated
create table if not exists public.sent_emails (
  id            uuid primary key default gen_random_uuid(),
  email_type    text not null check (email_type in ('exam_card','rejection')),
  to_email      text not null,
  to_name       text,
  semester      text,
  academic_year text,
  card_number   text,
  html          text not null,
  delivered     boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  sent_at       timestamptz not null default now()
);
create index if not exists idx_sent_at on public.sent_emails (sent_at);


-- ----------------------------------------------------------------------------
--  PRODUCTION ADDITIONS: fee statements, activity tracking, exam-card verification
-- ----------------------------------------------------------------------------

-- fee_statements: a fee statement a student uploaded (the file lives in the private Storage bucket 'fee-statements').
-- The figures are what the parser read from it; `outcome` is what the rules concluded.
create table if not exists public.fee_statements (
  id             uuid primary key default gen_random_uuid(),
  student_uid    uuid not null references public.profiles(id) on delete cascade,
  student_id     text not null,
  exam_period_id uuid references public.exam_periods(id) on delete set null,
  academic_year  text not null,
  semester       text not null,
  file_path      text not null,               -- path inside the 'fee-statements' bucket
  file_name      text not null,
  mime_type      text not null,
  size_bytes     integer not null check (size_bytes > 0),
  sha256         text not null,
  total_fee      numeric(12,2),
  amount_paid    numeric(12,2),
  balance        numeric(12,2),
  confidence     text not null default 'none' check (confidence in ('high','medium','low','none')),
  parse_source   text,
  flags          text[] not null default '{}',
  identity       text not null default 'unknown' check (identity in ('matched','mismatch','unknown')),
  outcome        text not null default 'needs_review' check (outcome in ('cleared','not_cleared','needs_review','official_record')),
  created_at     timestamptz not null default now()
);
create index if not exists idx_fee_statements_student on public.fee_statements (student_uid, created_at desc);
create index if not exists idx_fee_statements_created on public.fee_statements (created_at);

-- daily_activity: one row per user per day they used the app (powers "active students" on the dashboard).
create table if not exists public.daily_activity (
  day           date not null,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  pings         integer not null default 1,
  primary key (day, user_id)
);

-- tickets: when did staff first pick it up, and when was it closed?  (set by trigger, never by clients)
alter table public.tickets add column if not exists attended_at timestamptz;
alter table public.tickets add column if not exists resolved_at timestamptz;
alter table public.tickets add column if not exists closed_at   timestamptz;
create index if not exists idx_tickets_created  on public.tickets (created_at);
create index if not exists idx_tickets_attended on public.tickets (attended_at) where attended_at is not null;

-- exam_card_applications: where the decision came from, and everything the printed card's QR code needs
alter table public.exam_card_applications add column if not exists decision_source   text not null default 'fee_record'
  check (decision_source in ('fee_record','statement','manual'));
alter table public.exam_card_applications add column if not exists status_note       text;
alter table public.exam_card_applications add column if not exists statement_id      uuid references public.fee_statements(id) on delete set null;
alter table public.exam_card_applications add column if not exists verification_code text;
alter table public.exam_card_applications add column if not exists revoked_at        timestamptz;
alter table public.exam_card_applications add column if not exists revoked_by        uuid references public.profiles(id) on delete set null;
alter table public.exam_card_applications add column if not exists revoked_reason    text;
create unique index if not exists uq_app_verification_code on public.exam_card_applications (verification_code) where verification_code is not null;
create index if not exists idx_app_created on public.exam_card_applications (created_at);

-- Cards issued before verification codes existed get one now.
update public.exam_card_applications
   set verification_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
 where status = 'issued' and verification_code is null;

-- ----------------------------------------------------------------------------
--  updated_at maintenance (replaces MySQL's ON UPDATE CURRENT_TIMESTAMP)
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','tickets','fee_records','exam_periods','exam_card_applications','email_templates'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
--  NEW SIGN-UP  →  PROFILE
--  Fires for every user created in Supabase Auth (our API, or the dashboard).
--  SECURITY: raw_user_meta_data is chosen by whoever signs up, so it is NEVER used
--  for the role. Everyone starts as 'student'. Promote staff in SQL:
--      update public.profiles set role = 'staff' where email = 'someone@campus.ac.ke';
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email, student_id, university, course, year_of_study, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    lower(new.email),
    nullif(upper(btrim(new.raw_user_meta_data ->> 'student_id')), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'university'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'course'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'year_of_study'), ''),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users that already existed in this Supabase project before this schema was applied
insert into public.profiles (id, name, email, role)
select u.id, coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1)), lower(u.email), 'student'
  from auth.users u
 where u.email is not null
   and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

-- ----------------------------------------------------------------------------
--  TRIGGER: decide a new exam application's outcome from the fee record.
--  The API inserts with status 'pending'; the database sets approved / rejected.
--  Rows inserted with an explicit non-pending status (e.g. seed data) are left alone.
-- ----------------------------------------------------------------------------
create or replace function public.trg_application_reconcile() returns trigger
language plpgsql as $$
declare
  v_fee    public.fee_records%rowtype;
  v_min    integer;
  v_pct    numeric;
  v_ok     boolean;
begin
  -- Applications decided from an uploaded statement are decided by the API (decision_source = 'statement').
  if new.status = 'pending' and new.decision_source = 'fee_record' then
    select coalesce(min_payment_percent, 100) into v_min from public.exam_periods where id = new.exam_period_id;
    v_min := coalesce(v_min, 100);

    select * into v_fee
      from public.fee_records
     where student_id = new.student_id
       and academic_year = new.academic_year
       and semester = new.semester
     limit 1;

    if not found then
      new.status           := 'rejected';
      new.rejection_reason := 'No fee record found for this semester. Please visit the finance office with your payment receipts.';
      new.fee_record_id    := null;
      new.total_fee := 0; new.amount_paid := 0; new.balance := 0;
    else
      new.fee_record_id := v_fee.id;
      new.total_fee     := v_fee.total_fee;
      new.amount_paid   := v_fee.amount_paid;
      new.balance       := v_fee.balance;
      -- Cleared when the finance office cleared/excepted them, or they have paid at least the period's required percentage.
      v_ok := v_fee.is_cleared_for_exam
              or (v_fee.total_fee > 0 and v_fee.amount_paid * 100 >= v_fee.total_fee * v_min);
      if v_ok then
        new.status := 'approved';
        new.rejection_reason := null;
      else
        v_pct := case when v_fee.total_fee > 0 then floor(v_fee.amount_paid * 100 / v_fee.total_fee) else 0 end;
        new.status := 'rejected';
        new.rejection_reason := case
          when v_min >= 100 then 'Your fees are not fully cleared. Outstanding balance: KSh '
          else 'You have paid ' || v_pct::int || '% of your fees; at least ' || v_min || '% is required for this exam period. Outstanding balance: KSh '
        end
          || to_char(v_fee.balance, 'FM999,999,999,990')
          || '. Please settle your fees and reapply.';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_application_reconcile on public.exam_card_applications;
create trigger trg_application_reconcile
  before insert on public.exam_card_applications
  for each row execute function public.trg_application_reconcile();

-- ----------------------------------------------------------------------------
--  TRIGGER: ticket lifecycle timestamps for the dashboard.
--  "Attended" = a staff member picked the ticket up (it got an assignee) or it was resolved. A student booking an
--  appointment moves a ticket to 'in_review' too, but that is NOT staff attention, so status alone is not used.
-- ----------------------------------------------------------------------------
create or replace function public.trg_ticket_lifecycle() returns trigger
language plpgsql as $$
begin
  if new.attended_at is null and (new.assigned_staff_id is not null or new.status = 'resolved') then
    new.attended_at := now();
  end if;
  if new.status = 'resolved' and new.resolved_at is null then new.resolved_at := now(); end if;
  if new.status in ('resolved','cancelled') and new.closed_at is null then new.closed_at := now(); end if;
  if tg_op = 'UPDATE' and new.status in ('pending','in_review') and old.status in ('resolved','cancelled') then
    new.resolved_at := null;   -- re-opened
    new.closed_at   := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_ticket_lifecycle on public.tickets;
create trigger trg_ticket_lifecycle
  before insert or update on public.tickets
  for each row execute function public.trg_ticket_lifecycle();

-- Tickets that already existed before these columns did.
update public.tickets set attended_at = coalesce(updated_at, created_at)
 where attended_at is null and (assigned_staff_id is not null or status = 'resolved');
update public.tickets set resolved_at = coalesce(updated_at, created_at) where resolved_at is null and status = 'resolved';
update public.tickets set closed_at   = coalesce(updated_at, created_at) where closed_at   is null and status in ('resolved','cancelled');

-- ----------------------------------------------------------------------------
--  FUNCTIONS CALLED BY THE API  (replace the MySQL stored procedures)
--  Raising P0001 is how we signal "conflict" — the API turns it into HTTP 409.
-- ----------------------------------------------------------------------------

-- Generate 30-minute slots, 08:00–17:00, for one date. Skips dates already generated.
create or replace function public.generate_slots_for_date(p_date date) returns void
language plpgsql as $$
begin
  if exists (select 1 from public.slots where slot_date = p_date) then
    return;
  end if;
  insert into public.slots (slot_date, start_time, end_time, display_time)
  select p_date, t, t + interval '30 minutes', to_char(t, 'HH12:MI AM')
    from generate_series(p_date + time '08:00', p_date + time '16:30', interval '30 minutes') as t
  on conflict (start_time) do nothing;
end $$;

-- Book a slot. The conditional UPDATE is the double-booking guard; the whole function is one transaction.
create or replace function public.book_slot(p_slot_id uuid, p_user_id uuid, p_user_name text, p_ticket_id uuid)
returns void language plpgsql as $$
declare
  v_start timestamp;
begin
  update public.slots set is_booked = true
   where id = p_slot_id and is_booked = false
  returning start_time into v_start;

  if not found then
    raise exception 'This slot was just booked by someone else, or does not exist.' using errcode = 'P0001';
  end if;

  insert into public.slot_bookings (slot_id, booked_by, booked_by_name, ticket_id)
  values (p_slot_id, p_user_id, p_user_name, p_ticket_id)
  on conflict (slot_id) do update
    set booked_by = excluded.booked_by, booked_by_name = excluded.booked_by_name,
        ticket_id = excluded.ticket_id, booked_at = now();

  update public.tickets
     set appointment_slot = v_start,
         appointment_slot_id = p_slot_id,
         status = case when status = 'pending' then 'in_review' else status end
   where id = p_ticket_id;
end $$;

-- Release a booked slot and clear it from its ticket.
create or replace function public.unbook_slot(p_slot_id uuid) returns void
language plpgsql as $$
begin
  update public.tickets set appointment_slot = null, appointment_slot_id = null
   where appointment_slot_id = p_slot_id;
  delete from public.slot_bookings where slot_id = p_slot_id;
  update public.slots set is_booked = false where id = p_slot_id;
end $$;

-- ----------------------------------------------------------------------------
--  VIEWS  (security_invoker: they obey the Row Level Security of whoever queries them)
-- ----------------------------------------------------------------------------

-- Staff dashboard queue: open tickets, highest priority and oldest first
create or replace view public.v_staff_queue with (security_invoker = true) as
select t.id, t.student_name, u.student_id as student_number, t.issue_type, t.priority,
       t.status, t.appointment_slot, t.created_at
  from public.tickets t
  join public.profiles u on u.id = t.student_id
 where t.status in ('pending','in_review')
 order by case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.created_at;

-- Exam-card applications with their period and clearance info
create or replace view public.v_exam_applications with (security_invoker = true) as
select a.id, a.student_id, a.student_name, a.course, p.title as exam_period,
       a.academic_year, a.semester, a.status, a.rejection_reason,
       a.total_fee, a.amount_paid, a.balance, a.card_issued_at, a.created_at
  from public.exam_card_applications a
  join public.exam_periods p on p.id = a.exam_period_id;

-- Per-semester clearance totals
create or replace view public.v_fee_clearance_summary with (security_invoker = true) as
select academic_year, semester,
       count(*)                                          as students,
       count(*) filter (where is_cleared_for_exam)       as cleared,
       count(*) filter (where not is_cleared_for_exam)   as not_cleared,
       sum(total_fee)                                    as total_billed,
       sum(amount_paid)                                  as total_collected,
       sum(balance)                                      as total_outstanding
  from public.fee_records
 group by academic_year, semester;

-- ----------------------------------------------------------------------------
--  ROW LEVEL SECURITY
--
--  Supabase publishes every table in `public` over a REST API that anyone holding the
--  (public) anon key can call. RLS is what keeps data private.
--
--  Rule of this app: the Express API does ALL writes (it connects with a privileged
--  database role that bypasses RLS). Browsers/phones only get READ access, and only
--  to what they are allowed to see. That read access powers realtime updates.
-- ----------------------------------------------------------------------------

-- Helper: is the caller finance staff / admin?  (SECURITY DEFINER avoids policy recursion on profiles)
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
     where id = (select auth.uid()) and role in ('staff','admin')
  );
$$;

-- Helper: the caller's institutional student ID
create or replace function public.my_student_id() returns text
language sql stable security definer set search_path = '' as $$
  select student_id from public.profiles where id = (select auth.uid());
$$;

alter table public.profiles                enable row level security;
alter table public.slots                   enable row level security;
alter table public.tickets                 enable row level security;
alter table public.slot_bookings           enable row level security;
alter table public.fee_records             enable row level security;
alter table public.exam_periods            enable row level security;
alter table public.exam_card_applications  enable row level security;
alter table public.email_templates         enable row level security;
alter table public.sent_emails             enable row level security;
alter table public.fee_statements          enable row level security;
alter table public.daily_activity          enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_staff());

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using (student_id = (select auth.uid()) or public.is_staff());

drop policy if exists slots_select on public.slots;
create policy slots_select on public.slots for select to authenticated
  using (true);

drop policy if exists slot_bookings_select on public.slot_bookings;
create policy slot_bookings_select on public.slot_bookings for select to authenticated
  using (public.is_staff());

drop policy if exists fee_records_select on public.fee_records;
create policy fee_records_select on public.fee_records for select to authenticated
  using (public.is_staff() or student_id = public.my_student_id());

drop policy if exists exam_periods_select on public.exam_periods;
create policy exam_periods_select on public.exam_periods for select to authenticated
  using (true);

drop policy if exists applications_select on public.exam_card_applications;
create policy applications_select on public.exam_card_applications for select to authenticated
  using (student_uid = (select auth.uid()) or public.is_staff());

drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates for select to authenticated
  using (public.is_staff());

drop policy if exists sent_emails_select on public.sent_emails;
create policy sent_emails_select on public.sent_emails for select to authenticated
  using (public.is_staff());

drop policy if exists fee_statements_select on public.fee_statements;
create policy fee_statements_select on public.fee_statements for select to authenticated
  using (student_uid = (select auth.uid()) or public.is_staff());

drop policy if exists daily_activity_select on public.daily_activity;
create policy daily_activity_select on public.daily_activity for select to authenticated
  using (public.is_staff());

-- ----------------------------------------------------------------------------
--  EXAM-HALL SIGN-IN: units, who is registered for them, lecturers, and the signature.
--
--  Idea: scanning a student's exam-card QR code (1) proves the card is genuine, (2) lists the units that
--  student is registered for and allowed to sit, and (3) signs the scanning lecturer's unit as "sat".
--  The signature is one atomic UPDATE (see routes/invigilation.js), so a unit can only be signed once.
--  Students are matched by their institutional student ID, the same ID the fee records and exam cards use.
-- ----------------------------------------------------------------------------

-- A new role for invigilating lecturers: they can scan cards and see the register of THEIR units, nothing else.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add  constraint profiles_role_check check (role in ('student','staff','admin','lecturer'));

-- exam_units: the units examined in one exam period (optionally with date, time and venue)
create table if not exists public.exam_units (
  id             uuid primary key default gen_random_uuid(),
  exam_period_id uuid not null references public.exam_periods(id) on delete cascade,
  unit_code      text not null,
  unit_name      text not null default '',
  exam_date      date,
  start_time     time,
  end_time       time,
  venue          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_exam_unit unique (exam_period_id, unit_code)
);

-- Which lecturers may sign a unit
create table if not exists public.exam_unit_lecturers (
  exam_unit_id uuid not null references public.exam_units(id) on delete cascade,
  lecturer_id  uuid not null references public.profiles(id)  on delete cascade,
  primary key (exam_unit_id, lecturer_id)
);
create index if not exists idx_unit_lecturers_lecturer on public.exam_unit_lecturers (lecturer_id);

-- unit_registrations: one row per student per unit = "this student may sit this unit".
-- signed_at is NULL until the student has sat the exam; once set, the unit cannot be signed again.
create table if not exists public.unit_registrations (
  id             uuid primary key default gen_random_uuid(),
  exam_unit_id   uuid not null references public.exam_units(id) on delete cascade,
  student_id     text not null,                 -- institutional ID (profiles.student_id), upper-case
  allowed        boolean not null default true, -- false = barred from this unit (e.g. missing coursework)
  block_reason   text,
  signed_at      timestamptz,
  signed_by      uuid references public.profiles(id) on delete set null,
  signed_by_name text,                          -- kept even if the lecturer's account is later removed
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_unit_registration unique (exam_unit_id, student_id),
  constraint chk_signature_pair check ((signed_at is null) = (signed_by_name is null))
);
create index if not exists idx_unit_reg_student on public.unit_registrations (student_id);

-- Every signature, reset and bar/allow, with who and why (the audit trail for disputes)
create table if not exists public.unit_sign_log (
  id              bigint generated always as identity primary key,
  registration_id uuid not null references public.unit_registrations(id) on delete cascade,
  action          text not null check (action in ('signed','reset','barred','allowed')),
  by_user         uuid references public.profiles(id) on delete set null,
  by_name         text,
  reason          text,
  at              timestamptz not null default now()
);
create index if not exists idx_unit_sign_log_reg on public.unit_sign_log (registration_id, at);

do $$
declare t text;
begin
  foreach t in array array['exam_units','unit_registrations'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

alter table public.exam_units          enable row level security;
alter table public.exam_unit_lecturers enable row level security;
alter table public.unit_registrations  enable row level security;
alter table public.unit_sign_log       enable row level security;

drop policy if exists exam_units_select on public.exam_units;
create policy exam_units_select on public.exam_units for select to authenticated using (public.is_staff());

drop policy if exists exam_unit_lecturers_select on public.exam_unit_lecturers;
create policy exam_unit_lecturers_select on public.exam_unit_lecturers for select to authenticated using (public.is_staff());

-- A student may read their own registrations (so the apps can list their units); staff may read all.
drop policy if exists unit_registrations_select on public.unit_registrations;
create policy unit_registrations_select on public.unit_registrations for select to authenticated
  using (public.is_staff() or student_id = public.my_student_id());

drop policy if exists unit_sign_log_select on public.unit_sign_log;
create policy unit_sign_log_select on public.unit_sign_log for select to authenticated using (public.is_staff());

-- No INSERT / UPDATE / DELETE policies exist, so clients cannot write at all.
-- Belt and braces: also remove the privileges.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

-- Functions are callable by everyone by default. Lock the ones that change data to the
-- API's own database role, and allow only the two read-only helpers RLS needs.
revoke execute on function public.book_slot(uuid, uuid, text, uuid)  from public, anon, authenticated;
revoke execute on function public.unbook_slot(uuid)                  from public, anon, authenticated;
revoke execute on function public.generate_slots_for_date(date)      from public, anon, authenticated;
revoke execute on function public.handle_new_user()                  from public, anon, authenticated;
revoke execute on function public.trg_application_reconcile()        from public, anon, authenticated;
revoke execute on function public.trg_ticket_lifecycle()             from public, anon, authenticated;
revoke execute on function public.is_staff()                         from public, anon;
revoke execute on function public.my_student_id()                    from public, anon;
grant  execute on function public.is_staff()                         to authenticated;
grant  execute on function public.my_student_id()                    to authenticated;

-- ----------------------------------------------------------------------------
--  REALTIME: let the apps subscribe to changes on these tables.
--  (Postgres Changes respects the RLS policies above: a student only receives
--   events for rows they are allowed to read.)
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tickets','slots','exam_card_applications','fee_records','exam_periods','fee_statements'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Default email templates (only inserted if missing, so edits made in the app are kept)
insert into public.email_templates (template_key, subject, html) values
('exam_card', 'Your Finesse exam card for {{semester}}, {{academic_year}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#1B7A8A">Exam Card {{card_number}}</h2><p>Hello {{to_name}},</p><p>Your exam card for <b>{{semester}}</b> ({{academic_year}}) has been approved. Present it at the examination hall.</p><p style="color:#64748B;font-size:12px">Finesse Campus Finance Office</p></div>'),
('rejection', 'Update on your exam card application',
 '<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#EF4444">Application not cleared</h2><p>Hello {{to_name}},</p><p>We could not clear your exam card application for <b>{{semester}}</b> ({{academic_year}}).</p><p>{{reason}}</p><p style="color:#64748B;font-size:12px">Finesse Campus Finance Office</p></div>')
on conflict (template_key) do nothing;
