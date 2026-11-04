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
