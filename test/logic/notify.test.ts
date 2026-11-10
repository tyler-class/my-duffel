import { describe, expect, it } from 'vitest';
import {
  badgeCount,
  itineraryNotice,
  packingNotices,
  rowText,
  todosNotice,
  tripZoneNow,
  zonedInstant,
} from '../../src/shared/logic';
import type {
  EntryEnd,
  ItineraryEntry,
  ItinerarySection,
  Trip,
  TripTodo,
} from '../../src/shared/types';

const trip = (p: Partial<Trip> & { id: string }): Trip => ({
  name: p.id,
  template_id: null,
  cloned_from_trip_id: null,
  trip_type: null,
  start_date: null,
  end_date: null,
  days: null,
  nights: null,
  destination: null,
  climate: null,
  activities: [],
  status: null,
  notes: null,
  archived_at: null,
  category_order: [],
  travelers: [],
  item_count: 0,
  packed_count: 0,
  ...p,
});

let n = 0;
const todo = (p: Partial<TripTodo> & { trip_id: string; title: string }): TripTodo => ({
  id: `todo${++n}`,
  phase: 'pre',
  notes: null,
  done: false,
  done_at: null,
  sort_order: n,
  date_mode: 'none',
  due_date: null,
  rel_days: null,
  rel_dir: null,
  rel_anchor: null,
  ...p,
});

const end = (date: string | null, time: string | null, tz: string | null): EntryEnd => ({
  place: null,
  code: null,
  date,
  time,
  tz,
});
const entry = (p: Partial<ItineraryEntry> & { id: string }): ItineraryEntry => ({
  section_id: 's',
  kind: 'plan',
  mode: null,
  title: null,
  carrier: null,
  number: null,
  start: end(null, null, null),
  end: end(null, null, null),
  address: null,
  confirmation: null,
  details: null,
  notes: null,
  sort_order: 0,
  ...p,
});
const section = (
  p: Partial<ItinerarySection> & { id: string; entries: ItineraryEntry[] },
): ItinerarySection => ({
  trip_id: 'pt',
  kind: 'stay',
  title: p.id,
  notes: null,
  sort_order: 0,
  ...p,
  entries: p.entries.map((e, i) => ({ ...e, section_id: p.id, sort_order: i })),
});

describe('Get packing', () => {
  const trips = [
    trip({ id: 'pt', name: 'Portugal', start_date: '2027-06-10', end_date: '2027-06-20' }),
    trip({ id: 'mx', name: 'Mexico', start_date: '2027-06-11' }),
    trip({ id: 'old', name: 'Archived', start_date: '2027-06-10', archived_at: '2027-01-01' }),
    trip({ id: 'done', name: 'Packed', start_date: '2027-06-10', item_count: 3, packed_count: 3 }),
    trip({ id: 'nodate', name: 'Someday' }),
  ];
  it('goes out exactly 7 days before a trip starts, one per trip', () => {
    const out = packingNotices(trips, '2027-06-03');
    expect(out).toEqual([
      {
        kind: 'packing',
        key: 'pt',
        title: 'Get packing',
        body: 'Portugal starts in a week. Time to start packing.',
        url: '/trips/pt?view=packing',
        tag: 'packing-pt',
      },
    ]);
    expect(packingNotices(trips, '2027-06-04').map((x) => x.key)).toEqual(['mx']);
    expect(packingNotices(trips, '2027-06-02')).toEqual([]);
  });
});

describe('To-dos due today', () => {
  const pt = trip({ id: 'pt', name: 'Portugal', start_date: '2027-06-10', end_date: '2027-06-20' });
  const mx = trip({ id: 'mx', name: 'Mexico', start_date: '2027-12-20', end_date: '2027-12-30' });
  const gone = trip({ id: 'gone', start_date: '2027-06-01', archived_at: '2027-05-01' });
  const todos = [
    todo({ trip_id: 'pt', title: 'Book the kennel', date_mode: 'fixed', due_date: '2027-06-03' }),
    // Relative: 7 days before the trip starts = 2027-06-03.
    todo({
      trip_id: 'pt',
      title: 'Pick up euros',
      date_mode: 'relative',
      rel_days: 7,
      rel_dir: 'before',
      rel_anchor: 'start',
    }),
    todo({
      trip_id: 'pt',
      title: 'Done already',
      date_mode: 'fixed',
      due_date: '2027-06-03',
      done: true,
    }),
    todo({ trip_id: 'pt', title: 'Overdue', date_mode: 'fixed', due_date: '2027-05-30' }),
    todo({ trip_id: 'pt', title: 'Later', date_mode: 'fixed', due_date: '2027-06-08' }),
    todo({ trip_id: 'pt', title: 'Undated' }),
    todo({ trip_id: 'gone', title: 'Archived trip', date_mode: 'fixed', due_date: '2027-06-03' }),
  ];

  it('summarises the open to-dos dated today, relative dates included', () => {
    expect(todosNotice([pt, mx, gone], todos, '2027-06-03')).toEqual({
      kind: 'todos',
      key: 'today',
      title: 'Portugal',
      body: '2 to-dos today: Book the kennel, Pick up euros',
      url: '/trips/pt?view=todos',
      tag: 'todos-today',
    });
    expect(todosNotice([pt, mx], todos, '2027-06-04')).toBeNull();
  });

  it('spans trips, singular wording, and shortens a long list', () => {
    const more = [
      todo({ trip_id: 'mx', title: 'Renew passport', date_mode: 'fixed', due_date: '2027-06-03' }),
      ...todos,
    ];
    const t = todosNotice([pt, mx], more, '2027-06-03')!;
    expect(t.title).toBe('To-dos today');
    expect(t.url).toBe('/');
    expect(t.body).toBe('3 to-dos today: Book the kennel, Pick up euros, Renew passport');
    expect(todosNotice([pt], todos.slice(0, 1), '2027-06-03')!.body).toBe(
      '1 to-do today: Book the kennel',
    );
    const many = Array.from({ length: 20 }, (_, i) =>
      todo({
        trip_id: 'pt',
        title: `Something long to do ${i}`,
        date_mode: 'fixed',
        due_date: '2027-06-03',
      }),
    );
    const long = todosNotice([pt], many, '2027-06-03')!.body;
    expect(long.startsWith('20 to-dos today: Something long to do 0, ')).toBe(true);
    expect(long.endsWith(', …')).toBe(true);
    expect(long.length).toBeLessThan(190);
  });

  it('badge: open to-dos due today or overdue, nothing else', () => {
    // Book the kennel + Pick up euros (today) + Overdue. Not done, later, undated or archived.
    expect(badgeCount([pt, mx, gone], todos, '2027-06-03')).toBe(3);
    expect(badgeCount([pt, mx, gone], todos, '2027-05-29')).toBe(0);
    // A trip over for more than a week no longer counts.
    expect(badgeCount([pt], todos, '2027-06-27')).toBe(4);
    expect(badgeCount([pt], todos, '2027-06-28')).toBe(0);
  });
});

describe('Today’s itinerary', () => {
  const pt = trip({
    id: 'pt',
    name: 'Portugal',
    destination: 'Portugal',
    start_date: '2027-06-10',
    end_date: '2027-06-20',
  });
  const NY = 'America/New_York';
  const LIS = 'Europe/Lisbon';
  const sections = [
    section({
      id: 'there',
      kind: 'travel',
      title: 'Getting there',
      entries: [
        entry({
          id: 'f1',
          kind: 'transport',
          mode: 'plane',
          carrier: 'TP',
          number: '1234',
          start: end('2027-06-10', '21:40', NY),
          end: end('2027-06-11', '09:40', LIS),
        }),
      ],
    }),
    section({
      id: 'lis',
      title: 'Lisbon',
      sort_order: 1,
      entries: [
        entry({
          id: 'h',
          kind: 'lodging',
          title: 'Hotel Avenida',
          start: end('2027-06-11', '15:00', LIS),
          end: end('2027-06-14', '11:00', LIS),
        }),
        entry({ id: 'd', title: 'Dinner at Ramiro', start: end('2027-06-11', null, LIS) }),
        entry({ id: 'tram', title: 'Tram 28', start: end('2027-06-12', '10:00', LIS) }),
      ],
    }),
  ];
  const at = (date: string, time: string, tz: string) => zonedInstant(date, time, tz)!;

  it('follows the trip: in New York before the flight, Lisbon after it lands', () => {
    expect(tripZoneNow(sections, at('2027-06-10', '08:00', NY))).toBe(NY);
    expect(tripZoneNow(sections, at('2027-06-11', '07:00', LIS))).toBe(NY); // still flying
    expect(tripZoneNow(sections, at('2027-06-11', '10:00', LIS))).toBe(LIS);
    expect(tripZoneNow(sections, at('2027-06-12', '08:00', LIS))).toBe(LIS);
  });

  it('lists the day’s lines, by the trip’s clock, linking to that day', () => {
    const n = itineraryNotice(pt, sections, at('2027-06-12', '08:05', LIS), NY)!;
    expect(n).toEqual({
      kind: 'itinerary',
      key: 'pt',
      tz: LIS,
      title: 'Portugal',
      body: 'Today in Lisbon: 10:00 AM Tram 28',
      url: '/trips/pt?view=itinerary&day=2027-06-12',
      tag: 'itinerary-pt',
    });
    const arrival = itineraryNotice(pt, sections, at('2027-06-11', '10:30', LIS), NY)!;
    expect(arrival.body).toBe(
      // The flight is listed on the day it leaves, as in the app.
      'Today in Lisbon: 3:00 PM Check in at Hotel Avenida · Dinner at Ramiro',
    );
    const out = itineraryNotice(pt, sections, at('2027-06-14', '08:00', LIS), NY)!;
    expect(out.body).toBe('Today in Lisbon: 11:00 AM Check out of Hotel Avenida');
    // Departure day, still home: a travel section only, so the trip's destination.
    const dep = itineraryNotice(pt, sections, at('2027-06-10', '08:00', NY), NY)!;
    expect(dep.tz).toBe(NY);
    expect(dep.body).toBe('Today in Portugal: 9:40 PM Flight TP 1234');
  });

  it('nothing outside the trip or on an empty day', () => {
    expect(itineraryNotice(pt, sections, at('2027-06-09', '08:00', NY), NY)).toBeNull();
    expect(itineraryNotice(pt, sections, at('2027-06-13', '08:00', LIS), NY)).toBeNull();
    expect(
      itineraryNotice({ ...pt, archived_at: 'x' }, sections, at('2027-06-12', '08:00', LIS), NY),
    ).toBeNull();
  });

  it('words a line', () => {
    const rows = [{ key: 'a', part: 'all', date: null, from: 0, until: 0 }] as const;
    const e = entry({ id: 'x', kind: 'transport', mode: 'train', carrier: 'CP', number: '120' });
    expect(rowText({ ...rows[0], entry: e })).toBe('Train CP 120');
    expect(rowText({ ...rows[0], entry: { ...e, title: 'Alfa Pendular' } })).toBe('Alfa Pendular');
    expect(rowText({ ...rows[0], part: 'in', entry: entry({ id: 'l', kind: 'lodging' }) })).toBe(
      'Check in',
    );
  });
});
