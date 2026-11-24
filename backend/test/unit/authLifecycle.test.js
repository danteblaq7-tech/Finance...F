// Verifies an already-issued bearer token is blocked immediately when its profile is deactivated.
import assert from 'node:assert/strict';
import { before, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;
const state = { active: true, mustChangePassword: false, role: 'student', mfaEnrolled: false, mfaRequired: false, aal: 'aal1' };
const getUser = mock.fn(async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } }, error: null }));
const getClaims = mock.fn(async () => ({ data: { claims: { aal: state.aal } }, error: null }));

mock.module(src('db.js'), {
  namedExports: {
    queryOne: async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Student',
      email: 'student@example.test',
      role: state.role,
      is_active: state.active,
      must_change_password: state.mustChangePassword,
      mfa_enrolled: state.mfaEnrolled,
      mfa_required_by_policy: state.mfaRequired,
    }),
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  },
});
mock.module(src('supabase.js'), {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser,
        getClaims,
        admin: { mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }) } },
      },
    },
  },
});
mock.module(src('middleware/activity.js'), { namedExports: { trackActivity: () => {} } });

let requireAuth;
before(async () => {
  ({ requireAuth } = await import(src('middleware/auth.js')));
});

async function authenticate({ token, baseUrl = '/api/tickets', path = '/', method = 'GET' }) {
  let error;
  const req = {
    headers: { authorization: `Bearer ${token}` },
    baseUrl,
    path,
    method,
  };
  await requireAuth(req, {}, (nextError) => { error = nextError; });
  return { error, user: req.user };
}

describe('account authorization state', () => {
  test('an already-issued token is rejected on the next backend request after deactivation', async () => {
    state.active = true;
    const first = await authenticate({ token: 'still-valid-token' });
    assert.equal(first.error, undefined);

    state.active = false;
    const next = await authenticate({ token: 'still-valid-token' });
    assert.equal(next.error.status, 401);
    assert.equal(next.error.message, 'This account has been deactivated.');
    assert.equal(getUser.mock.calls.length, 1, 'profile active-state is reloaded even while the user ID is token-cached');
  });

  test('temporary-password accounts may reach only the password-change endpoint', async () => {
    state.role = 'student';
    state.active = true;
    state.mustChangePassword = true;
    assert.equal((await authenticate({ token: 'forced-1', baseUrl: '/api/auth', path: '/me' })).error.status, 403);
    assert.equal((await authenticate({ token: 'forced-2', baseUrl: '/api/auth', path: '/change-password', method: 'POST' })).error, undefined);
    assert.equal((await authenticate({ token: 'forced-3', baseUrl: '/api/auth', path: '/register', method: 'POST' })).error.status, 403);
    assert.equal((await authenticate({ token: 'forced-4', baseUrl: '/api/auth', path: '/change-password', method: 'GET' })).error.status, 403);
    assert.equal((await authenticate({ token: 'forced-5' })).error.status, 403);
    state.mustChangePassword = false;
  });

  test('staff with enrolled MFA must present an AAL2 token on protected API routes', async () => {
    state.active = true;
    state.mustChangePassword = false;
    state.role = 'staff';
    state.mfaEnrolled = true;
    state.mfaRequired = false;
    state.aal = 'aal1';
    assert.equal((await authenticate({ token: 'staff-aal1' })).error.status, 403);
    assert.equal((await authenticate({ token: 'staff-mfa-status', baseUrl: '/api/auth', path: '/mfa/status', method: 'GET' })).error, undefined);
    assert.equal((await authenticate({ token: 'staff-me', baseUrl: '/api/auth', path: '/me' })).error, undefined);

    state.aal = 'aal2';
    assert.equal((await authenticate({ token: 'staff-aal2' })).error, undefined);
  });

  test('the global policy requires enrollment for un-enrolled staff while students remain unaffected', async () => {
    state.active = true;
    state.mustChangePassword = false;
    state.role = 'staff';
    state.mfaEnrolled = false;
    state.mfaRequired = true;
    state.aal = 'aal1';
    assert.equal((await authenticate({ token: 'staff-policy-aal1' })).error.status, 403);
    assert.equal((await authenticate({ token: 'staff-policy-enrollment', baseUrl: '/api/auth', path: '/mfa/complete-enrollment', method: 'POST' })).error, undefined);
    state.aal = 'aal2';
    assert.equal((await authenticate({ token: 'staff-policy-aal2-without-totp' })).error.status, 403);

    state.role = 'student';
    state.aal = 'aal1';
    assert.equal((await authenticate({ token: 'student-aal1' })).error, undefined);
  });
});
