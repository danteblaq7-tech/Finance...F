import { createApp } from './app.js';
import { config, describeTarget } from './config.js';
import { pool } from './db.js';
import { ensureStatementBucket } from './storage.js';
import { supabaseAdmin } from './supabase.js';

const target = describeTarget();
const bail = (lines) => {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('');
  process.exit(1);
};

// 1. Can we reach the Supabase Postgres database?
try {
  await pool.query('SELECT 1');
} catch (e) {
  const hints = [];
  if (['ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH'].includes(e.code) || /ENETUNREACH|EHOSTUNREACH/.test(e.message)) {
    hints.push('  The "Direct connection" host (db.<ref>.supabase.co) is IPv6-only and many home/campus networks have no IPv6.');
    hints.push('  Use the "Session pooler" string instead: Supabase dashboard ▸ Connect ▸ Session pooler (host ends in pooler.supabase.com).');
  } else if (e.code === '28P01' || /password authentication failed/i.test(e.message)) {
    hints.push('  Wrong database password. Reset it in Supabase ▸ Project Settings ▸ Database, then update DATABASE_URL.');
    hints.push('  With the pooler the username is "postgres.<project-ref>", not just "postgres".');
  } else if (/Tenant or user not found/i.test(e.message)) {
    hints.push('  The pooler did not recognise the project. Check the region/host and that the username is "postgres.<project-ref>".');
  } else if (e.code === 'ETIMEDOUT' || /timeout/i.test(e.message)) {
    hints.push('  Timed out. Check your internet connection and that the Supabase project is not paused (free projects pause after a week idle).');
  }
  bail([
    `✖ Cannot connect to the database at ${target.dbHost}:${target.dbPort}.`,
    `  ${e.code || ''} ${e.message}`,
    ...hints,
    '  Check DATABASE_URL in backend/.env (README → "Supabase setup").',
  ]);
}

// 2. Has the schema been applied?
try {
  await pool.query('SELECT 1 FROM public.profiles LIMIT 1');
} catch (e) {
  if (e.code === '42P01') {
    bail([
      '✖ Connected to the database, but the Finesse tables do not exist yet.',
      '  Run once (from the project root):   npm run db:setup',
      '  (or paste database/supabase/schema.sql into the Supabase SQL Editor). Teammates do NOT need to repeat this: the database is shared.',
    ]);
  }
  bail([`✖ Database check failed: ${e.code || ''} ${e.message}`]);
}

// 3. Is the service-role key accepted by Supabase Auth? (A wrong key makes every sign-in fail in confusing ways.)
{
  const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) {
    if (error.status === 401 || error.status === 403) {
      bail([
        '✖ Supabase rejected SUPABASE_SERVICE_ROLE_KEY.',
        '  Copy the "service_role" (or "secret") key from Project Settings ▸ API, and make sure SUPABASE_URL belongs to the same project.',
      ]);
    }
    console.warn(`! Could not verify the Supabase Auth connection (${error.message}). Continuing; sign-in may fail until it is reachable.`);
  }
}

// 4. The private bucket that holds uploaded fee statements. Without it uploads fail, so say so loudly (but keep serving everything else).
try {
  await ensureStatementBucket();
} catch (e) {
  console.warn(`! Could not prepare the '${config.statementBucket}' storage bucket (${e.message}). Fee-statement uploads will fail until it exists.`);
}

const server = createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`✔ Finesse API listening on 0.0.0.0:${config.port}  (${config.nodeEnv})`);
  console.log(`  database: ${target.dbHost}   auth: ${target.supabaseHost}   fee statements: ${config.feeStatementMode} mode`);
  if (config.isProd && config.corsOrigins.some((o) => /localhost|127\.0\.0\.1/.test(o))) console.warn('! CORS_ORIGIN still lists a localhost address in production.');
});

// Stop taking new requests, let running ones finish, then close the database pool. A host's "deploy" sends SIGTERM.
let stopping = false;
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received: shutting down…`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => pool.end().then(() => process.exit(0)));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => console.error(JSON.stringify({ level: 'error', message: 'Unhandled promise rejection', reason: String(reason?.stack ?? reason) })));
