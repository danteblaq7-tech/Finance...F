// Exercises POST /api/fee-statements over real HTTP with the database, sign-in and file storage replaced by fakes,
// so the upload → parse → decide → record flow is tested without Supabase.
//   node --experimental-test-module-mocks --test test/unit/statementsRoute.test.js
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';
Object.assign(process.env, {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', DATABASE_URL: 'postgres://u:p@localhost:5432/d',
});

const src = (p) => new URL(`../../src/${p}`, import.meta.url).href;

// ── fakes ──────────────────────────────────────────────────────────────────────────────────────
const PERIOD = { id: '11111111-1111-4111-8111-111111111111', is_active: true, application_open: '2026-10-01', application_close: '2026-11-30', academic_year: '2026/2027', semester: 'Semester 1', min_payment_percent: 100 };
const STUDENT = { id: '22222222-2222-4222-8222-222222222222', role: 'student', name: 'Amina Hassan', email: 'amina@x.ke', student_id: 'EGM/027/2024', course: 'BSc EE', year_of_study: '2' };

const db = { existing: null, official: null, statements: [], apps: [], deleted: [], stored: [] };
const reset = () => Object.assign(db, { existing: null, official: null, statements: [], apps: [], deleted: [], stored: [] });

function route(sql, params) {
  if (/FROM exam_periods WHERE id/.test(sql)) return params[0] === PERIOD.id ? PERIOD : null;
  if (/SELECT app_today/.test(sql)) return { d: '2026-11-04' };
  if (/FROM exam_card_applications WHERE student_uid/.test(sql)) return db.existing;
  if (/FROM fee_records WHERE student_id/.test(sql)) return db.official;
  if (/INSERT INTO fee_statements/.test(sql)) { db.statements.push({ id: params[0], outcome: params[18], flags: params[16], identity: params[17], total_fee: params[11], amount_paid: params[12], balance: params[13] }); return null; }
  if (/DELETE FROM exam_card_applications/.test(sql)) { db.deleted.push(params[0]); return null; }
  if (/INSERT INTO exam_card_applications/.test(sql)) {
    const viaStatement = /'statement'/.test(sql);
    db.apps.push(viaStatement
      ? { id: params[0], status: params[10], rejection_reason: params[11], status_note: params[12], decision_source: 'statement', balance: params[15] }
      : { id: params[0], status: 'pending', decision_source: 'fee_record' });
    return null;
  }
  if (/FROM exam_card_applications a JOIN exam_periods/.test(sql)) return { ...db.apps.find((a) => a.id === params[0]), student_name: STUDENT.name, email: STUDENT.email, semester: PERIOD.semester, academic_year: PERIOD.academic_year };
  if (/FROM fee_statements s JOIN profiles/.test(sql)) return db.statements.find((s) => s.id === params[0]) ?? null;
  if (/FROM email_templates/.test(sql)) return null;
  throw new Error(`Unexpected SQL in test: ${sql.slice(0, 80)}`);
}
const asRows = (r) => (r === null || r === undefined ? [] : [r]);

mock.module(src('db.js'), {
  namedExports: {
    pool: {}, bind: (params, v) => { params.push(v); return `$${params.length}`; },
    query: async (sql, params = []) => asRows(route(sql, params)),
    queryOne: async (sql, params = []) => route(sql, params) ?? null,
    withTransaction: async (fn) => fn({ query: async (sql, params = []) => ({ rows: asRows(route(sql, params)) }) }),
  },
});
const authMock = {
  requireAuth: (req, _res, next) => { req.user = STUDENT; next(); },
  requireStudent: (req, _res, next) => (req.user.role === 'student' ? next() : next(Object.assign(new Error('Students only.'), { status: 403 }))),
  requireStaff: (_req, _res, next) => next(),
  isStaff: () => false,
  PUBLIC_USER_COLUMNS: '*',
};
mock.module(src('middleware/auth.js'), { namedExports: authMock });
mock.module(src('storage.js'), { namedExports: {
  saveStatementFile: async (path, buf) => { db.stored.push({ path, bytes: buf.length }); },
  statementSignedUrl: async () => 'https://signed.example/x', ensureStatementBucket: async () => {},
} });
// "PDF" in this test = the bytes %PDF- followed by the statement text.
mock.module(src('pdfText.js'), { namedExports: { extractPdfText: async (buf) => buf.toString('latin1').slice(5) } });

// ── harness ────────────────────────────────────────────────────────────────────────────────────
let server, base, config;
before(async () => {
  const express = (await import('express')).default;
  const { errorHandler } = await import(src('middleware/errors.js'));
  config = (await import(src('config.js'))).config;
  const router = (await import(src('routes/statements.js'))).default;
  const app = express();
  app.use('/api/fee-statements', router);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(reset);

const upload = (body, { period = PERIOD.id, type = 'application/octet-stream' } = {}) =>
  fetch(`${base}/api/fee-statements?examPeriodId=${period}`, { method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': 'my%20statement.pdf' }, body });

const pdf = (text) => Buffer.concat([Buffer.from('%PDF-'), Buffer.from(text, 'latin1')]);
const stmt = (reg, total, paid, balance, year = '2026/2027') =>
  `Reg No: ${reg}\nAcademic Year: ${year}\nTotal Fees: KES ${total}\nAmount Paid: KES ${paid}\nBalance: KES ${balance}\n`;

describe('POST /api/fee-statements', () => {
  test('a statement showing a balance is DENIED automatically, with the figures in the reason', async () => {
    const res = await upload(pdf(stmt('EGM/027/2024', '78,000.00', '52,000.00', '26,000.00')));
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.equal(j.application.status, 'rejected');
    assert.match(j.application.rejection_reason, /KSh 26,000/);
    assert.equal(db.statements[0].outcome, 'not_cleared');
    assert.equal(db.stored.length, 1, 'the original file is kept');
  });

  test('a cleared statement is held for the finance office in the default "verify" mode', async () => {
    assert.equal(config.feeStatementMode, 'verify');
    const j = await (await upload(pdf(stmt('EGM/027/2024', '85,000.00', '85,000.00', '0.00')))).json();
    assert.equal(j.application.status, 'pending');
    assert.match(j.application.status_note, /verify/i);
    assert.equal(db.statements[0].outcome, 'cleared');
  });

  test('"trust" mode approves a cleared statement for the right student and period', async () => {
    config.feeStatementMode = 'trust';
    try {
      const j = await (await upload(pdf(stmt('EGM/027/2024', '85,000.00', '85,000.00', '0.00')))).json();
      assert.equal(j.application.status, 'approved');
      assert.equal(j.application.decision_source, 'statement');
    } finally { config.feeStatementMode = 'verify'; }
  });

  test('someone else\'s statement is refused (422) and nothing is stored', async () => {
    const res = await upload(pdf(stmt('SCI/114/2023', '78,000.00', '78,000.00', '0.00')));
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /different student/i);
    assert.equal(db.stored.length + db.statements.length + db.apps.length, 0);
  });

  test('a statement for another academic year is never auto-decided', async () => {
    config.feeStatementMode = 'trust';
    try {
      const j = await (await upload(pdf(stmt('EGM/027/2024', '85,000.00', '85,000.00', '0.00', '2024/2025')))).json();
      assert.equal(j.application.status, 'pending');
      assert.ok(db.statements[0].flags.includes('wrong_period'));
    } finally { config.feeStatementMode = 'verify'; }
  });

  test('a CSV upload works too', async () => {
    const csv = 'student_id,total_fee,amount_paid,balance\nEGM/027/2024,80000,40000,40000\n';
    const j = await (await upload(Buffer.from(csv), { type: 'text/csv' })).json();
    assert.equal(j.application.status, 'rejected');
  });

  test('a photo cannot be read automatically: it goes to a person', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
    const j = await (await upload(png, { type: 'image/png' })).json();
    assert.equal(j.application.status, 'pending');
    assert.ok(db.statements[0].flags.includes('unreadable'));
  });

  test('an official fee record always wins: the statement is only evidence', async () => {
    db.official = { id: 'f1', amount_paid: 85000 };
    const j = await (await upload(pdf(stmt('EGM/027/2024', '85,000.00', '10,000.00', '75,000.00')))).json();
    assert.equal(j.usedOfficialRecord, true);
    assert.equal(db.statements[0].outcome, 'official_record');
    assert.ok(db.statements[0].flags.includes('differs_from_official_record'));
    assert.equal(db.apps[0].decision_source, 'fee_record', 'the database trigger decides from the official record');
  });

  test('re-uploading replaces a rejected attempt, but a finished application cannot be replaced', async () => {
    db.existing = { id: 'old-app', status: 'rejected', decision_source: 'statement' };
    assert.equal((await upload(pdf(stmt('EGM/027/2024', '1,000', '1,000', '0')))).status, 201);
    assert.deepEqual(db.deleted, ['old-app']);
    reset();
    db.existing = { id: 'x', status: 'issued', decision_source: 'fee_record' };
    assert.equal((await upload(pdf(stmt('EGM/027/2024', '1,000', '1,000', '0')))).status, 409);
  });

  test('rejects unsupported files, empty bodies and oversized uploads', async () => {
    assert.equal((await upload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]))).status, 415, 'a zip/binary');
    assert.equal((await upload(Buffer.alloc(0))).status, 400, 'empty');
    assert.equal((await upload(Buffer.alloc(config.maxStatementBytes + 10, 65))).status, 413, 'too big');
  });

  test('closed or unknown exam periods are refused', async () => {
    assert.equal((await upload(pdf('x'), { period: '99999999-9999-4999-8999-999999999999' })).status, 404);
    assert.equal((await upload(pdf('x'), { period: 'not-a-uuid' })).status, 400);
  });
});
