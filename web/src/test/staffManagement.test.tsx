import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/Guards';
import { Layout } from '@/components/Layout';
import { StaffManagementPage } from '@/features/staff/StaffManagementPage';

const mocks = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'staff' | 'student',
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

const staff = [
  { id: 'staff-1', name: 'Finance Officer', email: 'finance@example.test', role: 'staff' as const, is_active: true },
  { id: 'admin-1', name: 'Campus Admin', email: 'admin@example.test', role: 'admin' as const, is_active: false },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/staff/management']}>
        <Routes>
          <Route element={<RequireAuth roles={['admin']} />}>
            <Route element={<Layout />}>
              <Route path="/staff/management" element={<StaffManagementPage />} />
            </Route>
          </Route>
          <Route path="/staff/dashboard" element={<div>Staff home</div>} />
          <Route path="/tickets" element={<div>Student home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StaffManagementPage', () => {
  beforeEach(() => {
    mocks.role = 'admin';
    mocks.get.mockReset().mockResolvedValue({ staff });
    mocks.post.mockReset();
    mocks.patch.mockReset();
  });

  it('shows the management page and navigation entry to admins', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Staff management' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff management' })).toBeInTheDocument();
    expect(await screen.findByText('finance@example.test')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/admin/staff');
  });

  it.each([
    ['staff', 'Staff home'],
    ['student', 'Student home'],
  ] as const)('does not expose the page or navigation to %s accounts', async (role, home) => {
    mocks.role = role;
    renderPage();
    expect(await screen.findByText(home)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff management' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Staff management' })).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('creates an account and displays its temporary password with the first-login notice', async () => {
    mocks.post.mockResolvedValue({
      staff: { id: 'new-id', name: 'New Finance Officer', email: 'new@example.test', role: 'staff', is_active: true },
      temporaryPassword: 'one-time-password',
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('finance@example.test');
    await user.type(screen.getByLabelText('Name'), 'New Finance Officer');
    await user.type(screen.getByLabelText('Email'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('status')).toHaveTextContent('one-time-password');
    expect(screen.getByRole('status')).toHaveTextContent('must change it at first login');
    expect(mocks.post).toHaveBeenCalledWith('/admin/staff', {
      name: 'New Finance Officer',
      email: 'new@example.test',
      role: 'staff',
    });
  });

  it('changes roles and reactivates inactive accounts through the existing endpoint', async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('finance@example.test');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role for finance@example.test' }), 'admin');
    await user.click(screen.getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/admin/staff/staff-1', { role: 'admin' }));
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/admin/staff/admin-1', { isActive: true }));
  });

  it.each([
    ['last-admin', 'The last active admin cannot be demoted or deactivated.'],
    ['self-deactivation', 'You cannot deactivate your own account.'],
  ])('surfaces the %s error returned by the API', async (_case, message) => {
    mocks.get.mockResolvedValue({
      staff: [{ id: 'admin-id', name: 'Admin user', email: 'admin@example.test', role: 'admin', is_active: true }],
    });
    mocks.patch.mockRejectedValue(new Error(message));
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Admin user');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  });
});
