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

/** Status colours as CSS variables, so every badge is readable in both light and dark mode (see index.css). */
export const TONE = {
  green: 'rgb(var(--c-green))',
  red: 'rgb(var(--c-red))',
  amber: 'rgb(var(--c-amber))',
  teal: 'rgb(var(--c-teal))',
  gray: 'rgb(var(--c-gray))',
} as const;

export const TICKET_STATUS: Record<TicketStatus, { label: string; color: string }> = {
  pending: { label: 'PENDING', color: TONE.amber },
  in_review: { label: 'IN REVIEW', color: TONE.teal },
  resolved: { label: 'RESOLVED', color: TONE.green },
  cancelled: { label: 'CANCELLED', color: TONE.red },
};

export const EXAM_STATUS: Record<ExamCardStatus, { label: string; color: string }> = {
  pending: { label: 'PROCESSING', color: TONE.amber },
  approved: { label: 'APPROVED', color: TONE.teal },
  rejected: { label: 'NOT CLEARED', color: TONE.red },
  issued: { label: 'CARD ISSUED', color: TONE.green },
};
