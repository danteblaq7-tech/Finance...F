import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsPage } from '@/features/exam/StaffExamPages';
import { ExamCardPage } from '@/features/exam/ExamCardPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.get, upload: mocks.upload },
}));

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

describe('ExamCardPage', () => {
  beforeEach(() => {
    mocks.upload.mockReset().mockResolvedValue({});
    mocks.get.mockReset().mockImplementation(async (path: string) => {
      if (path === '/exam-periods') {
        return { periods: [{
          id: 'period-1',
          title: 'Semester 1 Exams',
          academic_year: '2026/2027',
          semester: 'Semester 1',
          exam_start_date: day(20),
          exam_end_date: day(35),
          application_open: day(-5),
          application_close: day(10),
          min_payment_percent: 100,
          is_active: true,
        }] };
      }
      if (path === '/applications') return { applications: [] };
      if (path === '/fee-records/mine') {
        return { feeRecords: [{
          id: 'fee-1',
          academic_year: '2026/2027',
          semester: 'Semester 1',
          total_fee: 80000,
          amount_paid: 80000,
          balance: 0,
        }] };
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  it('offers fee statement upload when an official fee record is present', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ExamCardPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText('KSh 80,000')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Choose statement file' })).toBeInTheDocument();
  });

  it('uploads a selected statement during the open application window', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ExamCardPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Choose statement file' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(['statement'], 'fee-statement.pdf', { type: 'application/pdf' });
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith('/fee-statements?examPeriodId=period-1', file));
  });

  it('shows eligibility and parsed amounts to finance staff and admins', async () => {
    mocks.get.mockResolvedValue({
      applications: [
        {
          id: 'app-eligible', student_uid: 'student-1', student_id: 'EGM/027/24', student_name: 'Amina Hassan', email: 'amina@example.test',
          course: 'BSc EE', year_of_study: '2', exam_period_id: 'period-1', period_title: 'Semester 1 Exams',
          exam_start_date: day(20), exam_end_date: day(35), academic_year: '2026/2027', semester: 'Semester 1',
          status: 'pending', rejection_reason: null, amount_paid: 70000, total_fee: 100000, balance: 30000,
          manual_approval_note: null, card_issued_at: null, created_at: new Date().toISOString(), min_payment_percent: 70,
          decision_source: 'statement', status_note: 'Verification is pending.', statement_id: null, statement_outcome: 'cleared',
          verification_code: null, revoked_at: null, revoked_reason: null, manually_approved_by: null,
        },
        {
          id: 'app-not-eligible', student_uid: 'student-2', student_id: 'SCI/114/23', student_name: 'Brian Otieno', email: 'brian@example.test',
          course: 'BSc CS', year_of_study: '1', exam_period_id: 'period-1', period_title: 'Semester 1 Exams',
          exam_start_date: day(20), exam_end_date: day(35), academic_year: '2026/2027', semester: 'Semester 1',
          status: 'rejected', rejection_reason: 'Below the minimum.', amount_paid: 69000, total_fee: 100000, balance: 31000,
          manual_approval_note: null, card_issued_at: null, created_at: new Date().toISOString(), min_payment_percent: 70,
          decision_source: 'statement', status_note: null, statement_id: null, statement_outcome: 'not_cleared',
          verification_code: null, revoked_at: null, revoked_reason: null, manually_approved_by: null,
        },
      ],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ApplicationsPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('ELIGIBLE · AWAITING VERIFICATION')).toBeInTheDocument();
    expect(screen.getByText('NOT ELIGIBLE')).toBeInTheDocument();
    expect(screen.getByText(/Paid KSh 70,000 of KSh 100,000 · balance KSh 30,000/)).toBeInTheDocument();
  });
});
