import { describe, expect, it } from 'vitest';
import { normaliseDate, normaliseTime, parseRegistrationsCsv, parseUnitsCsv } from '@/lib/csv';

describe('normaliseDate / normaliseTime', () => {
  it('accepts ISO and day-first dates, rejects impossible ones', () => {
    expect(normaliseDate('2026-11-23')).toBe('2026-11-23');
    expect(normaliseDate('23/11/2026')).toBe('2026-11-23');
    expect(normaliseDate('3.1.2027')).toBe('2027-01-03');
    expect(normaliseDate('')).toBeNull();
    expect(normaliseDate('2026-02-31')).toBeUndefined();
    expect(normaliseDate('31/02/2026')).toBeUndefined();
    expect(normaliseDate('tomorrow')).toBeUndefined();
  });
  it('accepts 24-hour and AM/PM times', () => {
    expect(normaliseTime('9:00')).toBe('09:00');
    expect(normaliseTime('14:30:00')).toBe('14:30');
    expect(normaliseTime('2:30 PM')).toBe('14:30');
    expect(normaliseTime('12:15 am')).toBe('00:15');
    expect(normaliseTime('')).toBeNull();
    expect(normaliseTime('25:00')).toBeUndefined();
    expect(normaliseTime('noon')).toBeUndefined();
  });
});

describe('parseUnitsCsv', () => {
  it('reads a units file, tolerating header names and messy cells', () => {
    const r = parseUnitsCsv('Unit Code,Unit Name,Exam Date,Start,End,Room,Lecturers\r\ncsc  101,Intro,23/11/2026,9:00,11:00 AM,Hall A,"A@x.ke; b@x.ke"\r\nCSC102,DB,,,,,\r\n');
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({ unit_code: 'CSC 101', unit_name: 'Intro', exam_date: '2026-11-23', start_time: '09:00', end_time: '11:00', venue: 'Hall A', lecturers: ['a@x.ke', 'b@x.ke'] });
    expect(r.rows[1]).toMatchObject({ unit_code: 'CSC102', exam_date: null, lecturers: [] });
  });
  it('reports bad lines with their line number and keeps the good ones', () => {
    const r = parseUnitsCsv('unit_code,exam_date,lecturers\nCSC1,2026-13-40,\nCSC2,,not-an-email\n,2026-11-01,\nCSC3,2026-11-01,ok@x.ke');
    expect(r.rows.map((x) => x.unit_code)).toEqual(['CSC3']);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
  it('explains a missing required column', () => {
    expect(parseUnitsCsv('name,date\nx,y').errors[0]!.message).toMatch(/unit_code/);
    expect(parseUnitsCsv('unit_code').errors[0]!.message).toMatch(/no data rows/);
  });
});

describe('parseRegistrationsCsv', () => {
  it('reads registrations; "allowed" is only set when the file says so', () => {
    const r = parseRegistrationsCsv('Student Number,Unit,Allowed,Reason\ncom/072/23,csc101,,\nCOM/073/23,CSC101,no,Missing CAT\nCOM/074/23,CSC101,YES,');
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({ student_id: 'COM/072/23', unit_code: 'CSC101', unit_name: '', reason: '' });
    expect('allowed' in r.rows[0]!).toBe(false);
    expect(r.rows[1]).toMatchObject({ allowed: false, reason: 'Missing CAT' });
    expect(r.rows[2]).toMatchObject({ allowed: true });
  });
  it('rejects rows it cannot trust', () => {
    const r = parseRegistrationsCsv('student_id,unit_code,allowed\n,CSC1,\nA/1,,\nA/2,CSC1,maybe\nA/3,CSC1,');
    expect(r.rows.map((x) => x.student_id)).toEqual(['A/3']);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
});
