begin;

create or replace function public.normalize_student_number(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    trim('/' from regexp_replace(upper(btrim(value)), '[[:space:]/-]+', '/', 'g')),
    ''
  );
$$;

drop index if exists public.uq_profiles_student_id;
alter table public.profiles
  drop constraint if exists profiles_student_id_unique;

update public.profiles
set student_id = public.normalize_student_number(student_id)
where student_id is not null
  and student_id is distinct from public.normalize_student_number(student_id);

do $$
begin
  if exists (
    select 1
    from public.profiles
    where student_id is not null
    group by student_id
    having count(*) > 1
  ) then
    raise exception 'Student numbers collide after normalization; resolve duplicate profile numbers and retry this migration.';
  end if;
end
$$;

alter table public.profiles
  add constraint profiles_student_id_unique unique (student_id);

create or replace function public.normalize_profile_student_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.student_id := public.normalize_student_number(new.student_id);
  return new;
end
$$;

drop trigger if exists profiles_normalize_student_number on public.profiles;
create trigger profiles_normalize_student_number
  before insert or update of student_id on public.profiles
  for each row execute function public.normalize_profile_student_number();

create table if not exists public.student_registry (
  student_number text primary key,
  course text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint student_registry_number_format
    check (student_number ~ '^[A-Z]{2,6}/[0-9]{3,4}/[0-9]{2}$')
);

alter table public.student_registry enable row level security;
revoke all on public.student_registry from public, anon, authenticated;

commit;
