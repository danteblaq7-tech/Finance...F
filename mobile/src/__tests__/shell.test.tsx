import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import { fake as __fake } from '@/test-utils/fakeSupabase';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

const user = (role: string, name = 'Test User') => ({ id: `id-${role}`, name, email: `${role}@finesse.ac.ke`, student_id: role === 'student' ? 'EGM/1' : null, university: null, course: null, year_of_study: null, role });

function fakeApi(me: unknown) {
  globalThis.fetch = jest.fn(async (url: string) => {
    const path = url.replace(/^.*\/api/, '');
    let body: unknown = {};
    if (path === '/auth/me') body = { user: me };
    else if (path.startsWith('/tickets')) body = { tickets: [] };
    else if (path.startsWith('/applications')) body = { applications: [] };
    else if (path.startsWith('/exam-periods')) body = { periods: [] };
    else if (path.startsWith('/fee-records')) body = { feeRecords: [] };
    else if (path.startsWith('/exam-units')) body = { period: null, units: [] };
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}
const pathMatcher = () => expect(screen) as unknown as { toHavePathname(p: string): void };
const signIn = async (role: string) => {
  __fake.session = { access_token: `jwt-${role}`, user: { id: `id-${role}` } };
  fakeApi(user(role));
  await renderRouter('./src/app', { initialUrl: '/' });
};
const openMenu = async () => fireEvent.press(await screen.findByLabelText('Open menu'));

describe('app shell: top bar and menu (the web sidebar, on a phone)', () => {
  it('a student gets the student menu, in the web order, plus Account', async () => {
    await signIn('student');
    await screen.findByText('My Tickets');
    await openMenu();
    for (const label of ['My Tickets', 'Raise Ticket', 'Exam Card', 'Account']) expect(await screen.findByRole('button', { name: label })).toBeTruthy();
    for (const hidden of ['Dashboard', 'Ticket Queue', 'Scan Cards']) expect(screen.queryByRole('button', { name: hidden })).toBeNull();
  });

  it('staff get the full staff menu (no e-mail template editor), with the current page marked', async () => {
    await signIn('staff');
    await screen.findByText('Ticket Queue');
    await openMenu();
    for (const label of ['Dashboard', 'Ticket Queue', 'Exam Applications', 'Fee Records', 'Exam Periods', 'Appointment Slots', 'Scan Cards', 'Exam Units', 'Account']) {
      expect(await screen.findByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Email Templates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ticket Queue' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Dashboard' }).props.accessibilityState.selected).toBe(false);
  });

  it('a lecturer gets only the scanner and their units', async () => {
    await signIn('lecturer');
    await screen.findByText('Scan exam cards');
    await openMenu();
    expect(await screen.findByRole('button', { name: 'My Units' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ticket Queue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fee Records' })).toBeNull();
  });

  it('choosing a menu item goes there and closes the menu', async () => {
    await signIn('staff');
    await screen.findByText('Ticket Queue');
    await openMenu();
    await fireEvent.press(await screen.findByRole('button', { name: 'Exam Periods' }));
    expect(await screen.findByText('Windows in which students can apply for an exam card.')).toBeTruthy();
    pathMatcher().toHavePathname('/periods');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull());
  });

  it('shows a back arrow, not the menu button, on a detail page', async () => {
    await signIn('student');
    await screen.findByText('My Tickets');
    await act(async () => router.push('/tickets/abc'));
    expect(await screen.findByLabelText('Go back')).toBeTruthy();
    expect(screen.queryByLabelText('Open menu')).toBeNull();
  });

  it('asks before signing out', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await signIn('student');
    await screen.findByText('My Tickets');
    await openMenu();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(alert).toHaveBeenCalledWith('Sign out?', undefined, expect.any(Array));
    alert.mockRestore();
  });

  it('keeps a lecturer out of staff screens even by navigating there', async () => {
    await signIn('lecturer');
    await screen.findByText('Scan exam cards');
    await act(async () => router.push('/queue'));
    await waitFor(() => expect(screen.queryByText('Ticket Queue')).toBeNull());
  });
});
