import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '@/features/tickets/TicketPages';

const mocks = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'staff', get: vi.fn(), patch: vi.fn() }));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: `${mocks.role}-id`, role: mocks.role } }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.get, patch: mocks.patch },
}));

const ticket = {
  id: 'ticket-1',
  student_id: 'student-1',
  student_number: 'EGM/027/24',
  student_name: 'Amina Hassan',
  issue_type: 'fee_dispute',
  description: 'Please review this fee statement balance.',
  priority: 'medium' as const,
  status: 'pending' as const,
  appointment_slot: null,
  appointment_slot_id: null,
  responses: [],
  assigned_staff_id: null,
  assigned_staff_name: null,
  attended_by_name: null,
  created_at: '2026-10-14T08:40:00.000Z',
  updated_at: '2026-10-14T08:40:00.000Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tickets/ticket-1']}>
        <Routes><Route path="/tickets/:id" element={<TicketDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ticket assignment', () => {
  beforeEach(() => {
    mocks.role = 'admin';
    mocks.get.mockReset().mockImplementation(async (path: string) => {
      if (path === '/tickets/ticket-1') return { ticket };
      if (path === '/admin/staff') return { staff: [{ id: 'staff-1', name: 'Susan Otieno', role: 'staff', is_active: true }] };
      throw new Error(`Unexpected API request: ${path}`);
    });
    mocks.patch.mockReset().mockResolvedValue({ ticket: { ...ticket, assigned_staff_id: 'staff-1' } });
  });

  it('lets admins assign tickets to an active staff account', async () => {
    renderPage();
    const user = userEvent.setup();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/admin/staff'));
    await screen.findByRole('option', { name: 'Susan Otieno' });
    await user.selectOptions(await screen.findByLabelText('Assigned finance staff'), 'staff-1');
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/tickets/ticket-1', { assignedStaffId: 'staff-1' }));
  });

  it('does not show assignment controls to regular staff', async () => {
    mocks.role = 'staff';
    renderPage();
    await screen.findByText('Staff controls');
    expect(screen.queryByLabelText('Assigned finance staff')).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalledWith('/admin/staff');
  });
});
