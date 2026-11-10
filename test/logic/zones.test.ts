// The itinerary's time zone maths, the hard cases: DST changes both ways (including the
// skipped and repeated hours), zones without DST, half-hour zones and the date line.
import { describe, expect, it } from 'vitest';
import {
  dayShift,
  endInstant,
  entryMinutes,
  localIn,
  sortKey,
  zonedInstant,
} from '../../src/shared/logic';
import type { ItineraryEntry } from '../../src/shared/types';

const at = (date: string, time: string, tz: string) => zonedInstant(date, time, tz)!;
const iso = (t: number) => new Date(t).toISOString().slice(0, 16);
const end = (date: string | null, time: string | null, tz: string | null) => ({
  place: null,
  code: null,
  date,
  time,
  tz,
});
const flight = (from: ReturnType<typeof end>, to: ReturnType<typeof end>): ItineraryEntry => ({
  id: 'f',
  section_id: 's',
  kind: 'transport',
  mode: 'plane',
  title: null,
  carrier: null,
  number: null,
  start: from,
  end: to,
  address: null,
  confirmation: null,
  details: null,
  notes: null,
  sort_order: 0,
});

describe('zonedInstant', () => {
  it('reads ordinary times right around a DST change (US)', () => {
    expect(iso(at('2027-03-13', '12:00', 'America/New_York'))).toBe('2027-03-13T17:00'); // EST
    expect(iso(at('2027-03-14', '03:30', 'America/New_York'))).toBe('2027-03-14T07:30'); // EDT
    expect(iso(at('2027-03-14', '01:59', 'America/New_York'))).toBe('2027-03-14T06:59'); // EST
  });

  it('moves a time in the skipped hour forward, in every zone', () => {
    // 02:30 doesn't exist on 14 Mar in New York: read as 03:30 EDT.
    expect(iso(at('2027-03-14', '02:30', 'America/New_York'))).toBe('2027-03-14T07:30');
    // 01:30 doesn't exist on 28 Mar in Lisbon: read as 02:30 WEST.
    expect(iso(at('2027-03-28', '01:30', 'Europe/Lisbon'))).toBe('2027-03-28T01:30');
    expect(localIn(at('2027-03-28', '01:30', 'Europe/Lisbon'), 'Europe/Lisbon').time).toBe('02:30');
  });

  it('takes the first of a repeated hour', () => {
    // 01:30 happens twice on 7 Nov in New York: EDT first.
    expect(iso(at('2027-11-07', '01:30', 'America/New_York'))).toBe('2027-11-07T05:30');
    // 01:30 happens twice on 31 Oct in Lisbon: WEST first.
    expect(iso(at('2027-10-31', '01:30', 'Europe/Lisbon'))).toBe('2027-10-31T00:30');
    expect(iso(at('2027-10-31', '02:30', 'Europe/Lisbon'))).toBe('2027-10-31T02:30');
  });

  it('handles zones without DST, half-hour zones and UTC', () => {
    expect(iso(at('2027-07-01', '15:00', 'America/Cancun'))).toBe('2027-07-01T20:00');
    expect(iso(at('2027-12-01', '15:00', 'America/Cancun'))).toBe('2027-12-01T20:00');
    expect(iso(at('2027-07-01', '09:00', 'Asia/Tokyo'))).toBe('2027-07-01T00:00');
    expect(iso(at('2027-07-01', '09:00', 'Asia/Kolkata'))).toBe('2027-07-01T03:30');
    expect(iso(at('2027-07-01', '09:00', 'Australia/Adelaide'))).toBe('2027-06-30T23:30');
    expect(iso(at('2027-07-01', '09:00', 'Etc/UTC'))).toBe('2027-07-01T09:00');
  });

  it('reads every quarter hour back as itself, all year, in tricky zones', () => {
    for (const tz of ['America/New_York', 'Europe/Lisbon', 'Australia/Sydney', 'Asia/Kolkata'])
      for (let m = 0; m < 12; m++)
        for (const t of ['00:15', '07:45', '12:00', '23:30']) {
          const date = `2027-${String(m + 1).padStart(2, '0')}-10`;
          expect(localIn(at(date, t, tz), tz)).toEqual({ date, time: t });
        }
  });

  it('works out a date-line crossing: LAX to SYD lands two days later', () => {
    const f = flight(
      end('2027-06-01', '22:30', 'America/Los_Angeles'),
      end('2027-06-03', '06:45', 'Australia/Sydney'),
    );
    expect(entryMinutes(f)).toBe(15 * 60 + 15);
    expect(dayShift(f)).toBe(2);
    // And back: leaves Sydney after it arrives in LA, by the clock.
    const back = flight(
      end('2027-06-10', '11:00', 'Australia/Sydney'),
      end('2027-06-10', '06:15', 'America/Los_Angeles'),
    );
    expect(entryMinutes(back)).toBe(12 * 60 + 15);
    expect(dayShift(back)).toBe(0);
  });

  it('converts to another zone with the right date', () => {
    const t = at('2027-06-01', '22:30', 'America/Los_Angeles');
    expect(localIn(t, 'America/New_York')).toEqual({ date: '2027-06-02', time: '01:30' });
    expect(localIn(t, 'Asia/Tokyo')).toEqual({ date: '2027-06-02', time: '14:30' });
  });

  it('leaves a date without a time untimed, and sorts it at noon that day', () => {
    expect(endInstant(end('2027-06-01', null, 'Asia/Tokyo'))).toBeNull();
    const e = flight(end('2027-06-01', null, 'Asia/Tokyo'), end(null, null, null));
    expect(iso(sortKey(e))).toBe('2027-06-01T12:00');
  });
});
