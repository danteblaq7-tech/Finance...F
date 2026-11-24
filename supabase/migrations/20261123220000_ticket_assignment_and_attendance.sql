begin;

alter table public.tickets
  add column if not exists attended_by uuid references public.profiles(id) on delete set null;

update public.tickets t
set attended_by = coalesce(
  (
    select r.author_id
    from public.ticket_responses r
    where r.ticket_id = t.id
      and r.author_id is not null
    order by r.created_at, r.id
    limit 1
  ),
  t.assigned_staff_id
)
where t.attended_at is not null
  and t.attended_by is null;

create index if not exists idx_tickets_assigned_staff_status_created
  on public.tickets (assigned_staff_id, status, created_at desc);

commit;
