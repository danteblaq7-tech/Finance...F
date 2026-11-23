import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketDetailPage } from '@/features/tickets/TicketPages';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'student-1', role: 'student' } }) }));

beforeEach(() => get.mockReset());

describe('ticket response history', () => {
  it('shows all Finance Office responses oldest first with timestamps and no student reply control', async () => {
    get.mockResolvedValue({
      ticket: {
        id: 'ticket-1',
        student_id: 'student-1',
        student_number: 'STU/1',
        student_name: 'Amina Hassan',
        issue_type: 'fee_dispute',
        description: 'A fee statement has a duplicate charge.',
        priority: 'medium',
        status: 'in_review',
        appointment_slot: null,
        appointment_slot_id: null,
        assigned_staff_id: null,
        created_at: '2026-10-14 08:40:00',
        updated_at: '2026-10-14 08:40:00',
        responses: [
          { id: 'response-1', ticket_id: 'ticket-1', author_id: null, body: 'We are checking the charge.', created_at: '2026-10-15T09:00:00.000Z' },
          { id: 'response-2', ticket_id: 'ticket-1', author_id: 'staff-1', body: 'The duplicate charge was reversed.', created_at: '2026-10-16T10:30:00.000Z' },
        ],
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tickets/ticket-1']}>
          <Routes><Route path="/tickets/:id" element={<TicketDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const history = await screen.findByRole('region', { name: 'Finance Office response history' });
    const first = within(history).getByText('We are checking the charge.');
    const second = within(history).getByText('The duplicate charge was reversed.');
    expect(history.textContent!.indexOf(first.textContent!)).toBeLessThan(history.textContent!.indexOf(second.textContent!));
    expect(within(history).getAllByText('Finance Office')).toHaveLength(2);
    expect(within(history).getAllByRole('time')).toHaveLength(2);
    expect(screen.queryByLabelText('New Finance Office response')).not.toBeInTheDocument();
  });
});
