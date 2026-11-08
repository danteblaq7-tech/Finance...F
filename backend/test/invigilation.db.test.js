// End-to-end test of exam-hall sign-in against a REAL Postgres: real routes, real auth middleware, real SQL.
// Only Supabase Auth is replaced by a fake (the token IS the user's id).
//
// It needs a SCRATCH database, not your shared Supabase project, because it creates users and exam data:
//   1. create an empty Postgres database and add a stand-in for Supabase's auth schema:
//        create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
//        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
//        create role anon nologin; create role authenticated nologin;
//   2. apply database/supabase/schema.sql to it
//   3. INVIGILATION_TEST_DATABASE_URL=postgres://user:pw@localhost:5432/scratch npm run test:invigilation
// Without INVIGILATION_TEST_DATABASE_URL the whole file is skipped (so CI and `npm test` stay green).
import assert from 'node:assert/strict';
import { after, before, describe, mock, test } from 'node:test';

const URL_ = process.env.INVIGILATION_TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

process.env.NODE_ENV = 'test';
if (URL_) {
  Object.assign(process.env, { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', DATABASE_URL: URL_ });
}
const src = (p) => new URL(`../src/${p}`, import.meta.url).href;

let pool;
let server;
let base;
const run = Date.now().toString(36).toUpperCase();

if (URL_) {
  const pg = (await import('pg')).default;
  pool = new pg.Pool({ connectionString: URL_ });
  // Fake Supabase: the bearer token is simply the profile id; createUser inserts into auth.users (the sign-up trigger builds the profile).
  mock.module(src('supabase.js'), {
    namedExports: {
      supabaseAdmin: {
        auth: {
          getUser: async (token) => ({ data: { user: { id: token } }, error: null }),
          admin: {
            createUser: async ({ email, user_metadata }) => {
              const r = await pool.query('INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1,$2) RETURNING id', [email, JSON.stringify(user_metadata ?? {})]);
              return { data: { user: { id: r.rows[0].id } }, error: null };
            },
            deleteUser: async (id) => { await pool.query('DELETE FROM auth.users WHERE id = $1', [id]); return { error: null }; },
          },
        },
      },
      createAnonClient: () => ({}),
    },
  });
}

async function api(path, { method = 'GET', body, as } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

suite('exam-hall sign-in (real Postgres)', () => {
  const ids = {};     // user ids by nickname
  const codes = {};   // card codes by student nickname
  let periodId; let pastPeriodId;
  const unit = {};    // unit ids by code

  const makeUser = async (nick, role, studentId) => {
    const email = `${nick}.${run.toLowerCase()}@test.ke`;
    const r = await pool.query('INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1,$2) RETURNING id',
      [email, JSON.stringify({ name: `${nick} ${run}`, student_id: studentId ?? null })]);
    await pool.query('UPDATE profiles SET role = $2 WHERE id = $1', [r.rows[0].id, role]);
    ids[nick] = r.rows[0].id;
    return r.rows[0].id;
  };
  const makeCard = async (nick, studentId, period, { revoked = false } = {}) => {
    const code = `T${run}${nick.toUpperCase()}`.replace(/[^A-Z0-9]/g, '').slice(0, 14).padEnd(10, '0');
    await pool.query(
      `INSERT INTO exam_card_applications (student_uid, student_id, student_name, exam_period_id, academic_year, semester, status, card_issued_at, verification_code, revoked_at)
       VALUES ($1,$2,$3,$4,'2026/2027','Semester 1','issued', now(), $5, $6)`,
      [ids[nick], studentId, `${nick} ${run}`, period, code, revoked ? new Date() : null]);
    codes[nick] = code;
  };

  before(async () => {
    const { createApp } = await import(src('app.js'));
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;

    const mk = async (title, startOff, endOff) => (await pool.query(
      `INSERT INTO exam_periods (title, academic_year, semester, exam_start_date, exam_end_date, application_open, application_close)
       VALUES ($1,'2026/2027','Semester 1', app_today() + $2::int, app_today() + $3::int, app_today() - 60, app_today() - 40) RETURNING id`,
      [`${title} ${run}`, startOff, endOff])).rows[0].id;
    periodId = await mk('Running now', -1, 5);
    pastPeriodId = await mk('Finished', -30, -20);

    await makeUser('admin', 'admin'); await makeUser('staff', 'staff');
    await makeUser('lecA', 'lecturer'); await makeUser('lecB', 'lecturer');
    for (const [n, sid] of [['amina', `AM/${run}/1`], ['brian', `BR/${run}/2`], ['cynthia', `CY/${run}/3`], ['david', `DA/${run}/4`], ['eve', `EV/${run}/5`]]) await makeUser(n, 'student', sid);
    await makeCard('amina', `AM/${run}/1`, periodId);
    await makeCard('brian', `BR/${run}/2`, periodId, { revoked: true });
    await makeCard('cynthia', `CY/${run}/3`, pastPeriodId);
    await makeCard('david', `DA/${run}/4`, periodId);
    // eve has no card at all
  });

  after(async () => {
    try {
      await pool.query('DELETE FROM exam_periods WHERE id = ANY($1)', [[periodId, pastPeriodId]]);          // cascades units, registrations, cards
      await pool.query('DELETE FROM auth.users WHERE email LIKE $1', [`%.${run.toLowerCase()}@test.ke`]);
    } finally {
      server?.close();
      await pool.end();
      const { pool: appPool } = await import(src('db.js'));
      await appPool.end();
    }
  });

  test('only admins create lecturer logins; the account really becomes a lecturer', async () => {
    const body = { name: 'New Lecturer', email: `new.${run.toLowerCase()}@test.ke`, password: 'Passw0rd!x' };
    assert.equal((await api('/api/lecturers', { method: 'POST', as: ids.staff, body })).status, 403);
    const ok = await api('/api/lecturers', { method: 'POST', as: ids.admin, body });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.lecturer.role, 'lecturer');
    assert.equal((await api('/api/lecturers', { method: 'POST', as: ids.admin, body })).status, 409, 'duplicate email');
    assert.equal((await api('/api/lecturers', { as: ids.lecA })).status, 403, 'lecturers cannot list lecturers');
  });

  test('importing units: creates them, links lecturers by e-mail, reports unknown e-mails, is repeatable', async () => {
    const emailOf = async (n) => (await pool.query('SELECT email FROM profiles WHERE id = $1', [ids[n]])).rows[0].email;
    const tomorrow = (await pool.query("SELECT to_char(app_today() + 1, 'YYYY-MM-DD') AS d")).rows[0].d;
    const body = {
      periodId,
      rows: [
        { unit_code: 'csc 101', unit_name: 'Intro to Programming', lecturers: [await emailOf('lecA')] },
        { unit_code: 'CSC102', unit_name: 'Databases', lecturers: [await emailOf('lecB'), 'ghost@nowhere.ke'] },
        { unit_code: 'CSC103', unit_name: 'Networks', exam_date: tomorrow },
      ],
    };
    assert.equal((await api('/api/exam-units/import', { method: 'POST', as: ids.lecA, body })).status, 403, 'a lecturer cannot import');
    const r = await api('/api/exam-units/import', { method: 'POST', as: ids.staff, body });
    assert.equal(r.status, 201);
    assert.deepEqual([r.json.units, r.json.created, r.json.lecturersLinked, r.json.unknownLecturers], [3, 3, 2, ['ghost@nowhere.ke']]);
    const again = await api('/api/exam-units/import', { method: 'POST', as: ids.staff, body });
    assert.equal(again.json.created, 0, 'second import creates nothing new');
    const list = await api(`/api/exam-units?periodId=${periodId}`, { as: ids.staff });
    for (const u of list.json.units) unit[u.unit_code] = u.id;
    assert.deepEqual(Object.keys(unit).sort(), ['CSC 101', 'CSC102', 'CSC103']); // code is upper-cased, inner spaces collapsed
    const bad = await api('/api/exam-units/import', { method: 'POST', as: ids.staff, body: { periodId, rows: [{ unit_code: 'X', exam_date: '2026-02-31' }] } });
    assert.equal(bad.status, 400, 'impossible date rejected');
  });

  test('importing registrations: upserts, keeps a bar set explicitly, ignores nothing silently', async () => {
    const rows = [
      { student_id: `am/${run}/1`, unit_code: 'CSC 101' }, { student_id: `AM/${run}/1`, unit_code: 'CSC102' },
      { student_id: `AM/${run}/1`, unit_code: 'CSC103', allowed: false, reason: 'Missing CAT marks' },
      { student_id: `BR/${run}/2`, unit_code: 'CSC 101' }, { student_id: `CY/${run}/3`, unit_code: 'CSC 101' },
      { student_id: `DA/${run}/4`, unit_code: 'CSC102' }, { student_id: `EV/${run}/5`, unit_code: 'CSC 101' },
    ];
    const r = await api('/api/exam-units/registrations/import', { method: 'POST', as: ids.staff, body: { periodId, rows } });
    assert.equal(r.status, 201);
    assert.equal(r.json.added, 7);
    // re-import the barred row WITHOUT an allowed value: the bar must survive
    await api('/api/exam-units/registrations/import', { method: 'POST', as: ids.staff, body: { periodId, rows: [{ student_id: `AM/${run}/1`, unit_code: 'CSC103' }] } });
    const reg = (await pool.query('SELECT allowed, block_reason FROM unit_registrations WHERE exam_unit_id = $1 AND student_id = $2', [unit.CSC103, `AM/${run}/1`])).rows[0];
    assert.deepEqual([reg.allowed, reg.block_reason], [false, 'Missing CAT marks']);
  });

  test('scanning a card shows the genuine state and the units, flagging which the lecturer can sign', async () => {
    const r = await api(`/api/invigilation/card/${encodeURIComponent(`https://finesse.example/verify/${codes.amina}`)}`, { as: ids.lecA });
    assert.equal(r.json.state, 'valid');
    const by = Object.fromEntries(r.json.units.map((u) => [u.unit_code, u]));
    assert.deepEqual(Object.keys(by).sort(), ['CSC 101', 'CSC102', 'CSC103']);
    assert.equal(by['CSC 101'].can_sign, true);
    assert.equal(by.CSC102.can_sign, false, 'belongs to lecturer B');
    assert.equal(by.CSC103.allowed, false);
    assert.equal((await api(`/api/invigilation/card/${codes.brian}`, { as: ids.lecA })).json.state, 'revoked');
    assert.equal((await api(`/api/invigilation/card/${codes.cynthia}`, { as: ids.lecA })).json.state, 'expired');
    assert.equal((await api('/api/invigilation/card/NOSUCHCODE12', { as: ids.lecA })).json.state, 'not_found');
    assert.equal((await api(`/api/invigilation/card/${codes.amina}`)).status, 401, 'signed-in only');
    assert.equal((await api(`/api/invigilation/card/${codes.amina}`, { as: ids.amina })).status, 403, 'students cannot scan');
  });

  const sign = (as, nick, code) => api('/api/invigilation/sign', { method: 'POST', as, body: { code: codes[nick], unitId: unit[code] } });

  test('signing: works once, then "already signed" with who and when', async () => {
    const first = await sign(ids.lecA, 'amina', 'CSC 101');
    assert.deepEqual([first.json.ok, first.json.result], [true, 'signed']);
    assert.ok(first.json.signed_at && first.json.signed_by_name.includes(run));
    const second = await sign(ids.lecA, 'amina', 'CSC 101');
    assert.deepEqual([second.json.ok, second.json.result], [false, 'already_signed']);
    assert.equal(second.json.signed_by_name, first.json.signed_by_name);
    const row = (await pool.query('SELECT signed_by FROM unit_registrations WHERE exam_unit_id = $1 AND student_id = $2', [unit['CSC 101'], `AM/${run}/1`])).rows[0];
    assert.equal(row.signed_by, ids.lecA);
  });

  test('every refusal reason', async () => {
    assert.equal((await sign(ids.lecA, 'amina', 'CSC102')).json.result, 'not_your_unit');
    assert.equal((await sign(ids.lecB, 'amina', 'CSC 101')).json.result, 'not_your_unit');
    assert.equal((await sign(ids.lecB, 'brian', 'CSC102')).json.result, 'card_invalid', 'revoked card');
    assert.equal((await sign(ids.lecA, 'cynthia', 'CSC 101')).json.result, 'card_invalid', 'expired card');
    const notReg = await sign(ids.lecB, 'david', 'CSC 101');           // staff-signable unit: david is registered only for CSC102
    assert.equal((await sign(ids.staff, 'david', 'CSC 101')).json.result, 'not_registered');
    assert.equal(notReg.json.result, 'not_your_unit');
    assert.equal((await sign(ids.staff, 'amina', 'CSC103')).json.result, 'barred');
    assert.match((await sign(ids.staff, 'amina', 'CSC103')).json.message, /Missing CAT marks/);
    // wrong day: CSC103 has tomorrow's date; let david in for it first
    await api('/api/exam-units/registrations/import', { method: 'POST', as: ids.staff, body: { periodId, rows: [{ student_id: `DA/${run}/4`, unit_code: 'CSC103' }] } });
    assert.equal((await sign(ids.staff, 'david', 'CSC103')).json.result, 'wrong_day');
    const noCard = await api('/api/invigilation/sign', { method: 'POST', as: ids.staff, body: { code: 'ZZZZZZZZZZ', unitId: unit.CSC102 } });
    assert.equal(noCard.json.result, 'card_invalid');
    assert.equal((await api('/api/invigilation/sign', { method: 'POST', as: ids.staff, body: { code: codes.amina, unitId: '11111111-1111-4111-8111-111111111111' } })).status, 404);
  });

  test('RACE: ten scans of the same card at the same moment sign it exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => sign(ids.lecB, 'david', 'CSC102')));
    const wins = results.filter((r) => r.json.ok).length;
    assert.equal(wins, 1, `expected exactly one winner, got ${wins}`);
    assert.ok(results.filter((r) => !r.json.ok).every((r) => r.json.result === 'already_signed'));
    const logs = (await pool.query(`SELECT count(*)::int AS n FROM unit_sign_log l JOIN unit_registrations r ON r.id = l.registration_id
                                     WHERE r.exam_unit_id = $1 AND r.student_id = $2 AND l.action = 'signed'`, [unit.CSC102, `DA/${run}/4`])).rows[0].n;
    assert.equal(logs, 1, 'exactly one audit entry');
  });

  test('registers: lecturers see only their own units; staff see everything', async () => {
    const mine = await api(`/api/exam-units?periodId=${periodId}`, { as: ids.lecA });
    assert.deepEqual(mine.json.units.map((u) => u.unit_code), ['CSC 101']);
    assert.equal((await api(`/api/exam-units/${unit.CSC102}/register`, { as: ids.lecA })).status, 403);
    const reg = await api(`/api/exam-units/${unit['CSC 101']}/register`, { as: ids.lecA });
    assert.equal(reg.status, 200);
    const amina = reg.json.rows.find((r) => r.student_id === `AM/${run}/1`);
    assert.ok(amina.signed_at && amina.has_card);
    assert.equal(reg.json.rows.find((r) => r.student_id === `BR/${run}/2`).has_card, false, 'revoked card does not count');
    const all = await api(`/api/exam-units?periodId=${periodId}`, { as: ids.staff });
    assert.equal(all.json.units.length, 3);
    assert.equal((await api(`/api/exam-units`, { as: ids.amina })).status, 403, 'students cannot list units');
  });

  test('corrections: reset needs a reason, is logged, and lets the unit be signed again; bar/allow works', async () => {
    const regId = (await pool.query('SELECT id FROM unit_registrations WHERE exam_unit_id = $1 AND student_id = $2', [unit['CSC 101'], `AM/${run}/1`])).rows[0].id;
    assert.equal((await api(`/api/exam-units/registrations/${regId}/reset`, { method: 'POST', as: ids.lecA, body: { reason: 'oops, mistake' } })).status, 403);
    assert.equal((await api(`/api/exam-units/registrations/${regId}/reset`, { method: 'POST', as: ids.staff, body: {} })).status, 400);
    assert.equal((await api(`/api/exam-units/registrations/${regId}`, { method: 'DELETE', as: ids.staff })).status, 409, 'cannot delete a signed registration');
    assert.equal((await api(`/api/exam-units/registrations/${regId}/reset`, { method: 'POST', as: ids.staff, body: { reason: 'Signed the wrong student' } })).status, 200);
    assert.equal((await sign(ids.lecA, 'amina', 'CSC 101')).json.ok, true, 'can be signed again after a reset');
    const log = (await pool.query('SELECT action, reason FROM unit_sign_log WHERE registration_id = $1 ORDER BY id', [regId])).rows;
    assert.deepEqual(log.map((l) => l.action), ['signed', 'reset', 'signed']);
    assert.equal(log[1].reason, 'Signed the wrong student');
    // bar and allow
    const bar = await api(`/api/exam-units/registrations/${regId}`, { method: 'PATCH', as: ids.staff, body: { allowed: false } });
    assert.equal(bar.status, 400, 'a bar needs a reason');
    const barredId = (await pool.query('SELECT id FROM unit_registrations WHERE exam_unit_id = $1 AND student_id = $2', [unit.CSC103, `AM/${run}/1`])).rows[0].id;
    assert.equal((await api(`/api/exam-units/registrations/${barredId}`, { method: 'PATCH', as: ids.staff, body: { allowed: true } })).status, 200);
    assert.equal((await sign(ids.staff, 'amina', 'CSC103')).json.result, 'wrong_day', 'allowed now; only the date stops it');
  });

  test('a student sees their own units', async () => {
    const r = await api(`/api/exam-units/mine?periodId=${periodId}`, { as: ids.amina });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.units.map((u) => u.unit_code).sort(), ['CSC 101', 'CSC102', 'CSC103']);
    assert.ok(r.json.units.find((u) => u.unit_code === 'CSC 101').signed_at);
    assert.equal((await api('/api/exam-units/mine', { as: ids.lecA })).status, 403);
  });

  test('assigning lecturers by hand', async () => {
    assert.equal((await api(`/api/exam-units/${unit.CSC102}/lecturers`, { method: 'PUT', as: ids.staff, body: { lecturerIds: [ids.amina] } })).status, 400, 'a student is not a lecturer');
    assert.equal((await api(`/api/exam-units/${unit.CSC102}/lecturers`, { method: 'PUT', as: ids.staff, body: { lecturerIds: [ids.lecA, ids.lecB] } })).status, 200);
    assert.equal((await api(`/api/exam-units/${unit.CSC102}/register`, { as: ids.lecA })).status, 200);
  });
});


