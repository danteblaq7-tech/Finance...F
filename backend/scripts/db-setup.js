// One-command database setup for Supabase.
//
//   npm run db:schema   create/upgrade tables, security rules and realtime (safe to re-run, never deletes data)
//   npm run db:seed     create the demo logins in Supabase Auth, then load the demo data
//   npm run db:setup    both of the above  ← what you want the first time
//   npm run db:reset    ⚠ DROP every Finesse table (asks first), then run db:setup yourself
//
// Everything here talks to the project in backend/.env. Because the whole team shares one Supabase project,
// the project OWNER runs this once; teammates never need to.
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { describeTarget } from '../src/config.js';
import { pool, queryOne, query } from '../src/db.js';
import { supabaseAdmin } from '../src/supabase.js';

const SQL_DIR = new URL('../../database/supabase/', import.meta.url);
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Finesse@2026';

const DEMO_USERS = [
  { email: 'admin@finesse.ac.ke', name: 'Grace Wanjiru', role: 'admin', university: 'Moi University' },
  { email: 'staff@finesse.ac.ke', name: 'Susan Otieno', role: 'staff', university: 'Moi University' },
  { email: 'amina@students.finesse.ac.ke', name: 'Amina Hassan', role: 'student', student_id: 'EGM/027/2024', university: 'Moi University', course: 'BSc Electrical Engineering', year_of_study: '2' },
  { email: 'brian@students.finesse.ac.ke', name: 'Brian Kiprop', role: 'student', student_id: 'SCI/114/2023', university: 'Moi University', course: 'BSc Computer Science', year_of_study: '3' },
  { email: 'cynthia@students.finesse.ac.ke', name: 'Cynthia Chebet', role: 'student', student_id: 'BUS/052/2025', university: 'Moi University', course: 'BCom Finance', year_of_study: '1' },
  { email: 'david@students.finesse.ac.ke', name: 'David Mutua', role: 'student', student_id: 'MED/009/2022', university: 'Moi University', course: 'MBChB Medicine', year_of_study: '4' },
];

const runFile = async (name) => pool.query(await readFile(new URL(name, SQL_DIR), 'utf8'));

async function applySchema() {
  console.log('→ Applying database/supabase/schema.sql …');
  await runFile('schema.sql');
  console.log('✔ Schema, security policies and realtime are in place.');
}

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

async function seed() {
  await createDemoUsers();
  console.log('→ Loading demo data (database/supabase/seed_demo.sql) …');
  await runFile('seed_demo.sql');
  console.log(`✔ Demo data loaded. Every demo account uses the password: ${DEMO_PASSWORD}`);
}

async function reset() {
  const { dbHost } = describeTarget();
  console.log(`⚠  This will DROP every Finesse table in the database at ${dbHost}.`);
  console.log('   The whole team shares this database, so everyone loses their data. Supabase Auth users are not deleted.');
  if (!process.argv.includes('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('   Type RESET to continue: ')).trim();
    rl.close();
    if (answer !== 'RESET') {
      console.log('Cancelled. Nothing was changed.');
      return;
    }
  }
  await runFile('reset.sql');
  console.log('✔ Tables dropped. Now run: npm run db:setup');
}

const commands = {
  schema: applySchema,
  seed,
  all: async () => {
    await applySchema();
    await seed();
  },
  reset,
};

const name = process.argv[2] ?? 'all';
if (!commands[name]) {
  console.error(`Unknown command "${name}". Use one of: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

const { dbHost } = describeTarget();
console.log(`Using the database at ${dbHost}\n`);
try {
  await commands[name]();
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  if (e.code === 'ENOTFOUND' || e.code === 'ENETUNREACH') console.error('  Use the "Session pooler" connection string (IPv4-friendly) for DATABASE_URL.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
