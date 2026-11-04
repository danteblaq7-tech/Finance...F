// Shapes returned by the Express API. Identical to web/src/lib/types.ts.
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
