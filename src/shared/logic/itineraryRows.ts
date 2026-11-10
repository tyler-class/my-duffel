// The lines of an itinerary section, shared by the app and the PDF: a stay with a check-out
// shows twice (at check-in and at check-out) so the days read in order.
import type { EntryEnd, ItineraryEntry, ItinerarySection } from '../types';
import { dayNumber } from './dates';
import { endInstant } from './itinerary';

const DAY = 86_400_000;

export interface ItineraryRow {
  key: string;
  entry: ItineraryEntry;
  part: 'all' | 'in' | 'out';
  /** The day it's shown under. */
  date: string | null;
  /** When it starts and ends, for sorting and "Next". */
  from: number;
  until: number;
}

/** When an end happens: its instant, or its day (start or end of it) when there's no time. */
function when(e: EntryEnd, endOfDay: boolean): number {
  const at = endInstant(e);
  if (at !== null) return at;
  const d = dayNumber(e.date);
  return d === null ? Infinity : d * DAY + (endOfDay ? DAY - 1 : DAY / 2);
}

/**
 * The lines of a section, in the entries' order. A check-out goes where its time falls:
 * after the last line that starts before it.
 */
export function itineraryRows(entries: readonly ItineraryEntry[]): ItineraryRow[] {
  const rows: ItineraryRow[] = [];
  const outs: ItineraryRow[] = [];
  for (const e of entries) {
    const split = e.kind === 'lodging' && !!e.end.date;
    rows.push({
      key: e.id,
      entry: e,
      part: split ? 'in' : 'all',
      date: e.start.date,
      from: when(e.start, false),
      until: split || !e.end.date ? when(e.start, true) : when(e.end, true),
    });
    if (split)
      outs.push({
        key: `${e.id}:out`,
        entry: e,
        part: 'out',
        date: e.end.date,
        from: when(e.end, false),
        until: when(e.end, true),
      });
  }
  for (const out of outs) {
    const own = rows.findIndex((r) => r.entry.id === out.entry.id);
    let at = own + 1;
    rows.forEach((r, i) => {
      if (i > own && r.from !== Infinity && r.from <= out.from) at = i + 1;
    });
    rows.splice(at, 0, out);
  }
  return rows;
}

/** A section's first and last day, from its entries. */
export function sectionDays(s: ItinerarySection): [string, string] | null {
  const days = s.entries
    .flatMap((e) => [e.start.date, e.end.date])
    .filter((d): d is string => !!d)
    .sort();
  return days.length ? [days[0]!, days[days.length - 1]!] : null;
}
