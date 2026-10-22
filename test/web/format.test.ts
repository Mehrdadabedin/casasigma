import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatCompact,
  formatDay,
  formatPrice,
  toIsoDate,
  todayIso,
  upcomingDays,
} from '../../src/lib/format';

afterEach(() => vi.useRealTimers());

describe('format', () => {
  it('formats prices as whole euros', () => {
    expect(formatPrice(1250000)).toBe('€1,250,000');
    expect(formatPrice(499.6)).toBe('€500');
  });

  it('formats compact numbers', () => {
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(2400000)).toBe('2.4m');
  });

  it('uses the local date, not UTC', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(toIsoDate(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31');
  });

  it('returns today and the upcoming days across a month end', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 9, 0));
    expect(todayIso()).toBe('2026-10-30');
    expect(upcomingDays(4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('formats a day label', () => {
    expect(formatDay('2026-10-22')).toBe('Thu 22 Oct');
  });
});
