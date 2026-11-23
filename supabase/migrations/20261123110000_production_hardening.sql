begin;

create table if not exists public.staff_action_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (length(btrim(action)) between 1 and 80),
  entity_type text not null check (length(btrim(entity_type)) between 1 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_action_audit_log_created
  on public.staff_action_audit_log (created_at desc);
create index if not exists idx_staff_action_audit_log_entity
  on public.staff_action_audit_log (entity_type, entity_id, created_at desc);

alter table public.staff_action_audit_log enable row level security;
revoke all on public.staff_action_audit_log from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fee-statements',
  'fee-statements',
  false,
  5242880,
  array['application/pdf', 'text/csv', 'text/plain', 'image/png', 'image/jpeg']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fee_statements_storage_select on storage.objects;
drop policy if exists fee_statements_storage_update on storage.objects;
drop policy if exists fee_statements_storage_delete on storage.objects;
create policy fee_statements_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fee-statements'
    and public.is_active_user()
    and (
      public.is_staff()
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

drop policy if exists fee_statements_storage_insert on storage.objects;
create policy fee_statements_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fee-statements'
    and public.is_active_user()
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'student'
        and p.is_active
        and not p.must_change_password
    )
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slots_select on public.slots;
create policy slots_select on public.slots
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.is_staff()
      or (slot_date >= public.app_today() and not is_booked)
    )
  );

drop policy if exists exam_periods_select on public.exam_periods;
create policy exam_periods_select on public.exam_periods
  for select to authenticated
  using (
    public.is_active_user()
    and (public.is_staff() or is_active)
  );

commit;
