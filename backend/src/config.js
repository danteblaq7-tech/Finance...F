import 'dotenv/config';

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

// Values copied straight from the template (or from Supabase's "[YOUR-PASSWORD]" example) are not real.
const looksLikePlaceholder = (v) => /your[-_ ]?(project|password|anon|service|ref)|\[YOUR|<.*>|paste[-_ ]/i.test(v);

const required = (name, where) => {
  const v = process.env[name]?.trim();
  if (!v) fail(`Missing ${name}. Copy backend/.env.example to backend/.env and fill it in.\n  Where to find it: ${where}\n  Full walkthrough: README → "Supabase setup".`);
  if (looksLikePlaceholder(v)) fail(`${name} in backend/.env still has the placeholder text from the template.\n  Where to find the real value: ${where}`);
  return v;
};

const supabaseUrl = required('SUPABASE_URL', 'Supabase dashboard ▸ Project Settings ▸ API ▸ Project URL').replace(/\/+$/, '');
const anonKey = required('SUPABASE_ANON_KEY', 'Supabase dashboard ▸ Project Settings ▸ API ▸ anon / publishable key');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY', 'Supabase dashboard ▸ Project Settings ▸ API ▸ service_role / secret key (keep it private!)');
const databaseUrl = required('DATABASE_URL', 'Supabase dashboard ▸ Connect ▸ "Session pooler" connection string (IPv4-friendly)');

try {
  new URL(supabaseUrl);
} catch {
  fail('SUPABASE_URL is not a valid URL. It looks like https://abcdefghijkl.supabase.co');
}
try {
  new URL(databaseUrl);
} catch {
  fail(
    'DATABASE_URL is not a valid URL.\n' +
      '  If your database password contains special characters such as @ # / ? : % you must URL-encode them\n' +
      '  (for example "@" becomes "%40"), or reset the password to letters and digits only.',
  );
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// In production the API must know exactly which website may call it, and where that website lives (for QR codes and emails).
if (isProd) {
  if (!process.env.CORS_ORIGIN?.trim()) fail('CORS_ORIGIN must be set in production: the public URL of the web app, e.g. https://finesse.example.ac.ke');
  if (!process.env.PUBLIC_WEB_URL?.trim()) fail('PUBLIC_WEB_URL must be set in production: the public URL of the web app. It is encoded in the QR code on printed exam cards.');
}

const statementMode = (process.env.FEE_STATEMENT_MODE || 'verify').trim().toLowerCase();
if (!['verify', 'trust'].includes(statementMode)) fail('FEE_STATEMENT_MODE must be "verify" (default, safer) or "trust".');

export const config = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT || 4000),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  // Public URL of the web app (no trailing slash). A printed exam card's QR code points at <this>/verify/<code>.
  publicWebUrl: (process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').trim().replace(/\/+$/, ''),
  // How many reverse proxies sit in front of the API (Render, Railway, Fly, nginx … = 1). Needed for correct client IPs and rate limits.
  trustProxy: process.env.TRUST_PROXY === undefined || process.env.TRUST_PROXY === '' ? (isProd ? 1 : false) : Number(process.env.TRUST_PROXY),
  // 'verify': an uploaded statement can DENY on its own but a cleared one waits for the finance office. 'trust': a cleared statement approves at once.
  feeStatementMode: statementMode,
  statementBucket: process.env.STATEMENT_BUCKET || 'fee-statements',
  maxStatementBytes: Number(process.env.MAX_STATEMENT_MB || 5) * 1024 * 1024,
  supabase: { url: supabaseUrl, anonKey, serviceRoleKey },
  databaseUrl,
  // undefined = decide from the host (TLS for anything that isn't localhost). Set DATABASE_SSL=false for a local Postgres.
  databaseSsl: process.env.DATABASE_SSL === undefined || process.env.DATABASE_SSL === '' ? undefined : process.env.DATABASE_SSL !== 'false',
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      }
    : null,
  mailFrom: process.env.MAIL_FROM || 'Finesse <noreply@finesse.ac.ke>',
};

/** Safe-to-print description of where we're connected (no secrets). */
export const describeTarget = () => {
  const db = new URL(config.databaseUrl);
  return { dbHost: db.hostname, dbPort: db.port || '5432', supabaseHost: new URL(config.supabase.url).hostname };
};
