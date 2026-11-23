begin;

alter table public.ticket_responses
  alter column author_id drop not null;

alter table public.ticket_responses
  drop constraint if exists ticket_responses_author_id_fkey;

alter table public.ticket_responses
  add constraint ticket_responses_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;

revoke all on public.ticket_responses from public, anon, authenticated;
grant select, insert on public.ticket_responses to authenticated;

create or replace function public.reject_cancelled_ticket_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_status text;
begin
  select t.status into ticket_status
  from public.tickets t
  where t.id = new.ticket_id
  for update;

  if ticket_status is null or ticket_status = 'cancelled' then
    raise exception 'Responses cannot be added to a cancelled or missing ticket.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.reject_cancelled_ticket_response() from public, anon, authenticated;

drop trigger if exists ticket_responses_reject_cancelled on public.ticket_responses;
create trigger ticket_responses_reject_cancelled
  before insert on public.ticket_responses
  for each row execute function public.reject_cancelled_ticket_response();

alter table public.tickets
  add column if not exists staff_notes text not null default '';

update public.tickets t
set staff_notes = coalesce((
  select r.body
  from public.ticket_responses r
  where r.ticket_id = t.id
  order by r.created_at desc, r.id desc
  limit 1
), '');

commit;
