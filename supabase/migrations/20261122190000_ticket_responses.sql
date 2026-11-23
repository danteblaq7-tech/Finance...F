begin;

create table public.ticket_responses (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index idx_ticket_responses_ticket_created
  on public.ticket_responses (ticket_id, created_at, id);

alter table public.ticket_responses enable row level security;

create policy ticket_responses_select on public.ticket_responses
  for select to authenticated
  using (
    exists (
      select 1
      from public.tickets t
      where t.id = ticket_id
        and (t.student_id = (select auth.uid()) or public.is_staff())
    )
  );

create policy ticket_responses_insert on public.ticket_responses
  for insert to authenticated
  with check (
    public.is_staff()
    and author_id = (select auth.uid())
    and exists (
      select 1
      from public.tickets t
      where t.id = ticket_id
        and t.status <> 'cancelled'
    )
  );

revoke all on public.ticket_responses from anon, authenticated;
grant select, insert on public.ticket_responses to authenticated;

-- Historical staff_notes stored neither their author nor their timestamp. Keep authors unknown;
-- updated_at is the closest available time and may reflect a later ticket update.
insert into public.ticket_responses (ticket_id, author_id, body, created_at)
select id, null::uuid, btrim(staff_notes), coalesce(updated_at, created_at)
from public.tickets
where nullif(btrim(staff_notes), '') is not null;

alter table public.tickets drop column staff_notes;

commit;
