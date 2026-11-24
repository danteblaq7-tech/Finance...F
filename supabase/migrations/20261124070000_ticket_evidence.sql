begin;

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  file_name text not null,
  file_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_attachments_ticket_created
  on public.ticket_attachments (ticket_id, created_at, id);

alter table public.ticket_attachments enable row level security;
revoke all on public.ticket_attachments from public, anon, authenticated;
grant select on public.ticket_attachments to authenticated;

drop policy if exists ticket_attachments_select on public.ticket_attachments;
create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1
      from public.tickets t
      where t.id = ticket_id
        and (t.student_id = (select auth.uid()) or public.is_staff())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-evidence',
  'ticket-evidence',
  false,
  5242880,
  array['application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ticket_evidence_storage_select on storage.objects;
drop policy if exists ticket_evidence_storage_insert on storage.objects;
drop policy if exists ticket_evidence_storage_update on storage.objects;
drop policy if exists ticket_evidence_storage_delete on storage.objects;

commit;
