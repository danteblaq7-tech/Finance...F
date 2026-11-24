import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;
const ids = {
  staff: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  student: '33333333-3333-4333-8333-333333333333',
  lecturer: '44444444-4444-4444-8444-444444444444',
};
let role = 'staff';
let aal = 'aal1';
const enrollmentStates = new Map();
const factors = new Map();
const auditActions = [];

mock.module(src('config.js'), { namedExports: { config: { studentIdPattern: '^[A-Z]+$' } } });
mock.module(src('db.js'), {
  namedExports: {
    queryOne: async () => null,
    withTransaction: async (fn) => fn({
      query: async (sql, params = []) => {
        if (/INSERT INTO public\.staff_mfa_enrollments/.test(sql) && /'pending'/.test(sql)) {
          if (enrollmentStates.has(params[0])) return { rows: [] };
          enrollmentStates.set(params[0], 'pending');
          return { rows: [{ user_id: params[0] }] };
        }
        if (/INSERT INTO public\.staff_mfa_enrollments/.test(sql)) {
          const previous = enrollmentStates.get(params[0]);
          enrollmentStates.set(params[0], 'verified');
          return { rows: previous === 'verified' ? [] : [{ user_id: params[0] }] };
        }
        if (/INSERT INTO public\.staff_action_audit_log/.test(sql)) {
          auditActions.push(params[1]);
          return { rows: [{ id: 'audit' }] };
        }
        throw new Error(`Unexpected transaction query: ${sql}`);
      },
    }),
  },
});
mock.module(src('middleware/auth.js'), {
  namedExports: {
    PUBLIC_USER_COLUMNS: 'id, name, email, role',
    requireAuth: (req, res, next) => {
      req.user = {
        id: ids[role],
        role,
        email: `${role}@example.test`,
        mfa: { enrolled: enrollmentStates.get(ids[role]) === 'verified', pending: enrollmentStates.get(ids[role]) === 'pending', required: true, assuranceLevel: aal },
      };
      next();
    },
  },
});
mock.module(src('supabase.js'), {
  namedExports: {
    supabaseAdmin: {
      auth: {
        admin: {
          mfa: {
            listFactors: async ({ userId }) => ({ data: { factors: factors.get(userId) ?? [] }, error: null }),
          },
        },
      },
    },
    createAnonClient: () => ({}),
  },
});
mock.module(src('studentRegistration.js'), { namedExports: { assertStudentNumberAllowed: async () => {} } });
mock.module(src('normalizeStudentNumber.js'), { namedExports: { normalizeStudentNumber: (value) => value } });
mock.module(src('logger.js'), { namedExports: { logger: { error: () => {} } } });

let server;
let base;
before(async () => {
  const express = (await import('express')).default;
  const { errorHandler } = await import(src('middleware/errors.js'));
  const router = (await import(src('routes/auth.js'))).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  role = 'staff';
  aal = 'aal1';
  enrollmentStates.clear();
  factors.clear();
  auditActions.length = 0;
});

async function api(path, method = 'GET') {
  const response = await fetch(`${base}/api/auth${path}`, {
    method,
    headers: { Authorization: 'Bearer test-token', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    body: method === 'POST' ? '{}' : undefined,
  });
  return { status: response.status, json: await response.json() };
}

describe('staff TOTP enrollment API', () => {
  test('only staff and admins can start enrollment, and the pending state is audited', async () => {
    for (const deniedRole of ['student', 'lecturer']) {
      role = deniedRole;
      assert.equal((await api('/mfa/begin-enrollment', 'POST')).status, 403);
    }

    role = 'staff';
    const started = await api('/mfa/begin-enrollment', 'POST');
    assert.equal(started.status, 200);
    assert.deepEqual(started.json, { pending: true });
    assert.equal(enrollmentStates.get(ids.staff), 'pending');
    assert.deepEqual(auditActions, ['staff_mfa_enrollment_started']);
  });

  test('enrollment completes only with AAL2 and a verified TOTP factor', async () => {
    enrollmentStates.set(ids.staff, 'pending');
    assert.equal((await api('/mfa/complete-enrollment', 'POST')).status, 403);

    aal = 'aal2';
    assert.equal((await api('/mfa/complete-enrollment', 'POST')).status, 400);
    factors.set(ids.staff, [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }]);
    const completed = await api('/mfa/complete-enrollment', 'POST');
    assert.equal(completed.status, 200);
    assert.deepEqual(completed.json.mfa, { enrolled: true, required: true, assuranceLevel: 'aal2' });
    assert.equal(enrollmentStates.get(ids.staff), 'verified');
    assert.deepEqual(auditActions, ['staff_mfa_enrolled']);
  });

  test('status exposes a verified factor ID without returning its secret', async () => {
    enrollmentStates.set(ids.admin, 'verified');
    factors.set(ids.admin, [{ id: 'admin-totp', factor_type: 'totp', status: 'verified', secret: 'must-not-be-returned' }]);
    role = 'admin';
    const status = await api('/mfa/status');
    assert.equal(status.status, 200);
    assert.equal(status.json.mfa.factorId, 'admin-totp');
    assert.equal(JSON.stringify(status.json).includes('must-not-be-returned'), false);
  });
});
