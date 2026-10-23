import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { setToken } from '@/lib/api';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

const student = {
  id: 'u1',
  name: 'Amina Hassan',
  email: 'amina@students.finesse.ac.ke',
  student_id: 'EGM/1',
  university: null,
  course: null,
  year_of_study: null,
  role: 'student',
};
const staff = {
  id: 'u2',
  name: 'Susan Otieno',
  email: 'staff@finesse.ac.ke',
  student_id: null,
  university: null,
  course: null,
  year_of_study: null,
  role: 'staff',
};

/** Minimal fake API: returns empty lists so screens render their empty states. */
function fakeApi(opts) {
  globalThis.fetch = jest.fn(async (url, init) => {
    const path = url.replace(/^.*\/api/, '');
    let status = 200;
    let body = {};
    if (path === '/auth/me') body = opts.me ? { user: opts.me } : { error: 'nope' };
    else if (path === '/auth/me' && !opts.me) status = 401;
    else if (path === '/auth/login' && init?.method === 'POST') ({ status = 200, body } = opts.login ?? { body: {} });
    else if (path.startsWith('/tickets')) body = { tickets: [] };
    else if (path.startsWith('/applications')) body = { applications: [] };
    else if (path.startsWith('/exam-periods')) body = { periods: [] };
    else if (path.startsWith('/fee-records')) body = { feeRecords: [] };
    else if (path.startsWith('/slots')) body = { dates: [], slots: [] };
    return { ok: status < 400, status, json: async () => body };
  });
}

const mountApp = () => renderRouter('./src/app', { initialUrl: '/' });

describe('role-based routing (real src/app routes)', () => {
  it('shows the sign-in screen when signed out', async () => {
    fakeApi({});
    await mountApp();
    expect(await screen.findByTestId('login-submit')).toBeTruthy();
    await waitFor(() => expect(screen).toHavePathname('/login'));
  });

  it('opens a restored student session on My Tickets', async () => {
    await setToken('jwt-student');
    fakeApi({ me: student });
    await mountApp();
    expect(await screen.findByText('My Tickets')).toBeTruthy();
    expect(screen).toHavePathname('/tickets');
  });

  it('opens a restored staff session on the Ticket Queue', async () => {
    await setToken('jwt-staff');
    fakeApi({ me: staff });
    await mountApp();
    expect(await screen.findByText('Ticket Queue')).toBeTruthy();
    expect(screen).toHavePathname('/queue');
  });

  it('keeps a student out of staff screens, even by navigating to them directly', async () => {
    await setToken('jwt-student');
    fakeApi({ me: student });
    await mountApp();
    await screen.findByText('My Tickets');
    await act(async () => router.push('/queue'));
    await waitFor(() => expect(screen).not.toHavePathname('/queue'));
    expect(screen.queryByText('Ticket Queue')).toBeNull();
  });

  it('signs a staff member in through the form and lands on the queue', async () => {
    fakeApi({ login: { body: { token: 'jwt-new', user: staff } } });
    await mountApp();
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'staff@finesse.ac.ke');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'Finesse@2026');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Ticket Queue')).toBeTruthy();
    expect(screen).toHavePathname('/queue');
  });

  it('shows the server message on a wrong password and stays on the sign-in screen', async () => {
    fakeApi({ login: { status: 401, body: { error: 'Incorrect email or password.' } } });
    await mountApp();
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'amina@students.finesse.ac.ke');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong-pass');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Incorrect email or password.')).toBeTruthy();
    expect(screen).toHavePathname('/login');
  });

  it('validates the form before calling the server', async () => {
    fakeApi({});
    await mountApp();
    await fireEvent.press(await screen.findByTestId('login-submit'));
    expect(await screen.findByText('Email is required')).toBeTruthy();
    const calls = globalThis.fetch.mock.calls.filter(([u]) => u.includes('/auth/login'));
    expect(calls).toHaveLength(0);
  });
});
