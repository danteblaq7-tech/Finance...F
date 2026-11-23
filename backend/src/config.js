import 'dotenv/config';

const fail = (msg) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'configuration_invalid',
    message: msg,
  }));
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

const corsOriginEntries = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());
const corsOrigins = corsOriginEntries.filter(Boolean);
// In production the API must know exactly which website may call it, and where that website lives (for QR codes and emails).
if (isProd) {
  if (!process.env.CORS_ORIGIN?.trim()) fail('CORS_ORIGIN must be set in production: the public URL of the web app, e.g. https://finesse.example.ac.ke');
  if (!process.env.PUBLIC_WEB_URL?.trim()) fail('PUBLIC_WEB_URL must be set in production: the public URL of the web app. It is encoded in the QR code on printed exam cards.');
  if (!corsOrigins.length || corsOrigins.length !== corsOriginEntries.length) {
    fail('CORS_ORIGIN must contain one or more non-empty exact HTTPS origins in production.');
  }
  for (const origin of corsOrigins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error();
    } catch {
      fail('Every production CORS_ORIGIN must be an exact HTTPS origin without a path, wildcard, or credentials.');
    }
  }
  try {
    const url = new URL(process.env.PUBLIC_WEB_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    fail('PUBLIC_WEB_URL must be an absolute HTTPS URL without credentials, query, or fragment in production.');
  }
}

const trustProxyText = process.env.TRUST_PROXY?.trim();
let trustProxy = isProd ? 1 : false;
if (trustProxyText) {
  if (trustProxyText === 'true' && !isProd) trustProxy = true;
  else if (trustProxyText === 'false') trustProxy = false;
  else if (/^\d+$/.test(trustProxyText) && Number(trustProxyText) <= 10) trustProxy = Number(trustProxyText);
  else fail('TRUST_PROXY must be false or a proxy hop count from 0 to 10 (production must not use true).');
}

const statementMode = (process.env.FEE_STATEMENT_MODE || 'verify').trim().toLowerCase();
if (!['verify', 'trust'].includes(statementMode)) fail('FEE_STATEMENT_MODE must be "verify" (default, safer) or "trust".');
const maxStatementMb = Number(process.env.MAX_STATEMENT_MB || 5);
if (!Number.isInteger(maxStatementMb) || maxStatementMb < 1 || maxStatementMb > 5) {
  fail('MAX_STATEMENT_MB must be a whole number from 1 to 5; Supabase Storage enforces the 5 MB bucket limit.');
}

const studentIdPatternText = process.env.STUDENT_ID_PATTERN?.trim() || '^[A-Z]{2,6}/\\d{3,4}/\\d{2}$';
let studentIdPattern;
try {
  studentIdPattern = new RegExp(studentIdPatternText);
} catch {
  fail('STUDENT_ID_PATTERN must be a valid regular expression.');
}

const classifierApiKey = process.env.CLASSIFIER_LLM_API_KEY?.trim() || '';
const classifierEndpoint = process.env.CLASSIFIER_LLM_URL?.trim() || '';
const classifierModel = process.env.CLASSIFIER_LLM_MODEL?.trim() || '';
const classifierTimeoutMs = Number(process.env.CLASSIFIER_TIMEOUT_MS || 4000);
if (classifierApiKey) {
  if (!classifierEndpoint || !classifierModel) {
    fail('CLASSIFIER_LLM_URL and CLASSIFIER_LLM_MODEL are required when CLASSIFIER_LLM_API_KEY is set.');
  }
  try {
    const url = new URL(classifierEndpoint);
    if (isProd && url.protocol !== 'https:') fail('CLASSIFIER_LLM_URL must use HTTPS in production.');
  } catch {
    fail('CLASSIFIER_LLM_URL must be an absolute URL.');
  }
}
if (!Number.isInteger(classifierTimeoutMs) || classifierTimeoutMs < 250 || classifierTimeoutMs > 30_000) {
  fail('CLASSIFIER_TIMEOUT_MS must be an integer from 250 to 30000.');
}

export const config = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT || 4000),
  corsOrigins,
  // Public URL of the web app (no trailing slash). A printed exam card's QR code points at <this>/verify/<code>.
  publicWebUrl: (process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').trim().replace(/\/+$/, ''),
  // How many reverse proxies sit in front of the API (Render, Railway, Fly, nginx … = 1). Needed for correct client IPs and rate limits.
  trustProxy,
  // 'verify': an uploaded statement can DENY on its own but a cleared one waits for the finance office. 'trust': a cleared statement approves at once.
  feeStatementMode: statementMode,
  studentIdPattern,
  classifier: {
    apiKey: classifierApiKey,
    endpoint: classifierEndpoint,
    model: classifierModel,
    timeoutMs: classifierTimeoutMs,
  },
  statementBucket: 'fee-statements',
  maxStatementBytes: maxStatementMb * 1024 * 1024,
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
