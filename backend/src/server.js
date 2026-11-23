import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { supabaseAdmin } from './supabase.js';
import { logger } from './logger.js';

const bail = (event, errorCode) => {
  logger.error(event, { errorCode });
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
  logger.error('startup_database_connection_failed', { errorCode: e.code });
  for (const hint of hints) logger.warn('startup_database_hint', { errorCode: hint.includes('Session pooler') ? 'use_session_pooler' : 'check_credentials' });
  bail('startup_aborted');
}

// 2. Has the schema been applied?
try {
  await pool.query('SELECT 1 FROM public.profiles LIMIT 1');
} catch (e) {
  if (e.code === '42P01') {
    bail('startup_schema_missing', e.code);
  }
  bail('startup_schema_check_failed', e.code);
}

try {
  const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM public.student_registry');
  if (count === 0) {
    logger.warn('student_registry_empty');
  } else {
    logger.info('student_registry_loaded', { count });
  }
} catch (e) {
  if (e.code === '42P01') {
    bail('startup_student_registry_missing', e.code);
  }
  bail('startup_student_registry_check_failed', e.code);
}

// 3. Is the service-role key accepted by Supabase Auth? (A wrong key makes every sign-in fail in confusing ways.)
{
  const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) {
    if (error.status === 401 || error.status === 403) {
      bail('startup_supabase_auth_rejected', error.status);
    }
    logger.warn('startup_supabase_auth_unavailable', { errorCode: error.status });
  }
}

const server = createApp().listen(config.port, '0.0.0.0', () => {
  logger.info('api_started');
  logger.info('api_connections_ready');
});

// Stop taking new requests, let running ones finish, then close the database pool. A host's "deploy" sends SIGTERM.
let stopping = false;
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  logger.info(signal === 'SIGTERM' ? 'shutdown_sigterm' : 'shutdown_sigint');
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => pool.end().then(() => process.exit(0)));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', { errorCode: reason?.code }));
