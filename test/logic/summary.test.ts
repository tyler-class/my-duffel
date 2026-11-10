import { describe, expect, it } from 'vitest';
import {
  bagFit,
  defaultTripId,
  isArchived,
  pickPersonColor,
  progress,
  splitTrips,
  unassignedCount,
} from '../../src/shared/logic';
import { row } from './fixtures';

const trip = (p: Partial<Parameters<typeof isArchived>[0]> & { id: string }) => ({
  name: p.id,
  start_date: null,
  end_date: null,
  archived_at: null,
  item_count: 0,
  packed_count: 0,
  ...p,
});

describe('archive rules', () => {
  const today = '2026-11-04';
  it('archives manual, fully packed, and long-past trips', () => {
    expect(isArchived(trip({ id: 'a', archived_at: '2026-01-01' }), today)).toBe(true);
    expect(isArchived(trip({ id: 'b', item_count: 3, packed_count: 3 }), today)).toBe(true);
    expect(isArchived(trip({ id: 'c', end_date: '2026-10-27' }), today)).toBe(true);
  });
  it('keeps empty, partly packed, and recently ended trips active', () => {
    expect(isArchived(trip({ id: 'd' }), today)).toBe(false);
    expect(isArchived(trip({ id: 'e', item_count: 3, packed_count: 2 }), today)).toBe(false);
    expect(isArchived(trip({ id: 'f', end_date: '2026-10-28' }), today)).toBe(false);
  });
  it('sorts active by start (nulls last) and archived by end descending', () => {
    const trips = [
      trip({ id: 'nodate' }),
      trip({ id: 'jan', start_date: '2027-01-24' }),
      trip({ id: 'dec', start_date: '2026-12-12' }),
      trip({ id: 'aug', end_date: '2026-08-10' }),
      trip({ id: 'may', end_date: '2026-05-19' }),
      trip({ id: 'sep', end_date: '2026-09-01', archived_at: 'x' }),
    ];
    const { active, archived } = splitTrips(trips, today);
    expect(active.map((t) => t.id)).toEqual(['dec', 'jan', 'nodate']);
    expect(archived.map((t) => t.id)).toEqual(['sep', 'aug', 'may']);
    expect(defaultTripId(trips, today)).toBe('dec');
    expect(defaultTripId(trips.slice(3), today)).toBe('sep');
    expect(defaultTripId([], today)).toBeNull();
  });
});

describe('progress / unassigned', () => {
  const bags = new Map([
    ['carry', { carry_on: true }],
    ['big', { carry_on: false }],
  ]);
  const rows = [
    row({ id: '1', trip_bag_id: 'carry', packed: true }),
    row({ id: '2', trip_bag_id: 'carry' }),
    row({ id: '3', trip_bag_id: 'big', packed: true }),
    row({ id: '4', no_bag: true }),
    row({ id: '5' }),
  ];
  it('counts carry-on from the bag', () => {
    expect(progress(rows, bags)).toEqual({ done: 2, total: 5, carryDone: 1, carryTotal: 2 });
  });
  it('counts only rows waiting for a bag', () => {
    expect(unassignedCount(rows)).toBe(1);
  });
});

describe('bagFit', () => {
  const rows = [
    { ...row({ id: '1', trip_bag_id: 'b', qty: 2 }), length_in: 10, width_in: 10, height_in: 10 },
    {
      ...row({ id: '2', trip_bag_id: 'b', qty: 7, qty_override: 1 }),
      length_in: 10,
      width_in: 5,
      height_in: 2,
    },
    { ...row({ id: '3', trip_bag_id: 'b' }), length_in: null, width_in: null, height_in: null },
    { ...row({ id: '4', trip_bag_id: 'other' }), length_in: 50, width_in: 50, height_in: 50 },
  ];
  it('sums volume × displayed qty in liters and counts unknown sizes', () => {
    const fit = bagFit('b', { capacity_l: 40 }, rows);
    // (2000 + 100) in³ × 0.0163871 = 34.4 L
    expect(fit).toEqual({
      usedL: 34.4,
      capacityL: 40,
      pct: 86,
      warn: false,
      itemCount: 3,
      missingDims: 1,
    });
  });
  it('warns above 90% and handles unknown capacity', () => {
    expect(bagFit('b', { capacity_l: 35 }, rows).warn).toBe(true);
    expect(bagFit('b', null, rows).pct).toBeNull();
  });
});

describe('pickPersonColor', () => {
  it('picks the first unused color, then the least used', () => {
    expect(pickPersonColor([])).toBe('blue');
    expect(pickPersonColor(['blue', 'violet'])).toBe('coral');
    expect(
      pickPersonColor([
        'blue',
        'violet',
        'coral',
        'amber',
        'green',
        'rose',
        'teal',
        'slate',
        'blue',
      ]),
    ).toBe('violet');
  });
});
