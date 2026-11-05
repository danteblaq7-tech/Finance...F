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

export const TICKET_STATUS: Record<TicketStatus, { label: string; color: string }> = {
  pending: { label: 'PENDING', color: '#F59E0B' },
  in_review: { label: 'IN REVIEW', color: '#2BA8BF' },
  resolved: { label: 'RESOLVED', color: '#22C55E' },
  cancelled: { label: 'CANCELLED', color: '#EF4444' },
};

export const EXAM_STATUS: Record<ExamCardStatus, { label: string; color: string }> = {
  pending: { label: 'PROCESSING', color: '#F59E0B' },
  approved: { label: 'APPROVED', color: '#2BA8BF' },
  rejected: { label: 'NOT CLEARED', color: '#EF4444' },
  issued: { label: 'CARD ISSUED', color: '#22C55E' },
};
