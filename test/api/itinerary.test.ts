import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { connections, entryMinutes } from '../../src/shared/logic';
import type { TripDetail } from '../../src/shared/types';
import { session } from './helpers';

describe('itinerary', () => {
  it('holds sections and entries, fills airports, and stays with its trip', async () => {
    const api = await session();
    let d = (
      await api.post<TripDetail>('/trips', {
        name: 'Portugal',
        start_date: '2027-06-03',
        end_date: '2027-06-10',
        source: { kind: 'blank' },
      })
    ).data;
    expect(d.itinerary).toEqual([]);
    const tripId = d.trip.id;

    await api.post<TripDetail>(`/trips/${tripId}/itinerary`, {
      kind: 'travel',
      title: 'Getting there',
    });
    d = (
      await api.post<TripDetail>(`/trips/${tripId}/itinerary`, { kind: 'stay', title: 'Lisbon' })
    ).data;
    const [there, lisbon] = d.itinerary;
    expect(there).toMatchObject({ kind: 'travel', title: 'Getting there', sort_order: 0 });
    expect(lisbon).toMatchObject({ kind: 'stay', sort_order: 1 });

    // Two flights with a connection; codes fill in the city and time zone.
    await api.post(`/itinerary-sections/${there!.id}/entries`, {
      kind: 'transport',
      carrier: 'TAP',
      number: '204',
      start: { code: 'bos', date: '2027-06-02', time: '21:40' },
      end: { code: 'LIS', date: '2027-06-03', time: '09:05' },
      confirmation: 'ABC123',
    });
    d = (
      await api.post<TripDetail>(`/itinerary-sections/${there!.id}/entries`, {
        kind: 'transport',
        carrier: 'TAP',
        number: '1944',
        start: { code: 'LIS', date: '2027-06-03', time: '10:55' },
        end: { code: 'OPO', date: '2027-06-03', time: '11:50' },
      })
    ).data;
    const flights = d.itinerary[0]!.entries;
    expect(flights[0]).toMatchObject({
      mode: 'plane',
      start: { code: 'BOS', place: 'Boston', tz: 'America/New_York' },
      end: { code: 'LIS', place: 'Lisbon', tz: 'Europe/Lisbon' },
    });
    // 21:40 EDT is 01:40 UTC; 09:05 WEST is 08:05 UTC: 6h 25m.
    expect(entryMinutes(flights[0]!)).toBe(385);
    expect(connections(flights)).toEqual([
      { after: flights[0]!.id, minutes: 110, at: 'Lisbon', change: null },
    ]);

    // An arrival before the departure is refused.
    const bad = await api.post(`/itinerary-sections/${lisbon!.id}/entries`, {
      kind: 'transport',
      start: { code: 'LIS', date: '2027-06-07', time: '10:00' },
      end: { code: 'OPO', date: '2027-06-07', time: '09:00' },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await api.post(`/itinerary-sections/${lisbon!.id}/entries`, {
          kind: 'plan',
          start: { time: '7pm' },
        })
      ).status,
    ).toBe(400);

    d = (
      await api.post<TripDetail>(`/itinerary-sections/${lisbon!.id}/entries`, {
        kind: 'lodging',
        title: 'Casa do Rio',
        start: { date: '2027-06-03', time: '15:00' },
        end: { date: '2027-06-07', time: '11:00' },
        address: 'Rua 1',
        confirmation: 'HB-889',
      })
    ).data;
    const hotel = d.itinerary[1]!.entries[0]!;

    // Move it to the other section, then edit just its check-out time.
    d = (await api.patch<TripDetail>(`/itinerary-entries/${hotel.id}`, { section_id: there!.id }))
      .data;
    expect(d.itinerary[0]!.entries).toHaveLength(3);
    d = (await api.patch<TripDetail>(`/itinerary-entries/${hotel.id}`, { end: { time: '12:00' } }))
      .data;
    expect(d.itinerary[0]!.entries.find((e) => e.id === hotel.id)!.end).toMatchObject({
      date: '2027-06-07',
      time: '12:00',
    });

    // Reorder sections.
    d = (
      await api.post<TripDetail>(`/trips/${tripId}/itinerary/order`, {
        ids: [lisbon!.id, there!.id],
      })
    ).data;
    expect(d.itinerary.map((s) => s.title)).toEqual(['Lisbon', 'Getting there']);

    // Not copied to a clone.
    const clone = (
      await api.post<TripDetail>('/trips', {
        name: 'Portugal again',
        source: { kind: 'clone', trip_id: tripId },
      })
    ).data;
    expect(clone.itinerary).toEqual([]);

    // In backups.
    const backup = (await api.get<{ tables: Record<string, unknown[]> }>('/export')).data;
    expect(backup.tables.itinerary_entries).toHaveLength(3);

    // Deleting a section deletes its entries; deleting the trip deletes the rest.
    d = (await api.del<TripDetail>(`/itinerary-sections/${there!.id}`)).data;
    expect(d.itinerary.map((s) => s.title)).toEqual(['Lisbon']);
    await api.del(`/trips/${tripId}`);
    const after = (await api.get<{ tables: Record<string, unknown[]> }>('/export')).data;
    expect(after.tables.itinerary_sections).toHaveLength(0);
  });

  it('places entries by time, keeps connecting flights together, and can be dragged', async () => {
    const api = await session();
    const d0 = (
      await api.post<TripDetail>('/trips', {
        name: 'Order',
        start_date: '2027-06-02',
        end_date: '2027-06-10',
        source: { kind: 'blank' },
      })
    ).data;
    const tripId = d0.trip.id;
    let d = (
      await api.post<TripDetail>(`/trips/${tripId}/itinerary`, { kind: 'travel', title: 'There' })
    ).data;
    const sec = d.itinerary[0]!.id;
    const add = async (body: object) =>
      (await api.post<TripDetail>(`/itinerary-sections/${sec}/entries`, body)).data;
    const names = (x: TripDetail, i = 0) =>
      [...x.itinerary[i]!.entries]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((e) => e.title ?? e.number);

    // Added out of order, they line up by time.
    await add({
      kind: 'transport',
      number: '2',
      start: { code: 'JFK', date: '2027-06-03', time: '13:00' },
      end: { code: 'LIS', date: '2027-06-04', time: '01:00' },
    });
    await add({
      kind: 'transport',
      number: '1',
      start: { code: 'GRR', date: '2027-06-03', time: '07:00' },
      end: { code: 'JFK', date: '2027-06-03', time: '09:00' },
    });
    // A taxi with just a date (noon) would fall between the two flights by time, but
    // connecting flights stay back to back.
    d = await add({ kind: 'transport', mode: 'car', title: 'Taxi', start: { date: '2027-06-03' } });
    expect(names(d)).toEqual(['1', '2', 'Taxi']);

    // Dragging the taxi between the flights doesn't split the connection.
    const ids = (x: TripDetail) => {
      const by = new Map(x.itinerary[0]!.entries.map((e) => [e.title ?? e.number, e.id]));
      return (n: string) => by.get(n)!;
    };
    let id = ids(d);
    d = (
      await api.post<TripDetail>(`/itinerary-sections/${sec}/order`, {
        ids: [id('1'), id('Taxi'), id('2')],
      })
    ).data;
    expect(names(d)).toEqual(['1', '2', 'Taxi']);

    // But anything else can go anywhere: the taxi first.
    d = (
      await api.post<TripDetail>(`/itinerary-sections/${sec}/order`, {
        ids: [id('Taxi'), id('1'), id('2')],
      })
    ).data;
    expect(names(d)).toEqual(['Taxi', '1', '2']);

    // Into another section.
    d = (
      await api.post<TripDetail>(`/trips/${tripId}/itinerary`, { kind: 'stay', title: 'Lisbon' })
    ).data;
    const lisbon = d.itinerary[1]!.id;
    d = (await api.post<TripDetail>(`/itinerary-sections/${lisbon}/order`, { ids: [id('Taxi')] }))
      .data;
    expect(names(d, 0)).toEqual(['1', '2']);
    expect(names(d, 1)).toEqual(['Taxi']);

    // A new time moves an entry to where it now falls.
    id = ids(d);
    d = (
      await api.patch<TripDetail>(`/itinerary-entries/${id('1')}`, {
        start: { code: 'GRR', date: '2027-06-03', time: '07:00' },
        title: 'Early',
      })
    ).data;
    expect(names(d)).toEqual(['Early', '2']);

    // Entries from another trip can't be moved in.
    const other = (
      await api.post<TripDetail>('/trips', { name: 'Other', source: { kind: 'blank' } })
    ).data;
    const os = (
      await api.post<TripDetail>(`/trips/${other.trip.id}/itinerary`, {
        kind: 'stay',
        title: 'X',
      })
    ).data.itinerary[0]!.id;
    const res = await api.post(`/itinerary-sections/${os}/order`, { ids: [id('2')] });
    expect(res.status).toBe(400);
  });

  it('gives a booking with no zone its trip’s zone, so 3 PM never becomes 10 AM', async () => {
    const api = await session();
    const t = (await api.post<TripDetail>('/trips', { name: 'Zones', source: { kind: 'blank' } }))
      .data;
    let d = (
      await api.post<TripDetail>(`/trips/${t.trip.id}/itinerary`, {
        kind: 'travel',
        title: 'There',
      })
    ).data;
    const there = d.itinerary[0]!.id;
    await api.post(`/itinerary-sections/${there}/entries`, {
      kind: 'transport',
      start: { code: 'CLT', date: '2026-12-17', time: '10:00' },
      end: { code: 'CUN', date: '2026-12-17', time: '12:30' },
    });
    d = (
      await api.post<TripDetail>(`/trips/${t.trip.id}/itinerary`, { kind: 'stay', title: 'Cancún' })
    ).data;
    const stay = d.itinerary[1]!.id;
    // What an assistant sent: times, no zone.
    d = (
      await api.post<TripDetail>(`/itinerary-sections/${stay}/entries`, {
        kind: 'lodging',
        title: 'Resort',
        start: { date: '2026-12-17', time: '15:00' },
        end: { date: '2026-12-21', time: '11:00' },
      })
    ).data;
    const resort = d.itinerary[1]!.entries[0]!;
    expect([resort.start.tz, resort.end.tz]).toEqual(['America/Cancun', 'America/Cancun']);

    // One saved before this fix, with no zone: repaired the next time the trip loads.
    await env.DB.prepare('UPDATE itinerary_entries SET start_tz = NULL, end_tz = NULL WHERE id = ?')
      .bind(resort.id)
      .run();
    d = (await api.get<TripDetail>(`/trips/${t.trip.id}`)).data;
    expect(d.itinerary[1]!.entries[0]!.start.tz).toBe('America/Cancun');
    const row = await env.DB.prepare('SELECT start_tz FROM itinerary_entries WHERE id = ?')
      .bind(resort.id)
      .first<{ start_tz: string }>();
    expect(row?.start_tz).toBe('America/Cancun');
  });
});
