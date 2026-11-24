import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTicketPage, TicketDetailPage } from '@/features/tickets/TicketPages';

const get = vi.fn();
const post = vi.fn();
const upload = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args), upload: (...args: unknown[]) => upload(...args) } }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'student-1', role: 'student' } }) }));

function renderPage(initialEntry: string, page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/tickets/new" element={page} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  upload.mockReset();
});

describe('ticket evidence', () => {
  it('uploads a selected PDF/image after creating a ticket', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/slots/dates?days=60') return { dates: [] };
      if (path.endsWith('/attachments')) return { attachments: [] };
      return { ticket: {
        id: 'ticket-new', student_id: 'student-1', student_name: 'Amina Hassan', student_number: 'STU/1',
        issue_type: 'fee_dispute', description: 'Please help with the duplicate payment.', priority: 'medium', status: 'pending',
        appointment_slot: null, appointment_slot_id: null, assigned_staff_id: null,
        created_at: '2026-11-24 08:00:00', updated_at: '2026-11-24 08:00:00', responses: [],
      } };
    });
    post.mockResolvedValue({ ticket: { id: 'ticket-new' } });
    upload.mockResolvedValue({});
    renderPage('/tickets/new', <NewTicketPage />);

    fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: 'fee_dispute' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Please help with the duplicate payment.' } });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'proof.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/Evidence files/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit ticket' }));

    await waitFor(() => expect(upload).toHaveBeenCalledWith('/tickets/ticket-new/attachments', file));
  });

  it('shows ticket attachments as signed links in the detail view', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/tickets/ticket-1') return { ticket: {
        id: 'ticket-1', student_id: 'student-1', student_name: 'Amina Hassan', student_number: 'STU/1',
        issue_type: 'fee_dispute', description: 'Please review this payment.', priority: 'medium', status: 'pending',
        appointment_slot: null, appointment_slot_id: null, assigned_staff_id: null,
        created_at: '2026-11-24 08:00:00', updated_at: '2026-11-24 08:00:00', responses: [],
      } };
      if (path === '/tickets/ticket-1/attachments') return { attachments: [{
        id: 'attachment-1', fileName: 'proof.pdf', mimeType: 'application/pdf', sizeBytes: 1200,
        createdAt: '2026-11-24T08:00:00Z', url: 'https://storage.example/signed', expiresInSeconds: 300,
      }] };
      return { dates: [] };
    });
    renderPage('/tickets/ticket-1', <TicketDetailPage />);

    const link = await screen.findByRole('link', { name: 'Open proof.pdf' });
    expect(link).toHaveAttribute('href', 'https://storage.example/signed');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
