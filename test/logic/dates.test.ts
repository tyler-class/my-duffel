import { describe, expect, it } from 'vitest';
import { dayNumber, localToday, tripLength } from '../../src/shared/logic';

describe('tripLength', () => {
  it('counts days inclusive and nights between', () => {
    expect(tripLength('2026-12-12', '2026-12-19')).toEqual({ days: 8, nights: 7 });
  });
  it('handles a same-day trip', () => {
    expect(tripLength('2026-05-01', '2026-05-01')).toEqual({ days: 1, nights: 0 });
  });
  it('crosses month and year boundaries', () => {
    expect(tripLength('2026-01-30', '2026-02-02')).toEqual({ days: 4, nights: 3 });
    expect(tripLength('2026-12-30', '2027-01-02')).toEqual({ days: 4, nights: 3 });
  });
  it('handles leap days', () => {
    expect(tripLength('2028-02-27', '2028-03-01')).toEqual({ days: 4, nights: 3 });
    expect(tripLength('2027-02-27', '2027-03-01')).toEqual({ days: 3, nights: 2 });
  });
  it('is not shifted by DST transitions', () => {
    expect(tripLength('2026-03-07', '2026-03-09')).toEqual({ days: 3, nights: 2 }); // US spring forward
    expect(tripLength('2026-10-31', '2026-11-02')).toEqual({ days: 3, nights: 2 }); // US fall back
    expect(tripLength('2026-03-28', '2026-03-30')).toEqual({ days: 3, nights: 2 }); // EU
  });
  it('returns null for missing, invalid or reversed dates', () => {
    expect(tripLength(null, '2026-01-01')).toBeNull();
    expect(tripLength('2026-01-05', '2026-01-01')).toBeNull();
    expect(tripLength('2026-02-30', '2026-03-01')).toBeNull();
    expect(tripLength('12/1/2026', '2026-12-05')).toBeNull();
  });
});

describe('dayNumber / localToday', () => {
  it('rejects impossible dates', () => {
    expect(dayNumber('2026-13-01')).toBeNull();
    expect(dayNumber('2027-02-29')).toBeNull();
  });
  it('formats local today', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
