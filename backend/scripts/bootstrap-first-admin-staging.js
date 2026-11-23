import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const stagingRef = 'jqmxcnilrwgirsdufzjn';
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(backendDir, '.env.staging');

const loaded = dotenv.config({ path: envPath, override: true });
if (loaded.error) {
  console.error('Staging bootstrap requires backend/.env.staging. Create it from backend/.env.staging.example and fill in the staging credentials.');
  process.exit(1);
}

function isStagingTarget(env) {
  let supabaseUrl;
  let databaseUrl;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL);
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    return false;
  }

  const expectedSupabase = supabaseUrl.protocol === 'https:'
    && supabaseUrl.origin === `https://${stagingRef}.supabase.co`
    && supabaseUrl.pathname === '/'
    && !supabaseUrl.username
    && !supabaseUrl.password
    && !supabaseUrl.search
    && !supabaseUrl.hash;
  const directDatabase = databaseUrl.hostname === `db.${stagingRef}.supabase.co`;
  const stagingPooler = databaseUrl.hostname.endsWith('.pooler.supabase.com')
    && databaseUrl.username === `postgres.${stagingRef}`;
  return expectedSupabase && (directDatabase || stagingPooler);
}

if (!isStagingTarget(process.env)) {
  console.error(`Staging bootstrap refused: backend/.env.staging must target Supabase project ${stagingRef} and its database.`);
  process.exit(1);
}

if (!process.env.BOOTSTRAP_ADMIN_NAME?.trim() || !process.env.BOOTSTRAP_ADMIN_EMAIL?.trim()) {
  console.error('Set BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_EMAIL in the current PowerShell session before running this command.');
  process.exit(1);
}

const [{ runBootstrap }, { pool }, { supabaseAdmin }] = await Promise.all([
  import('./bootstrap-first-admin.js'),
  import('../src/db.js'),
  import('../src/supabase.js'),
]);

try {
  await runBootstrap({
    dbPool: pool,
    authAdmin: supabaseAdmin.auth.admin,
    input: {
      name: process.env.BOOTSTRAP_ADMIN_NAME,
      email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    },
  });
} catch {
  console.error('Staging first-admin bootstrap failed. Check staging connectivity, credentials, and applied migrations; no temporary password was issued.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
