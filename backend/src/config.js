import 'dotenv/config';

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

const required = (name) => {
  const v = process.env[name];
  if (!v) fail(`Missing ${name}. Copy backend/.env.example to backend/.env and fill it in (see README step 3).`);
  return v;
};

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.startsWith('change-me') && process.env.NODE_ENV === 'production') {
  fail('JWT_SECRET must be changed from the example value in production.');
}

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || 'finesse',
  },
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      }
    : null,
  mailFrom: process.env.MAIL_FROM || 'Finesse <noreply@finesse.ac.ke>',
};
