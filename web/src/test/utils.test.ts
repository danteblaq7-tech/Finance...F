import { describe, expect, it } from 'vitest';
import { parseFeeCsv, parseCsv } from '@/lib/csv';
import { cardNumber, escapeHtml, formatKsh, homeFor, parseWall, renderTemplate, toDateString } from '@/lib/utils';

describe('renderTemplate', () => {
  it('fills placeholders and tolerates spaces', () => {
    expect(renderTemplate('Hi {{ name }}, {{n}}', { name: 'Amina', n: 3 })).toBe('Hi Amina, 3');
  });
  it('HTML-escapes values so user data cannot inject markup', () => {
    expect(renderTemplate('{{x}}', { x: '<img src=x onerror=alert(1)>' })).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('renders missing values as empty', () => {
    expect(renderTemplate('[{{missing}}]', {})).toBe('[]');
  });
});

describe('helpers', () => {
  it('escapeHtml escapes quotes and ampersands', () => expect(escapeHtml(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d'));
  it('formatKsh groups thousands', () => expect(formatKsh(85000)).toContain('85'));
  it('toDateString uses the local calendar, zero-padded', () => expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05'));
  it('parseWall reads MySQL wall-clock strings as local time', () => {
    const d = parseWall('2026-10-17 10:00:00');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 17, 10]);
  });
  it('cardNumber is stable and formatted', () => expect(cardNumber('e0000000-0000-4000-8000-000000000001')).toBe('FC-E0000000'));
  it('homeFor routes by role', () => {
    expect(homeFor('student')).toBe('/tickets');
    expect(homeFor('staff')).toBe('/staff/queue');
    expect(homeFor('admin')).toBe('/staff/queue');
  });
});

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes, CRLF and BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });
  it('skips blank lines', () => expect(parseCsv('a,b\n\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]));
});

describe('parseFeeCsv', () => {
  it('maps flexible headers, uppercases IDs and strips thousands separators', () => {
    const r = parseFeeCsv('Student ID,Name,Total Fee,Amount Paid\neg/1/2024,Amina,"85,000","40,000"\n');
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ student_id: 'EG/1/2024', student_name: 'Amina', total_fee: 85000, amount_paid: 40000 });
  });
  it('reports bad rows with line numbers instead of dropping them silently', () => {
    const r = parseFeeCsv('student_id,total_fee,amount_paid\nA/1,100,50\n,100,50\nB/2,abc,10\n');
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });
  it('rejects negative amounts', () => {
    expect(parseFeeCsv('student_id,total_fee,amount_paid\nA/1,-5,0\n').errors).toHaveLength(1);
  });
  it('rejects a file with only a header', () => expect(parseFeeCsv('student_id,total_fee,amount_paid\n').errors).toHaveLength(1));
});
