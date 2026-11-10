import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { fake as __fake } from '@/test-utils/fakeSupabase';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const camera = (require('expo-camera') as { __camera: { onScanned: (e: { data: string }) => void; permission: unknown; ask: jest.Mock } }).__camera;

const period = { id: 'p1', title: 'Semester 1 Exams', academic_year: '2026/2027', semester: 'Semester 1', exam_start_date: '2026-11-23', exam_end_date: '2026-12-11' };
const unit = { id: 'u1', exam_period_id: 'p1', unit_code: 'CSC101', unit_name: 'Intro to Programming', exam_date: null, start_time: '09:00:00', end_time: '11:00:00', venue: 'Main Hall', registered: 40, signed: 12, lecturers: [{ id: 'l1', name: 'Dr Otieno', email: 'o@x.ke' }] };
const student = { name: 'Amina Hassan', student_id: 'COM/072/23', course: 'Computer Science', year_of_study: '3' };
const chip = (over = {}) => ({ id: 'u1', unit_code: 'CSC101', unit_name: 'Intro to Programming', exam_date: null, start_time: null, venue: null, allowed: true, block_reason: null, signed_at: null, signed_by_name: null, can_sign: true, ...over });
const person = (role: string) => ({ id: `id-${role}`, name: 'Dr Otieno', email: `${role}@finesse.ac.ke`, student_id: null, university: null, course: null, year_of_study: null, role });

type Handler = (body: unknown) => unknown;
function fakeApi(role: string, routes: Record<string, Handler | unknown>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace(/^.*\/api/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const hit = routes[`${method} ${path}`] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && `${method} ${path}`.startsWith(k.slice(0, -1)))?.[1];
    const out = path === '/auth/me' ? { user: person(role) } : typeof hit === 'function' ? (hit as Handler)(body) : hit ?? {};
    return { ok: true, status: 200, json: async () => out } as Response;
  }) as unknown as typeof fetch;
  return calls;
}
async function openAs(role: string, url: string) {
  __fake.session = { access_token: `jwt-${role}`, user: { id: `id-${role}` } };
  await renderRouter('./src/app', { initialUrl: url });
}
const scanned = async (data: string) => { await act(async () => { camera.onScanned({ data }); }); };

beforeEach(() => { camera.permission = { granted: true, canAskAgain: true }; camera.ask.mockReset(); });

describe('Scan Cards (lecturer)', () => {
  it('chooses a lone unit itself and signs it the moment a card is read', async () => {
    const calls = fakeApi('lecturer', {
      'GET /exam-units': { period, units: [unit] },
      'POST /invigilation/sign': { ok: true, result: 'signed', message: 'Amina Hassan signed in for CSC101.', student, unit: { id: 'u1', unit_code: 'CSC101', unit_name: 'Intro' }, units: [chip({ signed_at: '2026-11-23T09:05:00' })], signed_at: '2026-11-23T09:05:00', signed_by_name: 'Dr Otieno' },
    });
    await openAs('lecturer', '/scan');
    expect(await screen.findByText(/CSC101 · Intro to Programming/)).toBeTruthy();
    await waitFor(() => expect(camera.onScanned).toBeTruthy());
    await scanned('https://finesse.ac.ke/verify/ab12cd34ef56');
    expect(await screen.findByLabelText(/^SIGNED IN\./)).toBeTruthy();
    expect(screen.getAllByText('Amina Hassan').length).toBeGreaterThan(0);
    expect(calls.find((c) => c.path === '/invigilation/sign')?.body).toEqual({ code: 'https://finesse.ac.ke/verify/ab12cd34ef56', unitId: 'u1' });
  });

  it('ignores the same card read again and again within a few seconds (the camera reads it constantly)', async () => {
    const calls = fakeApi('lecturer', { 'GET /exam-units': { period, units: [unit] }, 'POST /invigilation/sign': { ok: true, result: 'signed', message: 'ok', student, unit: { id: 'u1', unit_code: 'CSC101', unit_name: 'x' }, units: [] } });
    await openAs('lecturer', '/scan');
    await screen.findByText(/CSC101 · Intro/);
    await waitFor(() => expect(camera.onScanned).toBeTruthy());
    for (let i = 0; i < 5; i += 1) await scanned('AB12CD34EF56');
    await waitFor(() => expect(calls.filter((c) => c.path === '/invigilation/sign')).toHaveLength(1));
  });

  it('says plainly why a student is refused, and who signed an already-signed unit', async () => {
    fakeApi('lecturer', {
      'GET /exam-units': { period, units: [unit] },
      'POST /invigilation/sign': { ok: false, result: 'already_signed', message: 'CSC101 was already signed for Amina Hassan.', student, unit: { id: 'u1', unit_code: 'CSC101', unit_name: 'x' }, units: [chip({ signed_at: '2026-11-23T09:05:00' })], signed_at: '2026-11-23T09:05:00', signed_by_name: 'Dr Wanjala' },
    });
    await openAs('lecturer', '/scan');
    await screen.findByText(/CSC101 · Intro/);
    await waitFor(() => expect(camera.onScanned).toBeTruthy());
    await scanned('AB12CD34EF56');
    expect(await screen.findByLabelText(/^ALREADY SIGNED\./)).toBeTruthy();
    expect(await screen.findByText('Dr Wanjala')).toBeTruthy();
  });

  it('rejects a QR code that is not an exam card without asking the server', async () => {
    const calls = fakeApi('lecturer', { 'GET /exam-units': { period, units: [unit] } });
    await openAs('lecturer', '/scan');
    await screen.findByText(/CSC101 · Intro/);
    await waitFor(() => expect(camera.onScanned).toBeTruthy());
    await scanned('https://example.com/some-other-qr');
    expect(await screen.findByText('That is not a Finesse exam-card code.')).toBeTruthy();
    expect(calls.some((c) => c.path === '/invigilation/sign')).toBe(false);
  });

  it('with several units, makes you choose one before signing', async () => {
    const calls = fakeApi('lecturer', { 'GET /exam-units': { period, units: [{ ...unit, id: 'm1' }, { ...unit, id: 'm2', unit_code: 'CSC102' }] } });
    await openAs('lecturer', '/scan');
    await screen.findByText('Choose a unit…');
    await waitFor(() => expect(camera.onScanned).toBeTruthy());
    await scanned('AB12CD34EF56');
    expect(await screen.findByText('Choose the unit you are invigilating first.')).toBeTruthy();
    expect(calls.some((c) => c.path === '/invigilation/sign')).toBe(false);
  });

  it('accepts a pasted code when the camera cannot be used', async () => {
    camera.permission = { granted: false, canAskAgain: true };
    const calls = fakeApi('lecturer', { 'GET /exam-units': { period, units: [unit] }, 'POST /invigilation/sign': { ok: true, result: 'signed', message: 'ok', student, unit: { id: 'u1', unit_code: 'CSC101', unit_name: 'x' }, units: [] } });
    await openAs('lecturer', '/scan');
    expect(await screen.findByText(/needs the camera/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Allow camera'));
    expect(camera.ask).toHaveBeenCalled();
    await screen.findByText(/CSC101 · Intro/);
    await fireEvent.changeText(screen.getByLabelText('Card code'), 'ab12cd34ef56');
    await fireEvent.press(screen.getByText('Check'));
    await waitFor(() => expect(calls.find((c) => c.path === '/invigilation/sign')?.body).toEqual({ code: 'ab12cd34ef56', unitId: 'u1' }));
  });
});

describe('Units (lecturer and staff)', () => {
  const register = { unit, rows: [
    { id: 'r1', student_id: 'COM/072/23', student_name: 'Amina Hassan', allowed: true, block_reason: null, signed_at: '2026-11-23T09:05:00', signed_by_name: 'Dr Otieno', has_card: true },
    { id: 'r2', student_id: 'COM/073/23', student_name: 'Brian Kamau', allowed: true, block_reason: null, signed_at: null, signed_by_name: null, has_card: true },
    { id: 'r3', student_id: 'COM/074/24', student_name: 'Cynthia Wanjiru', allowed: false, block_reason: 'Missing CAT marks', signed_at: null, signed_by_name: null, has_card: false },
  ] };

  it('a lecturer sees their units with progress and opens a unit\'s register (read-only)', async () => {
    fakeApi('lecturer', { 'GET /exam-units': { period, units: [unit] }, 'GET /exam-units/u1/register': register });
    await openAs('lecturer', '/units');
    expect(await screen.findByText('My units')).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('CSC101 Intro to Programming'));
    expect(await screen.findByText('Amina Hassan')).toBeTruthy();
    expect(screen.getByText('1 of 3 signed in')).toBeTruthy();
    expect(screen.getByText('Missing CAT marks')).toBeTruthy();
    expect(screen.queryByText('Bar')).toBeNull(); // corrections are for finance staff
    expect(screen.queryByLabelText('Add a student by ID')).toBeNull();
  });

  it('filters and searches the register', async () => {
    fakeApi('lecturer', { 'GET /exam-units': { period, units: [unit] }, 'GET /exam-units/u1/register': register });
    await openAs('lecturer', '/units/u1');
    await screen.findByText('Brian Kamau');
    await fireEvent.press(screen.getByText('Barred 1'));
    await waitFor(() => expect(screen.queryByText('Brian Kamau')).toBeNull());
    expect(screen.getByText('Cynthia Wanjiru')).toBeTruthy();
    await fireEvent.press(screen.getByText('All 3'));
    await fireEvent.changeText(screen.getByLabelText('Search'), 'amina');
    await waitFor(() => expect(screen.queryByText('Brian Kamau')).toBeNull());
    expect(screen.getByText('Amina Hassan')).toBeTruthy();
  });

  it('staff can add one student to a unit from its register', async () => {
    const calls = fakeApi('staff', {
      'GET /exam-units/u1/register': register,
      'POST /exam-units/registrations/import': { rows: 1, added: 1, unitsCreated: 0 },
    });
    await openAs('staff', '/units/u1');
    await screen.findByText('Brian Kamau');
    await fireEvent.changeText(screen.getByLabelText('Add a student by ID'), 'com/072/23');
    await fireEvent.press(screen.getByText('Add'));
    expect(await screen.findByText('COM/072/23 added.')).toBeTruthy();
    expect(calls.find((c) => c.path === '/exam-units/registrations/import')?.body).toEqual({ periodId: 'p1', rows: [{ student_id: 'com/072/23', unit_code: 'CSC101' }] });
  });
});
