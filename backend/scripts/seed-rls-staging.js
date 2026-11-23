import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

const stagingEnv = resolve(process.cwd(), '.env.staging');
const loaded = dotenv.config({ path: stagingEnv, override: true });
if (loaded.error) {
  console.error('RLS profile seeding requires backend/.env.staging. Create it from backend/.env.staging.example.');
  process.exit(1);
}

const { assertStagingIntegrationTarget } = await import('../src/integrationTestGuard.js');
try {
  assertStagingIntegrationTarget();
} catch (error) {
  console.error(`RLS profile seeding refused: ${error.message}`);
  process.exit(1);
}

const [{ pool }, { supabaseAdmin }] = await Promise.all([
  import('../src/db.js'),
  import('../src/supabase.js'),
]);

async function assertMigrationsApplied() {
  const { rows } = await pool.query(`
    SELECT to_regclass('public.profiles') IS NOT NULL AS profiles,
           to_regclass('public.ticket_responses') IS NOT NULL AS responses,
           to_regclass('public.slots') IS NOT NULL AS slots,
           to_regclass('public.exam_periods') IS NOT NULL AS periods,
           to_regclass('public.staff_action_audit_log') IS NOT NULL AS audit_log,
           to_regclass('storage.buckets') IS NOT NULL AS storage_buckets,
           to_regprocedure('public.is_active_user()') IS NOT NULL AS active_user_fn,
           EXISTS (
             SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND policyname = 'profiles_select'
           ) AS profile_policy,
           EXISTS (
             SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND policyname = 'ticket_responses_select'
           ) AS response_policy,
           EXISTS (
             SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND policyname = 'slots_select'
           ) AS slots_policy,
           EXISTS (
             SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND policyname = 'exam_periods_select'
           ) AS periods_policy,
           EXISTS (
             SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND policyname = 'fee_statements_storage_select'
           ) AS storage_read_policy,
           EXISTS (
             SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND policyname = 'fee_statements_storage_insert'
           ) AS storage_insert_policy,
           EXISTS (
             SELECT 1 FROM storage.buckets
              WHERE id = 'fee-statements' AND public = false
           ) AS private_statement_bucket,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'profiles'
                AND column_name IN ('is_active', 'must_change_password')
              GROUP BY table_name
             HAVING count(*) = 2
           ) AS profile_columns
  `);
  if (Object.values(rows[0]).some((present) => !present)) {
    throw new Error('Required profile, response-history, active-user, audit-log, storage, or RLS-policy migrations are missing. Apply all staging migrations before seeding.');
  }
}

async function findAuthUser(email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not check the staging Auth user list (${error.code ?? 'unknown error'}).`);
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw new Error('Staging Auth user list exceeded the safety pagination limit.');
}

const suffix = process.env.RLS_TEST_EMAIL_DOMAIN?.trim().toLowerCase() || 'example.test';
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(suffix)) {
  throw new Error('RLS_TEST_EMAIL_DOMAIN must be a plain email domain.');
}
const testProfiles = [
  { role: 'student', name: 'Finesse RLS Test Student', active: true },
  { role: 'staff', name: 'Finesse RLS Test Finance Staff', active: true },
  { role: 'lecturer', name: 'Finesse RLS Test Lecturer', active: true },
  { role: 'admin', name: 'Finesse RLS Test Admin', active: true },
  { role: 'inactive', name: 'Finesse RLS Test Inactive Student', active: false },
];

try {
  await assertMigrationsApplied();
  let studentNumber;
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const candidate = `RLS/${100 + attempt}/99`;
    const { rows } = await pool.query('SELECT 1 FROM public.profiles WHERE student_id = $1 LIMIT 1', [candidate]);
    if (rows.length === 0) {
      studentNumber = candidate;
      break;
    }
  }
  if (!studentNumber) throw new Error('No unused student number remains for the staging RLS profile; free an RLS/100-999/99 number first.');

  const created = [];
  for (const profile of testProfiles) {
    const role = profile.role === 'inactive' ? 'student' : profile.role;
    const email = `finesse-rls-${profile.role}@${suffix}`;
    let user = await findAuthUser(email);
    if (!user) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: `${randomBytes(32).toString('base64url')}R9!`,
        email_confirm: true,
        user_metadata: { name: profile.name },
        app_metadata: { role, must_change_password: false, finesse_rls_test_profile: true },
      });
      if (error) throw new Error(`Could not create staging ${profile.role} test user (${error.code ?? 'unknown error'}).`);
      user = data.user;
    } else if (user.app_metadata?.finesse_rls_test_profile !== true) {
      throw new Error(`Refusing to overwrite pre-existing Auth user ${email}; use a dedicated test email domain.`);
    }

    const profileStudentNumber = profile.role === 'student' ? studentNumber : null;
    await pool.query(
      `INSERT INTO public.profiles (id, name, email, student_id, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email,
         student_id = COALESCE(EXCLUDED.student_id, public.profiles.student_id),
         is_active = EXCLUDED.is_active,
         must_change_password = false`,
      [user.id, profile.name, email, profileStudentNumber, role, profile.active],
    );
    if (!profile.active) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' });
      if (error) throw new Error(`Could not ban the inactive staging profile (${error.code ?? 'unknown error'}).`);
    } else {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { ban_duration: 'none' });
      if (error) throw new Error(`Could not unban the staging ${profile.role} profile (${error.code ?? 'unknown error'}).`);
    }
    created.push(`RLS_TEST_${profile.role.toUpperCase()}_ID=${user.id}`);
  }

  console.log('Staging RLS test profiles are ready. Add these IDs to the test process environment:');
  for (const entry of created) console.log(entry);
} catch (error) {
  console.error(`Staging RLS profile seeding failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}