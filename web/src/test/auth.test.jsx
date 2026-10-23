import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/Guards';
import { LoginPage } from '@/features/auth/AuthPages';
import { AuthProvider } from '@/features/auth/AuthProvider';

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

function mockFetch(handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const { status = 200, body } = handler(url, init);
      return { ok: status < 400, status, json: async () => body };
    }),
  );
}

function renderApp(initial) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/tickets" element={<div>MY TICKETS PAGE</div>} />
            </Route>
            <Route element={<RequireAuth roles={['staff']} />}>
              <Route path="/staff/queue" element={<div>STAFF QUEUE</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('validates before calling the API', async () => {
    mockFetch(() => ({ body: {} }));
    renderApp('/login');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the server error on a wrong password and stores no token', async () => {
    mockFetch(() => ({ status: 401, body: { error: 'Incorrect email or password.' } }));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'amina@students.finesse.ac.ke');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(localStorage.getItem('finesse_token')).toBeNull();
  });

  it('signs a student in, stores the token and lands on their tickets', async () => {
    mockFetch(() => ({ body: { token: 'jwt-123', user: student } }));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'amina@students.finesse.ac.ke');
    await userEvent.type(screen.getByLabelText('Password'), 'Finesse@2026');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('MY TICKETS PAGE')).toBeInTheDocument();
    expect(localStorage.getItem('finesse_token')).toBe('jwt-123');
  });
});

describe('route guards', () => {
  it('redirects signed-out visitors to the login page', async () => {
    mockFetch(() => ({ body: {} }));
    renderApp('/tickets');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('restores a saved session and sends a student away from staff-only pages', async () => {
    localStorage.setItem('finesse_token', 'jwt-123');
    mockFetch(() => ({ body: { user: student } }));
    renderApp('/staff/queue');
    await waitFor(() => expect(screen.getByText('MY TICKETS PAGE')).toBeInTheDocument());
    expect(screen.queryByText('STAFF QUEUE')).not.toBeInTheDocument();
  });

  it('drops an invalid saved token and shows login', async () => {
    localStorage.setItem('finesse_token', 'stale');
    mockFetch(() => ({ status: 401, body: { error: 'Session expired.' } }));
    renderApp('/tickets');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(localStorage.getItem('finesse_token')).toBeNull();
  });
});
