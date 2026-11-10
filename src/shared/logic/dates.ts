// Date-only math on YYYY-MM-DD strings. Everything goes through UTC so local
// timezones and DST changes can never shift a day.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since the Unix epoch for a YYYY-MM-DD string, or null if it isn't a real date. */
export function dayNumber(date: string | null | undefined): number | null {
  if (!date) return null;
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const t = Date.UTC(y, mo, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo || back.getUTCDate() !== d)
    return null;
  return t / DAY_MS;
}

export function isISODate(date: string): boolean {
  return dayNumber(date) !== null;
}

export interface TripLength {
  days: number;
  nights: number;
}

/** days = end − start + 1, nights = end − start. Null when either date is missing or end < start. */
export function tripLength(
  start: string | null | undefined,
  end: string | null | undefined,
): TripLength | null {
  const a = dayNumber(start);
  const b = dayNumber(end);
  if (a === null || b === null || b < a) return null;
  return { days: b - a + 1, nights: b - a };
}

/** Today's date in the caller's local timezone as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
