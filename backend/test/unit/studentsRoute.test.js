import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  staff: '22222222-2222-4222-8222-222222222222',
  student: '33333333-3333-4333-8333-333333333333',
  lecturer: '44444444-4444-4444-8444-444444444444',
};
const records = [];
const auditActions = [];
const authCalls = [];
const emailCalls = [];

function resetRecords() {
  records.splice(0, records.length,
    { id: ids.admin, name: 'Admin User', email: 'admin@example.test', student_id: null, role: 'admin', is_active: true, created_at: '2026-01-01T00:00:00.000Z' },
    { id: ids.staff, name: 'Staff User', email: 'staff@example.test', student_id: null, role: 'staff', is_active: true, created_at: '2026-01-01T00:00:00.000Z' },
    { id: ids.student, name: 'Example Student', email: 'student@example.test', student_id: 'COM/072/23', role: 'student', is_active: true, created_at: '2026-01-01T00:00:00.000Z' },
    { id: ids.lecturer, name: 'Lecturer User', email: 'lecturer@example.test', student_id: null, role: 'lecturer', is_active: true, created_at: '2026-01-01T00:00:00.000Z' },
  );
}
resetRecords();

const student = () => records.find((row) => row.id === ids.student);

mock.module(src('config.js'), {
  namedExports: {
    config: {
      nodeEnv: 'test',
      smtp: { host: 'smtp.example.test' },
      publicWebUrl: 'https://finesse.example.test',
    },
  },
});
mock.module(src('db.js'), {
  namedExports: {
    query: async () => [{ ...student() }],
    queryOne: async (sql) => {
      if (/count\(\*\)::int AS total/.test(sql)) return { total: 1 };
      if (/role = 'student'/.test(sql)) {
        const row = student();
        return row ? { id: row.id, name: row.name, email: row.email } : null;
      }
      throw new Error(`Unexpected queryOne: ${sql}`);
    },
    withTransaction: async (fn) => fn({
      query: async (sql, params = []) => {
        if (/SELECT id, role, is_active FROM profiles/.test(sql)) {
          const row = records.find((record) => record.id === params[0]);
          return { rows: row ? [{ id: row.id, role: row.role, is_active: row.is_active }] : [] };
        }
        if (/UPDATE profiles SET is_active/.test(sql)) {
          const row = records.find((record) => record.id === params[1]);
          row.is_active = params[0];
          return { rows: [{ ...row }] };
        }
        if (/INSERT INTO public\.staff_action_audit_log/.test(sql)) {
          auditActions.push({ action: params[1], entityId: params[3], metadata: JSON.parse(params[4]) });
          return { rows: [{ id: 'audit-row' }] };
        }
        throw new Error(`Unexpected transaction query: ${sql}`);
      },
    }),
  },
});

mock.module(src('middleware/auth.js'), {
  namedExports: {
    requireAuth: (req, res, next) => {
      const role = req.get('authorization')?.replace(/^Bearer /i, '');
      const id = ids[role];
      if (!id) return res.status(401).json({ error: 'Authentication required.' });
      req.user = { id, role };
      next();
    },
    requireAdmin: (req, res, next) => req.user.role === 'admin'
      ? next()
      : res.status(403).json({ error: 'Admins only.' }),
  },
});

mock.module(src('supabase.js'), {
  namedExports: {
    supabaseAdmin: {
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { last_sign_in_at: '2026-02-01T12:00:00.000Z' } }, error: null }),
          updateUserById: async (id, value) => {
            authCalls.push({ id, ...value });
            return { error: null };
          },
          generateLink: async () => ({
            data: { properties: { action_link: 'https://auth.example.test/recovery?token=one-time-secret' } },
            error: null,
          }),
        },
      },
    },
  },
});
mock.module(src('mailer.js'), {
  namedExports: {
    renderTemplate: (template, values) => template.replace('{{actionUrl}}', values.actionUrl),
    sendEmail: async (message) => {
      emailCalls.push(message);
      return { id: 'email-id', delivered: true };
    },
  },
});

let server;
let base;
before(async () => {
  const express = (await import('express')).default;
  const { errorHandler } = await import(src('middleware/errors.js'));
  const router = (await import(src('routes/students.js'))).default;
  const app = express();
  app.use(express.json());
  app.use('/api/admin/students', router);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  resetRecords();
  auditActions.length = 0;
  authCalls.length = 0;
  emailCalls.length = 0;
});

const api = async (path, role, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${role}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, json: await response.json() };
};

describe('student account management routes', () => {
  test('admin and finance staff can list accounts; students and lecturers cannot', async () => {
    for (const role of ['admin', 'staff']) {
      const response = await api('/api/admin/students?q=COM%2F072%2F23&status=active&page=1', role);
      assert.equal(response.status, 200);
      assert.equal(response.json.students[0].student_id, 'COM/072/23');
      assert.equal(response.json.students[0].last_sign_in_at, '2026-02-01T12:00:00.000Z');
      assert.equal(response.json.total, 1);
    }
    for (const role of ['student', 'lecturer']) {
      assert.equal((await api('/api/admin/students', role)).status, 403);
    }
  });

  test('only admins may deactivate/reactivate students; deactivation requires and audits a reason', async () => {
    for (const role of ['staff', 'student', 'lecturer']) {
      assert.equal((await api(`/api/admin/students/${ids.student}`, role, {
        method: 'PATCH',
        body: { isActive: false, reason: 'Graduated' },
      })).status, 403);
    }
    assert.equal((await api(`/api/admin/students/${ids.student}`, 'admin', {
      method: 'PATCH',
      body: { isActive: false },
    })).status, 400);
    assert.equal(student().is_active, true);

    const disabled = await api(`/api/admin/students/${ids.student}`, 'admin', {
      method: 'PATCH',
      body: { isActive: false, reason: 'Account requested closure' },
    });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.json.student.is_active, false);
    assert.deepEqual(authCalls.at(-1), { id: ids.student, ban_duration: '876000h' });
    assert.deepEqual(auditActions.at(-1), {
      action: 'student_deactivated',
      entityId: ids.student,
      metadata: { reason: 'Account requested closure' },
    });

    const enabled = await api(`/api/admin/students/${ids.student}`, 'admin', {
      method: 'PATCH',
      body: { isActive: true },
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.json.student.is_active, true);
    assert.deepEqual(authCalls.at(-1), { id: ids.student, ban_duration: 'none' });
    assert.equal(auditActions.at(-1).action, 'student_reactivated');
  });

  test('admin sends a recovery email without persisting or returning its one-time link', async () => {
    for (const role of ['staff', 'student', 'lecturer']) {
      assert.equal((await api(`/api/admin/students/${ids.student}/password-reset`, role, { method: 'POST', body: {} })).status, 403);
    }
    const result = await api(`/api/admin/students/${ids.student}/password-reset`, 'admin', {
      method: 'POST',
      body: {},
    });
    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result.json).includes('one-time-secret'), false);
    assert.match(emailCalls[0].html, /one-time-secret/);
    assert.equal(emailCalls[0].outboxHtml.includes('one-time-secret'), false);
    assert.equal(auditActions.at(-1).action, 'student_password_reset_requested');
  });
});