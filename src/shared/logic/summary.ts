// Read-side calculations shared by the Pack screen and the API.
import type { Suitcase, TripBag, TripItem } from '../types';
import { dayNumber } from './dates';
import { displayQty } from './quantity';

export interface TripLike {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
  item_count: number;
  packed_count: number;
}

/** Archived when archived by hand, fully packed, or ended more than 7 days ago. */
export function isArchived(t: TripLike, today: string): boolean {
  if (t.archived_at) return true;
  if (t.item_count > 0 && t.packed_count === t.item_count) return true;
  const end = dayNumber(t.end_date);
  const now = dayNumber(today);
  return end !== null && now !== null && now - end > 7;
}

export function splitTrips<T extends TripLike>(
  trips: T[],
  today: string,
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const t of trips) (isArchived(t, today) ? archived : active).push(t);
  const start = (t: T) => dayNumber(t.start_date) ?? Infinity;
  const end = (t: T) => dayNumber(t.end_date) ?? -Infinity;
  active.sort((a, b) => start(a) - start(b) || a.name.localeCompare(b.name));
  archived.sort((a, b) => end(b) - end(a) || a.name.localeCompare(b.name));
  return { active, archived };
}

/** First active trip, else the most recent archived one. */
export function defaultTripId(trips: TripLike[], today: string): string | null {
  const { active, archived } = splitTrips(trips, today);
  return active[0]?.id ?? archived[0]?.id ?? null;
}

type Row = Pick<TripItem, 'packed' | 'trip_bag_id' | 'no_bag'>;

export function isCarryOn(
  row: Pick<TripItem, 'trip_bag_id'>,
  bags: Map<string, Pick<TripBag, 'carry_on'>>,
): boolean {
  return row.trip_bag_id ? (bags.get(row.trip_bag_id)?.carry_on ?? false) : false;
}

export function progress(rows: Row[], bags: Map<string, Pick<TripBag, 'carry_on'>>) {
  let done = 0;
  let carryTotal = 0;
  let carryDone = 0;
  for (const r of rows) {
    if (r.packed) done++;
    if (isCarryOn(r, bags)) {
      carryTotal++;
      if (r.packed) carryDone++;
    }
  }
  return { done, total: rows.length, carryDone, carryTotal };
}

/** Rows still waiting for a bag (not explicitly "no bag"). */
export function unassignedCount(rows: Pick<TripItem, 'trip_bag_id' | 'no_bag'>[]): number {
  return rows.filter((r) => !r.trip_bag_id && !r.no_bag).length;
}

export const CUBIC_INCH_TO_LITER = 0.0163871;

export interface FitRow extends Pick<TripItem, 'trip_bag_id' | 'no_bag' | 'qty' | 'qty_override'> {
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
}

export interface BagFit {
  usedL: number;
  capacityL: number | null;
  pct: number | null;
  warn: boolean;
  itemCount: number;
  missingDims: number;
}

/** Estimated volume of a bag's items against its suitcase's capacity. */
export function bagFit(
  bagId: string,
  suitcase: Pick<Suitcase, 'capacity_l'> | null,
  rows: FitRow[],
): BagFit {
  let cubicIn = 0;
  let itemCount = 0;
  let missingDims = 0;
  for (const r of rows) {
    if (r.trip_bag_id !== bagId || r.no_bag) continue;
    itemCount++;
    const q = displayQty(r) ?? 1;
    if (r.length_in && r.width_in && r.height_in)
      cubicIn += r.length_in * r.width_in * r.height_in * q;
    else missingDims++;
  }
  const usedL = Math.round(cubicIn * CUBIC_INCH_TO_LITER * 10) / 10;
  const capacityL = suitcase?.capacity_l ?? null;
  const pct = capacityL ? Math.round((usedL / capacityL) * 100) : null;
  return { usedL, capacityL, pct, warn: pct !== null && pct > 90, itemCount, missingDims };
}
