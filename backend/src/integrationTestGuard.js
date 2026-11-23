const STAGING_PROJECT_REF = 'jqmxcnilrwgirsdufzjn';

export function assertStagingIntegrationTarget(env = process.env) {
  if (env.ALLOW_INTEGRATION_TESTS !== 'staging') {
    throw new Error('Integration tests are disabled. Set ALLOW_INTEGRATION_TESTS=staging to explicitly allow the staging target.');
  }

  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new Error('Integration tests require SUPABASE_URL for the approved staging project.');
  }

  if (
    url.protocol !== 'https:'
    || url.origin !== `https://${STAGING_PROJECT_REF}.supabase.co`
    || url.pathname !== '/'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`Integration tests are restricted to Supabase staging project ${STAGING_PROJECT_REF}.`);
  }

  let database;
  try {
    database = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('Integration tests require DATABASE_URL for the approved staging database.');
  }
  const directDatabase = database.hostname === `db.${STAGING_PROJECT_REF}.supabase.co`;
  const stagingPooler = database.hostname.endsWith('.pooler.supabase.com')
    && decodeURIComponent(database.username) === `postgres.${STAGING_PROJECT_REF}`;
  if (!directDatabase && !stagingPooler) {
    throw new Error(`Integration tests require a staging database connection for project ${STAGING_PROJECT_REF}.`);
  }
}
