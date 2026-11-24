import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import 'dotenv/config';
import { assertStagingIntegrationTarget } from '../src/integrationTestGuard.js';

assertStagingIntegrationTarget();

const roleIds = {
  student: process.env.RLS_TEST_STUDENT_ID,
  staff: process.env.RLS_TEST_STAFF_ID,
  lecturer: process.env.RLS_TEST_LECTURER_ID,
  admin: process.env.RLS_TEST_ADMIN_ID,
  inactive: process.env.RLS_TEST_INACTIVE_ID,
};
for (const [role, id] of Object.entries(roleIds)) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Set RLS_TEST_${role.toUpperCase()}_ID to the staging test profile UUID before running RLS tests.`);
  }
}
if (new Set(Object.values(roleIds)).size !== Object.keys(roleIds).length) {
  throw new Error('Each RLS test role must use a distinct staging profile UUID.');
}

const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let client;
let ids;

before(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  const { rows } = await client.query(
    'SELECT id, role, is_active, must_change_password FROM public.profiles WHERE id = ANY($1::uuid[])',
    [Object.values(roleIds)],
  );
  const profiles = new Map(rows.map((row) => [row.id, row]));
  for (const role of ['student', 'staff', 'lecturer', 'admin']) {
    const profile = profiles.get(roleIds[role]);
    assert.ok(profile, `Missing configured staging ${role} profile.`);
    assert.equal(profile.role, role);
    assert.equal(profile.is_active, true);
    assert.equal(profile.must_change_password, false);
  }
  const inactive = profiles.get(roleIds.inactive);
  assert.ok(inactive, 'Missing configured staging inactive profile.');
  assert.equal(inactive.is_active, false);

  const [ticketId, responseId, slotId, activePeriodId, inactivePeriodId] =
    Array.from({ length: 5 }, () => randomUUID());
  ids = { ticketId, responseId, slotId, activePeriodId, inactivePeriodId };

  await client.query(
    `INSERT INTO public.tickets (id, student_id, student_name, issue_type, description)
     VALUES ($1, $2, 'RLS test record', 'other', $3)`,
    [ticketId, roleIds.student, `RLS policy test ${ticketId}`],
  );
  await client.query(
    `INSERT INTO public.ticket_responses (id, ticket_id, author_id, body)
     VALUES ($1, $2, $3, 'RLS test response')`,
    [responseId, ticketId, roleIds.staff],
  );
  const slotStart = new Date(Date.now() + 86400000 * 30);
  const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
  await client.query(
    `INSERT INTO public.slots (id, slot_date, start_time, end_time, display_time)
     VALUES ($1, $2::date, $3::timestamp, $4::timestamp, 'RLS test')`,
    [slotId, slotStart.toISOString().slice(0, 10), slotStart.toISOString().slice(0, 19).replace('T', ' '), slotEnd.toISOString().slice(0, 19).replace('T', ' ')],
  );
  const today = await client.query("SELECT public.app_today() AS day");
  const start = today.rows[0].day;
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 5);
  await client.query(
    `INSERT INTO public.exam_periods
      (id, title, academic_year, semester, exam_start_date, exam_end_date, application_open, application_close, is_active)
     VALUES
      ($1, 'RLS active test', '2098/2099', 'RLS', $3::date, $4::date, $2::date, $3::date, true),
      ($5, 'RLS inactive test', '2098/2099', 'RLS', $3::date, $4::date, $2::date, $3::date, false)`,
    [activePeriodId, start, end.toISOString().slice(0, 10), end.toISOString().slice(0, 10), inactivePeriodId],
  );
});

after(async () => {
  if (client) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  await pool.end();
});

async function asRole(userId, fn, aal = 'aal1') {
  await client.query('RESET ROLE');
  await client.query(
    `SELECT set_config('request.jwt.claim.sub', $1, true),
            set_config('request.jwt.claims', $2, true)`,
    [userId, JSON.stringify({ sub: userId, role: 'authenticated', aal })],
  );
  await client.query('SET LOCAL ROLE authenticated');
  return fn();
}

test('staging RLS scopes tickets, responses, profiles, slots, and exam periods by role and active state', async () => {
  for (const [role, userId] of Object.entries(roleIds)) {
    const visible = await asRole(userId, async () => {
      const { rows: [counts] } = await client.query(
        `SELECT
           (SELECT count(*)::int FROM public.profiles WHERE id = $1) AS own_profile,
           (SELECT count(*)::int FROM public.tickets WHERE id = $2) AS ticket,
           (SELECT count(*)::int FROM public.ticket_responses WHERE id = $3) AS response,
           (SELECT count(*)::int FROM public.slots WHERE id = $4) AS slot,
           (SELECT count(*)::int FROM public.exam_periods WHERE id = $5) AS active_period,
           (SELECT count(*)::int FROM public.exam_periods WHERE id = $6) AS inactive_period,
           public.is_active_user() AS active_user,
           public.is_staff() AS staff_user`,
        [userId, ids.ticketId, ids.responseId, ids.slotId, ids.activePeriodId, ids.inactivePeriodId],
      );
      return counts;
    });

    if (role === 'inactive') {
      assert.equal(visible.own_profile, 0);
      assert.equal(visible.ticket, 0);
      assert.equal(visible.response, 0);
      assert.equal(visible.slot, 0);
      assert.equal(visible.active_period, 0);
      assert.equal(visible.inactive_period, 0);
      assert.equal(visible.active_user, false);
      assert.equal(visible.staff_user, false);
      continue;
    }

    assert.equal(visible.own_profile, 1, `${role} can read their own profile`);
    assert.equal(visible.active_user, true);
    assert.equal(visible.slot, 1, `${role} can read future unbooked slots`);
    assert.equal(visible.active_period, 1, `${role} can read active exam periods`);
    assert.equal(visible.inactive_period, role === 'staff' || role === 'admin' ? 1 : 0);
    assert.equal(visible.staff_user, role === 'staff' || role === 'admin');
    assert.equal(visible.ticket, role === 'student' || role === 'staff' || role === 'admin' ? 1 : 0);
    assert.equal(visible.response, role === 'student' || role === 'staff' || role === 'admin' ? 1 : 0);
  }
});

test('staff and admins require AAL2 for direct RLS access while enrollment is pending or policy requires it', async () => {
  await client.query(
    `INSERT INTO public.staff_mfa_enrollments (user_id, enrollment_status)
     VALUES ($1, 'pending') ON CONFLICT (user_id) DO NOTHING`,
    [roleIds.staff],
  );
  const staffAal1 = await asRole(roleIds.staff, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.staff],
    );
    return counts.profile_count;
  });
  assert.equal(staffAal1, 0);
  const staffAal2 = await asRole(roleIds.staff, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.staff],
    );
    return counts.profile_count;
  }, 'aal2');
  assert.equal(staffAal2, 0, 'pending enrollment is blocked even with an AAL2 token');
  await client.query(
    `UPDATE public.staff_mfa_enrollments
     SET enrollment_status = 'verified', verified_at = now()
     WHERE user_id = $1`,
    [roleIds.staff],
  );
  const enrolledStaffAal2 = await asRole(roleIds.staff, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.staff],
    );
    return counts.profile_count;
  }, 'aal2');
  assert.equal(enrolledStaffAal2, 1);

  await client.query('UPDATE public.auth_security_settings SET require_staff_mfa = true WHERE singleton');
  const adminAal1 = await asRole(roleIds.admin, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.admin],
    );
    return counts.profile_count;
  });
  assert.equal(adminAal1, 0);
  const adminAal2 = await asRole(roleIds.admin, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.admin],
    );
    return counts.profile_count;
  }, 'aal2');
  assert.equal(adminAal2, 0, 'AAL2 from a non-TOTP factor is not enough without verified TOTP enrollment');
  await client.query(
    `INSERT INTO public.staff_mfa_enrollments (user_id, enrollment_status, verified_at)
     VALUES ($1, 'verified', now()) ON CONFLICT (user_id) DO NOTHING`,
    [roleIds.admin],
  );
  const enrolledAdminAal2 = await asRole(roleIds.admin, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.admin],
    );
    return counts.profile_count;
  }, 'aal2');
  assert.equal(enrolledAdminAal2, 1);
  const lecturerAal1 = await asRole(roleIds.lecturer, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.lecturer],
    );
    return counts.profile_count;
  });
  assert.equal(lecturerAal1, 1);
  const studentAal1 = await asRole(roleIds.student, async () => {
    const { rows: [counts] } = await client.query(
      'SELECT count(*)::int AS profile_count FROM public.profiles WHERE id = $1',
      [roleIds.student],
    );
    return counts.profile_count;
  });
  assert.equal(studentAal1, 1);
});

test('storage and public-schedule policies are scoped and the statement bucket stays private', async () => {
  const { rows: policies } = await client.query(
    `SELECT schemaname, tablename, policyname, qual, with_check
       FROM pg_policies
      WHERE (schemaname = 'public' AND tablename IN ('slots', 'exam_periods'))
         OR (schemaname = 'storage' AND tablename = 'objects'
             AND policyname IN ('fee_statements_storage_select', 'fee_statements_storage_insert'))`,
  );
  const byName = new Map(policies.map((policy) => [policy.policyname, policy]));
  for (const name of ['slots_select', 'exam_periods_select', 'fee_statements_storage_select', 'fee_statements_storage_insert']) {
    assert.ok(byName.has(name), `Missing RLS policy ${name}.`);
    const policy = byName.get(name);
    assert.match(`${policy.qual ?? ''} ${policy.with_check ?? ''}`, /is_active_user/i);
  }
  const { rows: [bucket] } = await client.query(
    `SELECT public, file_size_limit, allowed_mime_types
       FROM storage.buckets WHERE id = 'fee-statements'`,
  );
  assert.ok(bucket, 'The private fee-statements bucket must be migration-managed.');
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 5 * 1024 * 1024);
  assert.ok(bucket.allowed_mime_types.includes('application/pdf'));
  assert.ok(bucket.allowed_mime_types.includes('image/jpeg'));
});
