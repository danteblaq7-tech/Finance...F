// Verifies an already-issued bearer token is blocked immediately when its profile is deactivated.
import assert from 'node:assert/strict';
import { before, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;
const state = { active: true, mustChangePassword: false };
const getUser = mock.fn(async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } }, error: null }));

mock.module(src('db.js'), {
  namedExports: {
    queryOne: async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Staff',
      email: 'staff@example.test',
      role: 'staff',
      is_active: state.active,
      must_change_password: state.mustChangePassword,
    }),
  },
});
mock.module(src('supabase.js'), { namedExports: { supabaseAdmin: { auth: { getUser } } } });
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

describe('staff account authorization state', () => {
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
    state.active = true;
    state.mustChangePassword = true;
    assert.equal((await authenticate({ token: 'forced-1', baseUrl: '/api/auth', path: '/me' })).error.status, 403);
    assert.equal((await authenticate({ token: 'forced-2', baseUrl: '/api/auth', path: '/change-password', method: 'POST' })).error, undefined);
    assert.equal((await authenticate({ token: 'forced-3', baseUrl: '/api/auth', path: '/register', method: 'POST' })).error.status, 403);
    assert.equal((await authenticate({ token: 'forced-4', baseUrl: '/api/auth', path: '/change-password', method: 'GET' })).error.status, 403);
    assert.equal((await authenticate({ token: 'forced-5' })).error.status, 403);
    state.mustChangePassword = false;
  });
});
