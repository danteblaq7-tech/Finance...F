import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/Guards';
import { Layout } from '@/components/Layout';
import { StudentAccountsPage } from '@/features/students/StudentAccountsPage';

const mocks = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'staff' | 'student' | 'lecturer',
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: `${mocks.role}-id`,
      name: `${mocks.role} user`,
      email: `${mocks.role}@example.test`,
      role: mocks.role,
      must_change_password: false,
    },
    logout: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
  },
}));

const student = {
  id: 'student-1',
  name: 'Example Student',
  email: 'student@example.test',
  student_id: 'COM/072/23',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  last_sign_in_at: '2026-02-01T12:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/staff/students']}>
        <Routes>
          <Route element={<RequireAuth roles={['staff', 'admin']} />}>
            <Route element={<Layout />}>
              <Route path="/staff/students" element={<StudentAccountsPage />} />
            </Route>
          </Route>
          <Route path="/staff/dashboard" element={<div>Staff home</div>} />
          <Route path="/tickets" element={<div>Student home</div>} />
          <Route path="/scan" element={<div>Lecturer home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StudentAccountsPage', () => {
  beforeEach(() => {
    mocks.role = 'admin';
    mocks.get.mockReset().mockResolvedValue({ students: [student], page: 1, pageSize: 25, total: 1, totalPages: 1 });
    mocks.post.mockReset().mockResolvedValue({ ok: true });
    mocks.patch.mockReset().mockResolvedValue({ student: { ...student, is_active: false } });
  });

  it('lets admins search, review account metadata, deactivate with a reason, reactivate and request a reset', async () => {
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Student accounts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student accounts' })).toBeInTheDocument();
    expect(await screen.findByText('COM/072/23')).toBeInTheDocument();
    expect(screen.getByText('student@example.test')).toBeInTheDocument();
    expect(screen.getByText('Feb 1, 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await user.type(screen.getByLabelText('Reason (required)'), 'Student requested closure');
    mocks.get.mockResolvedValue({
      students: [{ ...student, is_active: false }],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    await user.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/admin/students/student-1', {
      isActive: false,
      reason: 'Student requested closure',
    }));

    await user.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/admin/students/student-1', { isActive: true }));
    await user.click(screen.getByRole('button', { name: 'Send password reset' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/admin/students/student-1/password-reset', {}));
    expect(await screen.findByRole('status')).toHaveTextContent('Password-reset email sent to student@example.test.');
  });

  it('allows finance staff to list and search but hides all account actions', async () => {
    mocks.role = 'staff';
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Student accounts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Student accounts' })).toBeInTheDocument();
    expect(await screen.findByText('Example Student')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send password reset' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'COM/072/23');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining('q=COM%2F072%2F23')));
  });

  it.each(['admin', 'staff'] as const)('shows registered students without accounts to %s as a read-only paginated list', async (role) => {
    mocks.role = role;
    mocks.get.mockImplementation(async (path: string) => {
      if (path.includes('/registered-not-signed-up')) {
        const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
        return {
          students: [{ student_number: page === 1 ? 'COM/080/23' : 'COM/081/23', units: ['CSC101 · Introduction'] }],
          page,
          pageSize: 25,
          total: 26,
          totalPages: 2,
        };
      }
      return { students: [student], page: 1, pageSize: 25, total: 1, totalPages: 1 };
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Registered, not signed up' }));
    expect(await screen.findByText('COM/080/23')).toBeInTheDocument();
    expect(screen.getByText('CSC101 · Introduction')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/admin/students/registered-not-signed-up?page=1&pageSize=25');
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send password reset' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('COM/081/23')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/admin/students/registered-not-signed-up?page=2&pageSize=25');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it.each([
    ['student', 'Student home'],
    ['lecturer', 'Lecturer home'],
  ] as const)('does not expose the page or navigation to %s accounts', async (role, home) => {
    mocks.role = role;
    renderPage();
    expect(await screen.findByText(home)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Student accounts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Student accounts' })).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('shows backend rejection messages to admins', async () => {
    mocks.patch.mockRejectedValue(new Error('The last active admin cannot be deactivated.'));
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Example Student');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await user.type(screen.getByLabelText('Reason (required)'), 'Student requested closure');
    await user.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The last active admin cannot be deactivated.');
  });
});