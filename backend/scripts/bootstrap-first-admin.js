import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { pool } from '../src/db.js';
import { supabaseAdmin } from '../src/supabase.js';

const REQUIRED_MIGRATIONS = [
  '20261122180000',
  '20261122190000',
  '20261122200000',
  '20261122201000',
  '20261123070000',
];
const REQUIRED_PROFILE_COLUMNS = [
  'id',
  'name',
  'email',
  'role',
  'is_active',
  'must_change_password',
];

const schema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(190),
});

async function assertRequiredMigrations(client) {
  const { rows: [migrationStatus] } = await client.query(
    "SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_table",
  );
  if (!migrationStatus?.migration_table) {
    throw new Error('Required Supabase migrations are not recorded as applied. Run `supabase db push` against this project, then retry.');
  }

  const { rows: appliedRows } = await client.query(
    'SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])',
    [REQUIRED_MIGRATIONS],
  );
  const applied = new Set(appliedRows.map((row) => row.version));
  const missing = REQUIRED_MIGRATIONS.filter((version) => !applied.has(version));
  if (missing.length) {
    throw new Error(`Required Supabase migrations are missing (${missing.join(', ')}). Run \`supabase db push\` against this project, then retry.`);
  }

  const { rows: columnRows } = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name = ANY($1::text[])`,
    [REQUIRED_PROFILE_COLUMNS],
  );
  const columns = new Set(columnRows.map((row) => row.column_name));
  const missingColumns = REQUIRED_PROFILE_COLUMNS.filter((column) => !columns.has(column));
  if (missingColumns.length) {
    throw new Error(`The profile schema is incomplete (missing ${missingColumns.join(', ')}). Apply the required Supabase migrations before bootstrapping.`);
  }
}

async function findAuthUserByEmail(authAdmin, email) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage });
    if (error) throw new Error(`Supabase could not check for an existing account (${error.code || 'unknown error'}).`);
    const users = data?.users ?? [];
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (users.length < perPage) return null;
  }
}

export async function runBootstrap({ dbPool, authAdmin, input, output = process.stdout }) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`First-admin bootstrap configuration is invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  const { name, email } = parsed.data;
  const client = await dbPool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('finesse_staff_lifecycle'))");

    await assertRequiredMigrations(client);
    const { rows: [existingAdmin] } = await client.query(
      "SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1",
    );
    if (existingAdmin) throw new Error('An admin profile already exists; first-admin bootstrap is disabled.');

    const temporaryPassword = randomBytes(32).toString('base64url');
    let user = await findAuthUserByEmail(authAdmin, email);
    if (user) {
      const { error } = await authAdmin.updateUserById(user.id, {
        password: temporaryPassword,
        user_metadata: { ...user.user_metadata, name },
        app_metadata: { ...user.app_metadata, role: 'admin', must_change_password: true },
      });
      if (error) throw new Error(`Supabase could not reset the existing bootstrap account (${error.code || 'unknown error'}).`);
    } else {
      const { data, error } = await authAdmin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { name },
        app_metadata: { role: 'admin', must_change_password: true },
      });
      if (error) throw new Error(`Supabase could not create the bootstrap account (${error.code || 'unknown error'}).`);
      user = data?.user;
      if (!user?.id) throw new Error('Supabase did not return an ID for the bootstrap account.');
    }

    const { rowCount } = await client.query(
      `INSERT INTO public.profiles (id, name, email, role, is_active, must_change_password)
       VALUES ($1, $2, $3, 'admin', true, true)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           role = 'admin',
           is_active = true,
           must_change_password = true
       RETURNING id`,
      [user.id, name, email],
    );
    if (rowCount !== 1) throw new Error('The bootstrap profile could not be created.');

    await client.query('COMMIT');
    transactionStarted = false;
    output.write(`First admin account ready for ${email}.\nTemporary password (shown once): ${temporaryPassword}\nSign in and change it immediately.\n`);
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const parsed = schema.safeParse({
    name: process.env.BOOTSTRAP_ADMIN_NAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
  });
  if (!parsed.success) {
    console.error(`First-admin bootstrap configuration is invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
    process.exitCode = 1;
  } else {
    try {
      await runBootstrap({ dbPool: pool, authAdmin: supabaseAdmin.auth.admin, input: parsed.data });
    } catch (error) {
      console.error(`First-admin bootstrap failed: ${error.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
