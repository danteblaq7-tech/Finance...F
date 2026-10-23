export const ISSUE_TYPES = [
  { label: 'Fee Dispute', value: 'fee_dispute' },
  { label: 'Payment Arrangement', value: 'payment_plan' },
  { label: 'Sponsorship Letter', value: 'sponsorship' },
  { label: 'HELB Inquiry', value: 'helb' },
  { label: 'Bursary Confirmation', value: 'bursary' },
  { label: 'Fee Statement Request', value: 'fee_statement' },
  { label: 'Other', value: 'other' },
];

export const ISSUE_LABELS = Object.fromEntries(ISSUE_TYPES.map((t) => [t.value, t.label]));

export const TICKET_STATUS = {
  pending: { label: 'PENDING', color: '#F59E0B' },
  in_review: { label: 'IN REVIEW', color: '#2BA8BF' },
  resolved: { label: 'RESOLVED', color: '#22C55E' },
  cancelled: { label: 'CANCELLED', color: '#EF4444' },
};

export const EXAM_STATUS = {
  pending: { label: 'PROCESSING', color: '#F59E0B' },
  approved: { label: 'APPROVED', color: '#2BA8BF' },
  rejected: { label: 'NOT CLEARED', color: '#EF4444' },
  issued: { label: 'CARD ISSUED', color: '#22C55E' },
};
