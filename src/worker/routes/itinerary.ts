// A trip's itinerary: sections in order, each with transport, lodging, plans and notes.
import { Hono } from 'hono';
import airportData from '@shared/airports.json';
import {
  endInstant,
  findAirport,
  keepConnections,
  likelyZone,
  placeByTime,
  type AirportData,
} from '@shared/logic';
import {
  entryInput,
  entryPatch,
  reorderEntries,
  reorderSections,
  sectionInput,
  sectionPatch,
} from '@shared/schemas';
import type { EntryEnd } from '@shared/types';
import {
  all,
  endCols,
  first,
  insertStmt,
  loadItinerary,
  newId,
  nowIso,
  toEntry,
  updateStmt,
} from '../db';
import { tripDetail } from './trips';
import { ApiError, body, defined, notFound, type AppEnv } from './util';

export const itinerary = new Hono<AppEnv>();

const AIRPORTS = airportData as AirportData;

type EndIn = Partial<EntryEnd> | undefined;

/** An airport code fills in the city and time zone when they're left out. */
function withAirport(e: EndIn): EndIn {
  if (!e?.code) return e;
  const a = findAirport(AIRPORTS, e.code);
  if (!a) return e;
  return { ...e, place: e.place ?? a.city, tz: e.tz ?? a.tz };
}

function checkOrder(start: EndIn, end: EndIn) {
  const a = start
    ? endInstant({ place: null, code: null, date: null, time: null, tz: null, ...start })
    : null;
  const b = end
    ? endInstant({ place: null, code: null, date: null, time: null, tz: null, ...end })
    : null;
  if (a !== null && b !== null && b < a)
    throw new ApiError(
      400,
      'invalid',
      'The end is before the start. Check the dates, times and time zones.',
    );
}

async function sectionTrip(db: D1Database, id: string): Promise<string> {
  const r = await first<{ trip_id: string }>(
    db,
    'SELECT trip_id FROM itinerary_sections WHERE id = ?',
    id,
  );
  if (!r) throw notFound('Section');
  return r.trip_id;
}

async function nextOrder(db: D1Database, sql: string, id: string) {
  const r = await first<{ m: number | null }>(db, sql, id);
  return (r?.m ?? -1) + 1;
}

/**
 * Saves a section's entry order: as it stands, or with one entry moved to where its time
 * falls. Connecting flights always end up back to back.
 */
async function arrange(db: D1Database, sectionId: string, placeId?: string) {
  const rows = await all(
    db,
    'SELECT * FROM itinerary_entries WHERE section_id = ? ORDER BY sort_order, created_at',
    sectionId,
  );
  let list = rows.map(toEntry);
  const moved = placeId ? list.find((e) => e.id === placeId) : undefined;
  if (moved) list = placeByTime(list, moved);
  list = keepConnections(list);
  const now = nowIso();
  const stmts = list.flatMap((e, i) =>
    e.sort_order === i
      ? []
      : [
          db
            .prepare('UPDATE itinerary_entries SET sort_order = ?, updated_at = ? WHERE id = ?')
            .bind(i, now, e.id),
        ],
  );
  if (stmts.length) await db.batch(stmts);
}

// ---------- sections ----------
itinerary.post('/trips/:id/itinerary', async (c) => {
  const tripId = c.req.param('id');
  const db = c.env.DB;
  if (!(await first(db, 'SELECT id FROM trips WHERE id = ?', tripId))) throw notFound('Trip');
  const input = await body(c, sectionInput);
  const now = nowIso();
  await insertStmt(db, 'itinerary_sections', {
    id: newId(),
    trip_id: tripId,
    kind: input.kind,
    title: input.title,
    notes: input.notes ?? null,
    sort_order:
      input.sort_order ??
      (await nextOrder(
        db,
        'SELECT MAX(sort_order) AS m FROM itinerary_sections WHERE trip_id = ?',
        tripId,
      )),
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(await tripDetail(db, tripId), 201);
});

itinerary.post('/trips/:id/itinerary/order', async (c) => {
  const tripId = c.req.param('id');
  const db = c.env.DB;
  const { ids } = await body(c, reorderSections);
  await db.batch(
    ids.map((id, i) =>
      db
        .prepare(
          'UPDATE itinerary_sections SET sort_order = ?, updated_at = ? WHERE id = ? AND trip_id = ?',
        )
        .bind(i, nowIso(), id, tripId),
    ),
  );
  return c.json(await tripDetail(db, tripId));
});

itinerary.patch('/itinerary-sections/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const tripId = await sectionTrip(db, id);
  const input = await body(c, sectionPatch);
  const f = defined({
    kind: input.kind,
    title: input.title,
    notes: input.notes,
    sort_order: input.sort_order,
  });
  if (Object.keys(f).length) await updateStmt(db, 'itinerary_sections', id, f).run();
  return c.json(await tripDetail(db, tripId));
});

itinerary.delete('/itinerary-sections/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const tripId = await sectionTrip(db, id);
  await db.batch([
    db.prepare('DELETE FROM itinerary_entries WHERE section_id = ?').bind(id),
    db.prepare('DELETE FROM itinerary_sections WHERE id = ?').bind(id),
  ]);
  return c.json(await tripDetail(db, tripId));
});

// ---------- entries ----------
itinerary.post('/itinerary-sections/:id/entries', async (c) => {
  const sectionId = c.req.param('id');
  const db = c.env.DB;
  const tripId = await sectionTrip(db, sectionId);
  const input = await body(c, entryInput);
  let start = withAirport(input.start);
  let end = withAirport(input.end);
  // A time with no zone (and no airport to take one from) gets the trip's nearest zone,
  // instead of being read as UTC.
  const timed = (e: EndIn) => !!(e?.time || e?.date);
  if ((timed(start) && !start?.tz) || (timed(end) && !end?.tz)) {
    const near =
      start?.tz ?? end?.tz ?? likelyZone(await loadItinerary(db, tripId), sectionId) ?? null;
    if (near) {
      if (timed(start) && !start?.tz) start = { ...start, tz: end?.tz ?? near };
      if (timed(end) && !end?.tz) end = { ...end, tz: start?.tz ?? near };
    }
  }
  checkOrder(start, end);
  const now = nowIso();
  const entryId = newId();
  await insertStmt(db, 'itinerary_entries', {
    id: entryId,
    section_id: sectionId,
    kind: input.kind,
    mode: input.kind === 'transport' ? (input.mode ?? 'plane') : null,
    title: input.title ?? null,
    carrier: input.carrier ?? null,
    number: input.number ?? null,
    ...endCols('start', start),
    ...endCols('end', end),
    address: input.address ?? null,
    confirmation: input.confirmation ?? null,
    details: input.details ?? null,
    notes: input.notes ?? null,
    sort_order:
      input.sort_order ??
      (await nextOrder(
        db,
        'SELECT MAX(sort_order) AS m FROM itinerary_entries WHERE section_id = ?',
        sectionId,
      )),
    created_at: now,
    updated_at: now,
  }).run();
  // A new entry goes where its time falls, unless it asked for a spot (an undo).
  await arrange(db, sectionId, input.sort_order === undefined ? entryId : undefined);
  return c.json(await tripDetail(db, tripId), 201);
});

// Entries in a section, in a new order. Entries from the trip's other sections move here.
itinerary.post('/itinerary-sections/:id/order', async (c) => {
  const sectionId = c.req.param('id');
  const db = c.env.DB;
  const tripId = await sectionTrip(db, sectionId);
  const { ids } = await body(c, reorderEntries);
  const owned = await all<{ id: string }>(
    db,
    `SELECT e.id FROM itinerary_entries e JOIN itinerary_sections s ON s.id = e.section_id
     WHERE s.trip_id = ?`,
    tripId,
  );
  const ok = new Set(owned.map((r) => r.id));
  if (ids.some((id) => !ok.has(id)))
    throw new ApiError(400, 'invalid', 'Some of those entries aren’t on this trip.');
  const now = nowIso();
  await db.batch(
    ids.map((id, i) =>
      db
        .prepare(
          'UPDATE itinerary_entries SET section_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
        )
        .bind(sectionId, i, now, id),
    ),
  );
  await arrange(db, sectionId);
  return c.json(await tripDetail(db, tripId));
});

itinerary.patch('/itinerary-entries/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first(db, 'SELECT * FROM itinerary_entries WHERE id = ?', id);
  if (!row) throw notFound('Entry');
  const old = toEntry(row);
  const tripId = await sectionTrip(db, old.section_id);
  const input = await body(c, entryPatch);
  if (input.section_id && input.section_id !== old.section_id) {
    if ((await sectionTrip(db, input.section_id)) !== tripId)
      throw new ApiError(400, 'invalid', 'That section is on another trip.');
  }
  const start = withAirport(input.start);
  const end = withAirport(input.end);
  checkOrder({ ...old.start, ...start }, { ...old.end, ...end });
  const f: Record<string, unknown> = defined({
    section_id: input.section_id,
    kind: input.kind,
    mode: input.mode,
    title: input.title,
    carrier: input.carrier,
    number: input.number,
    address: input.address,
    confirmation: input.confirmation,
    details: input.details,
    notes: input.notes,
    sort_order: input.sort_order,
  });
  Object.assign(f, endCols('start', start), endCols('end', end));
  if (input.kind && input.kind !== 'transport') f.mode = null;
  if (input.kind === 'transport' && !old.mode && !input.mode) f.mode = 'plane';
  if (Object.keys(f).length) await updateStmt(db, 'itinerary_entries', id, f).run();
  // A new time or section puts the entry where its time falls.
  const section = input.section_id ?? old.section_id;
  const retimed =
    section !== old.section_id ||
    (['date', 'time', 'tz'] as const).some(
      (k) => start?.[k] !== undefined && start[k] !== old.start[k],
    );
  await arrange(db, section, retimed && input.sort_order === undefined ? id : undefined);
  return c.json(await tripDetail(db, tripId));
});

itinerary.delete('/itinerary-entries/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first<{ section_id: string }>(
    db,
    'SELECT section_id FROM itinerary_entries WHERE id = ?',
    id,
  );
  if (!row) return c.json({ ok: true });
  const tripId = await sectionTrip(db, row.section_id);
  await db.prepare('DELETE FROM itinerary_entries WHERE id = ?').bind(id).run();
  return c.json(await tripDetail(db, tripId));
});
