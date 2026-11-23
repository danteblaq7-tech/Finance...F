begin;

create table if not exists public.admin_lifecycle_guard (
  id boolean primary key default true check (id),
  revision bigint not null default 0
);
insert into public.admin_lifecycle_guard (id) values (true) on conflict (id) do nothing;
alter table public.admin_lifecycle_guard enable row level security;
revoke all on public.admin_lifecycle_guard from public, anon, authenticated;

create or replace function public.prevent_last_active_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removing_last_admin boolean := false;
begin
  if tg_op = 'DELETE' then
    removing_last_admin := old.role = 'admin' and old.is_active;
  else
    removing_last_admin := old.role = 'admin'
      and old.is_active
      and (new.role is distinct from 'admin' or not new.is_active);
  end if;

  if removing_last_admin then
    perform pg_advisory_xact_lock(hashtext('finesse_staff_lifecycle'));
    update public.admin_lifecycle_guard
    set revision = revision + 1
    where id = true;
    if not exists (
      select 1
      from public.profiles p
      where p.role = 'admin'
        and p.is_active
        and p.id <> old.id
    ) then
      raise exception 'The last active admin cannot be removed or demoted.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke execute on function public.prevent_last_active_admin_removal() from public, anon, authenticated;

drop trigger if exists profiles_prevent_last_active_admin_removal on public.profiles;
create trigger profiles_prevent_last_active_admin_removal
  before update of role, is_active or delete on public.profiles
  for each row execute function public.prevent_last_active_admin_removal();

update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', p.role, 'must_change_password', true)
from public.profiles p
where p.id = u.id
  and p.role in ('staff', 'admin', 'lecturer')
  and p.must_change_password;

do $$
declare
  unguarded_policy record;
begin
  select schemaname, tablename, policyname
  into unguarded_policy
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || coalesce(with_check, '')) not ilike '%is_active_user%'
    and (coalesce(qual, '') || coalesce(with_check, '')) not ilike '%is_staff%'
  limit 1;

  if found then
    raise exception 'RLS policy %.% (%) does not enforce active-profile access.',
      unguarded_policy.schemaname, unguarded_policy.tablename, unguarded_policy.policyname;
  end if;
end
$$;

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
    'appointment_cancelled'
  ));

commit;
