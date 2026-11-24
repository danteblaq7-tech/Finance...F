begin;

create or replace function public.generate_slot_for_datetime(p_date date, p_start_time time)
returns void
language plpgsql
as $$
declare
  v_start timestamp;
begin
  if p_date > public.app_today() + 60 then
    raise exception 'Appointment slots can only be generated for the next 60 days.' using errcode = 'P0001';
  end if;
  if p_start_time > time '23:30' then
    raise exception 'The 30-minute appointment must finish on the same day.' using errcode = 'P0001';
  end if;

  v_start := p_date + p_start_time;
  if v_start <= (now() at time zone 'Africa/Nairobi') then
    raise exception 'Choose a future appointment time.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('finesse_slots'), hashtext(p_date::text));
  if exists (
    select 1
      from public.slots
     where start_time < v_start + interval '30 minutes'
       and end_time > v_start
  ) then
    raise exception 'That appointment time overlaps an existing slot.' using errcode = 'P0001';
  end if;

  insert into public.slots (slot_date, start_time, end_time, display_time)
  values (p_date, v_start, v_start + interval '30 minutes', to_char(v_start, 'HH12:MI AM'));
end;
$$;

create or replace function public.book_slot(p_slot_id uuid, p_user_id uuid, p_user_name text, p_ticket_id uuid)
returns void
language plpgsql
as $$
declare
  v_start timestamp;
begin
  update public.slots
     set is_booked = true
   where id = p_slot_id
     and is_booked = false
     and start_time > (now() at time zone 'Africa/Nairobi')
  returning start_time into v_start;

  if not found then
    raise exception 'This appointment has passed or is no longer available.' using errcode = 'P0001';
  end if;

  insert into public.slot_bookings (slot_id, booked_by, booked_by_name, ticket_id)
  values (p_slot_id, p_user_id, p_user_name, p_ticket_id)
  on conflict (slot_id) do update
    set booked_by = excluded.booked_by,
        booked_by_name = excluded.booked_by_name,
        ticket_id = excluded.ticket_id,
        booked_at = now();

  update public.tickets
     set appointment_slot = v_start,
         appointment_slot_id = p_slot_id,
         status = case when status = 'pending' then 'in_review' else status end
   where id = p_ticket_id;
end;
$$;

revoke execute on function public.generate_slot_for_datetime(date, time) from public, anon, authenticated;
revoke execute on function public.book_slot(uuid, uuid, text, uuid) from public, anon, authenticated;

drop policy if exists slots_select on public.slots;
create policy slots_select on public.slots
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.is_staff()
      or (start_time > (now() at time zone 'Africa/Nairobi') and not is_booked)
    )
  );

commit;
