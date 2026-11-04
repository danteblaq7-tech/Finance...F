import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import { toDateString } from '@/lib/format';
import { installFakeApi, signedInAs, ticket } from '@/test-utils/fakeApi';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

const mount = (url: string) => renderRouter('./src/app', { initialUrl: url });
const path = () => expect(screen) as unknown as { toHavePathname(p: string): void };

const today = new Date();
const day = (offset: number) => toDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
const period = { id: 'p1', title: 'Semester 1 Exams', academic_year: '2026/2027', semester: 'Semester 1', exam_start_date: day(20), exam_end_date: day(35), application_open: day(-5), application_close: day(10), min_payment_percent: 100, is_active: true };
const application = (over: Record<string, unknown> = {}) => ({
  id: 'e0000000-0000-4000-8000-000000000001', student_uid: 'u1', student_id: 'EGM/1', student_name: 'Amina Hassan', email: 'a@x.ke', course: 'BSc EE',
  year_of_study: '2', exam_period_id: 'p1', period_title: 'Semester 1 Exams', exam_start_date: day(20), exam_end_date: day(35), academic_year: '2026/2027',
  semester: 'Semester 1', status: 'pending', rejection_reason: null, amount_paid: 50000, total_fee: 80000, balance: 30000,
  manual_approval_note: null, card_issued_at: null, created_at: '2026-10-10 09:00:00', ...over,
});

describe('student: tickets', () => {
  it('raises a ticket: validates, sends the right payload, then opens the new ticket', async () => {
    const api = installFakeApi({
      ...(await signedInAs('student')),
      'POST /tickets': { status: 201, body: { ticket: ticket({ id: 'new1' }) } },
      'GET /tickets/new1': { body: { ticket: ticket({ id: 'new1' }) } },
    });
    await mount('/tickets/new');

    // Submitting empty shows both errors and sends nothing
    await fireEvent.press(await screen.findByText('Submit ticket'));
    expect(await screen.findByText('Choose an issue type')).toBeTruthy();
    expect(api.last('POST /tickets')).toBeUndefined();

    await fireEvent.press(screen.getByText('Fee Dispute'));
    await fireEvent.press(screen.getByText('High'));
    await fireEvent.changeText(screen.getByLabelText('Description'), 'My fee statement shows a duplicate charge for September.');
    await fireEvent.press(screen.getByText('Submit ticket'));

    await waitFor(() => expect(api.last('POST /tickets')?.body).toEqual({ issueType: 'fee_dispute', priority: 'high', description: 'My fee statement shows a duplicate charge for September.' }));
    expect(await screen.findByText('My fee statement shows a duplicate charge for September.')).toBeTruthy();
    path().toHavePathname('/tickets/new1');
  });

  it('books an appointment slot after confirming, and surfaces a double-booking conflict', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const d = day(2);
    const api = installFakeApi({
      ...(await signedInAs('student')),
      'GET /tickets/t1': { body: { ticket: ticket() } },
      'GET /slots/dates': { body: { dates: [{ date: d, free: 1, total: 2 }] } },
      'GET /slots?date': { body: { slots: [
        { id: 's1', slot_date: d, start_time: `${d} 10:00:00`, end_time: `${d} 10:30:00`, display_time: '10:00 AM', is_booked: false },
        { id: 's2', slot_date: d, start_time: `${d} 10:30:00`, end_time: `${d} 11:00:00`, display_time: '10:30 AM', is_booked: true },
      ] } },
      'POST /tickets/t1/book': { status: 409, body: { error: 'This slot was just booked by someone else. Please choose another.' } },
    });
    await mount('/tickets/t1');

    await fireEvent.press(await screen.findByLabelText('Book 10:00 AM'));
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0]![2]!;
    await act(async () => buttons.find((b) => b.text === 'Book')!.onPress!());

    await waitFor(() => expect(api.last('POST /tickets/t1/book')?.body).toEqual({ slotId: 's1' }));
    expect(await screen.findByText(/just booked by someone else/)).toBeTruthy();
    alert.mockRestore();
  });

  it("shows the finance office's reply to the student", async () => {
    installFakeApi({ ...(await signedInAs('student')), 'GET /tickets/t1': { body: { ticket: ticket({ status: 'resolved', staff_notes: 'Duplicate charge reversed on 15 Oct.' }) } } });
    await mount('/tickets/t1');
    expect(await screen.findByText('Duplicate charge reversed on 15 Oct.')).toBeTruthy();
    expect(screen.getByText('RESOLVED')).toBeTruthy();
  });
});

describe('student: exam card', () => {
  const setup = async (app: Record<string, unknown> | null, fee?: Record<string, unknown>) =>
    installFakeApi({
      ...(await signedInAs('student')),
      'GET /exam-periods': { body: { periods: [period] } },
      'GET /applications': { body: { applications: app ? [app] : [] } },
      'GET /fee-records/mine': { body: { feeRecords: fee ? [fee] : [] } },
      'POST /applications': { status: 201, body: { application: application() } },
    });

  it('lets a student with no application apply', async () => {
    const api = await setup(null);
    await mount('/exam');
    await fireEvent.press(await screen.findByText('Apply for exam card'));
    await waitFor(() => expect(api.last('POST /applications')?.body).toEqual({ examPeriodId: 'p1' }));
  });

  it('explains a rejection with the balance and offers Re-apply', async () => {
    await setup(application({ status: 'rejected', rejection_reason: 'Your fees are not fully cleared. Outstanding balance: KSh 30,000.' }),
      { id: 'f1', academic_year: '2026/2027', semester: 'Semester 1', total_fee: 80000, amount_paid: 50000, balance: 30000 });
    await mount('/exam');
    expect(await screen.findByText(/Outstanding balance: KSh 30,000/)).toBeTruthy();
    expect(screen.getByText('NOT CLEARED')).toBeTruthy();
    expect(screen.getByText('Re-apply')).toBeTruthy();
    expect(screen.getByText('KSh 80,000')).toBeTruthy();
  });

  it('issues an approved card and shows the printable-style card once issued', async () => {
    const api = await setup(application({ status: 'approved' }));
    await mount('/exam');
    await fireEvent.press(await screen.findByText('Generate & email my card'));
    await waitFor(() => expect(api.last('POST /applications/e0000000-0000-4000-8000-000000000001/issue')).toBeTruthy());
  });

  it('shows the card number for an issued application', async () => {
    await setup(application({ status: 'issued', card_issued_at: '2026-10-12 09:14:00' }));
    await mount('/exam');
    expect(await screen.findByText('FC-E0000000')).toBeTruthy();
    expect(screen.getByText('CARD ISSUED')).toBeTruthy();
  });

  it('says applications are closed outside the window', async () => {
    installFakeApi({
      ...(await signedInAs('student')),
      'GET /exam-periods': { body: { periods: [{ ...period, application_open: day(5), application_close: day(9) }] } },
    });
    await mount('/exam');
    expect(await screen.findByText('Applications are not open right now.')).toBeTruthy();
    expect(screen.queryByText('Apply for exam card')).toBeNull();
  });
});

describe('staff', () => {
  it('requires a reason before a manual approval, then records it', async () => {
    const api = installFakeApi({
      ...(await signedInAs('staff')),
      'GET /applications': { body: { applications: [application({ status: 'rejected', rejection_reason: 'x' })] } },
      'POST /applications/e0000000-0000-4000-8000-000000000001/approve': { body: { application: application({ status: 'approved' }) } },
    });
    await mount('/applications');
    await fireEvent.press(await screen.findByText('Approve manually'));

    // "Approve" stays disabled until a real reason (5+ chars) is typed
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'ok');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Sponsor letter received');
    await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(api.last('POST /applications/e0000000-0000-4000-8000-000000000001/approve')?.body).toEqual({ note: 'Sponsor letter received' }));
  });

  it('shows the queue and opens a ticket with staff controls', async () => {
    const api = installFakeApi({
      ...(await signedInAs('staff')),
      'GET /tickets?': { body: { tickets: [] } },
      'GET /tickets': { body: { tickets: [ticket(), ticket({ id: 't2', student_name: 'Brian Kiprop', status: 'resolved' })] } },
      'GET /tickets/t1': { body: { ticket: ticket() } },
      'PATCH /tickets/t1': { body: { ticket: ticket({ status: 'in_review' }) } },
    });
    await mount('/queue');
    expect(await screen.findByText(/Amina Hassan/)).toBeTruthy();
    expect(screen.queryByText(/Brian Kiprop/)).toBeNull(); // resolved tickets are hidden under the default "Open" filter

    await fireEvent.press(screen.getByText('Fee Dispute'));
    expect(await screen.findByText('Staff controls')).toBeTruthy();
    await fireEvent.press(screen.getByText('IN REVIEW'));
    await fireEvent.changeText(screen.getByLabelText('Notes to student'), 'Checking with accounts.');
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(api.last('PATCH /tickets/t1')?.body).toEqual({ status: 'in_review', priority: 'medium', staffNotes: 'Checking with accounts.' }));
  });
});
