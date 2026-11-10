// What Duffel's notifications say and when: "Get packing" a week out, the day's to-dos, and the
// day's itinerary on a trip, plus the app-icon count (open to-dos due today or overdue).
// Sending, the 8 a.m. timing and once-a-day are the Selfhost Kit's (src/worker/kit/push.ts).
import type { ItineraryEntry, ItinerarySection, Trip, TripTodo } from '../types';
import { dayNumber } from './dates';
import { endInstant, entryName, localIn, orderEntries, sortSections } from './itinerary';
import { itineraryRows, type ItineraryRow } from './itineraryRows';
import { todoDueDate, tripStage } from './todos';

/** The kinds of notification, each with its own switch in Settings. */
export const NOTIFY_KINDS = [
  { id: 'packing', label: 'Get packing', description: 'A week before each trip starts.' },
  { id: 'todos', label: 'To-dos due today', description: 'A morning list of the day’s to-dos.' },
  {
    id: 'itinerary',
    label: 'Today’s itinerary',
    description: 'Each morning of a trip, the day’s plans.',
  },
] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number]['id'];

/** What the app-icon count counts, for the ⓘ in Settings. */
export const BADGE_MEANS = 'how many to-dos are due today or overdue';

export interface Notice {
  kind: NotifyKind;
  /** What it's about (once per day each): a trip id, or "today". */
  key: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

type TripDates = Pick<Trip, 'start_date' | 'end_date' | 'archived_at'>;

/** A trip that still matters: not archived by hand, and not over for more than a week. */
export function isLive(t: TripDates, today: string): boolean {
  if (t.archived_at) return false;
  const end = dayNumber(t.end_date ?? t.start_date);
  const now = dayNumber(today);
  return end === null || now === null || now - end <= 7;
}

/** Joins items up to about `max` characters, ending with "…" when some are left out. */
function listUpTo(items: string[], sep: string, max: number): string {
  let out = '';
  for (const [i, s] of items.entries()) {
    const next = out ? `${out}${sep}${s}` : s;
    if (next.length > max && i > 0) return `${out}${sep}…`;
    out = next;
  }
  return out;
}

/** "Get packing": each trip that starts exactly a week from today. */
export function packingNotices(trips: readonly Trip[], today: string): Notice[] {
  const now = dayNumber(today);
  if (now === null) return [];
  return trips
    .filter((t) => isLive(t, today) && dayNumber(t.start_date) === now + 7)
    .filter((t) => !(t.item_count > 0 && t.packed_count === t.item_count))
    .map((t) => ({
      kind: 'packing',
      key: t.id,
      title: 'Get packing',
      body: `${t.name} starts in a week. Time to start packing.`,
      url: `/trips/${t.id}?view=packing`,
      tag: `packing-${t.id}`,
    }));
}

/** Open to-dos and their dates, on trips that still matter. */
function datedTodos(trips: readonly Trip[], todos: readonly TripTodo[], today: string) {
  const byId = new Map(trips.filter((t) => isLive(t, today)).map((t) => [t.id, t]));
  const out: { todo: TripTodo; trip: Trip; due: string }[] = [];
  for (const todo of todos) {
    const trip = byId.get(todo.trip_id);
    if (!trip || todo.done) continue;
    const due = todoDueDate(todo, trip);
    if (due) out.push({ todo, trip, due });
  }
  return out;
}

/** The app-icon count: open to-dos due today or earlier. */
export function badgeCount(trips: readonly Trip[], todos: readonly TripTodo[], today: string) {
  return datedTodos(trips, todos, today).filter((x) => x.due <= today).length;
}

/** "3 to-dos today: Book the kennel, Pick up euros, Charge the camera". */
export function todosNotice(
  trips: readonly Trip[],
  todos: readonly TripTodo[],
  today: string,
): Notice | null {
  const due = datedTodos(trips, todos, today)
    .filter((x) => x.due === today)
    .sort(
      (a, b) =>
        (a.trip.start_date ?? '').localeCompare(b.trip.start_date ?? '') ||
        a.trip.name.localeCompare(b.trip.name) ||
        a.todo.sort_order - b.todo.sort_order,
    );
  if (!due.length) return null;
  const tripIds = [...new Set(due.map((x) => x.trip.id))];
  const one = tripIds.length === 1 ? due[0]!.trip : null;
  const n = due.length;
  return {
    kind: 'todos',
    key: 'today',
    title: one ? one.name : 'To-dos today',
    body: `${n} to-do${n === 1 ? '' : 's'} today: ${listUpTo(
      due.map((x) => x.todo.title),
      ', ',
      150,
    )}`,
    url: one ? `/trips/${one.id}?view=todos` : '/',
    tag: 'todos-today',
  };
}

/**
 * Where the trip is now: the zone of the last thing that's started (a flight that's landed
 * counts where it landed). Null when the itinerary has no zones.
 */
export function tripZoneNow(sections: readonly ItinerarySection[], now: number): string | null {
  let zone: string | null = null;
  let first: string | null = null;
  for (const s of sortSections(sections))
    for (const e of orderEntries(s.entries)) {
      first ??= e.start.tz ?? e.end.tz;
      const start = endInstant(e.start);
      if (start === null || start > now) continue;
      const end = endInstant(e.end);
      const landed = e.kind === 'transport' && end !== null && end <= now;
      zone = (landed ? (e.end.tz ?? e.start.tz) : (e.start.tz ?? e.end.tz)) ?? zone;
    }
  return zone ?? first;
}

const MODE_WORD: Record<string, string> = {
  plane: 'Flight',
  train: 'Train',
  bus: 'Bus',
  boat: 'Ferry',
};

const clock = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** "21:40" → "9:40 PM". */
export function clockText(hhmm: string | null): string {
  const m = hhmm && /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? clock.format(Date.UTC(2000, 0, 1, +m[1]!, +m[2]!)) : '';
}

/** One itinerary line in a few words: "9:40 AM Flight TP 1234", "Check in at Hotel Avenida". */
export function rowText(r: ItineraryRow): string {
  const e: ItineraryEntry = r.entry;
  let what = entryName(e);
  if (e.kind === 'transport' && !e.title && e.number && e.mode && MODE_WORD[e.mode])
    what = `${MODE_WORD[e.mode]} ${[e.carrier, e.number].filter(Boolean).join(' ')}`;
  if (r.part === 'in') what = e.title ? `Check in at ${e.title}` : 'Check in';
  if (r.part === 'out') what = e.title ? `Check out of ${e.title}` : 'Check out';
  const time = clockText(r.part === 'out' ? e.end.time : e.start.time);
  return time ? `${time} ${what}` : what;
}

/**
 * Today's itinerary on a trip that's under way, by the trip's own clock (where it is now, else
 * `fallbackTz`). Null when the trip isn't on or nothing is planned today.
 */
export function itineraryNotice(
  trip: Trip,
  sections: readonly ItinerarySection[],
  now: number,
  fallbackTz: string,
): (Notice & { tz: string }) | null {
  const tz = tripZoneNow(sections, now) ?? fallbackTz;
  const today = localIn(now, tz).date;
  if (!isLive(trip, today) || tripStage(trip, today) !== 'during') return null;
  const lines: string[] = [];
  let place: string | null = null;
  for (const s of sortSections(sections)) {
    const rows = itineraryRows(orderEntries(s.entries)).filter((r) => r.date === today);
    if (!rows.length) continue;
    if (s.kind === 'stay') place ??= s.title;
    lines.push(...rows.map(rowText));
  }
  if (!lines.length) return null;
  place ??= trip.destination;
  return {
    kind: 'itinerary',
    key: trip.id,
    tz,
    title: trip.name,
    body: `${place ? `Today in ${place}` : 'Today'}: ${listUpTo(lines, ' · ', 160)}`,
    url: `/trips/${trip.id}?view=itinerary&day=${today}`,
    tag: `itinerary-${trip.id}`,
  };
}
