import { dayNumber, type PackChoice } from '@shared/logic';
import type { AutoPackFallback } from '@shared/lookups';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(d: string) {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { y, m, day };
}

export function formatDate(d: string | null): string {
  if (!d || dayNumber(d) === null) return '';
  const { m, day } = parts(d);
  return `${MONTHS[m - 1]} ${day}`;
}

/** "Dec 12 – 19", "Dec 30 – Jan 2", "Dec 12" */
export function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  if (!start || !end) return formatDate(start ?? end);
  const a = parts(start);
  const b = parts(end);
  if (start === end) return formatDate(start);
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.day} – ${b.day}`;
  const yearNote = a.y !== b.y ? ` ${b.y}` : '';
  return `${MONTHS[a.m - 1]} ${a.day} – ${MONTHS[b.m - 1]} ${b.day}${yearNote}`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** What an auto pack choice does, for the hint under the picker. */
export function packHint(c: PackChoice, fallback: AutoPackFallback): string {
  if (c === 'none') return 'Car seats, strollers: travels outside any bag.';
  if (c === 'main') return 'Goes in its person’s suitcase, or their duffel or backpack.';
  if (c === 'carry_on') return 'Goes into its person’s carry-on bag.';
  const t = c.type.toLowerCase();
  return `Goes into its person’s ${t}, or a shared ${t}. If there’s none on the trip, ${
    fallback === 'main'
      ? 'it goes in their luggage instead'
      : 'it waits in No bag yet until you add one'
  } (see Settings).`;
}

/** "Mia: 3 items with no diaper bag". */
export function gapText(g: { carry: boolean; pack_type: string | null; count: number }): string {
  if (g.pack_type) return `${plural(g.count, 'item')} with no ${g.pack_type.toLowerCase()}`;
  return `${plural(g.count, g.carry ? 'carry-on item' : 'item')} with no ${g.carry ? 'carry-on' : 'checked'} bag`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu, Dec 10" */
export function formatDay(d: string | null): string {
  const n = dayNumber(d);
  if (n === null || !d) return '';
  return `${WEEKDAYS[(n + 4) % 7]}, ${formatDate(d)}`;
}
