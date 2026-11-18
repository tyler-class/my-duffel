import { describe, expect, it } from 'vitest';
import { formatRange } from '../../src/client/lib/format';
import { timeRange } from '../../src/client/lib/itinerary';

describe('ranges read with "to", not a dash', () => {
  it('formats date ranges', () => {
    expect(formatRange('2026-12-12', '2026-12-19')).toBe('Dec 12 to 19');
    expect(formatRange('2026-12-30', '2027-01-02')).toBe('Dec 30 to Jan 2 2027');
    expect(formatRange('2026-12-12', '2026-12-12')).toBe('Dec 12');
  });

  it('formats time ranges, saying a shared AM or PM once', () => {
    expect(timeRange('9:00 AM', '10:30 AM')).toBe('9:00 to 10:30 AM');
    expect(timeRange('9:00 AM', '10:30 AM')).toBe('9:00 to 10:30 AM');
    expect(timeRange('11:00 AM', '1:00 PM')).toBe('11:00 AM to 1:00 PM');
    expect(timeRange('9:00 AM', '')).toBe('9:00 AM');
    expect(timeRange('', '')).toBe('');
  });
});
