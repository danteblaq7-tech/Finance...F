const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocalUrl(value) {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertLocalDemoTarget({ nodeEnv, supabaseUrl, databaseUrl }) {
  if (nodeEnv === 'production') {
    throw new Error('Demo data operations are disabled when NODE_ENV=production.');
  }
  if (!isLocalUrl(supabaseUrl) || !isLocalUrl(databaseUrl)) {
    throw new Error('Demo data operations require both SUPABASE_URL and DATABASE_URL to point to a local Supabase CLI project.');
  }
}
