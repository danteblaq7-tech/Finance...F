import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as DocumentPicker from 'expo-document-picker';
import { Alert } from 'react-native';
import { api } from '@/lib/api';
import { toDateString } from '@/lib/format';
import { installFakeApi, signedInAs, ticket } from '@/test-utils/fakeApi';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn(),
}));

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

  it('lets a student choose a staff-generated appointment while raising the ticket', async () => {
    const d = day(2);
    const api = installFakeApi({
      ...(await signedInAs('student')),
      'GET /slots/dates': { body: { dates: [{ date: d, free: 1, total: 1 }] } },
      'GET /slots?date': { body: { slots: [
        { id: 's1', slot_date: d, start_time: `${d} 10:00:00`, end_time: `${d} 10:30:00`, display_time: '10:00 AM', is_booked: false },
      ] } },
      'POST /tickets': { status: 201, body: { ticket: ticket({ id: 'new1', appointment_slot_id: 's1' }) } },
      'GET /tickets/new1': { body: { ticket: ticket({ id: 'new1', appointment_slot_id: 's1' }) } },
    });
    await mount('/tickets/new');

    await fireEvent.press(screen.getByText('Fee Dispute'));
    await fireEvent.changeText(screen.getByLabelText('Description'), 'I need help and would like to visit the Finance Office.');
    await fireEvent.press(await screen.findByLabelText('Select appointment at 10:00 AM'));
    await fireEvent.press(screen.getByText('Submit ticket'));

    await waitFor(() => expect(api.last('POST /tickets')?.body).toEqual({
      issueType: 'fee_dispute',
      priority: 'medium',
      description: 'I need help and would like to visit the Finance Office.',
      slotId: 's1',
    }));
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

  it('shows the timestamped finance office response history to the student', async () => {
    installFakeApi({ ...(await signedInAs('student')), 'GET /tickets/t1': { body: { ticket: ticket({ status: 'resolved', attended_by_name: 'Susan Otieno', responses: [
      { id: 'r1', ticket_id: 't1', author_id: null, author_name: null, body: 'We are reviewing the transaction.', created_at: '2026-10-15 09:00:00' },
      { id: 'r2', ticket_id: 't1', author_id: 'u2', author_name: 'Susan Otieno', body: 'Duplicate charge reversed on 15 Oct.', created_at: '2026-10-16 10:30:00' },
    ] }) } } });
    await mount('/tickets/t1');
    expect(await screen.findByText('We are reviewing the transaction.')).toBeTruthy();
    expect(await screen.findByText('Duplicate charge reversed on 15 Oct.')).toBeTruthy();
    expect(screen.getByText('Finance Office')).toBeTruthy();
    expect(screen.getByText('Susan Otieno')).toBeTruthy();
    expect(screen.getByText('Attended by Susan')).toBeTruthy();
    expect(screen.getByText('Fri 16 Oct, 10:30 AM')).toBeTruthy();
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

  it('lets a student with an official fee record apply', async () => {
    const api = await setup(null, { id: 'f1', academic_year: '2026/2027', semester: 'Semester 1', total_fee: 80000, amount_paid: 80000, balance: 0 });
    await mount('/exam');
    await fireEvent.press(await screen.findByText('Apply for exam card'));
    expect(await screen.findByText('Choose statement file')).toBeTruthy();
    await waitFor(() => expect(api.last('POST /applications')?.body).toEqual({ examPeriodId: 'p1' }));
  });

  it('asks a student with no fee record to upload their fee statement', async () => {
    await setup(null);
    await mount('/exam');
    expect(await screen.findByText('Upload your fee statement')).toBeTruthy();
    expect(screen.getByText('Choose statement file')).toBeTruthy();
    expect(screen.queryByText('Apply for exam card')).toBeNull();
  });

  it('uploads a selected statement from mobile during the open application window', async () => {
    installFakeApi({
      ...(await signedInAs('student')),
      'GET /exam-periods': { body: { periods: [period] } },
      'GET /applications': { body: { applications: [] } },
      'GET /fee-records/mine': { body: { feeRecords: [] } },
    });
    const picker = jest.mocked(DocumentPicker.getDocumentAsync);
    picker.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///statement.pdf', name: 'statement.pdf', mimeType: 'application/pdf', size: 100, lastModified: 0 }],
    });
    const upload = jest.spyOn(api, 'upload').mockImplementation(async () => ({} as never));

    try {
      await mount('/exam');
      await fireEvent.press(await screen.findByRole('button', { name: 'Choose statement file' }));
      await waitFor(() => expect(upload).toHaveBeenCalledWith('/fee-statements?examPeriodId=p1', {
        uri: 'file:///statement.pdf',
        name: 'statement.pdf',
        mimeType: 'application/pdf',
      }));
    } finally {
      upload.mockRestore();
      picker.mockReset();
    }
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

  it('shows the student their units as a checklist under the card: sat, not yet, and not allowed', async () => {
    installFakeApi({
      ...(await signedInAs('student')),
      'GET /exam-periods': { body: { periods: [period] } },
      'GET /applications': { body: { applications: [application({ status: 'issued', card_issued_at: '2026-10-12 09:14:00' })] } },
      'GET /fee-records/mine': { body: { feeRecords: [] } },
      'GET /exam-units/mine': { body: { units: [
        { id: 'a', unit_code: 'CSC101', unit_name: 'Intro to Programming', exam_date: null, start_time: null, venue: 'Main Hall', allowed: true, block_reason: null, signed_at: '2026-11-23T09:05:00' },
        { id: 'b', unit_code: 'CSC102', unit_name: 'Databases', exam_date: null, start_time: null, venue: null, allowed: true, block_reason: null, signed_at: null },
        { id: 'c', unit_code: 'CSC103', unit_name: 'Networks', exam_date: null, start_time: null, venue: null, allowed: false, block_reason: 'Missing CAT marks', signed_at: null },
      ] } },
    });
    await mount('/exam');
    expect(await screen.findByText('1 of 2 sat')).toBeTruthy();
    expect(screen.getByLabelText('CSC101 Intro to Programming, sat')).toBeTruthy();
    expect(screen.getByLabelText('CSC102 Databases, not yet')).toBeTruthy();
    expect(screen.getByLabelText('CSC103 Networks, not allowed')).toBeTruthy();
    expect(screen.getByText('Missing CAT marks')).toBeTruthy();
  });

  it('draws a QR code on the issued card, with the code underneath', async () => {
    installFakeApi({
      ...(await signedInAs('student')),
      'GET /exam-periods': { body: { periods: [period] } },
      'GET /applications': { body: { applications: [application({ status: 'issued', card_issued_at: '2026-10-12 09:14:00', verification_code: 'BZ5M4ZQVN5ZC' })] } },
      'GET /fee-records/mine': { body: { feeRecords: [] } },
    });
    await mount('/exam');
    expect(await screen.findByLabelText('Verification QR code')).toBeTruthy();
    expect(screen.getByText('BZ5M4ZQVN5ZC')).toBeTruthy();
  });

  it('says so, instead of showing nothing, when no units are registered yet', async () => {
    installFakeApi({
      ...(await signedInAs('student')),
      'GET /exam-periods': { body: { periods: [period] } },
      'GET /applications': { body: { applications: [application({ status: 'issued', card_issued_at: '2026-10-12 09:14:00' })] } },
      'GET /fee-records/mine': { body: { feeRecords: [] } },
      'GET /exam-units/mine': { body: { units: [] } },
    });
    await mount('/exam');
    expect(await screen.findByText(/No units are registered for you/)).toBeTruthy();
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

  it('lets finance staff and admins see eligibility and parsed statement amounts', async () => {
    installFakeApi({
      ...(await signedInAs('admin')),
      'GET /applications': { body: { applications: [application({
        status: 'pending',
        decision_source: 'statement',
        statement_outcome: 'cleared',
        status_note: 'Waiting for finance office verification.',
        total_fee: 100000,
        amount_paid: 70000,
        balance: 30000,
      })] } },
    });
    await mount('/applications');
    expect(await screen.findByText('ELIGIBLE · AWAITING VERIFICATION')).toBeTruthy();
    expect(screen.getByText(/Paid KSh 70,000 of KSh 100,000 · balance KSh 30,000/)).toBeTruthy();
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
    await fireEvent.changeText(screen.getByLabelText('New Finance Office response'), 'Checking with accounts.');
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(api.last('PATCH /tickets/t1')?.body).toEqual({ issueType: 'fee_dispute', status: 'in_review', priority: 'medium', response: 'Checking with accounts.' }));
  });

  it('filters the staff queue to tickets assigned to the signed-in staff member', async () => {
    const api = installFakeApi({
      ...(await signedInAs('staff')),
      'GET /tickets?assignedTo=me': { body: { tickets: [ticket({ id: 'mine', student_name: 'Assigned Student', assigned_staff_id: 'u2' })] } },
      'GET /tickets': { body: { tickets: [ticket(), ticket({ id: 'mine', student_name: 'Assigned Student', assigned_staff_id: 'u2' })] } },
    });
    await mount('/queue');
    await fireEvent.press(await screen.findByText('My tickets'));
    expect(await screen.findByText(/Assigned Student/)).toBeTruthy();
    await waitFor(() => expect(api.last('GET /tickets?assignedTo=me')).toBeTruthy());
  });

  it('lets an admin assign a ticket to active finance staff', async () => {
    const api = installFakeApi({
      ...(await signedInAs('admin')),
      'GET /tickets/t1': { body: { ticket: ticket() } },
      'GET /admin/staff': { body: { staff: [{ id: 'u2', name: 'Susan Otieno', role: 'staff', is_active: true }] } },
      'PATCH /tickets/t1': { body: { ticket: ticket({ assigned_staff_id: 'u2', assigned_staff_name: 'Susan Otieno' }) } },
    });
    await mount('/queue/t1');
    await fireEvent.press(await screen.findByText('Susan Otieno'));
    await waitFor(() => expect(api.last('PATCH /tickets/t1')?.body).toEqual({ assignedStaffId: 'u2' }));
  });
});
