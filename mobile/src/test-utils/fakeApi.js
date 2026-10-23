import { setToken } from '@/lib/api';

/** What the real API returns for any list endpoint with no rows, so unmatched requests never crash a screen. */
const EMPTY_LISTS = {
  tickets: [],
  applications: [],
  periods: [],
  feeRecords: [],
  dates: [],
  slots: [],
  emails: [],
  templates: [],
};

/**
 * Replaces fetch with a tiny fake server. Keys look like "GET /tickets" or "POST /tickets/abc/book"
 * and match by prefix (longest first); unmatched requests return empty lists, so screens show empty states.
 */
export function installFakeApi(routes) {
  const calls = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  globalThis.fetch = jest.fn(async (url, init) => {
    const path = url.replace(/^.*\/api/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const key = `${method} ${path}`;
    calls.push({ key, body });
    const match = keys.find((k) => key.startsWith(k));
    const h = match ? routes[match] : undefined;
    const reply = h ? (typeof h === 'function' ? h({ body, path }) : h) : { body: EMPTY_LISTS };
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body };
  });
  return { calls, last: (key) => [...calls].reverse().find((c) => c.key.startsWith(key)) };
}

export const users = {
  student: {
    id: 'u1',
    name: 'Amina Hassan',
    email: 'amina@students.finesse.ac.ke',
    student_id: 'EGM/1',
    university: 'Moi University',
    course: 'BSc EE',
    year_of_study: '2',
    role: 'student',
  },
  staff: {
    id: 'u2',
    name: 'Susan Otieno',
    email: 'staff@finesse.ac.ke',
    student_id: null,
    university: null,
    course: null,
    year_of_study: null,
    role: 'staff',
  },
};

/** Pretend the person already signed in earlier (token saved) and the server accepts it. */
export async function signedInAs(role) {
  await setToken(`jwt-${role}`);
  return { 'GET /auth/me': { body: { user: users[role] } } };
}

export const ticket = (over = {}) => ({
  id: 't1',
  student_id: 'u1',
  student_number: 'EGM/1',
  student_name: 'Amina Hassan',
  issue_type: 'fee_dispute',
  description: 'My fee statement shows a duplicate charge for September.',
  priority: 'medium',
  status: 'pending',
  appointment_slot: null,
  appointment_slot_id: null,
  staff_notes: '',
  assigned_staff_id: null,
  created_at: '2026-10-14 08:40:00',
  updated_at: '2026-10-14 08:40:00',
  ...over,
});
