-- ============================================================================
--  FINESSE · demo data for Supabase
--
--  Run with:  npm run db:seed     (it creates the demo LOGINS first, then runs this file)
--  Safe to re-run: every insert is skipped if the row already exists.
--
--  The demo accounts (created by backend/scripts/db-setup.js, all with the same password):
--    admin@finesse.ac.ke   admin      staff@finesse.ac.ke   staff
--    lecturer@finesse.ac.ke   lecturer (scans exam cards, signs units)
--    amina@ / brian@ / cynthia@ / david@students.finesse.ac.ke   students
--  Demo password: Finesse@2026   — change it or delete these users before real use.
-- ============================================================================

do $$
declare
  u_admin   uuid; u_staff uuid;
  u_amina   uuid; u_brian uuid; u_cynthia uuid; u_david uuid;
  v_slot    uuid; u_lect uuid;
begin
  select id into u_admin   from public.profiles where email = 'admin@finesse.ac.ke';
  select id into u_staff   from public.profiles where email = 'staff@finesse.ac.ke';
  select id into u_amina   from public.profiles where email = 'amina@students.finesse.ac.ke';
  select id into u_brian   from public.profiles where email = 'brian@students.finesse.ac.ke';
  select id into u_cynthia from public.profiles where email = 'cynthia@students.finesse.ac.ke';
  select id into u_david   from public.profiles where email = 'david@students.finesse.ac.ke';

  if u_admin is null or u_staff is null or u_amina is null or u_brian is null or u_cynthia is null or u_david is null then
    raise exception 'Demo users are missing. Run "npm run db:seed" (it creates the logins first) instead of running this file on its own.';
  end if;

  -- Exam periods ------------------------------------------------------------
  insert into public.exam_periods (id, title, academic_year, semester, exam_start_date, exam_end_date, application_open, application_close, min_payment_percent, is_active) values
  ('c0000000-0000-4000-8000-000000000001','Semester 1 End-of-Term Exams','2026/2027','Semester 1','2026-11-23','2026-12-11','2026-10-01','2026-11-15',100,true),
  ('c0000000-0000-4000-8000-000000000002','Semester 2 End-of-Term Exams','2025/2026','Semester 2','2026-04-20','2026-05-08','2026-03-25','2026-04-12',100,false)
  on conflict (id) do nothing;

  -- Fee records -------------------------------------------------------------
  insert into public.fee_records (id, student_id, student_name, email, course, academic_year, semester, total_fee, amount_paid, balance, is_cleared_for_exam, payment_ref, exception_granted_by, exception_note) values
  ('d0000000-0000-4000-8000-000000000001','EGM/027/2024','Amina Hassan','amina@students.finesse.ac.ke','BSc Electrical Engineering','2026/2027','Semester 1',85000.00,85000.00,0.00,true,'MPESA-QJ81K2L9XA',null,null),
  ('d0000000-0000-4000-8000-000000000002','SCI/114/2023','Brian Kiprop','brian@students.finesse.ac.ke','BSc Computer Science','2026/2027','Semester 1',78000.00,52000.00,26000.00,false,'BANK-EQ-558201',null,null),
  ('d0000000-0000-4000-8000-000000000003','BUS/052/2025','Cynthia Chebet','cynthia@students.finesse.ac.ke','BCom Finance','2026/2027','Semester 1',72000.00,72000.00,0.00,true,'MPESA-QJ92M4T7BC',null,null),
  ('d0000000-0000-4000-8000-000000000004','MED/009/2022','David Mutua','david@students.finesse.ac.ke','MBChB Medicine','2026/2027','Semester 1',140000.00,120000.00,20000.00,true,'BANK-EQ-558977',u_staff,'Exception granted: HELB disbursement confirmed, pending credit.'),
  ('d0000000-0000-4000-8000-000000000005','EGM/027/2024','Amina Hassan','amina@students.finesse.ac.ke','BSc Electrical Engineering','2025/2026','Semester 2',85000.00,85000.00,0.00,true,'MPESA-PL44A7ZQ21',null,null)
  on conflict (id) do nothing;

  -- Exam card applications (explicit non-pending status, so the reconcile trigger leaves them alone)
  insert into public.exam_card_applications
   (id, student_uid, student_id, student_name, email, course, year_of_study, exam_period_id, academic_year, semester, status, rejection_reason, fee_record_id, amount_paid, total_fee, balance, manually_approved_by, manual_approval_note, card_issued_at, email_sent_at) values
  ('e0000000-0000-4000-8000-000000000001',u_amina,'EGM/027/2024','Amina Hassan','amina@students.finesse.ac.ke','BSc Electrical Engineering','2','c0000000-0000-4000-8000-000000000001','2026/2027','Semester 1','issued',null,'d0000000-0000-4000-8000-000000000001',85000.00,85000.00,0.00,null,null,'2026-10-12 09:14:00+03','2026-10-12 09:14:05+03'),
  ('e0000000-0000-4000-8000-000000000002',u_brian,'SCI/114/2023','Brian Kiprop','brian@students.finesse.ac.ke','BSc Computer Science','3','c0000000-0000-4000-8000-000000000001','2026/2027','Semester 1','rejected','Your fees are not fully cleared. Outstanding balance: KSh 26,000. Please settle your fees and reapply.','d0000000-0000-4000-8000-000000000002',52000.00,78000.00,26000.00,null,null,null,null),
  ('e0000000-0000-4000-8000-000000000003',u_david,'MED/009/2022','David Mutua','david@students.finesse.ac.ke','MBChB Medicine','4','c0000000-0000-4000-8000-000000000001','2026/2027','Semester 1','approved',null,'d0000000-0000-4000-8000-000000000004',120000.00,140000.00,20000.00,u_staff,'Approved under fee exception (HELB pending credit).',null,null)
  on conflict (id) do nothing;

  -- Exam-hall sign-in demo ---------------------------------------------------
  -- Units and who may sit them. No exam dates are set, so scanning works whenever you try it.
  -- Amina holds an issued card (EGM/027/2024): she may sit EEE201 and MAT201 but is barred from EEE202.
  insert into public.exam_units (id, exam_period_id, unit_code, unit_name, venue) values
  ('f1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','EEE201','Circuit Analysis','Main Hall'),
  ('f1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','EEE202','Electromagnetics','Main Hall'),
  ('f1000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001','MAT201','Engineering Mathematics III','Lecture Theatre 1'),
  ('f1000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000001','MED401','Clinical Medicine IV','Medical Hall')
  on conflict (id) do nothing;

  insert into public.unit_registrations (id, exam_unit_id, student_id, allowed, block_reason) values
  ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','EGM/027/2024',true,null),
  ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','EGM/027/2024',false,'Missing coursework (CAT 2)'),
  ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003','EGM/027/2024',true,null),
  ('f2000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000004','MED/009/2022',true,null)
  on conflict (id) do nothing;

  select id into u_lect from public.profiles where email = 'lecturer@finesse.ac.ke';
  if u_lect is not null then
    insert into public.exam_unit_lecturers (exam_unit_id, lecturer_id) values
    ('f1000000-0000-4000-8000-000000000001', u_lect),
    ('f1000000-0000-4000-8000-000000000002', u_lect)
    on conflict do nothing;
  end if;

  -- Tickets -----------------------------------------------------------------
  insert into public.tickets (id, student_id, student_name, issue_type, description, priority, status, staff_notes, assigned_staff_id, created_at) values
  ('f0000000-0000-4000-8000-000000000001',u_brian,'Brian Kiprop','payment_plan','I have paid KSh 52,000 of my Semester 1 fees and would like to arrange instalments for the balance before exams.','high','pending','',null,'2026-10-13 10:05:00+03'),
  ('f0000000-0000-4000-8000-000000000002',u_cynthia,'Cynthia Chebet','fee_statement','Please issue my official fee statement for the 2026/2027 academic year. It is required for a bursary application.','medium','in_review','Statement being prepared. Collect from the finance office on Friday.',u_staff,'2026-10-14 08:40:00+03'),
  ('f0000000-0000-4000-8000-000000000003',u_amina,'Amina Hassan','helb','My HELB loan was disbursed in September but it is not reflected on my fee statement. Reference attached in my payment details.','medium','resolved','HELB credit of KSh 40,000 has been posted to your account. Thank you for your patience.',u_staff,'2026-10-05 14:20:00+03'),
  ('f0000000-0000-4000-8000-000000000004',u_david,'David Mutua','sponsorship','I need a sponsorship letter for my clinical attachment fees to be sent to the county sponsor.','low','pending','',null,'2026-10-15 16:55:00+03')
  on conflict (id) do nothing;

  -- Appointment slots for the next 5 days (the function skips dates already generated)
  for i in 1..5 loop
    perform public.generate_slots_for_date(public.app_today() + i);
  end loop;

  -- One demo booking: Cynthia's ticket, tomorrow at 10:00 AM
  if not exists (select 1 from public.slot_bookings where ticket_id = 'f0000000-0000-4000-8000-000000000002') then
    select id into v_slot from public.slots
     where start_time = (public.app_today() + 1)::timestamp + time '10:00' and is_booked = false;
    if v_slot is not null then
      perform public.book_slot(v_slot, u_cynthia, 'Cynthia Chebet', 'f0000000-0000-4000-8000-000000000002');
    end if;
  end if;

  -- Email outbox ------------------------------------------------------------
  insert into public.sent_emails (id, email_type, to_email, to_name, semester, academic_year, card_number, html, delivered, created_by, sent_at) values
  ('a1000000-0000-4000-8000-000000000001','exam_card','amina@students.finesse.ac.ke','Amina Hassan','Semester 1','2026/2027','FC-00000001','<h2>Exam Card FC-00000001</h2><p>Your exam card is approved.</p>',true,u_amina,'2026-10-12 09:14:05+03'),
  ('a1000000-0000-4000-8000-000000000002','rejection','brian@students.finesse.ac.ke','Brian Kiprop','Semester 1','2026/2027',null,'<h2>Application not cleared</h2><p>Outstanding balance: KSh 26,000.</p>',true,u_brian,'2026-10-13 09:50:00+03')
  on conflict (id) do nothing;
end $$;

-- ============================================================================
--  DEMO ONLY: two weeks of past activity so the staff dashboard has something to draw.
--  Real installs skip this file; real activity is recorded by the API as people use the app.
-- ============================================================================
do $$
declare
  v_students uuid[];
  v_staff    uuid;
  v_names    text[];
  i int; n int; sid uuid; sname text; created timestamptz; attended timestamptz; st text;
begin
  select array_agg(id order by email), array_agg(name order by email) into v_students, v_names
    from public.profiles where role = 'student' and email like '%@students.finesse.ac.ke';
  select id into v_staff from public.profiles where email = 'staff@finesse.ac.ke';
  if v_students is null or v_staff is null then return; end if;
  n := array_length(v_students, 1);

  for i in 1..13 loop
    -- who used the app that day (a different subset each day)
    for k in 1..n loop
      if (i + k) % 3 <> 0 then
        insert into public.daily_activity (day, user_id, first_seen_at, last_seen_at, pings)
        values (public.app_today() - i, v_students[k],
                ((public.app_today() - i)::timestamp + time '08:15') at time zone 'Africa/Nairobi',
                ((public.app_today() - i)::timestamp + time '16:40') at time zone 'Africa/Nairobi', 6 + k)
        on conflict (day, user_id) do nothing;
      end if;
    end loop;

    -- one or two tickets a day; older ones were attended and mostly resolved, the last two days are still waiting
    for k in 1..(1 + i % 2) loop
      sid     := v_students[1 + (i + k) % n];
      sname   := v_names[1 + (i + k) % n];
      created := ((public.app_today() - i)::timestamp + time '09:30' + (k * interval '40 minutes')) at time zone 'Africa/Nairobi';
      if i <= 2 then
        insert into public.tickets (id, student_id, student_name, issue_type, description, priority, status, staff_notes, created_at)
        values (md5('demo-ticket-' || i || '-' || k)::uuid, sid, sname, 'fee_statement',
                'Demo history: please issue my fee statement for this semester.', 'medium', 'pending', '', created)
        on conflict (id) do nothing;
      else
        attended := created + interval '3 hours';
        st := case when i % 4 = 0 then 'in_review' else 'resolved' end;
        insert into public.tickets (id, student_id, student_name, issue_type, description, priority, status, staff_notes,
                                    assigned_staff_id, created_at, attended_at, resolved_at, closed_at)
        values (md5('demo-ticket-' || i || '-' || k)::uuid, sid, sname, 'payment_plan',
                'Demo history: I would like to arrange instalments for my balance.', 'medium', st, 'Handled by finance office.',
                v_staff, created, attended,
                case when st = 'resolved' then attended + interval '5 hours' end,
                case when st = 'resolved' then attended + interval '5 hours' end)
        on conflict (id) do nothing;
      end if;
    end loop;
  end loop;
end $$;
