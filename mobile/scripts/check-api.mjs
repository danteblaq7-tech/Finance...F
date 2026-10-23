// Contract check: signs in to a running Finesse API with the demo accounts and verifies that every
// response has the fields the mobile app reads. Also a handy "is my backend reachable?" test.
//
//   npm run check:api                       -> http://localhost:4000
//   npm run check:api -- 192.168.1.5:4000   -> your computer's Wi-Fi address
const arg = process.argv[2] ?? 'localhost:4000';
const BASE = (/^https?:\/\//.test(arg) ? arg : `http://${arg}`).replace(/\/+$/, '');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Finesse@2026';

const SHAPES = {
  user: ['id', 'name', 'email', 'student_id', 'university', 'course', 'year_of_study', 'role'],
  ticket: ['id', 'student_id', 'student_number', 'student_name', 'issue_type', 'description', 'priority', 'status', 'appointment_slot', 'appointment_slot_id', 'staff_notes', 'assigned_staff_id', 'created_at', 'updated_at'],
  slot: ['id', 'slot_date', 'start_time', 'end_time', 'display_time', 'is_booked'],
  slotDate: ['date', 'free', 'total'],
  feeRecord: ['id', 'student_id', 'academic_year', 'semester', 'total_fee', 'amount_paid', 'balance', 'is_cleared_for_exam'],
  period: ['id', 'title', 'academic_year', 'semester', 'exam_start_date', 'exam_end_date', 'application_open', 'application_close', 'is_active'],
  application: ['id', 'student_uid', 'student_id', 'student_name', 'exam_period_id', 'period_title', 'exam_start_date', 'exam_end_date', 'academic_year', 'semester', 'status', 'amount_paid', 'total_fee', 'balance', 'created_at'],
};

let failures = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✖ ${msg}`); };

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function expectShape(label, obj, fields) {
  if (!obj) return bad(`${label}: no data to check`);
  const missing = fields.filter((f) => !(f in obj));
  missing.length ? bad(`${label}: missing field(s) ${missing.join(', ')}`) : ok(`${label} has all ${fields.length} fields the app reads`);
}

async function login(email) {
  const r = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${r.json?.error ?? ''}`);
  return r.json;
}

console.log(`Checking ${BASE}\n`);
try {
  const health = await call('GET', '/health');
  health.json?.ok ? ok(`health: database ${health.json.db}`) : bad('health: backend is up but the database is not reachable');

  console.log('\nStudent (amina@students.finesse.ac.ke)');
  const s = await login('amina@students.finesse.ac.ke');
  expectShape('login user', s.user, SHAPES.user);
  const me = await call('GET', '/auth/me', { token: s.token });
  me.status === 200 ? ok('GET /auth/me') : bad(`GET /auth/me -> ${me.status}`);
  const tix = await call('GET', '/tickets', { token: s.token });
  Array.isArray(tix.json?.tickets) ? ok(`GET /tickets -> ${tix.json.tickets.length} ticket(s)`) : bad('GET /tickets: "tickets" is not a list');
  if (tix.json?.tickets?.[0]) expectShape('ticket', tix.json.tickets[0], SHAPES.ticket);
  const periods = await call('GET', '/exam-periods', { token: s.token });
  Array.isArray(periods.json?.periods) ? ok('GET /exam-periods') : bad('GET /exam-periods: "periods" is not a list');
  expectShape('exam period', periods.json?.periods?.[0], SHAPES.period);
  const apps = await call('GET', '/applications', { token: s.token });
  expectShape('application', apps.json?.applications?.[0], SHAPES.application);
  const fees = await call('GET', '/fee-records/mine', { token: s.token });
  expectShape('fee record', fees.json?.feeRecords?.[0], SHAPES.feeRecord);
  const dates = await call('GET', '/slots/dates?days=14', { token: s.token });
  Array.isArray(dates.json?.dates) ? ok(`GET /slots/dates -> ${dates.json.dates.length} day(s) with slots`) : bad('GET /slots/dates: "dates" is not a list');
  if (dates.json?.dates?.[0]) {
    expectShape('slot date', dates.json.dates[0], SHAPES.slotDate);
    const slots = await call('GET', `/slots?date=${dates.json.dates[0].date}`, { token: s.token });
    expectShape('slot', slots.json?.slots?.[0], SHAPES.slot);
    slots.json?.slots?.[0] && 'booked_by_name' in slots.json.slots[0] ? bad('slots leak who booked them to students') : ok('slots hide who booked them from students');
  }
  (await call('GET', '/fee-records', { token: s.token })).status === 403 ? ok('students are refused staff endpoints (403)') : bad('a student could read /fee-records');

  console.log('\nStaff (staff@finesse.ac.ke)');
  const st = await login('staff@finesse.ac.ke');
  const queue = await call('GET', '/tickets', { token: st.token });
  expectShape('staff ticket list', queue.json?.tickets?.[0], SHAPES.ticket);
  const allApps = await call('GET', '/applications', { token: st.token });
  expectShape('staff application list', allApps.json?.applications?.[0], SHAPES.application);
  const allFees = await call('GET', '/fee-records?search=', { token: st.token });
  expectShape('staff fee list', allFees.json?.feeRecords?.[0], SHAPES.feeRecord);
} catch (e) {
  failures++;
  console.log(`\n  ✖ ${e.message}\n    Is the backend running at ${BASE}? Did you import the database? (Demo password: ${PASSWORD})`);
}

console.log(failures ? `\n${failures} problem(s) found.` : '\nAll good: the backend matches what the mobile app expects.');
process.exit(failures ? 1 : 0);
