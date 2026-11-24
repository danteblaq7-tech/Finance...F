import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTicketPage } from '@/features/tickets/TicketPages';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }));

describe('NewTicketPage appointments', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockImplementation((path: string) => {
      if (path.startsWith('/slots/dates')) {
        return Promise.resolve({ dates: [{ date: '2099-06-15', free: 1, total: 1 }] });
      }
      return Promise.resolve({ slots: [
        { id: 'slot-1', slot_date: '2099-06-15', start_time: '2099-06-15 10:00:00', end_time: '2099-06-15 10:30:00', is_booked: false },
      ] });
    });
    mocks.post.mockReset().mockResolvedValue({
      ticket: {
        id: 'ticket-1',
        student_id: 'student-1',
        student_name: 'Example Student',
        issue_type: 'fee_dispute',
        description: 'Please help with my fee statement.',
        priority: 'medium',
        status: 'in_review',
        appointment_slot: '2099-06-15 10:00:00',
        appointment_slot_id: 'slot-1',
        created_at: '2099-06-01T10:00:00.000Z',
        updated_at: '2099-06-01T10:00:00.000Z',
        assigned_staff_id: null,
      },
    });
  });

  it('submits the selected staff-generated appointment with the new ticket', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tickets/new']}>
          <Routes>
            <Route path="/tickets/new" element={<NewTicketPage />} />
            <Route path="/tickets/:id" element={<div>Ticket created</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.selectOptions(await screen.findByLabelText('Issue type'), 'fee_dispute');
    await user.type(screen.getByLabelText('Description'), 'Please help with my fee statement.');
    await user.click(await screen.findByRole('button', { name: /10:00 am/i }));
    await user.click(screen.getByRole('button', { name: 'Submit ticket' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/tickets', {
      issueType: 'fee_dispute',
      priority: 'medium',
      description: 'Please help with my fee statement.',
      slotId: 'slot-1',
    }));
    expect(await screen.findByText('Ticket created')).toBeInTheDocument();
  });
});
