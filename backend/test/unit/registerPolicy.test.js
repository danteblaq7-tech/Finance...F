// Student numbers are normalized and checked against the configured pattern or the optional registry.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';

const PATTERN = /^[A-Z]{2,6}\/\d{3,4}\/\d{2}$/;
const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;
const student = { id: '11111111-1111-4111-8111-111111111111', name: 'Student', role: 'student', must_change_password: false };
let registryRows;
let duplicateStudentNumbers;
let createdAuthUsers;

mock.module(src('config.js'), {
  namedExports: { config: { studentIdPattern: PATTERN } },
});
mock.module(src('db.js'), {
  namedExports: {
    queryOne: async (sql, params = []) => {
      if (/registry_configured/.test(sql)) {
        return {
          registry_configured: registryRows.length > 0,
          registry_match: registryRows.some((row) => row.studentNumber === params[0] && row.active),
        };
      }
      if (/SELECT 1 FROM profiles/.test(sql)) {
        return duplicateStudentNumbers.has(params[1]) ? { one: 1 } : null;
      }
      if (/SELECT .* FROM profiles WHERE id/.test(sql)) return student;
      throw new Error(`Unexpected query in test: ${sql}`);
    },
  },
});
mock.module(src('middleware/auth.js'), {
  namedExports: {
    PUBLIC_USER_COLUMNS: 'id, name, email, role',
    requireAuth: (_req, _res, next) => next(),
  },
});
mock.module(src('supabase.js'), {
  namedExports: {
    supabaseAdmin: {
      auth: {
        admin: {
          createUser: async (value) => {
            createdAuthUsers.push(value);
            return { data: { user: { id: student.id } }, error: null };
          },
          deleteUser: async () => ({ error: null }),
        },
      },
    },
    createAnonClient: () => ({}),
  },
});

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
  registryRows = [];
  duplicateStudentNumbers = new Set();
  createdAuthUsers = [];
});

const register = async (email, studentId) => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Student Name', email, password: 'Strong-pass-123', studentId }),
  });
  return { status: res.status, json: await res.json() };
};

describe('student signup policy', () => {
  test('normalizes and accepts valid course/number/year student numbers with a Gmail address', async () => {
    const result = await register('NEW@gmail.com', ' com - 072 - 23 ');
    assert.equal(result.status, 201);
    assert.equal(createdAuthUsers[0].user_metadata.student_id, 'COM/072/23');
  });

  test('accepts 3- and 4-digit middle numbers and rejects malformed numbers', async () => {
    assert.equal((await register('three@gmail.com', 'COM/072/23')).status, 201);
    assert.equal((await register('four@gmail.com', 'SCI/1234/24')).status, 201);
    assert.equal((await register('invalid@gmail.com', 'COM/12/23')).status, 400);
    assert.equal((await register('invalid-year@gmail.com', 'COM/123/2023')).status, 400);
    assert.equal(createdAuthUsers.length, 2);
  });

  test('rejects duplicate numbers after normalization', async () => {
    duplicateStudentNumbers.add('COM/072/23');
    const result = await register('duplicate@gmail.com', ' com - 072 - 23 ');
    assert.equal(result.status, 409);
    assert.equal(createdAuthUsers.length, 0);
  });

  test('falls back to the pattern when the registry is empty', async () => {
    assert.equal((await register('fallback@gmail.com', 'BUS/1234/25')).status, 201);
    assert.equal((await register('invalid@gmail.com', 'BUS/1/25')).status, 400);
  });

  test('when the registry has rows, allows only active listed numbers', async () => {
    registryRows = [
      { studentNumber: 'BUS/1234/25', active: true },
      { studentNumber: 'COM/072/23', active: false },
    ];
    assert.equal((await register('listed@gmail.com', 'BUS/1234/25')).status, 201);
    assert.equal((await register('inactive@gmail.com', 'COM/072/23')).status, 400);
    assert.equal((await register('unlisted@gmail.com', 'SCI/321/25')).status, 400);
    assert.equal(createdAuthUsers.length, 1);
  });
});
