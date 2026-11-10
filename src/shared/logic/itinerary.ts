// Itinerary times: local dates and times in each place's time zone, turned into real instants
// so flight lengths and layovers come out right across zones and DST changes.
import type { EntryEnd, ItineraryEntry, ItinerarySection } from '../types';
import { dayNumber } from './dates';

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

const offsetCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = offsetCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    offsetCache.set(tz, f);
  }
  return f;
}

/** Minutes the zone is ahead of UTC at an instant. */
export function zoneOffset(ms: number, tz: string): number {
  const p = Object.fromEntries(
    fmt(tz)
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  return Math.round((asUtc - Math.floor(ms / MIN_MS) * MIN_MS) / MIN_MS);
}

export function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** The instant a local date and time happens in a time zone (UTC when there's none). */
export function zonedInstant(date: string, time: string, tz: string | null): number | null {
  const day = dayNumber(date);
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (day === null || !m) return null;
  const local = day * 86_400_000 + (+m[1]! * 60 + +m[2]!) * MIN_MS;
  if (!isTimeZone(tz)) return local;
  // The zone's offset a day either side covers any DST change near this time. A candidate is
  // right when it reads back as the same local time. Two right answers (the repeated hour when
  // clocks go back): the first. None (the hour skipped when clocks go forward): read the time
  // with the offset from before the change, which moves it forward, as clocks do.
  const before = zoneOffset(local - DAY_MS, tz);
  const after = zoneOffset(local + DAY_MS, tz);
  const fits = [...new Set([before, after])]
    .map((o) => local - o * MIN_MS)
    .filter((t) => t + zoneOffset(t, tz) * MIN_MS === local)
    .sort((x, y) => x - y);
  return fits[0] ?? local - before * MIN_MS;
}

/** An instant's local date ("2027-06-03") and time ("21:40") in a time zone. */
export function localIn(at: number, tz: string): { date: string; time: string } {
  const p = Object.fromEntries(
    fmt(tz)
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** When an end happens, if it has a date and a time. */
export const endInstant = (e: EntryEnd): number | null =>
  e.date && e.time ? zonedInstant(e.date, e.time, e.tz) : null;

/** Sort key: the real instant when there's a time, else noon on the date. Undated: Infinity. */
export function sortKey(e: ItineraryEntry): number {
  const at = endInstant(e.start);
  if (at !== null) return at;
  const day = dayNumber(e.start.date);
  return day === null ? Infinity : day * 86_400_000 + 12 * 3_600_000;
}

/**
 * Flight B continues flight A: B leaves within a day of A landing, and isn't a flight back
 * to where A started (that's a day trip, not a connection).
 */
function continues(a: ItineraryEntry, b: ItineraryEntry): boolean {
  if (a.id === b.id || a.kind !== 'transport' || b.kind !== 'transport') return false;
  if (a.mode !== 'plane' || b.mode !== 'plane') return false;
  const x = endInstant(a.end);
  const y = endInstant(b.start);
  if (x === null || y === null || y < x || y - x > DAY_MS) return false;
  const home = a.start.code;
  return !(home && b.end.code && home === b.end.code);
}

/** Connecting flights: each flight that continues another, keyed by the one it continues. */
export function connectingFlights(entries: readonly ItineraryEntry[]): Map<string, string> {
  const flights = entries
    .filter((e) => e.kind === 'transport' && e.mode === 'plane' && endInstant(e.start) !== null)
    .sort((a, b) => endInstant(a.start)! - endInstant(b.start)!);
  const next = new Map<string, string>();
  for (const b of flights) {
    // The flight it continues: the last one to land before it leaves.
    let best: ItineraryEntry | null = null;
    for (const a of flights)
      if (
        !next.has(a.id) &&
        continues(a, b) &&
        (!best || endInstant(a.end)! > endInstant(best.end)!)
      )
        best = a;
    if (best) next.set(best.id, b.id);
  }
  return next;
}

/** Keeps a list's order, but pulls each connecting flight up to right after the one it continues. */
export function keepConnections<T extends ItineraryEntry>(list: readonly T[]): T[] {
  const next = connectingFlights(list);
  const follows = new Set(next.values());
  const byId = new Map(list.map((e) => [e.id, e]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (follows.has(e.id)) continue;
    for (let cur: T | undefined = e; cur && !seen.has(cur.id);) {
      out.push(cur);
      seen.add(cur.id);
      const n = next.get(cur.id);
      cur = n ? byId.get(n) : undefined;
    }
  }
  // Anything left (only possible with odd data): keep it, in place order.
  for (const e of list) if (!seen.has(e.id)) out.push(e);
  return out;
}

/**
 * A section's entries in order: as arranged (dragged, or placed by time when added), with
 * each connecting flight right after the flight it continues.
 */
export function orderEntries<T extends ItineraryEntry>(entries: readonly T[]): T[] {
  return keepConnections([...entries].sort((a, b) => a.sort_order - b.sort_order));
}

/**
 * Puts an entry into an ordered list where its time falls: before the first dated entry
 * that starts later, else after the last dated one. Undated entries go last.
 */
export function placeByTime<T extends ItineraryEntry>(list: readonly T[], e: T): T[] {
  const rest = list.filter((x) => x.id !== e.id);
  const key = sortKey(e);
  let at = rest.length;
  if (key !== Infinity) {
    const later = rest.findIndex((x) => sortKey(x) !== Infinity && sortKey(x) > key);
    if (later >= 0) at = later;
    else {
      let last = -1;
      rest.forEach((x, i) => sortKey(x) !== Infinity && (last = i));
      at = last >= 0 ? last + 1 : rest.length;
    }
  }
  return [...rest.slice(0, at), e, ...rest.slice(at)];
}

export const sortSections = <T extends ItinerarySection>(s: readonly T[]): T[] =>
  [...s].sort((a, b) => a.sort_order - b.sort_order);

/** Minutes from start to end, across time zones. Null without both dates and times. */
export function entryMinutes(e: ItineraryEntry): number | null {
  const a = endInstant(e.start);
  const b = endInstant(e.end);
  return a === null || b === null || b < a ? null : Math.round((b - a) / MIN_MS);
}

/** How many local calendar days later the end is: the "+1" on an overnight flight. */
export function dayShift(e: ItineraryEntry): number {
  const a = dayNumber(e.start.date);
  const b = dayNumber(e.end.date);
  return a === null || b === null ? 0 : b - a;
}

/** "6h 25m", "55m", "2d 3h". */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d}d${h ? ` ${h}h` : ''}`;
  return `${h}h${m ? ` ${m}m` : ''}`;
}

export interface Connection {
  /** The entry the layover comes after. */
  after: string;
  minutes: number;
  /** Where you wait: the arrival's code or place. */
  at: string | null;
  /** Arrive at one airport or station and leave from another. */
  change: { from: string; to: string } | null;
}

/** Layovers between back-to-back transport entries in a section (a gap of up to a day). */
export function connections(ordered: readonly ItineraryEntry[]): Connection[] {
  const out: Connection[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const next = ordered[i]!;
    if (prev.kind !== 'transport' || next.kind !== 'transport') continue;
    // A drive or a taxi after a flight isn't a layover.
    if (prev.mode === 'car' || next.mode === 'car') continue;
    const a = endInstant(prev.end);
    const b = endInstant(next.start);
    if (a === null || b === null || b < a || b - a > 24 * 60 * MIN_MS) continue;
    const from = prev.end.code ?? prev.end.place;
    const to = next.start.code ?? next.start.place;
    out.push({
      after: prev.id,
      minutes: Math.round((b - a) / MIN_MS),
      at: prev.end.place ?? prev.end.code,
      change: from && to && from.toLowerCase() !== to.toLowerCase() ? { from, to } : null,
    });
  }
  return out;
}

/** The first entry that hasn't finished yet: what's next on the trip. */
export function nextEntry(sections: readonly ItinerarySection[], now: number): string | null {
  for (const s of sortSections(sections))
    for (const e of orderEntries(s.entries)) {
      const end = endInstant(e.end) ?? endInstant(e.start);
      const day = dayNumber(e.end.date ?? e.start.date);
      if (end !== null ? end >= now : day !== null && (day + 1) * 86_400_000 > now) return e.id;
    }
  return null;
}

/** "TAP 204", or "Boston → Lisbon", or the entry's title. */
export function entryName(e: ItineraryEntry): string {
  if (e.kind === 'transport') {
    const num = [e.carrier, e.number].filter(Boolean).join(' ');
    if (e.title) return e.title;
    if (num) return num;
    const route = [e.start.code ?? e.start.place, e.end.code ?? e.end.place].filter(Boolean);
    return route.length ? route.join(' → ') : 'Transport';
  }
  return e.title ?? (e.kind === 'lodging' ? 'Lodging' : e.kind === 'note' ? 'Note' : 'Plan');
}

/**
 * The zone a new or zoneless entry in a section most likely uses: the last one before it on
 * the trip (in order), else the first one after it. Null when the trip has no zones at all.
 */
export function likelyZone(
  sections: readonly ItinerarySection[],
  sectionId: string,
  before?: string,
): string | null {
  let last: string | null = null;
  let after: string | null = null;
  let passed = false;
  for (const s of sortSections(sections)) {
    for (const e of orderEntries(s.entries)) {
      if (s.id === sectionId && e.id === before) passed = true;
      const z = e.end.tz ?? e.start.tz;
      if (!z) continue;
      if (!passed) last = z;
      else after ??= z;
    }
    if (s.id === sectionId && !before) passed = true;
  }
  return last ?? after;
}

/**
 * Entries with a time but no zone (an assistant left it out, say): the zone they most likely
 * use, so their times aren't read as UTC. Each end takes the entry's other end's zone first,
 * then the trip's neighbouring entries.
 */
export function missingZones(
  sections: readonly ItinerarySection[],
): { id: string; start_tz?: string; end_tz?: string }[] {
  const out: { id: string; start_tz?: string; end_tz?: string }[] = [];
  for (const s of sections)
    for (const e of s.entries) {
      const needStart = !e.start.tz && !!(e.start.time || e.start.date);
      const needEnd = !e.end.tz && !!(e.end.time || e.end.date);
      if (!needStart && !needEnd) continue;
      const near = e.start.tz ?? e.end.tz ?? likelyZone(sections, s.id, e.id);
      if (!near) continue;
      out.push({
        id: e.id,
        ...(needStart ? { start_tz: e.end.tz ?? near } : {}),
        ...(needEnd ? { end_tz: e.start.tz ?? near } : {}),
      });
    }
  return out;
}
