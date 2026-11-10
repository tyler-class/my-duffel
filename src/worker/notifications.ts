// Duffel's notifications on top of the Selfhost Kit's push (src/worker/kit/push.ts): which ones a
// device gets now, and the app-icon count. The words and rules are in src/shared/logic/notify.ts.
import {
  badgeCount,
  isLive,
  itineraryNotice,
  NOTIFY_KINDS,
  packingNotices,
  todosNotice,
  type Notice,
} from '@shared/logic';
import type { ItinerarySection, Trip, TripTodo } from '@shared/types';
import { all, loadItinerary, loadTrips, toTripTodo } from './db';
import {
  localDate,
  pushRoutes,
  runPushJob,
  type PushCandidate,
  type PushDevice,
  type PushJobOptions,
} from './kit/push';

const ICON = '/pwa-192x192.png';

/** Trips and open to-dos, loaded once per run (or request), not once per device. */
function loader(db: D1Database) {
  let base: Promise<{ trips: Trip[]; todos: TripTodo[] }> | null = null;
  const itineraries = new Map<string, Promise<ItinerarySection[]>>();
  return {
    base: () =>
      (base ??= (async () => ({
        trips: await loadTrips(db),
        todos: (await all(db, 'SELECT * FROM trip_todos WHERE done = 0')).map(toTripTodo),
      }))()),
    itinerary: (tripId: string) => {
      let p = itineraries.get(tripId);
      if (!p) itineraries.set(tripId, (p = loadItinerary(db, tripId)));
      return p;
    },
  };
}

const candidate = (n: Notice, tz?: string): PushCandidate => ({
  kind: n.kind,
  key: n.key,
  ...(tz ? { tz } : {}),
  message: { title: n.title, body: n.body, url: n.url, tag: n.tag },
});

/** The notifications a device could get now, and its badge count. */
export function duffelPush(db: D1Database): Pick<PushJobOptions, 'build' | 'badge'> {
  const data = loader(db);
  return {
    async build(device: PushDevice, now: Date) {
      const today = localDate(now, device.tz);
      const { trips, todos } = await data.base();
      const out = packingNotices(trips, today).map((n) => candidate(n));
      const t = todosNotice(trips, todos, today);
      if (t) out.push(candidate(t));
      // Trips that could be under way somewhere in the world today: each by its own clock.
      for (const trip of trips) {
        if (!trip.start_date || !isLive(trip, today)) continue;
        if (trip.start_date > nextDay(today) || (trip.end_date ?? trip.start_date) < prevDay(today))
          continue;
        const n = itineraryNotice(trip, await data.itinerary(trip.id), now.getTime(), device.tz);
        if (n) out.push(candidate(n, n.tz));
      }
      return out;
    },
    async badge(device: PushDevice, now: Date) {
      const { trips, todos } = await data.base();
      return badgeCount(trips, todos, localDate(now, device.tz));
    },
  };
}

const shift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nextDay = (d: string) => shift(d, 1);
const prevDay = (d: string) => shift(d, -1);

/**
 * The hourly cron's notification run. Anything due that hasn't gone out yet is sent at any hour
 * from 8:00 local to midnight (no 21:00 cutoff): one turned on late in the evening still gets
 * today's.
 */
export function runNotifications(db: D1Database, o: Partial<PushJobOptions> = {}) {
  return runPushJob(db, { ...duffelPush(db), icon: ICON, until: 24, ...o });
}

/** /api/push/*: behind Duffel's sign-in (mounted after the guard in app.ts). */
export const push = pushRoutes({
  title: 'Duffel',
  kinds: NOTIFY_KINDS.map((k) => k.id),
  icon: ICON,
  fallbackSubject: 'mailto:duffel@tylerclass.net',
  badge: (device, now, db) => duffelPush(db).badge!(device, now, db),
});
