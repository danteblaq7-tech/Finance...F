// Local-only demo account and seed-data helpers.
import { readFile } from 'node:fs/promises';
import { pool, queryOne, query } from '../src/db.js';
import { assertLocalDemoTarget } from '../src/localProject.js';
import { supabaseAdmin } from '../src/supabase.js';

const LOCAL_SEED_FILE = new URL('../../database/supabase/local/seed_demo.sql', import.meta.url);
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Finesse@2026';

const DEMO_USERS = [
  { email: 'admin@finesse.ac.ke', name: 'Grace Wanjiru', role: 'admin', university: 'Moi University' },
  { email: 'staff@finesse.ac.ke', name: 'Susan Otieno', role: 'staff', university: 'Moi University' },
  { email: 'lecturer@finesse.ac.ke', name: 'Dr Peter Otieno', role: 'lecturer', university: 'Moi University' },
  { email: 'amina@students.finesse.ac.ke', name: 'Amina Hassan', role: 'student', student_id: 'EGM/027/2024', university: 'Moi University', course: 'BSc Electrical Engineering', year_of_study: '2' },
  { email: 'brian@students.finesse.ac.ke', name: 'Brian Kiprop', role: 'student', student_id: 'SCI/114/2023', university: 'Moi University', course: 'BSc Computer Science', year_of_study: '3' },
  { email: 'cynthia@students.finesse.ac.ke', name: 'Cynthia Chebet', role: 'student', student_id: 'BUS/052/2025', university: 'Moi University', course: 'BCom Finance', year_of_study: '1' },
  { email: 'david@students.finesse.ac.ke', name: 'David Mutua', role: 'student', student_id: 'MED/009/2022', university: 'Moi University', course: 'MBChB Medicine', year_of_study: '4' },
];

async function createDemoUsers() {
  console.log('→ Creating demo logins in Supabase Auth …');
  for (const u of DEMO_USERS) {
    let profile = await queryOne('SELECT id, role FROM profiles WHERE email = $1', [u.email]);
    if (!profile) {
      const { error } = await supabaseAdmin.auth.admin.createUser({
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { name: u.name, student_id: u.student_id ?? null, university: u.university ?? null, course: u.course ?? null, year_of_study: u.year_of_study ?? null },
      });
      if (error) throw new Error(`Could not create ${u.email}: ${error.message}`);
      profile = await queryOne('SELECT id, role FROM profiles WHERE email = $1', [u.email]);
      if (!profile) throw new Error(`${u.email} was created in Auth but has no profile. Run "npm run db:schema" first.`);
      console.log(`  + ${u.email}`);
    } else {
      console.log(`  = ${u.email} (already exists)`);
    }
    // Sign-ups always start as 'student'; promotion is a deliberate, server-side step.
    if (profile.role !== u.role) await query('UPDATE profiles SET role = $1 WHERE id = $2', [u.role, profile.id]);
  }
}

function requireLocalDemoTarget() {
  assertLocalDemoTarget({
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl: process.env.SUPABASE_URL,
    databaseUrl: process.env.DATABASE_URL,
  });
}

async function requireCurrentSchema() {
  const ok = await queryOne("SELECT to_regclass('public.exam_units') IS NOT NULL AS tables, pg_get_constraintdef(c.oid) LIKE '%lecturer%' AS role_ok FROM pg_constraint c WHERE c.conname = 'profiles_role_check' AND c.conrelid = 'public.profiles'::regclass");
  if (!ok?.tables || !ok?.role_ok) {
    throw new Error('Apply the Supabase migrations to the local database first with "supabase db reset".');
  }
}

async function seed() {
  requireLocalDemoTarget();
  await requireCurrentSchema();
  await createDemoUsers();
  console.log('→ Loading local-only demo data …');
  await pool.query(await readFile(LOCAL_SEED_FILE, 'utf8'));
  console.log(`✔ Demo data loaded. Every demo account uses the password: ${DEMO_PASSWORD}`);
}

// Set every EXISTING demo account's password back to the demo password (use when a demo login says "Invalid login credentials").
async function demoPasswords() {
  requireLocalDemoTarget();
  console.log('→ Resetting demo passwords …');
  for (const u of DEMO_USERS) {
    const profile = await queryOne('SELECT id FROM profiles WHERE email = $1', [u.email]);
    if (!profile) { console.log(`  - ${u.email}: no such account (run "npm run db:seed" to create it)`); continue; }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: DEMO_PASSWORD, email_confirm: true });
    console.log(error ? `  ! ${u.email}: ${error.message}` : `  = ${u.email}`);
  }
  console.log(`✔ Done. The demo password is: ${DEMO_PASSWORD}`);
}

const commands = {
  seed,
  passwords: demoPasswords,
};

const name = process.argv[2] ?? 'seed';
if (!commands[name]) {
  console.error(`Unknown command "${name}". Use one of: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

try {
  await commands[name]();
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  if (e.code === 'ENOTFOUND' || e.code === 'ENETUNREACH') console.error('  Use the "Session pooler" connection string (IPv4-friendly) for DATABASE_URL.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
