import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanPage } from '@/features/invigilation/ScanPage';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
vi.mock('@/features/invigilation/QrScanner', () => ({ QrScanner: () => <div data-testid="camera" /> }));

const unit = { id: 'u1', exam_period_id: 'p1', unit_code: 'CSC101', unit_name: 'Intro to Programming', exam_date: null, start_time: null, end_time: null, venue: 'Main Hall', registered: 40, signed: 12, lecturers: [] };
const student = { name: 'Amina Hassan', student_id: 'COM/072/23', course: 'Computer Science', year_of_study: '3' };
const chip = { id: 'u1', unit_code: 'CSC101', unit_name: 'Intro to Programming', exam_date: null, start_time: null, venue: null, allowed: true, block_reason: null, signed_at: null, signed_by_name: null, can_sign: true };

function renderPage(units = [unit], path = '/scan') {
  get.mockImplementation(async (p: string) => {
    if (p === '/exam-units') return { period: { id: 'p1', title: 'Semester 1 Exams', academic_year: '2026/2027', semester: 'Semester 1', exam_start_date: '2026-11-23', exam_end_date: '2026-12-11' }, units };
    throw new Error(`unexpected GET ${p}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><ScanPage /></MemoryRouter></QueryClientProvider>);
}
const result = async () => within(await screen.findByRole('status')); // the big result panel (not the session history)
const scan = async (text: string) => {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText('Card code'), text);
  await u.click(screen.getByRole('button', { name: 'Check' }));
};

beforeEach(() => { get.mockReset(); post.mockReset(); sessionStorage.clear(); });

describe('ScanPage', () => {
  it('auto-selects a lecturer\'s only unit and signs it when a card is scanned', async () => {
    post.mockResolvedValue({ ok: true, result: 'signed', message: 'Amina Hassan signed in for CSC101.', student, unit: { id: 'u1', unit_code: 'CSC101', unit_name: 'Intro' }, units: [{ ...chip, signed_at: '2026-11-23T09:05:00' }], signed_at: '2026-11-23T09:05:00', signed_by_name: 'Dr Otieno' });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Unit you are invigilating')).toHaveValue('u1'));
    await scan('https://finesse.ac.ke/verify/ab12cd34ef56');
    expect((await result()).getByText('SIGNED IN')).toBeInTheDocument();
    expect((await result()).getByText('Amina Hassan')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/invigilation/sign', { code: 'https://finesse.ac.ke/verify/ab12cd34ef56', unitId: 'u1' });
  });

  it('shows who already signed when the same card is scanned again', async () => {
    post.mockResolvedValue({ ok: false, result: 'already_signed', message: 'CSC101 was already signed for Amina Hassan.', student, units: [{ ...chip, signed_at: '2026-11-23T09:05:00' }], signed_at: '2026-11-23T09:05:00', signed_by_name: 'Dr Otieno' });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Unit you are invigilating')).toHaveValue('u1'));
    await scan('AB12CD34EF56');
    expect((await result()).getByText('ALREADY SIGNED')).toBeInTheDocument();
    expect((await result()).getByText('Dr Otieno')).toBeInTheDocument();
  });

  it('refuses things that are not exam-card codes without calling the server', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Unit you are invigilating')).toHaveValue('u1'));
    await scan('hello world');
    expect(await screen.findByText(/not a Finesse exam-card code/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('with several units, asks which one before signing', async () => {
    renderPage([unit, { ...unit, id: 'u2', unit_code: 'CSC102' }]);
    await screen.findByText(/CSC102/);
    await scan('AB12CD34EF56');
    expect(await screen.findByText('Choose the unit you are invigilating first.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('"look first" mode lists the student\'s units and signs the one you tap', async () => {
    get.mockReset();
    renderPage();
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText('Unit you are invigilating')).toHaveValue('u1'));
    get.mockImplementation(async (p: string) => {
      if (p.startsWith('/invigilation/card/')) return { state: 'valid', valid: true, student, units: [chip, { ...chip, id: 'u9', unit_code: 'CSC999', unit_name: 'Not mine', can_sign: false }] };
      return { period: null, units: [unit] };
    });
    post.mockResolvedValue({ ok: true, result: 'signed', message: 'ok', student, unit: { id: 'u1', unit_code: 'CSC101', unit_name: 'Intro' }, units: [{ ...chip, signed_at: '2026-11-23T09:05:00' }] });
    await u.click(screen.getByLabelText(/Sign automatically/));
    await scan('AB12CD34EF56');
    expect(await screen.findByText('GENUINE CARD')).toBeInTheDocument();
    expect(screen.getByText('NOT YOURS')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Sign' }));
    expect((await result()).getByText('SIGNED IN')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/invigilation/sign', { code: 'AB12CD34EF56', unitId: 'u1' });
  });

  it('opened from a verify-page link (?code=), it signs straight away', async () => {
    post.mockResolvedValue({ ok: true, result: 'signed', message: 'ok', student, unit: { id: 'u1', unit_code: 'CSC101', unit_name: 'Intro' }, units: [] });
    renderPage([unit], '/scan?code=AB12CD34EF56');
    expect((await screen.findAllByText('SIGNED IN')).length).toBeGreaterThan(0);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
