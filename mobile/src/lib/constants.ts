import type { Palette } from '@/theme/theme';
// Shared with the web app (same labels and colours for ticket / exam statuses).
import type { ExamCardStatus, TicketStatus } from './types';

export const ISSUE_TYPES = [
  { label: 'Fee Dispute', value: 'fee_dispute' },
  { label: 'Payment Arrangement', value: 'payment_plan' },
  { label: 'Sponsorship Letter', value: 'sponsorship' },
  { label: 'HELB Inquiry', value: 'helb' },
  { label: 'Bursary Confirmation', value: 'bursary' },
  { label: 'Fee Statement Request', value: 'fee_statement' },
  { label: 'Other', value: 'other' },
] as const;

export const ISSUE_LABELS: Record<string, string> = Object.fromEntries(ISSUE_TYPES.map((t) => [t.value, t.label]));

export const TICKET_STATUS: Record<TicketStatus, { label: string; color: keyof Palette }> = {
  pending: { label: 'PENDING', color: 'accent_amber' },
  in_review: { label: 'IN REVIEW', color: 'accent_teal_lt' },
  resolved: { label: 'RESOLVED', color: 'accent_green' },
  cancelled: { label: 'CANCELLED', color: 'accent_red' },
};

export const EXAM_STATUS: Record<ExamCardStatus, { label: string; color: keyof Palette }> = {
  pending: { label: 'PROCESSING', color: 'accent_amber' },
  approved: { label: 'APPROVED', color: 'accent_teal_lt' },
  rejected: { label: 'NOT CLEARED', color: 'accent_red' },
  issued: { label: 'CARD ISSUED', color: 'accent_green' },
};
