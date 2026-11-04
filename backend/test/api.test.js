// Integration tests: run against the REAL Supabase project defined in backend/.env
// (real Postgres + real Supabase Auth). They create uniquely-named users and records and delete them again
// when the run finishes, but because the whole team shares one project, prefer a separate "dev" project for
// tests if you can, and don't run them while a teammate is demoing.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { pool, queryOne } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { supabaseAdmin } = await import('../src/supabase.js');

let server;
let base;
const PASSWORD = 'Finesse@2026';
const run = Date.now().toString(36);
const createdUserIds = [];
let testPeriodId; // an exam period created by this run, open today, so the tests never depend on seed dates

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

/** Sign in the way the apps do: straight against Supabase Auth. Returns { status, json: { token, user } }; on failure json is Supabase's error. */
async function login(email, password = PASSWORD) {
  const res = await fetch(`${config.supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.supabase.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) return { status: res.status, json };
  const me = await api('/api/auth/me', { token: json.access_token });
  return { status: res.status, json: { token: json.access_token, user: me.json?.user } };
}

/** Register through the API, then sign in. */
async function registerAndLogin(fields) {
  const reg = await api('/api/auth/register', { method: 'POST', body: { password: PASSWORD, ...fields } });
  if (reg.status === 201) createdUserIds.push(reg.json.user.id);
  const session = reg.status === 201 ? await login(fields.email) : null;
  return { reg, token: session?.json.token, user: reg.json?.user };
}

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const { today } = await queryOne("SELECT to_char(app_today(), 'YYYY-MM-DD') AS today");
  const shift = async (days) => (await queryOne("SELECT to_char($1::date + $2::int, 'YYYY-MM-DD') AS d", [today, days])).d;
  const p = await queryOne(
    `INSERT INTO exam_periods (title, academic_year, semester, exam_start_date, exam_end_date, application_open, application_close)
     VALUES ($1,'2026/2027','Semester 1',$2,$3,$4,$5) RETURNING id`,
    [`Test period ${run}`, await shift(20), await shift(30), await shift(-1), await shift(10)],
  );
  testPeriodId = p.id;
});

after(async () => {
  try {
    // Free any slot the run booked, then remove everything it created (deleting a user cascades to its tickets/applications).
    const tickets = await pool.query('SELECT appointment_slot_id FROM tickets WHERE description ILIKE $1 AND appointment_slot_id IS NOT NULL', [`%${run}%`]);
    for (const t of tickets.rows) await pool.query('SELECT unbook_slot($1)', [t.appointment_slot_id]);
    await pool.query('DELETE FROM tickets WHERE description ILIKE $1', [`%${run}%`]);
    await pool.query('DELETE FROM fee_records WHERE student_id ILIKE $1', [`FLOW/_/${run}`]);
    await pool.query('DELETE FROM sent_emails WHERE to_email ILIKE $1', [`%-${run}@students.finesse.ac.ke`]);
    await pool.query('DELETE FROM exam_periods WHERE id = $1', [testPeriodId]);
    for (const id of createdUserIds) await supabaseAdmin.auth.admin.deleteUser(id);
  } catch (e) {
    console.error('Test cleanup failed (remove leftovers manually):', e.message);
  }
  await new Promise((r) => server.close(r));
  await pool.end();
});

describe('health + auth', () => {
  test('health reports the database as connected', async () => {
    const r = await api('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.db, 'connected');
  });

  test('seeded staff and student can sign in; /auth/me returns their profile with the right role', async () => {
    const expected = { 'staff@finesse.ac.ke': 'staff', 'admin@finesse.ac.ke': 'admin', 'amina@students.finesse.ac.ke': 'student' };
    for (const [email, role] of Object.entries(expected)) {
      const r = await login(email);
      assert.equal(r.status, 200, email);
      assert.ok(r.json.token);
      assert.equal(r.json.user.role, role);
      assert.equal(r.json.user.password_hash, undefined);
    }
  });

  test('wrong password and unknown email are refused identically by Supabase Auth', async () => {
    const a = await login('staff@finesse.ac.ke', 'nope-nope-nope');
    const b = await login('ghost@nowhere.ke', 'nope-nope-nope');
    assert.equal(a.status, 400);
    assert.equal(b.status, 400);
    assert.equal(a.json.error_code ?? a.json.code, b.json.error_code ?? b.json.code);
  });

  test('protected routes reject missing or garbage tokens', async () => {
    assert.equal((await api('/api/tickets')).status, 401);
    assert.equal((await api('/api/tickets', { token: 'garbage' })).status, 401);
  });

  test('the Supabase access token works as the API bearer token', async () => {
    const { json } = await login('amina@students.finesse.ac.ke');
    const me = await api('/api/auth/me', { token: json.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, 'amina@students.finesse.ac.ke');
  });

  test('registration is student-only, ignores a client-supplied role, and the new account can sign in', async () => {
    const { reg, token } = await registerAndLogin({ name: 'Role Tester', email: `role-${run}@students.finesse.ac.ke`, studentId: `ROLE/${run}`, role: 'admin' });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.user.role, 'student');
    assert.ok(token, 'the new user can sign in with the password they registered with');
    assert.equal((await api('/api/fee-records', { token })).status, 403, 'and has no staff powers');
  });

  test('change-password: wrong current password is refused, correct one works and the new password signs in', async () => {
    const { token } = await registerAndLogin({ name: 'Pw Tester', email: `pw-${run}@students.finesse.ac.ke`, studentId: `PW/${run}` });
    const bad = await api('/api/auth/change-password', { method: 'POST', token, body: { currentPassword: 'not-my-password', newPassword: 'Brand-new-pass-1' } });
    assert.equal(bad.status, 400);
    const ok = await api('/api/auth/change-password', { method: 'POST', token, body: { currentPassword: PASSWORD, newPassword: 'Brand-new-pass-1' } });
    assert.equal(ok.status, 200);
    assert.equal((await login(`pw-${run}@students.finesse.ac.ke`, PASSWORD)).status, 400, 'old password no longer works');
    assert.equal((await login(`pw-${run}@students.finesse.ac.ke`, 'Brand-new-pass-1')).status, 200);
  });

  test('duplicate email is rejected with 409 and weak passwords with 400', async () => {
    const dup = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'Dup', email: 'amina@students.finesse.ac.ke', password: PASSWORD, studentId: `DUP/${run}` },
    });
    assert.equal(dup.status, 409);
    const weak = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'Weak', email: `weak-${run}@x.ke`, password: 'short', studentId: `WEAK/${run}` },
    });
    assert.equal(weak.status, 400);
  });
});

describe('authorisation', () => {
  test('students cannot reach staff-only endpoints', async () => {
    const { json } = await login('amina@students.finesse.ac.ke');
    for (const path of ['/api/fee-records', '/api/templates', '/api/emails']) {
      assert.equal((await api(path, { token: json.token })).status, 403, path);
    }
  });

  test("a student cannot read another student's ticket (404, not 403)", async () => {
    const amina = (await login('amina@students.finesse.ac.ke')).json.token;
    const brianTicket = 'f0000000-0000-4000-8000-000000000001';
    assert.equal((await api(`/api/tickets/${brianTicket}`, { token: amina })).status, 404);
  });

  test('students only see their own tickets; staff see all', async () => {
    const brian = (await login('brian@students.finesse.ac.ke')).json.token;
    const staff = (await login('staff@finesse.ac.ke')).json.token;
    const mine = (await api('/api/tickets', { token: brian })).json.tickets;
    const all = (await api('/api/tickets', { token: staff })).json.tickets;
    assert.ok(mine.length >= 1 && mine.every((t) => t.student_name === 'Brian Kiprop'));
    assert.ok(all.length > mine.length);
  });
});

describe('tickets + appointment booking', () => {
  test('student raises a ticket, books a slot, and a second booking of the same slot is a 409', async () => {
    const cynthia = (await login('cynthia@students.finesse.ac.ke')).json.token;
    const david = (await login('david@students.finesse.ac.ke')).json.token;

    const t1 = await api('/api/tickets', { method: 'POST', token: cynthia, body: { issueType: 'bursary', description: `Bursary confirmation letter please ${run}` } });
    assert.equal(t1.status, 201);
    assert.equal(t1.json.ticket.status, 'pending');
    const t2 = await api('/api/tickets', { method: 'POST', token: david, body: { issueType: 'helb', description: `HELB query for the semester ${run}` } });

    // a free slot, 3 days out, mid-afternoon
    const dates = (await api('/api/slots/dates?days=7', { token: cynthia })).json.dates;
    assert.ok(dates.length > 0, 'seed data should provide upcoming slots');
    const slots = (await api(`/api/slots?date=${dates[dates.length - 1].date}`, { token: cynthia })).json.slots;
    const free = slots.find((s) => !s.is_booked);
    assert.ok(free);
    assert.equal(free.booked_by_name, undefined, 'students must not see who booked');

    const book1 = await api(`/api/tickets/${t1.json.ticket.id}/book`, { method: 'POST', token: cynthia, body: { slotId: free.id } });
    assert.equal(book1.status, 200);
    assert.equal(book1.json.ticket.appointment_slot_id, free.id);
    assert.equal(book1.json.ticket.status, 'in_review');

    const book2 = await api(`/api/tickets/${t2.json.ticket.id}/book`, { method: 'POST', token: david, body: { slotId: free.id } });
    assert.equal(book2.status, 409);

    // cancelling the booking frees the slot for someone else
    const cancel = await api(`/api/tickets/${t1.json.ticket.id}/booking`, { method: 'DELETE', token: cynthia });
    assert.equal(cancel.status, 200);
    const rebook = await api(`/api/tickets/${t2.json.ticket.id}/book`, { method: 'POST', token: david, body: { slotId: free.id } });
    assert.equal(rebook.status, 200);
  });

  test('students may only cancel; staff can change status and notes', async () => {
    const amina = (await login('amina@students.finesse.ac.ke')).json.token;
    const staff = (await login('staff@finesse.ac.ke')).json.token;
    const t = (await api('/api/tickets', { method: 'POST', token: amina, body: { issueType: 'other', description: `Something else entirely ${run}` } })).json.ticket;

    const sneaky = await api(`/api/tickets/${t.id}`, { method: 'PATCH', token: amina, body: { status: 'resolved' } });
    assert.equal(sneaky.status, 400);

    const upd = await api(`/api/tickets/${t.id}`, { method: 'PATCH', token: staff, body: { status: 'in_review', staffNotes: 'Looking into it' } });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.ticket.status, 'in_review');
    assert.equal(upd.json.ticket.staff_notes, 'Looking into it');
    assert.ok(upd.json.ticket.assigned_staff_id, 'moving to in_review assigns the staff member');

    const cancel = await api(`/api/tickets/${t.id}`, { method: 'PATCH', token: amina, body: { status: 'cancelled' } });
    assert.equal(cancel.json.ticket.status, 'cancelled');
  });

  test('input validation: too-short description is a 400 with details', async () => {
    const amina = (await login('amina@students.finesse.ac.ke')).json.token;
    const r = await api('/api/tickets', { method: 'POST', token: amina, body: { issueType: 'other', description: 'short' } });
    assert.equal(r.status, 400);
    assert.ok(r.json.details.length >= 1);
  });
});

describe('exam card workflow', () => {
  test('full flow: import fees -> apply -> auto-approve -> issue -> email stored; rejected applicant can re-apply after paying', async () => {
    const staff = (await login('staff@finesse.ac.ke')).json.token;
    const periodId = testPeriodId;

    // Two new students
    const reg = async (n, sid) => {
      const { token } = await registerAndLogin({ name: `Flow ${n}`, email: `flow${n}-${run}@students.finesse.ac.ke`, studentId: sid });
      assert.ok(token, `flow ${n} user could register and sign in`);
      return { token };
    };
    const paid = await reg('paid', `FLOW/P/${run}`.toUpperCase());
    const owing = await reg('owing', `FLOW/O/${run}`.toUpperCase());

    // Staff imports fees (client-supplied balance/cleared would be ignored: server recomputes)
    const imp = await api('/api/fee-records/import', {
      method: 'POST', token: staff,
      body: {
        academicYear: '2026/2027', semester: 'Semester 1',
        rows: [
          { student_id: `FLOW/P/${run}`, student_name: 'Flow paid', total_fee: 50000, amount_paid: 50000 },
          { student_id: `FLOW/O/${run}`, student_name: 'Flow owing', total_fee: 50000, amount_paid: 30000 },
        ],
      },
    });
    assert.equal(imp.status, 201);

    // Paid student: auto-approved, then issued
    const a1 = await api('/api/applications', { method: 'POST', token: paid.token, body: { examPeriodId: periodId } });
    assert.equal(a1.status, 201);
    assert.equal(a1.json.application.status, 'approved');
    const issued = await api(`/api/applications/${a1.json.application.id}/issue`, { method: 'POST', token: paid.token });
    assert.equal(issued.status, 200);
    assert.equal(issued.json.application.status, 'issued');
    assert.match(issued.json.cardNumber, /^FC-[0-9A-F]{8}$/);

    const emails = (await api('/api/emails', { token: staff })).json.emails;
    assert.ok(emails.some((e) => e.card_number === issued.json.cardNumber && e.email_type === 'exam_card'));

    // Duplicate application is blocked
    const dup = await api('/api/applications', { method: 'POST', token: paid.token, body: { examPeriodId: periodId } });
    assert.equal(dup.status, 409);

    // Owing student: rejected with balance in the reason, rejection email stored
    const a2 = await api('/api/applications', { method: 'POST', token: owing.token, body: { examPeriodId: periodId } });
    assert.equal(a2.json.application.status, 'rejected');
    assert.match(a2.json.application.rejection_reason, /20,000/);
    const cannotIssue = await api(`/api/applications/${a2.json.application.id}/issue`, { method: 'POST', token: owing.token });
    assert.equal(cannotIssue.status, 409);

    // Student cannot self-approve; staff can override with a reason
    const selfApprove = await api(`/api/applications/${a2.json.application.id}/approve`, { method: 'POST', token: owing.token, body: { note: 'let me in please' } });
    assert.equal(selfApprove.status, 403);
    const override = await api(`/api/applications/${a2.json.application.id}/approve`, { method: 'POST', token: staff, body: { note: 'Sponsor letter received' } });
    assert.equal(override.json.application.status, 'approved');
    assert.equal(override.json.application.manual_approval_note, 'Sponsor letter received');

    // A rejected student who then pays in full can re-apply and is approved
    const late = await reg('late', `FLOW/L/${run}`.toUpperCase());
    await api('/api/fee-records/import', { method: 'POST', token: staff, body: { academicYear: '2026/2027', semester: 'Semester 1', rows: [{ student_id: `FLOW/L/${run}`, total_fee: 40000, amount_paid: 10000 }] } });
    const first = await api('/api/applications', { method: 'POST', token: late.token, body: { examPeriodId: periodId } });
    assert.equal(first.json.application.status, 'rejected');
    await api('/api/fee-records/import', { method: 'POST', token: staff, body: { academicYear: '2026/2027', semester: 'Semester 1', rows: [{ student_id: `FLOW/L/${run}`, total_fee: 40000, amount_paid: 40000 }] } });
    const second = await api('/api/applications', { method: 'POST', token: late.token, body: { examPeriodId: periodId } });
    assert.equal(second.status, 201);
    assert.equal(second.json.application.status, 'approved');
  });

  test('applying to an inactive or closed exam period is refused', async () => {
    const amina = (await login('amina@students.finesse.ac.ke')).json.token;
    const r = await api('/api/applications', { method: 'POST', token: amina, body: { examPeriodId: 'c0000000-0000-4000-8000-000000000002' } });
    assert.equal(r.status, 404);
  });

  test('exam period validation rejects end-before-start', async () => {
    const staff = (await login('staff@finesse.ac.ke')).json.token;
    const r = await api('/api/exam-periods', {
      method: 'POST', token: staff,
      body: { title: 'Bad period', academicYear: '2027/2028', semester: 'Semester 1', examStartDate: '2027-12-10', examEndDate: '2027-12-01', applicationOpen: '2027-11-01', applicationClose: '2027-11-20' },
    });
    assert.equal(r.status, 400);
  });
});

describe('templates', () => {
  test('staff can edit a template and rendered output escapes user data', async () => {
    const staff = (await login('staff@finesse.ac.ke')).json.token;
    const tpl = (await api('/api/templates', { token: staff })).json.templates.find((t) => t.template_key === 'rejection');
    const put = await api('/api/templates/rejection', { method: 'PUT', token: staff, body: { subject: tpl.subject, html: tpl.html } });
    assert.equal(put.status, 200);
    const { renderTemplate } = await import('../src/mailer.js');
    assert.equal(renderTemplate('Hi {{name}}', { name: '<script>x</script>' }), 'Hi &lt;script&gt;x&lt;/script&gt;');
  });
});
