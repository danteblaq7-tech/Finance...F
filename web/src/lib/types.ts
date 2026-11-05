// Shapes returned by the Express API (column names come straight from the Postgres schema in database/supabase).
export type UserRole = 'student' | 'staff' | 'admin';
export type TicketStatus = 'pending' | 'in_review' | 'resolved' | 'cancelled';
export type TicketPriority = 'low' | 'medium' | 'high';
export type ExamCardStatus = 'pending' | 'approved' | 'rejected' | 'issued';

export interface User {
  id: string;
  name: string;
  email: string;
  student_id: string | null;
  university: string | null;
  course: string | null;
  year_of_study: string | null;
  role: UserRole;
}

export interface Ticket {
  id: string;
  student_id: string;
  student_number: string | null;
  student_name: string;
  issue_type: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  appointment_slot: string | null;
  appointment_slot_id: string | null;
  staff_notes: string;
  assigned_staff_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  display_time: string | null;
  is_booked: boolean;
  booked_by_name?: string | null;
}

export interface SlotDate {
  date: string;
  free: number;
  total: number;
}

export interface FeeRecord {
  id: string;
  student_id: string;
  student_name: string | null;
  email: string | null;
  course: string | null;
  academic_year: string;
  semester: string;
  total_fee: number;
  amount_paid: number;
  balance: number;
  is_cleared_for_exam: boolean;
  payment_ref: string | null;
  exception_note: string | null;
}

export interface ExamPeriod {
  id: string;
  title: string;
  academic_year: string;
  semester: string;
  exam_start_date: string;
  exam_end_date: string;
  application_open: string;
  application_close: string;
  min_payment_percent: number;
  is_active: boolean;
}

export interface Application {
  id: string;
  student_uid: string;
  student_id: string;
  student_name: string;
  email: string | null;
  course: string | null;
  year_of_study: string | null;
  exam_period_id: string;
  period_title: string;
  exam_start_date: string;
  exam_end_date: string;
  academic_year: string;
  semester: string;
  status: ExamCardStatus;
  rejection_reason: string | null;
  amount_paid: number;
  total_fee: number;
  balance: number;
  manual_approval_note: string | null;
  card_issued_at: string | null;
  created_at: string;
  min_payment_percent: number;
  /** Where the decision came from: the finance office's fee record, an uploaded statement, or a staff override. */
  decision_source: 'fee_record' | 'statement' | 'manual';
  /** Explains a pending application (e.g. "waiting for the finance office to verify your statement"). */
  status_note: string | null;
  statement_id: string | null;
  verification_code: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  manually_approved_by: string | null;
}

export type StatementOutcome = 'cleared' | 'not_cleared' | 'needs_review' | 'official_record';

export interface FeeStatement {
  id: string;
  student_uid: string;
  student_id: string;
  student_name: string;
  academic_year: string;
  semester: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  total_fee: number | null;
  amount_paid: number | null;
  balance: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  flags: string[];
  identity: 'matched' | 'mismatch' | 'unknown';
  outcome: StatementOutcome;
  created_at: string;
}

export interface VerifyResult {
  state: 'valid' | 'provisional' | 'revoked' | 'expired' | 'not_found';
  valid: boolean;
  studentName?: string;
  studentId?: string;
  course?: string | null;
  semester?: string;
  academicYear?: string;
  examStartDate?: string;
  examEndDate?: string;
  issuedAt?: string;
}

export interface StatsOverview {
  generatedAt: string;
  people: { students_total: number; new_students_today: number; active_today: number; active_7d: number; active_30d: number; online_now: number };
  tickets: {
    total: number; pending: number; in_review: number; resolved: number; cancelled: number; awaiting_attention: number;
    raised_today: number; attended_today: number; resolved_today: number;
    avg_first_response_hours: number | null; oldest_waiting_hours: number | null;
  };
  exams: {
    total: number; pending: number; awaiting_verification: number; approved: number; rejected: number; issued: number; revoked: number;
    applied_today: number; issued_today: number;
  };
  fees: { students: number; cleared: number; not_cleared: number; billed: number; collected: number; outstanding: number; collectionRate: number | null };
  statements: { total: number; uploaded_today: number; needs_review: number };
}

export interface DailyStat {
  day: string;
  active_students: number;
  tickets_raised: number;
  tickets_attended: number;
  tickets_resolved: number;
  tickets_pending: number;
  applications: number;
  cards_issued: number;
  statements_uploaded: number;
}

export interface EmailTemplate {
  template_key: 'exam_card' | 'rejection';
  subject: string;
  html: string;
  updated_at: string;
}

export interface SentEmail {
  id: string;
  email_type: 'exam_card' | 'rejection';
  to_email: string;
  to_name: string | null;
  semester: string | null;
  academic_year: string | null;
  card_number: string | null;
  delivered: boolean;
  sent_at: string;
  html?: string;
}
