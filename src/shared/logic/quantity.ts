import type { QtyMode } from '../lookups';

export interface Calc {
  mode: QtyMode;
  unitQty: number;
  max: number | null;
  /** Added to a per-day or per-night count before the cap ("1 per day, plus 2"). Can be negative. */
  offset?: number;
}

export interface LengthLike {
  days: number | null;
  nights: number | null;
}

export function resolveCalc(
  item: { qty_mode: QtyMode; qty: number; max_qty: number | null; qty_offset?: number },
  override?: {
    qty_mode_override: QtyMode | null;
    qty_override: number | null;
    qty_offset_override?: number | null;
  } | null,
): Calc {
  return {
    mode: override?.qty_mode_override ?? item.qty_mode,
    unitQty: override?.qty_override ?? item.qty,
    max: item.max_qty,
    offset: override?.qty_offset_override ?? item.qty_offset ?? 0,
  };
}

/**
 * fixed → unitQty; per_day → unitQty × days + offset; per_night → unitQty × nights + offset;
 * capped at max, rounded up, never below 0. Null when the trip length it needs is unknown.
 */
export function calcQty(calc: Calc, len: LengthLike | null | undefined): number | null {
  let raw: number;
  if (calc.mode === 'fixed') raw = calc.unitQty;
  else {
    const n = calc.mode === 'per_day' ? len?.days : len?.nights;
    if (n === null || n === undefined) return null;
    raw = Math.max(0, calc.unitQty * n + (calc.offset ?? 0));
  }
  if (calc.max !== null && calc.max !== undefined) raw = Math.min(raw, calc.max);
  // Trim float noise (0.1 × 30 = 3.0000000000000004) before rounding up.
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
}

export function displayQty(row: {
  qty: number | null;
  qty_override: number | null;
}): number | null {
  return row.qty_override ?? row.qty;
}

export interface CalcRow {
  id: string;
  calc_mode: QtyMode | null;
  calc_unit_qty: number | null;
  calc_max: number | null;
  calc_offset?: number | null;
  qty: number | null;
}

/** Recomputes qty for rows that have a calc snapshot. Returns only rows whose qty changed. */
export function recalcRows(
  rows: CalcRow[],
  len: LengthLike | null,
): { id: string; qty: number | null }[] {
  const out: { id: string; qty: number | null }[] = [];
  for (const r of rows) {
    if (!r.calc_mode || r.calc_unit_qty === null) continue;
    const qty = calcQty(rowCalc(r), len);
    if (qty !== r.qty) out.push({ id: r.id, qty });
  }
  return out;
}

/** The calc snapshot stored on a trip-item row. */
export function rowCalc(
  r: Pick<CalcRow, 'calc_mode' | 'calc_unit_qty' | 'calc_max' | 'calc_offset'>,
): Calc {
  return {
    mode: r.calc_mode ?? 'fixed',
    unitQty: r.calc_unit_qty ?? 0,
    max: r.calc_max,
    offset: r.calc_offset ?? 0,
  };
}

/** "1/day +2", "×3": a short summary of a quantity rule. */
export function calcSummary(calc: Calc): string {
  if (calc.mode === 'fixed') return `×${calc.unitQty}`;
  const off = calc.offset ?? 0;
  return `${calc.unitQty}${calc.mode === 'per_day' ? '/day' : '/night'}${off ? ` ${off > 0 ? '+' : '−'}${Math.abs(off)}` : ''}`;
}
