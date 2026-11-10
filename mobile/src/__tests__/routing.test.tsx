import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { fake as __fake } from '@/test-utils/fakeSupabase';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

const student = { id: 'u1', name: 'Amina Hassan', email: 'amina@students.finesse.ac.ke', student_id: 'EGM/1', university: null, course: null, year_of_study: null, role: 'student' };
const lecturer = { id: 'u3', name: 'Dr Otieno', email: 'lecturer@finesse.ac.ke', student_id: null, university: null, course: null, year_of_study: null, role: 'lecturer' };
const staff = { id: 'u2', name: 'Susan Otieno', email: 'staff@finesse.ac.ke', student_id: null, university: null, course: null, year_of_study: null, role: 'staff' };

/** Minimal fake API: returns empty lists so screens render their empty states. */
function fakeApi(opts: { me?: unknown }) {
  globalThis.fetch = jest.fn(async (url: string) => {
    const path = url.replace(/^.*\/api/, '');
    let status = 200;
    let body: unknown = {};
    if (path === '/auth/me') body = opts.me ? { user: opts.me } : { error: 'nope' };
    else if (path === '/auth/me' && !opts.me) status = 401;
    else if (path.startsWith('/tickets')) body = { tickets: [] };
    else if (path.startsWith('/applications')) body = { applications: [] };
    else if (path.startsWith('/exam-periods')) body = { periods: [] };
    else if (path.startsWith('/fee-records')) body = { feeRecords: [] };
    else if (path.startsWith('/slots')) body = { dates: [], slots: [] };
    else if (path.startsWith('/exam-units')) body = { period: null, units: [] };
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

// Expo Router's `toHavePathname` matcher isn't picked up by @types/jest 30's typings, so wrap it once here.
const pathMatcher = () => expect(screen) as unknown as { toHavePathname(p: string): void; not: { toHavePathname(p: string): void } };

const mountApp = () => renderRouter('./src/app', { initialUrl: '/' });

describe('role-based routing (real src/app routes)', () => {
  it('shows the sign-in screen when signed out', async () => {
    fakeApi({});
    await mountApp();
    expect(await screen.findByTestId('login-submit')).toBeTruthy();
    await waitFor(() => pathMatcher().toHavePathname('/login'));
  });

  it('opens a restored student session on My Tickets', async () => {
    __fake.session = { access_token: 'jwt-student', user: { id: 'u1' } };
    fakeApi({ me: student });
    await mountApp();
    expect(await screen.findByText('My Tickets')).toBeTruthy();
    pathMatcher().toHavePathname('/tickets');
  });

  it('opens a restored staff session on the Ticket Queue', async () => {
    __fake.session = { access_token: 'jwt-staff', user: { id: 'u2' } };
    fakeApi({ me: staff });
    await mountApp();
    expect(await screen.findByText('Ticket Queue')).toBeTruthy();
    pathMatcher().toHavePathname('/queue');
  });

  it('sends a lecturer to the card scanner, never the finance staff screens', async () => {
    __fake.session = { access_token: 'jwt-lecturer', user: { id: 'u3' } };
    fakeApi({ me: lecturer });
    await mountApp();
    expect(await screen.findByText('Scan exam cards')).toBeTruthy();
    pathMatcher().toHavePathname('/scan');
    await act(async () => { router.navigate('/queue'); });
    await waitFor(() => pathMatcher().not.toHavePathname('/queue'));
    expect(screen.queryByText('Ticket Queue')).toBeNull();
  });

  it('keeps a student out of staff screens, even by navigating to them directly', async () => {
    __fake.session = { access_token: 'jwt-student', user: { id: 'u1' } };
    fakeApi({ me: student });
    await mountApp();
    await screen.findByText('My Tickets');
    await act(async () => router.push('/queue'));
    await waitFor(() => pathMatcher().not.toHavePathname('/queue'));
    expect(screen.queryByText('Ticket Queue')).toBeNull();
  });

  it('signs a staff member in through the form and lands on the queue', async () => {
    fakeApi({ me: staff });
    await mountApp();
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'staff@finesse.ac.ke');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'Finesse@2026');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Ticket Queue')).toBeTruthy();
    pathMatcher().toHavePathname('/queue');
  });

  it('shows a friendly message on a wrong password and stays on the sign-in screen', async () => {
    fakeApi({});
    await mountApp();
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'amina@students.finesse.ac.ke');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong-pass');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Incorrect email or password.')).toBeTruthy();
    pathMatcher().toHavePathname('/login');
  });

  it('validates the form before contacting Supabase', async () => {
    fakeApi({});
    await mountApp();
    await fireEvent.press(await screen.findByTestId('login-submit'));
    expect(await screen.findByText('Email is required')).toBeTruthy();
    expect(__fake.signIn).not.toHaveBeenCalled();
  });

  it('signs out a saved session that the API rejects (revoked or expired)', async () => {
    __fake.session = { access_token: 'jwt-stale', user: { id: 'u1' } };
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Session expired.' }) }) as Response) as unknown as typeof fetch;
    await mountApp();
    expect(await screen.findByTestId('login-submit')).toBeTruthy();
    expect(__fake.signOut).toHaveBeenCalled();
  });

  it('does NOT sign out when the backend is merely unreachable, so the session survives until it is back', async () => {
    __fake.session = { access_token: 'jwt-ok', user: { id: 'u1' } };
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await mountApp();
    expect(await screen.findByTestId('login-submit')).toBeTruthy();
    expect(__fake.signOut).not.toHaveBeenCalled();
    expect(__fake.session).not.toBeNull();
  });
});
