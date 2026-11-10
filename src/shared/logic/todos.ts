// To-dos before, during and after a trip, and moving them between templates and trips.
import { REL_ANCHORS, TODO_PHASES, type RelAnchor, type TodoPhase } from '../lookups';
import type { TemplateTodo, TodoWhen, TripTodo } from '../types';
import { dayNumber } from './dates';

const DAY_MS = 86_400_000;
const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

interface TripDates {
  start_date: string | null;
  end_date: string | null;
}

export const NO_DATE: TodoWhen = {
  date_mode: 'none',
  due_date: null,
  rel_days: null,
  rel_dir: null,
  rel_anchor: null,
};

export const WHEN_KEYS = ['date_mode', 'due_date', 'rel_days', 'rel_dir', 'rel_anchor'] as const;

/** The date mode a request means when it doesn't say: a date is fixed, days or anchors relative. */
function inferMode(w: Partial<TodoWhen>): TodoWhen['date_mode'] | undefined {
  if (w.date_mode) return w.date_mode;
  if (w.due_date) return 'fixed';
  if (w.rel_dir || w.rel_anchor || (w.rel_days !== undefined && w.rel_days !== null))
    return 'relative';
  return undefined;
}

/** Keeps only the fields the date mode uses, with defaults for a relative date. */
export function normalizeWhen(input: Partial<TodoWhen>): TodoWhen {
  const w = { ...input, date_mode: inferMode(input) };
  if (w.date_mode === 'fixed' && w.due_date)
    return { ...NO_DATE, date_mode: 'fixed', due_date: w.due_date };
  if (w.date_mode === 'relative') {
    const dir = w.rel_dir ?? 'before';
    return {
      ...NO_DATE,
      date_mode: 'relative',
      rel_dir: dir,
      rel_days: dir === 'on' ? 0 : Math.max(0, Math.round(w.rel_days ?? 0)),
      rel_anchor: w.rel_anchor ?? 'start',
    };
  }
  return { ...NO_DATE };
}

/** A stored to-do's date fields with a change applied (PATCH). */
export function mergeWhen(old: Partial<TodoWhen>, patch: Partial<TodoWhen>): TodoWhen {
  const mode = inferMode(patch) ?? old.date_mode;
  const pick = <K extends keyof TodoWhen>(k: K) => (patch[k] !== undefined ? patch[k] : old[k]);
  return normalizeWhen({
    date_mode: mode,
    due_date: pick('due_date'),
    rel_days: pick('rel_days'),
    rel_dir: pick('rel_dir'),
    rel_anchor: pick('rel_anchor'),
  });
}

/** The day a trip's start, middle or end falls on. A trip with only a start is one day long. */
function anchorDay(anchor: RelAnchor, trip: TripDates): number | null {
  const start = dayNumber(trip.start_date);
  const end = dayNumber(trip.end_date) ?? start;
  if (start === null || end === null) return null;
  if (anchor === 'start') return start;
  if (anchor === 'end') return end;
  return start + Math.floor((end - start) / 2);
}

/** A to-do's date on a trip: its fixed date, or worked out from the trip's dates. */
export function todoDueDate(w: TodoWhen, trip: TripDates): string | null {
  if (w.date_mode === 'fixed') return w.due_date;
  if (w.date_mode !== 'relative' || !w.rel_anchor) return null;
  const base = anchorDay(w.rel_anchor, trip);
  if (base === null) return null;
  const n = w.rel_dir === 'on' ? 0 : (w.rel_days ?? 0);
  return isoOf(base + (w.rel_dir === 'before' ? -n : n));
}

const ANCHOR_WORDS: Record<RelAnchor, [on: string, ref: string]> = {
  start: ['The day the trip starts', 'the trip starts'],
  middle: ['The middle of the trip', 'the middle of the trip'],
  end: ['The day the trip ends', 'the trip ends'],
};

/** A relative date in words: "3 days before the trip starts". Empty for other modes. */
export function describeRelative(w: TodoWhen): string {
  if (w.date_mode !== 'relative' || !w.rel_anchor) return '';
  const [on, ref] = ANCHOR_WORDS[w.rel_anchor];
  const n = w.rel_days ?? 0;
  if (w.rel_dir === 'on' || n === 0) return on;
  return `${n} day${n === 1 ? '' : 's'} ${w.rel_dir === 'before' ? 'before' : 'after'} ${ref}`;
}

/** Just the date fields of a to-do. */
export const whenCols = (w: TodoWhen): TodoWhen => ({
  date_mode: w.date_mode,
  due_date: w.due_date,
  rel_days: w.rel_days,
  rel_dir: w.rel_dir,
  rel_anchor: w.rel_anchor,
});

/** A to-do row before it has an id, trip and timestamps. */
export interface TodoDraft extends TodoWhen {
  title: string;
  phase: TodoPhase;
  notes: string | null;
  sort_order: number;
}

const draftOf = (t: TemplateTodo | TripTodo, when: TodoWhen): TodoDraft => ({
  title: t.title,
  phase: t.phase,
  ...when,
  notes: t.notes,
  sort_order: t.sort_order,
});

/** Template to-dos for a new trip. Relative dates follow the trip; fixed ones stay. */
export function planTodosFromTemplate(todos: TemplateTodo[]): TodoDraft[] {
  return todos.map((t) => draftOf(t, whenCols(t)));
}

/**
 * A past trip's to-dos for a new trip, all not done. Relative dates follow the new trip.
 * Fixed dates move with the trip (same number of days from its start) when both trips
 * have a start date.
 */
export function planTodosClone(todos: TripTodo[], from: TripDates, to: TripDates): TodoDraft[] {
  const a = dayNumber(from.start_date);
  const b = dayNumber(to.start_date);
  return todos.map((t) => {
    const d = dayNumber(t.due_date);
    if (t.date_mode === 'fixed' && d !== null && a !== null && b !== null)
      return draftOf(t, { ...NO_DATE, date_mode: 'fixed', due_date: isoOf(d + b - a) });
    return draftOf(t, whenCols(t));
  });
}

/**
 * A trip's to-dos for a new template. A fixed date becomes relative to the trip (before it
 * starts, after it ends, or counted from the start) so it fits any future trip.
 */
export function planTemplateTodos(todos: TripTodo[], trip: TripDates): TodoDraft[] {
  const start = dayNumber(trip.start_date);
  const end = dayNumber(trip.end_date) ?? start;
  return todos.map((t) => {
    const d = dayNumber(t.due_date);
    if (t.date_mode !== 'fixed' || d === null || start === null || end === null)
      return draftOf(t, whenCols(t));
    const rel = (rel_dir: 'before' | 'on' | 'after', rel_days: number, rel_anchor: RelAnchor) =>
      draftOf(t, { ...NO_DATE, date_mode: 'relative', rel_dir, rel_days, rel_anchor });
    if (d < start) return rel('before', start - d, 'start');
    if (d > end) return rel('after', d - end, 'end');
    return d === start ? rel('on', 0, 'start') : rel('after', d - start, 'start');
  });
}

const phaseRank = (p: TodoPhase) => TODO_PHASES.indexOf(p);
const LAST = '￿';

/** Trip to-dos by phase, then date (undated last), then the order they were added. */
export function sortTripTodos<T extends TripTodo>(todos: readonly T[], trip: TripDates): T[] {
  const date = new Map(todos.map((t) => [t, todoDueDate(t, trip) ?? LAST]));
  return [...todos].sort(
    (a, b) =>
      phaseRank(a.phase) - phaseRank(b.phase) ||
      date.get(a)!.localeCompare(date.get(b)!) ||
      a.sort_order - b.sort_order,
  );
}

/** Template to-dos in the order they'd fall on a trip; fixed dates after relative, undated last. */
export function sortTemplateTodos<T extends TemplateTodo>(todos: readonly T[]): T[] {
  const rank = (t: T) =>
    t.date_mode === 'relative' && t.rel_anchor ? 0 : t.date_mode === 'fixed' && t.due_date ? 1 : 2;
  const offset = (t: T) => {
    const n = t.rel_dir === 'on' ? 0 : (t.rel_days ?? 0);
    return (
      REL_ANCHORS.indexOf(t.rel_anchor ?? 'start') * 100_000 + (t.rel_dir === 'before' ? -n : n)
    );
  };
  return [...todos].sort(
    (a, b) =>
      phaseRank(a.phase) - phaseRank(b.phase) ||
      rank(a) - rank(b) ||
      (rank(a) === 0 ? offset(a) - offset(b) : 0) ||
      (rank(a) === 1 ? a.due_date!.localeCompare(b.due_date!) : 0) ||
      a.sort_order - b.sort_order,
  );
}

/** Where a trip is relative to today: before it starts, under way, or over. */
export function tripStage(trip: TripDates, today: string): 'before' | 'during' | 'after' {
  const t = dayNumber(today);
  const start = dayNumber(trip.start_date);
  const end = dayNumber(trip.end_date) ?? start;
  if (t === null || start === null || end === null || t < start) return 'before';
  return t <= end ? 'during' : 'after';
}
