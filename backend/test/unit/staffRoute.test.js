// Exercises staff lifecycle endpoints over HTTP with Supabase Auth and Postgres replaced by fakes.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  staff: '22222222-2222-4222-8222-222222222222',
  student: '33333333-3333-4333-8333-333333333333',
  lecturer: '44444444-4444-4444-8444-444444444444',
  otherAdmin: '55555555-5555-4555-8555-555555555555',
};
const users = [
  { id: ids.admin, name: 'Admin', email: 'admin@example.test', role: 'admin', is_active: true, must_change_password: false },
  { id: ids.staff, name: 'Staff', email: 'staff@example.test', role: 'staff', is_active: true, must_change_password: false },
  { id: ids.student, name: 'Student', email: 'student@example.test', role: 'student', is_active: true, must_change_password: false },
  { id: ids.lecturer, name: 'Lecturer', email: 'lecturer@example.test', role: 'lecturer', is_active: true, must_change_password: false },
];
const authCalls = [];
let createId = 0;
let activeAdminCountOverride = null;

const userById = (id) => users.find((user) => user.id === id);
const rowForSql = (user, sql) => {
  const columns = sql.match(/RETURNING (.*)$/s)?.[1]?.split(',').map((column) => column.trim().split('.').pop()) ?? [];
  return Object.fromEntries(columns.map((column) => [column, user[column]]));
};

async function transactionQuery(sql, params = []) {
  if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
  if (/INSERT INTO public\.staff_action_audit_log/.test(sql)) return { rows: [{ id: 'audit-row' }] };
  if (/SELECT id, role, is_active FROM profiles/.test(sql)) {
    const user = userById(params[0]);
    return { rows: user ? [{ id: user.id, role: user.role, is_active: user.is_active }] : [] };
  }
  if (/SELECT count\(\*\)::int AS count FROM profiles/.test(sql)) {
    return { rows: [{ count: activeAdminCountOverride ?? users.filter((user) => user.role === 'admin' && user.is_active).length }] };
  }
  if (/UPDATE profiles SET role = \$1, is_active = \$2/.test(sql)) {
    const user = userById(params[2]);
    if (!user) return { rows: [] };
    user.role = params[0];
    user.is_active = params[1];
    return { rows: [rowForSql(user, sql)] };
  }
  if (/UPDATE profiles\s+SET role = \$1, is_active = true, must_change_password = true/.test(sql)) {
    const user = userById(params[1]);
    if (!user) return { rows: [] };
    user.role = params[0];
    user.is_active = true;
    user.must_change_password = true;
    return { rows: [rowForSql(user, sql)] };
  }
  throw new Error(`Unexpected transaction query in test: ${sql}`);
}

mock.module(src('db.js'), {
  namedExports: {
    query: async () => users.filter((user) => ['staff', 'admin', 'lecturer'].includes(user.role)),
    queryOne: async (sql, params = []) => {
      if (/SELECT 1 FROM profiles WHERE lower\(email\)/.test(sql)) {
        return users.some((user) => user.email === params[0]) ? { one: 1 } : null;
      }
      if (/UPDATE profiles/.test(sql) && /must_change_password = true/.test(sql)) {
        const user = userById(`66666666-6666-4666-8666-${String(createId).padStart(12, '0')}`);
        if (!user) return null;
        user.role = params[0];
        user.is_active = true;
        user.must_change_password = true;
        return rowForSql(user, sql);
      }
      throw new Error(`Unexpected queryOne in test: ${sql}`);
    },
    withTransaction: async (fn) => fn({ query: transactionQuery }),
  },
});

mock.module(src('middleware/auth.js'), {
  namedExports: {
    PUBLIC_USER_COLUMNS: 'id, name, email, role, must_change_password',
    requireAuth: (req, res, next) => {
      const token = req.get('authorization')?.replace(/^Bearer /i, '');
      const role = ['admin', 'staff', 'student', 'lecturer'].includes(token) ? token : null;
      const id = role === 'admin' ? ids.admin : role === 'staff' ? ids.staff : role === 'lecturer' ? ids.lecturer : ids.student;
      req.user = role ? { id, role } : null;
      if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
      next();
    },
    requireAdmin: (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' }),
  },
});

mock.module(src('supabase.js'), {
  namedExports: {
    supabaseAdmin: {
      auth: {
        admin: {
          createUser: async ({ email, user_metadata, app_metadata }) => {
            const id = `66666666-6666-4666-8666-${String(++createId).padStart(12, '0')}`;
            authCalls.push({ method: 'createUser', app_metadata });
            users.push({ id, name: user_metadata.name, email, role: 'student', is_active: true, must_change_password: false });
            return { data: { user: { id } }, error: null };
          },
          updateUserById: async (id, value) => {
            authCalls.push({ id, ...value });
            return { error: null };
          },
          deleteUser: async (id) => {
            const index = users.findIndex((user) => user.id === id);
            if (index >= 0) users.splice(index, 1);
            return { error: null };
          },
        },
      },
    },
  },
});

let server;
let base;
before(async () => {
  const express = (await import('express')).default;
  const { errorHandler } = await import(src('middleware/errors.js'));
  const router = (await import(src('routes/staff.js'))).default;
  const app = express();
  app.use(express.json());
  app.use('/api/admin/staff', router);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  users.splice(0, users.length,
    { id: ids.admin, name: 'Admin', email: 'admin@example.test', role: 'admin', is_active: true, must_change_password: false },
    { id: ids.staff, name: 'Staff', email: 'staff@example.test', role: 'staff', is_active: true, must_change_password: false },
    { id: ids.student, name: 'Student', email: 'student@example.test', role: 'student', is_active: true, must_change_password: false },
    { id: ids.lecturer, name: 'Lecturer', email: 'lecturer@example.test', role: 'lecturer', is_active: true, must_change_password: false },
  );
  authCalls.length = 0;
  createId = 0;
  activeAdminCountOverride = null;
});

const api = async (path, token, options = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

describe('admin staff lifecycle', () => {
  test('only admins may list, create or change staff accounts', async () => {
    for (const role of ['student', 'staff', 'lecturer']) {
      assert.equal((await api('/api/admin/staff', role)).status, 403);
      assert.equal((await api('/api/admin/staff', role, { method: 'POST', body: { name: 'New Staff', email: 'new@example.test', role: 'staff' } })).status, 403);
      assert.equal((await api(`/api/admin/staff/${ids.staff}`, role, { method: 'PATCH', body: { role: 'lecturer' } })).status, 403);
    }

    assert.equal((await api('/api/admin/staff', 'admin')).status, 200);
  });

  test('admin creates finance and lecturer accounts with one-time passwords and mandatory password changes', async () => {
    for (const [email, role] of [['new-staff@example.test', 'staff'], ['new-lecturer@example.test', 'lecturer']]) {
      const created = await api('/api/admin/staff', 'admin', {
        method: 'POST',
        body: { name: 'New User', email, role },
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.staff.role, role);
      assert.equal(created.json.staff.must_change_password, true);
      assert.ok(created.json.temporaryPassword.length >= 24);
      assert.deepEqual(authCalls.at(-1), { method: 'createUser', app_metadata: { role, must_change_password: true } });
    }
  });

  test('admin role changes and deactivation/reactivation synchronize Auth bans', async () => {
    const promote = await api(`/api/admin/staff/${ids.staff}`, 'admin', { method: 'PATCH', body: { role: 'lecturer' } });
    assert.equal(promote.status, 200);
    assert.equal(promote.json.staff.role, 'lecturer');

    const deactivate = await api(`/api/admin/staff/${ids.lecturer}`, 'admin', { method: 'PATCH', body: { isActive: false } });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.json.staff.is_active, false);
    assert.deepEqual(authCalls.at(-1), { id: ids.lecturer, ban_duration: '876000h' });

    const reactivate = await api(`/api/admin/staff/${ids.lecturer}`, 'admin', { method: 'PATCH', body: { isActive: true } });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.json.staff.is_active, true);
    assert.deepEqual(authCalls.at(-1), { id: ids.lecturer, ban_duration: 'none' });
  });

  test('admins cannot demote or deactivate themselves or the last active admin', async () => {
    assert.equal((await api(`/api/admin/staff/${ids.admin}`, 'admin', { method: 'PATCH', body: { role: 'staff' } })).status, 409);
    assert.equal((await api(`/api/admin/staff/${ids.admin}`, 'admin', { method: 'PATCH', body: { isActive: false } })).status, 409);

    users.push({ id: ids.otherAdmin, name: 'Other Admin', email: 'other-admin@example.test', role: 'admin', is_active: true, must_change_password: false });
    activeAdminCountOverride = 1;
    const last = await api(`/api/admin/staff/${ids.otherAdmin}`, 'admin', { method: 'PATCH', body: { role: 'staff' } });
    assert.equal(last.status, 409);
  });
});
