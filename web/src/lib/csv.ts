import { z } from 'zod';

/** Minimal RFC 4180-style parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  const pushRow = () => {
    row.push(field);
    field = '';
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; pushRow(); }
    else field += c;
  }
  pushRow();
  return rows;
}

const rowSchema = z.object({
  student_id: z.string().trim().min(1, 'student_id is required').transform((s) => s.toUpperCase()),
  student_name: z.string().trim().default(''),
  email: z.string().trim().toLowerCase().default(''),
  course: z.string().trim().default(''),
  total_fee: z.coerce.number({ invalid_type_error: 'total_fee must be a number' }).min(0),
  amount_paid: z.coerce.number({ invalid_type_error: 'amount_paid must be a number' }).min(0),
  payment_ref: z.string().trim().default(''),
});

export type FeeImportRow = z.infer<typeof rowSchema>;
export interface FeeImportResult {
  rows: FeeImportRow[];
  errors: { line: number; message: string }[];
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, '');
const HEADERS: Record<string, string> = {
  studentid: 'student_id', studentname: 'student_name', name: 'student_name', email: 'email', course: 'course',
  totalfee: 'total_fee', amountpaid: 'amount_paid', paymentref: 'payment_ref', ref: 'payment_ref',
};

/** Parse + validate a fee CSV. Bad lines are reported with their line number, never silently dropped. */
export function parseFeeCsv(text: string): FeeImportResult {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], errors: [{ line: 1, message: 'File has no data rows.' }] };
  const headers = table[0]!.map((h) => HEADERS[norm(h)] ?? norm(h));
  const rows: FeeImportRow[] = [];
  const errors: FeeImportResult['errors'] = [];
  table.slice(1).forEach((cells, idx) => {
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => (raw[h] = cells[i] ?? ''));
    // Strip thousands separators from the numeric columns only.
    for (const k of ['total_fee', 'amount_paid']) raw[k] = (raw[k] ?? '').replace(/,/g, '');
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ line: idx + 2, message: parsed.error.issues.map((i) => i.message).join('; ') });
    } else rows.push(parsed.data);
  });
  return { rows, errors };
}

// ── Exam units and unit registrations ───────────────────────────────────────

export interface ImportResult<T> {
  rows: T[];
  errors: { line: number; message: string }[];
}
export interface UnitImportRow {
  unit_code: string; unit_name: string; exam_date: string | null; start_time: string | null; end_time: string | null; venue: string; lecturers: string[];
}
export interface RegistrationImportRow { student_id: string; unit_code: string; unit_name: string; allowed?: boolean; reason: string }

const UNIT_HEADERS: Record<string, string> = {
  unitcode: 'unit_code', code: 'unit_code', unit: 'unit_code',
  unitname: 'unit_name', name: 'unit_name', title: 'unit_name', unittitle: 'unit_name',
  examdate: 'exam_date', date: 'exam_date',
  starttime: 'start_time', start: 'start_time', endtime: 'end_time', end: 'end_time',
  venue: 'venue', room: 'venue', hall: 'venue',
  lecturers: 'lecturers', lecturer: 'lecturers', lectureremails: 'lecturers', lectureremail: 'lecturers', invigilators: 'lecturers',
  studentid: 'student_id', studentnumber: 'student_id', studentno: 'student_id', regno: 'student_id', registrationnumber: 'student_id', admissionnumber: 'student_id',
  allowed: 'allowed', eligible: 'allowed', reason: 'reason', note: 'reason', blockreason: 'reason',
};

const unitCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

/** "2026-11-23" or "23/11/2026" (day first) -> "2026-11-23"; null when empty; undefined when not a real date. */
export function normaliseDate(s: string): string | null | undefined {
  const v = s.trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  let hit = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (hit) { [y, m, d] = [+hit[1]!, +hit[2]!, +hit[3]!]; }
  else if ((hit = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { [d, m, y] = [+hit[1]!, +hit[2]!, +hit[3]!]; }
  else return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "9:00", "09:00:00", "2:30 PM" -> "HH:MM"; null when empty; undefined when not a time. */
export function normaliseTime(s: string): string | null | undefined {
  const v = s.trim();
  if (!v) return null;
  const hit = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!hit) return undefined;
  let h = +hit[1]!;
  const min = +hit[2]!;
  const ap = hit[3]?.toLowerCase();
  if (ap) { if (h < 1 || h > 12) return undefined; h = (h % 12) + (ap === 'pm' ? 12 : 0); }
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function table(text: string, required: string[]): { headers: string[]; body: string[][]; error?: string } {
  const t = parseCsv(text);
  if (t.length < 2) return { headers: [], body: [], error: 'File has no data rows.' };
  const headers = t[0]!.map((h) => UNIT_HEADERS[norm(h)] ?? norm(h));
  const missing = required.filter((r) => !headers.includes(r));
  if (missing.length) return { headers, body: [], error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` };
  return { headers, body: t.slice(1) };
}

const cell = (headers: string[], cells: string[], name: string) => (cells[headers.indexOf(name)] ?? '').trim();

/** Units file: unit_code (required), unit_name, exam_date, start_time, end_time, venue, lecturers (e-mails separated by ; or |). */
export function parseUnitsCsv(text: string): ImportResult<UnitImportRow> {
  const { headers, body, error } = table(text, ['unit_code']);
  if (error) return { rows: [], errors: [{ line: 1, message: error }] };
  const rows: UnitImportRow[] = [];
  const errors: ImportResult<UnitImportRow>['errors'] = [];
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const code = unitCode(cell(headers, cells, 'unit_code'));
    if (!code) return void errors.push({ line, message: 'unit_code is required' });
    const date = normaliseDate(cell(headers, cells, 'exam_date'));
    const start = normaliseTime(cell(headers, cells, 'start_time'));
    const end = normaliseTime(cell(headers, cells, 'end_time'));
    if (date === undefined) return void errors.push({ line, message: `${code}: exam_date must look like 2026-11-23 or 23/11/2026` });
    if (start === undefined || end === undefined) return void errors.push({ line, message: `${code}: times must look like 09:00 or 2:30 PM` });
    const emails = cell(headers, cells, 'lecturers').split(/[;|\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const badEmail = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (badEmail) return void errors.push({ line, message: `${code}: "${badEmail}" is not an e-mail address` });
    rows.push({ unit_code: code, unit_name: cell(headers, cells, 'unit_name'), exam_date: date, start_time: start, end_time: end, venue: cell(headers, cells, 'venue'), lecturers: emails });
  });
  return { rows, errors };
}

const YES = new Set(['yes', 'y', 'true', '1', 'allowed', 'eligible']);
const NO = new Set(['no', 'n', 'false', '0', 'barred', 'blocked', 'not allowed']);

/** Registrations file: student_id and unit_code (required); unit_name, allowed (yes/no), reason optional. */
export function parseRegistrationsCsv(text: string): ImportResult<RegistrationImportRow> {
  const { headers, body, error } = table(text, ['student_id', 'unit_code']);
  if (error) return { rows: [], errors: [{ line: 1, message: error }] };
  const rows: RegistrationImportRow[] = [];
  const errors: ImportResult<RegistrationImportRow>['errors'] = [];
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const student = cell(headers, cells, 'student_id').toUpperCase();
    const code = unitCode(cell(headers, cells, 'unit_code'));
    if (!student) return void errors.push({ line, message: 'student_id is required' });
    if (!code) return void errors.push({ line, message: 'unit_code is required' });
    const flag = cell(headers, cells, 'allowed').toLowerCase();
    if (flag && !YES.has(flag) && !NO.has(flag)) return void errors.push({ line, message: `allowed must be yes or no (got "${flag}")` });
    const row: RegistrationImportRow = { student_id: student, unit_code: code, unit_name: cell(headers, cells, 'unit_name'), reason: cell(headers, cells, 'reason') };
    if (flag) row.allowed = YES.has(flag);
    rows.push(row);
  });
  return { rows, errors };
}

/** Rows -> CSV text (quotes cells that need it; a leading BOM so Excel reads UTF-8 names correctly). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined) => {
    const t = v == null ? '' : String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
