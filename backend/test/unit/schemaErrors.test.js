// A database that has not been updated for a feature must say so plainly (503), not look like a crash (500).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorHandler } from '../../src/middleware/errors.js';

const run = (err) => {
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  const log = console.error; console.error = () => {};
  try { errorHandler(err, { id: 'r1', originalUrl: '/api/exam-units/mine?x=1' }, res, () => {}); } finally { console.error = log; }
  return out;
};

test('a missing table is a 503 that names the fix', () => {
  const r = run(Object.assign(new Error('relation "unit_registrations" does not exist'), { code: '42P01' }));
  assert.equal(r.status, 503);
  assert.match(r.body.error, /npm run db:schema/);
  assert.equal(r.body.requestId, 'r1');
});
test('a missing column is the same kind of problem', () => {
  assert.equal(run(Object.assign(new Error('column "x" does not exist'), { code: '42703' })).status, 503);
});
test('anything else unexpected is still a plain 500 that leaks nothing', () => {
  const r = run(new Error('boom: secret detail'));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'Internal server error');
});
