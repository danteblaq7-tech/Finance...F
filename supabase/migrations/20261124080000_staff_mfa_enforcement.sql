create table public.auth_security_settings (
  singleton boolean primary key default true check (singleton),
  require_staff_mfa boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.auth_security_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.auth_security_settings enable row level security;
revoke all on public.auth_security_settings from public, anon, authenticated;

create table public.staff_mfa_enrollments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enrollment_status text not null default 'verified' check (enrollment_status in ('pending', 'verified')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.staff_mfa_enrollments enable row level security;
revoke all on public.staff_mfa_enrollments from public, anon, authenticated;

create or replace function public.staff_mfa_assurance_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select case
    when auth.uid() is null then false
    when not exists (select 1 from public.profiles p where p.id = auth.uid()) then false
    else not exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('staff', 'admin')
        and (
          exists (
            select 1
            from public.staff_mfa_enrollments e
            where e.user_id = p.id
          )
          or exists (
            select 1
            from public.auth_security_settings s
            where s.singleton and s.require_staff_mfa
          )
        )
        and (
          coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
          or not exists (
            select 1
            from public.staff_mfa_enrollments e
            where e.user_id = p.id and e.enrollment_status = 'verified'
          )
        )
    )
  end;
$$;

revoke all on function public.staff_mfa_assurance_allowed() from public, anon;
grant execute on function public.staff_mfa_assurance_allowed() to authenticated;

do $$
declare
  target text;
  relation text;
begin
  foreach target in array array[
    'profiles',
    'slots',
    'tickets',
    'slot_bookings',
    'fee_records',
    'exam_periods',
    'exam_card_applications',
    'email_templates',
    'sent_emails',
    'fee_statements',
    'daily_activity',
    'exam_units',
    'exam_unit_lecturers',
    'unit_registrations',
    'unit_sign_log',
    'ticket_responses',
    'ticket_classification_recommendations',
    'ticket_attachments',
    'student_registry'
  ]
  loop
    relation := format('public.%I', target);
    if to_regclass(relation) is not null then
      execute format(
        'create policy staff_mfa_assurance on %s as restrictive for all to authenticated using (public.staff_mfa_assurance_allowed()) with check (public.staff_mfa_assurance_allowed())',
        relation
      );
    end if;
  end loop;

  if to_regclass('storage.objects') is not null then
    create policy staff_mfa_assurance on storage.objects
      as restrictive for all to authenticated
      using (public.staff_mfa_assurance_allowed())
      with check (public.staff_mfa_assurance_allowed());
  end if;
end;
$$;
