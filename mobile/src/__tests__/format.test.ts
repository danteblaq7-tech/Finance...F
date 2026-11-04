import { cardNumber, formatDateTime, formatDay, formatKsh, formatTime, initials, parseWall, toDateString } from '@/lib/format';

describe('format', () => {
  it('parses MySQL wall-clock strings as local time', () => {
    const d = parseWall('2026-10-17 10:00:00');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 17, 10]);
  });

  it('formats times in 12-hour form, including midnight and noon', () => {
    expect(formatTime('2026-10-17 00:05:00')).toBe('12:05 AM');
    expect(formatTime('2026-10-17 12:00:00')).toBe('12:00 PM');
    expect(formatTime('2026-10-17 15:30:00')).toBe('03:30 PM');
  });

  it('formats dates identically on every device (no Intl dependency)', () => {
    expect(formatDay('2026-10-17 08:00:00')).toBe('Sat 17 Oct');
    expect(formatDateTime('2026-10-17 10:00:00')).toBe('Sat 17 Oct, 10:00 AM');
    expect(formatDateTime(null)).toBe('—');
  });

  it('groups thousands in KSh amounts', () => {
    expect(formatKsh(85000)).toBe('KSh 85,000');
    expect(formatKsh(1234567)).toBe('KSh 1,234,567');
    expect(formatKsh(0)).toBe('KSh 0');
  });

  it('toDateString uses the local calendar, zero-padded', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('cardNumber and initials are stable', () => {
    expect(cardNumber('e0000000-0000-4000-8000-000000000001')).toBe('FC-E0000000');
    expect(initials('Amina Hassan Ali')).toBe('AH');
  });
});
