import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnitChecklist } from '@/features/exam/UnitChecklist';
import { UnitsPage } from '@/features/invigilation/UnitsPage';
import type { MyUnit } from '@/lib/types';

const unit = (over: Partial<MyUnit>): MyUnit => ({ id: 'x', unit_code: 'CSC101', unit_name: 'Intro', exam_date: null, start_time: null, venue: null, allowed: true, block_reason: null, signed_at: null, ...over });

describe('UnitChecklist (student)', () => {
  it('ticks signed units, leaves the rest open, and explains a bar', () => {
    render(<UnitChecklist units={[
      unit({ id: 'a', unit_code: 'CSC101', signed_at: '2026-11-23T09:05:00', venue: 'Main Hall' }),
      unit({ id: 'b', unit_code: 'CSC102' }),
      unit({ id: 'c', unit_code: 'CSC103', allowed: false, block_reason: 'Missing CAT marks' }),
    ]} />);
    expect(screen.getByText('1 of 2 sat')).toBeInTheDocument(); // the barred unit is not counted against them
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['sat', 'todo', 'barred']);
    expect(within(rows[0]!).getByText('Sat')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Main Hall/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Not yet')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Missing CAT marks')).toBeInTheDocument();
  });
  it('updates when a lecturer signs a unit (new data in, tick appears)', () => {
    const { rerender } = render(<UnitChecklist units={[unit({ id: 'a' }), unit({ id: 'b', unit_code: 'CSC102' })]} />);
    expect(screen.getByText('0 of 2 sat')).toBeInTheDocument();
    rerender(<UnitChecklist units={[unit({ id: 'a', signed_at: '2026-11-23T09:05:00' }), unit({ id: 'b', unit_code: 'CSC102' })]} />);
    expect(screen.getByText('1 of 2 sat')).toBeInTheDocument();
  });
  it('explains an empty list instead of hiding it', () => {
    render(<UnitChecklist units={[]} />);
    expect(screen.getByText(/No units are registered for you/)).toBeInTheDocument();
  });
});

const get = vi.fn(); const post = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'staff', name: 'Susan' } }) }));

describe('UnitsPage: add one student to a unit', () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });
  const period = { id: 'p1', title: 'Sem 1', academic_year: '2026/2027', semester: 'Semester 1', exam_start_date: '2026-11-23', exam_end_date: '2026-12-11' };
  const u = { id: 'u1', exam_period_id: 'p1', unit_code: 'CSC101', unit_name: 'Intro', exam_date: null, start_time: null, end_time: null, venue: null, registered: 1, signed: 0, lecturers: [] };
  it('posts a one-row registration for that unit and says what happened', async () => {
    get.mockImplementation(async (p: string) => {
      if (p.startsWith('/exam-periods')) return { periods: [period] };
      if (p === '/exam-units') return { period, units: [u] };
      if (p.endsWith('/register')) return { unit: u, rows: [] };
      if (p === '/lecturers') return { lecturers: [] };
      throw new Error(p);
    });
    post.mockResolvedValueOnce({ rows: 1, added: 1, unitsCreated: 0 }).mockResolvedValueOnce({ rows: 1, added: 0, unitsCreated: 0 });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><UnitsPage /></MemoryRouter></QueryClientProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Show register' }));
    const box = await screen.findByLabelText('Add a student to CSC101');
    await user.type(box, 'com/072/23');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/exam-units/registrations/import', { periodId: 'p1', rows: [{ student_id: 'com/072/23', unit_code: 'CSC101' }] }));
    expect(await screen.findByText('COM/072/23 added to CSC101.')).toBeInTheDocument();
    await user.type(box, 'com/072/23');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(await screen.findByText('COM/072/23 is already on this register.')).toBeInTheDocument();
  });
});
