import { describe, expect, it } from 'vitest';
import { calcQty, displayQty, recalcRows, resolveCalc } from '../../src/shared/logic';

const len = { days: 8, nights: 7 };

describe('calcQty', () => {
  it('fixed ignores trip length', () => {
    expect(calcQty({ mode: 'fixed', unitQty: 2, max: null }, len)).toBe(2);
    expect(calcQty({ mode: 'fixed', unitQty: 2, max: null }, null)).toBe(2);
  });
  it('scales per day and per night', () => {
    expect(calcQty({ mode: 'per_day', unitQty: 8, max: null }, len)).toBe(64);
    expect(calcQty({ mode: 'per_night', unitQty: 1, max: null }, len)).toBe(7);
  });
  it('caps at max', () => {
    expect(calcQty({ mode: 'per_day', unitQty: 1, max: 5 }, len)).toBe(5);
    expect(calcQty({ mode: 'per_day', unitQty: 1, max: 10 }, len)).toBe(8);
  });
  it('rounds up fractional counts without float noise', () => {
    expect(calcQty({ mode: 'per_day', unitQty: 0.5, max: null }, { days: 3, nights: 2 })).toBe(2);
    expect(calcQty({ mode: 'per_day', unitQty: 0.1, max: null }, { days: 30, nights: 29 })).toBe(3);
  });
  it('adds a positive or negative offset before the cap, never below 0', () => {
    expect(calcQty({ mode: 'per_day', unitQty: 1, max: null, offset: 2 }, len)).toBe(10);
    expect(calcQty({ mode: 'per_night', unitQty: 1, max: null, offset: -2 }, len)).toBe(5);
    expect(calcQty({ mode: 'per_day', unitQty: 1, max: 9, offset: 2 }, len)).toBe(9);
    expect(calcQty({ mode: 'per_day', unitQty: 1, max: null, offset: -20 }, len)).toBe(0);
  });
  it('ignores the offset for fixed counts', () => {
    expect(calcQty({ mode: 'fixed', unitQty: 2, max: null, offset: 3 }, len)).toBe(2);
  });
  it('returns null when the needed length is unknown', () => {
    expect(calcQty({ mode: 'per_day', unitQty: 1, max: null }, null)).toBeNull();
    expect(
      calcQty({ mode: 'per_night', unitQty: 1, max: null }, { days: 3, nights: null }),
    ).toBeNull();
  });
});

describe('resolveCalc', () => {
  const item = { qty_mode: 'per_day' as const, qty: 8, max_qty: 40 };
  it('uses item defaults', () => {
    expect(resolveCalc(item)).toEqual({ mode: 'per_day', unitQty: 8, max: 40, offset: 0 });
    expect(resolveCalc({ ...item, qty_offset: 2 }).offset).toBe(2);
  });
  it('applies template overrides', () => {
    expect(resolveCalc(item, { qty_mode_override: 'fixed', qty_override: 3 })).toEqual({
      mode: 'fixed',
      unitQty: 3,
      max: 40,
      offset: 0,
    });
    expect(resolveCalc(item, { qty_mode_override: null, qty_override: 6 })).toEqual({
      mode: 'per_day',
      unitQty: 6,
      max: 40,
      offset: 0,
    });
  });
  it('a template offset overrides the catalog offset; null inherits it', () => {
    const it2 = { ...item, qty_offset: 2 };
    const o = { qty_mode_override: null, qty_override: null };
    expect(resolveCalc(it2, { ...o, qty_offset_override: -1 }).offset).toBe(-1);
    expect(resolveCalc(it2, { ...o, qty_offset_override: null }).offset).toBe(2);
  });
});

describe('displayQty / recalcRows', () => {
  it('override wins', () => {
    expect(displayQty({ qty: 7, qty_override: 3 })).toBe(3);
    expect(displayQty({ qty: 7, qty_override: null })).toBe(7);
  });
  it('recalculates only rows with a calc snapshot that changed', () => {
    const rows = [
      { id: 'a', calc_mode: 'per_day' as const, calc_unit_qty: 1, calc_max: null, qty: 8 },
      { id: 'b', calc_mode: 'fixed' as const, calc_unit_qty: 2, calc_max: null, qty: 2 },
      { id: 'c', calc_mode: null, calc_unit_qty: null, calc_max: null, qty: 4 },
      { id: 'd', calc_mode: 'per_night' as const, calc_unit_qty: 1, calc_max: 3, qty: 3 },
      {
        id: 'e',
        calc_mode: 'per_day' as const,
        calc_unit_qty: 1,
        calc_max: null,
        calc_offset: 2,
        qty: 10,
      },
    ];
    expect(recalcRows(rows, { days: 4, nights: 3 })).toEqual([
      { id: 'a', qty: 4 },
      { id: 'e', qty: 6 },
    ]);
    expect(recalcRows(rows, null)).toEqual([
      { id: 'a', qty: null },
      { id: 'd', qty: null },
      { id: 'e', qty: null },
    ]);
  });
});
