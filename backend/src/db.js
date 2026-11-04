import pg from 'pg';
import { config } from './config.js';

// Make Postgres values look exactly like the MySQL ones the web and mobile apps were built against:
//   DATE / TIMESTAMP (no zone)  -> plain strings   "2026-10-17"  /  "2026-10-17 10:00:00"
//   NUMERIC (money)             -> numbers, not strings
//   BIGINT (COUNT(*))           -> numbers
// TIMESTAMPTZ is left alone: it arrives as a Date and is sent to clients as an ISO string with a zone.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1114, (v) => v);
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

function connectionOptions() {
  const url = new URL(config.databaseUrl);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const useSsl = config.databaseSsl ?? !isLocal;
  // Supabase's TLS chain is not in Node's default trust store, and an `sslmode=` in the URL would override our
  // setting below, so drop it and decide TLS ourselves.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('ssl');
  return { connectionString: url.toString(), ssl: useSsl ? { rejectUnauthorized: false } : false };
}

export const pool = new pg.Pool({
  ...connectionOptions(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pooled connection can be dropped by the server while idle. Don't let that crash the API.
pool.on('error', (e) => console.error('Idle database connection error:', e.message));

export const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

export const queryOne = async (sql, params = []) => (await query(sql, params))[0] ?? null;

/** Append a value to a params array and return its "$n" placeholder (for building dynamic WHERE/SET lists). */
export const bind = (params, value) => {
  params.push(value);
  return `$${params.length}`;
};

/** Run fn(client) inside a transaction. client.query(sql, params) works like the helpers above (returns { rows }). */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
