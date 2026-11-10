// Showing itinerary times: local "9:40 PM" as on the booking, or converted to this device's zone.
import { useEffect, useState } from 'react';
import {
  endInstant,
  likelyZone as sharedLikelyZone,
  localIn,
  type AirportData,
} from '@shared/logic';
import type { EntryEnd, ItinerarySection } from '@shared/types';

export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const clock = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** "21:40" → "9:40 PM" (in the viewer's locale). */
export function formatClock(hhmm: string | null): string {
  const m = hhmm && /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return '';
  return clock.format(Date.UTC(2000, 0, 1, +m[1]!, +m[2]!));
}

/** "EDT", "GMT+1": a zone's short name at an instant. */
export function zoneName(tz: string, at: number): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? tz
    );
  } catch {
    return tz;
  }
}

/** An end's time in this device's zone: "6:40 PM" plus the date when it differs. */
export function homeTime(e: EntryEnd, tz = deviceZone()): { time: string; date: string } | null {
  // Without a zone the time can't be converted: show it as written.
  if (!e.tz) return null;
  const at = endInstant(e);
  return at === null ? null : localIn(at, tz);
}

/** Every IANA zone this browser knows, for the time zone picker. */
export function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return [];
  }
}

/** The zone a new entry in a section most likely uses: the trip's nearest, else this device's. */
export function likelyZone(sections: ItinerarySection[], sectionId: string): string {
  return sharedLikelyZone(sections, sectionId) ?? deviceZone();
}

let loading: Promise<AirportData> | null = null;
/** The airport list, loaded the first time it's needed. */
export function useAirports(): AirportData | null {
  const [data, setData] = useState<AirportData | null>(null);
  useEffect(() => {
    loading ??= import('@shared/airports.json').then((m) => m.default as AirportData);
    let live = true;
    loading.then((d) => live && setData(d)).catch(() => (loading = null));
    return () => {
      live = false;
    };
  }, []);
  return data;
}
