import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/Guards';
import { LoginPage } from '@/features/auth/AuthPages';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';

// A fake Supabase client: tests control the session and can see which auth calls were made.
const sb = vi.hoisted(() => {
  const state = {
    session: null as null | { access_token: string; user: { id: string } },
    listeners: new Set<(event: string, session: unknown) => void>(),
    emit(event: string) { state.listeners.forEach((l) => l(event, state.session)); },
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
  return state;
});

vi.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: sb.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        sb.listeners.add(cb);
        queueMicrotask(() => cb('INITIAL_SESSION', sb.session)); // Supabase reports any saved session on subscribe
        return { data: { subscription: { unsubscribe: () => sb.listeners.delete(cb) } } };
      },
      signInWithPassword: sb.signIn,
      signOut: sb.signOut,
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: vi.fn(),
  },
}));

const student = { id: 'u1', name: 'Amina Hassan', email: 'amina@students.finesse.ac.ke', student_id: 'EGM/1', university: null, course: null, year_of_study: null, role: 'student' };
const goodSession = () => ({ access_token: 'tok-123', user: { id: 'u1' } });

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return { ok: status < 400, status, json: async () => body } as Response;
  }));
}

function renderApp(initial: string, extra?: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<><LoginPage />{extra}</>} />
            <Route element={<RequireAuth />}><Route path="/tickets" element={<div>MY TICKETS PAGE</div>} /></Route>
            <Route element={<RequireAuth roles={['staff']} />}><Route path="/staff/queue" element={<div>STAFF QUEUE</div>} /></Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sb.session = null;
  sb.listeners.clear();
  sb.signIn.mockReset();
  sb.signOut.mockReset();
  sb.signOut.mockImplementation(async () => { sb.session = null; sb.emit('SIGNED_OUT'); return { error: null }; });
  // Default: the password "Finesse@2026" works; anything else is refused the way Supabase refuses it.
  sb.signIn.mockImplementation(async ({ password }: { password: string }) => {
    if (password !== 'Finesse@2026') return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } };
    sb.session = goodSession();
    sb.emit('SIGNED_IN');
    return { data: { user: { id: 'u1' }, session: sb.session }, error: null };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('validates before contacting Supabase', async () => {
    mockFetch(() => ({ body: {} }));
    renderApp('/login');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(sb.signIn).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a friendly error on a wrong password and ends up signed out', async () => {
    mockFetch(() => ({ body: {} }));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'amina@students.finesse.ac.ke');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(sb.session).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); // never asked the API for a profile
  });

  it('signs a student in with Supabase, loads their profile with the Supabase token, and lands on their tickets', async () => {
    mockFetch(() => ({ body: { user: student } }));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'Amina@Students.Finesse.ac.ke');
    await userEvent.type(screen.getByLabelText('Password'), 'Finesse@2026');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('MY TICKETS PAGE')).toBeInTheDocument();
    expect(sb.signIn).toHaveBeenCalledWith({ email: 'amina@students.finesse.ac.ke', password: 'Finesse@2026' });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('signs back out of Supabase if the API cannot give the profile, so no half-session is left behind', async () => {
    mockFetch(() => ({ status: 500, body: { error: 'Internal server error' } }));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'amina@students.finesse.ac.ke');
    await userEvent.type(screen.getByLabelText('Password'), 'Finesse@2026');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    await waitFor(() => expect(sb.signOut).toHaveBeenCalled());
  });
});

describe('register', () => {
  function Registrar() {
    const { register } = useAuth();
    return <button onClick={() => void register({ name: 'New Student', email: 'new@students.finesse.ac.ke', password: 'Finesse@2026', studentId: 'NEW/1' })}>do-register</button>;
  }

  it('creates the account through the API, then signs in with Supabase using the same password', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method} ${url}`);
      return url.endsWith('/auth/register') ? { status: 201, body: { user: student } } : { body: { user: student } };
    });
    renderApp('/login', <Registrar />);
    await userEvent.click(screen.getByText('do-register'));
    await waitFor(() => expect(sb.signIn).toHaveBeenCalledWith({ email: 'new@students.finesse.ac.ke', password: 'Finesse@2026' }));
    await waitFor(() => expect(calls).toContain('GET /api/auth/me'));
    expect(calls[0]).toBe('POST /api/auth/register'); // account first, sign-in second
  });
});

describe('route guards', () => {
  it('redirects signed-out visitors to the login page', async () => {
    mockFetch(() => ({ body: {} }));
    renderApp('/tickets');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('restores a saved Supabase session and sends a student away from staff-only pages', async () => {
    sb.session = goodSession();
    mockFetch(() => ({ body: { user: student } }));
    renderApp('/staff/queue');
    await waitFor(() => expect(screen.getByText('MY TICKETS PAGE')).toBeInTheDocument());
    expect(screen.queryByText('STAFF QUEUE')).not.toBeInTheDocument();
  });

  it('signs out a saved session that the API rejects (revoked / expired) and shows login', async () => {
    sb.session = goodSession();
    mockFetch(() => ({ status: 401, body: { error: 'Session expired.' } }));
    renderApp('/tickets');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(sb.signOut).toHaveBeenCalled();
  });

  it('does NOT sign the user out when the API is just unreachable', async () => {
    sb.session = goodSession();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    renderApp('/tickets');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(sb.session).not.toBeNull(); // still holds the session: a reload once the API is back restores it
  });
});
