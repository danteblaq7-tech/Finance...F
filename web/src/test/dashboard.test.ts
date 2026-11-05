import { describe, expect, it } from 'vitest';
import { niceMax } from '@/components/charts';
import { hoursLabel } from '@/features/dashboard/DashboardPage';

describe('chart helpers', () => {
  it('rounds the axis maximum up to a friendly number', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(4)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(50);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(101)).toBe(200);
  });
  it('formats waiting times for humans', () => {
    expect(hoursLabel(null)).toBe('—');
    expect(hoursLabel(0.5)).toBe('30 min');
    expect(hoursLabel(3)).toBe('3.0 h');
    expect(hoursLabel(72)).toBe('3.0 days');
  });
});
