import { Hono } from 'hono';
import {
  reorderRows,
  saveAsTemplate,
  tripTodoInput,
  tripTodoPatch,
  tripBagInput,
  tripBagPatch,
  tripCreate,
  tripItemInput,
  tripItemPatch,
  tripItemsAdd,
  tripItemsBulk,
  tripPatch,
} from '@shared/schemas';
import {
  calcQty,
  defaultBagCarryOn,
  displayQty,
  planClone,
  planFromTemplate,
  planRows,
  planTemplateFromTrip,
  placeRow,
  recalcRows,
  planTemplateTodos,
  planTodosClone,
  planTodosFromTemplate,
  normalizeWhen,
  whenCols,
  mergeWhen,
  WHEN_KEYS,
  type TodoDraft,
  resolveCalc,
  rewriteLabelPrefix,
  shortBagLabel,
  suggestItems,
  suggestPlacements,
  unplacedSummary,
  tripLength,
  typedBags,
  type LengthLike,
  type TripItemDraft,
  missingZones,
} from '@shared/logic';
import type { Item, Template, TodoWhen, Trip, TripBag, TripDetail } from '@shared/types';
import {
  b,
  existingIds,
  first,
  getAutoPackFallback,
  insertStmt,
  json,
  loadItems,
  loadPeople,
  loadSuitcases,
  loadTemplates,
  loadTrip,
  loadTripBags,
  loadTripItems,
  loadTripTodos,
  loadItinerary,
  newId,
  setBagPeople,
  nowIso,
  updateStmt,
} from '../db';
import { ApiError, body, defined, notFound, type AppEnv } from './util';

export const trips = new Hono<AppEnv>();

export async function getTrip(db: D1Database, id: string): Promise<Trip> {
  const t = await loadTrip(db, id);
  if (!t) throw notFound('Trip');
  return t;
}

export async function tripDetail(db: D1Database, id: string): Promise<TripDetail> {
  const [trip, bags, items, todos, itinerary] = await Promise.all([
    getTrip(db, id),
    loadTripBags(db, id),
    loadTripItems(db, id),
    loadTripTodos(db, id),
    loadItinerary(db, id),
  ]);
  // Entries saved with a time but no zone get their trip's nearest zone, once, for good.
  const fixes = missingZones(itinerary);
  if (fixes.length) {
    const now = nowIso();
    await db.batch(
      fixes.map((f) =>
        db
          .prepare(
            'UPDATE itinerary_entries SET start_tz = COALESCE(?, start_tz), end_tz = COALESCE(?, end_tz), updated_at = ? WHERE id = ?',
          )
          .bind(f.start_tz ?? null, f.end_tz ?? null, now, f.id),
      ),
    );
    for (const s of itinerary)
      for (const e of s.entries) {
        const f = fixes.find((x) => x.id === e.id);
        if (f?.start_tz) e.start.tz = f.start_tz;
        if (f?.end_tz) e.end.tz = f.end_tz;
      }
  }
  return { trip, bags, items, todos, itinerary };
}

const lenOf = (t: { days: number | null; nights: number | null }): LengthLike | null =>
  t.days === null && t.nights === null ? null : { days: t.days, nights: t.nights };

function tripItemStmt(
  db: D1Database,
  tripId: string,
  d: TripItemDraft,
  sortOrder: number,
  now: string,
) {
  return insertStmt(db, 'trip_items', {
    id: newId(),
    trip_id: tripId,
    item_id: d.item_id,
    name: d.name,
    person_id: d.person_id,
    trip_bag_id: d.trip_bag_id,
    no_bag: b(d.no_bag),
    calc_mode: d.calc_mode,
    calc_unit_qty: d.calc_unit_qty,
    calc_max: d.calc_max,
    calc_offset: d.calc_offset,
    qty: d.qty,
    qty_override: d.qty_override,
    packed: 0,
    packed_at: null,
    carry_hint: b(d.carry_hint),
    pack_type: d.pack_type,
    category: d.category,
    notes: d.notes,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
  });
}

async function nextSortOrder(db: D1Database, tripId: string): Promise<number> {
  const r = await first<{ m: number | null }>(
    db,
    'SELECT MAX(sort_order) AS m FROM trip_items WHERE trip_id = ?',
    tripId,
  );
  return (r?.m ?? -1) + 1;
}

// ---------- trips ----------
trips.get('/trips/:id', async (c) => c.json(await tripDetail(c.env.DB, c.req.param('id'))));

type TripCreateInput = ReturnType<typeof tripCreate.parse>;

/**
 * Works out everything a new trip needs (bags, rows, where each row goes) without
 * writing anything. Used both to create the trip and to preview it.
 */
async function planTrip(db: D1Database, input: TripCreateInput, id: string, now: string) {
  const fromDates = tripLength(input.start_date, input.end_date);
  const days = input.days ?? fromDates?.days ?? null;
  const nights = input.nights ?? fromDates?.nights ?? null;
  const len = lenOf({ days, nights });
  const travelers = [...(await existingIds(db, 'people', input.travelers))];

  let templateId: string | null = null;
  let clonedFrom: string | null = null;
  let climate = input.climate ?? null;
  let activities = input.activities;
  let tripType = input.trip_type ?? null;
  let categoryOrder: string[] = input.category_order ?? [];
  const bags: (TripBag & { source?: string })[] = [];
  let drafts: (TripItemDraft & { sort_order?: number })[] = [];
  let todos: TodoDraft[] = [];
  const dates = { start_date: input.start_date ?? null, end_date: input.end_date ?? null };
  const suitcases = new Map((await loadSuitcases(db)).map((s) => [s.id, s]));

  const addBag = (bg: {
    suitcase_id?: string | null;
    label: string;
    role?: string | null;
    carry_on?: boolean;
    notes?: string | null;
    people?: string[];
    sort_order?: number;
  }) => {
    const suitcase = bg.suitcase_id ? suitcases.get(bg.suitcase_id) : undefined;
    bags.push({
      id: newId(),
      trip_id: id,
      suitcase_id: suitcase?.id ?? null,
      label: bg.label,
      role: bg.role ?? null,
      carry_on: bg.carry_on ?? defaultBagCarryOn(suitcase?.carry_on, bg.role),
      notes: bg.notes ?? null,
      sort_order: bg.sort_order ?? bags.length,
      people: bg.people ?? suitcase?.people ?? [],
    });
  };

  if (input.source.kind === 'clone') {
    const src = await getTrip(db, input.source.trip_id);
    clonedFrom = src.id;
    templateId = src.template_id;
    climate ??= src.climate;
    if (!activities.length) activities = src.activities;
    tripType ??= src.trip_type;
    if (!categoryOrder.length) categoryOrder = src.category_order;
    const [srcBags, srcItems] = await Promise.all([
      loadTripBags(db, src.id),
      loadTripItems(db, src.id),
    ]);
    const plan = planClone({
      sourceName: src.name,
      newName: input.name,
      bags: srcBags,
      items: srcItems,
      len,
      travelers: travelers.length ? travelers : undefined,
      newId,
    });
    for (const bg of plan.bags) bags.push({ ...bg, trip_id: id });
    drafts = plan.items;
    todos = planTodosClone(await loadTripTodos(db, src.id), src, dates);
    if (!travelers.length) travelers.push(...src.travelers);
  }

  let tpl: Template | undefined;
  if (input.source.kind === 'template') {
    tpl = (await loadTemplates(db, input.source.template_id))[0];
    if (!tpl) throw notFound('Template');
    templateId = tpl.id;
    climate ??= tpl.climate;
    if (!activities.length) activities = tpl.activities;
    tripType ??= tpl.trip_type;
    if (!categoryOrder.length) categoryOrder = tpl.category_order;
    todos = planTodosFromTemplate(tpl.todos);
    // The template's bag setup comes first, so its order wins when placing items.
    for (const tb of tpl.bags) {
      addBag({
        suitcase_id: tb.suitcase_id,
        label: rewriteLabelPrefix(tb.label, tpl.name, input.name),
        role: tb.role,
        carry_on: tb.carry_on,
        notes: tb.notes,
        people: tb.people,
      });
    }
  }

  // Bags passed with the request (blank trips, or extra bags on any trip).
  for (const bg of input.bags) addBag({ ...bg, sort_order: bags.length });

  if (tpl) {
    const items = new Map((await loadItems(db)).map((i) => [i.id, i]));
    drafts = planFromTemplate(tpl.items, items, {
      len,
      travelers,
      bags: typedBags(bags, suitcases),
      fallback: await getAutoPackFallback(db),
    });
  }

  const tripRow = {
    id,
    name: input.name,
    template_id: templateId,
    cloned_from_trip_id: clonedFrom,
    trip_type: tripType,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    days,
    nights,
    destination: input.destination ?? null,
    climate,
    activities: json(activities),
    category_order: json(categoryOrder),
    status: input.status ?? null,
    notes: input.notes ?? null,
    archived_at: input.archived ? now : null,
    created_at: now,
    updated_at: now,
  };
  return { tripRow, travelers, bags, drafts, todos };
}

/** What a trip would look like: bags, and how many rows would have no bag yet. */
trips.post('/trips/preview', async (c) => {
  const input = await body(c, tripCreate);
  const plan = await planTrip(c.env.DB, input, 'preview', nowIso());
  return c.json({
    bags: plan.bags.map((bg) => ({ label: bg.label, carry_on: bg.carry_on, people: bg.people })),
    rows: plan.drafts.length,
    unplaced: unplacedSummary(plan.drafts),
  });
});

trips.post('/trips', async (c) => {
  const input = await body(c, tripCreate);
  const db = c.env.DB;
  const id = newId();
  const now = nowIso();
  const { tripRow, travelers, bags, drafts, todos } = await planTrip(db, input, id, now);
  const stmts: D1PreparedStatement[] = [
    insertStmt(db, 'trips', tripRow),
    ...travelers.map((p) =>
      db.prepare('INSERT INTO trip_travelers (trip_id, person_id) VALUES (?, ?)').bind(id, p),
    ),
  ];
  for (const bg of bags) {
    stmts.push(
      insertStmt(db, 'trip_bags', {
        id: bg.id,
        trip_id: id,
        suitcase_id: bg.suitcase_id,
        label: bg.label,
        role: bg.role,
        carry_on: b(bg.carry_on),
        notes: bg.notes,
        sort_order: bg.sort_order,
        created_at: now,
        updated_at: now,
      }),
      ...bg.people.map((p) =>
        db
          .prepare('INSERT OR IGNORE INTO trip_bag_people (trip_bag_id, person_id) VALUES (?, ?)')
          .bind(bg.id, p),
      ),
    );
  }
  stmts.push(...drafts.map((d, i) => tripItemStmt(db, id, d, d.sort_order ?? i, now)));
  stmts.push(
    ...todos.map((t) =>
      insertStmt(db, 'trip_todos', {
        id: newId(),
        trip_id: id,
        title: t.title,
        phase: t.phase,
        ...whenCols(t),
        notes: t.notes,
        done: 0,
        done_at: null,
        sort_order: t.sort_order,
        created_at: now,
        updated_at: now,
      }),
    ),
  );
  await db.batch(stmts);
  return c.json(await tripDetail(db, id), 201);
});

trips.patch('/trips/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const old = await getTrip(db, id);
  const input = await body(c, tripPatch);
  const f: Record<string, unknown> = defined({
    name: input.name,
    trip_type: input.trip_type,
    start_date: input.start_date,
    end_date: input.end_date,
    days: input.days,
    nights: input.nights,
    destination: input.destination,
    climate: input.climate,
    status: input.status,
    notes: input.notes,
  });
  if (input.activities !== undefined) f.activities = json(input.activities);
  if (input.category_order !== undefined) f.category_order = json(input.category_order);
  if (input.archived !== undefined)
    f.archived_at = input.archived ? (old.archived_at ?? nowIso()) : null;

  // New dates recompute the length unless days/nights were set in the same request.
  const datesChanged = input.start_date !== undefined || input.end_date !== undefined;
  if (datesChanged && input.days === undefined && input.nights === undefined) {
    const len = tripLength(
      input.start_date !== undefined ? input.start_date : old.start_date,
      input.end_date !== undefined ? input.end_date : old.end_date,
    );
    if (len) {
      f.days = len.days;
      f.nights = len.nights;
    }
  }
  const newLen = {
    days: (f.days !== undefined ? f.days : old.days) as number | null,
    nights: (f.nights !== undefined ? f.nights : old.nights) as number | null,
  };
  const stmts: D1PreparedStatement[] = [];
  if (Object.keys(f).length) stmts.push(updateStmt(db, 'trips', id, f));
  if (newLen.days !== old.days || newLen.nights !== old.nights) {
    const now = nowIso();
    for (const r of recalcRows(await loadTripItems(db, id), lenOf(newLen))) {
      stmts.push(
        db
          .prepare('UPDATE trip_items SET qty = ?, updated_at = ? WHERE id = ?')
          .bind(r.qty, now, r.id),
      );
    }
  }
  if (input.travelers) {
    const valid = await existingIds(db, 'people', input.travelers);
    stmts.push(db.prepare('DELETE FROM trip_travelers WHERE trip_id = ?').bind(id));
    for (const p of valid)
      stmts.push(
        db.prepare('INSERT INTO trip_travelers (trip_id, person_id) VALUES (?, ?)').bind(id, p),
      );
    // Someone added after the trip was made gets their entries from its template (or the
    // trip it was copied from), as if they'd been picked at the start.
    const added = [...valid].filter((p) => !old.travelers.includes(p));
    if (added.length) stmts.push(...(await rowsForNewTravelers(db, old, added, lenOf(newLen))));
  }
  if (stmts.length) await db.batch(stmts);
  return c.json(await tripDetail(db, id));
});

trips.delete('/trips/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM trips WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

trips.post('/trips/:id/reset-packed', async (c) => {
  const id = c.req.param('id');
  await getTrip(c.env.DB, id);
  await c.env.DB.prepare(
    'UPDATE trip_items SET packed = 0, packed_at = NULL, updated_at = ? WHERE trip_id = ? AND packed = 1',
  )
    .bind(nowIso(), id)
    .run();
  return c.json(await tripDetail(c.env.DB, id));
});

trips.get('/trips/:id/suggestions', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const [trip, rows, items] = await Promise.all([
    getTrip(db, id),
    loadTripItems(db, id),
    loadItems(db),
  ]);
  const onTrip = new Set(rows.map((r) => r.item_id).filter((x): x is string => !!x));
  return c.json(suggestItems(items, trip.climate, trip.activities, onTrip));
});

/** Adds catalog items to a trip (from suggestions or the catalog picker). */
trips.post('/trips/:id/items/from-catalog', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const input = await body(c, tripItemsAdd);
  const [trip, bags, items, suitcases, fallback] = await Promise.all([
    getTrip(db, id),
    loadTripBags(db, id),
    loadItems(db),
    loadSuitcases(db),
    getAutoPackFallback(db),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const person = input.person_id
    ? (await existingIds(db, 'people', [input.person_id])).has(input.person_id)
    : false;
  const entries = [...new Set(input.item_ids)]
    .map((i) => byId.get(i))
    .filter((i): i is Item => !!i)
    .map((item) => ({
      item,
      assignees: person ? [input.person_id!] : [],
      carryHint: item.usually_carry_on,
      packType: item.pack_type,
      notes: null,
    }));
  const drafts = planRows(entries, {
    len: lenOf(trip),
    travelers: trip.travelers,
    bags: typedBags(bags, new Map(suitcases.map((s) => [s.id, s]))),
    fallback,
  });
  const start = await nextSortOrder(db, id);
  const now = nowIso();
  if (drafts.length) await db.batch(drafts.map((d, i) => tripItemStmt(db, id, d, start + i, now)));
  return c.json(await tripDetail(db, id), 201);
});

trips.post('/trips/:id/save-as-template', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const { name } = await body(c, saveAsTemplate);
  const [trip, bags, rows, items, tripTodos] = await Promise.all([
    getTrip(db, id),
    loadTripBags(db, id),
    loadTripItems(db, id),
    loadItems(db),
    loadTripTodos(db, id),
  ]);
  const plan = planTemplateFromTrip({
    rows,
    bags: new Map(bags.map((bg) => [bg.id, bg])),
    items: new Map(items.map((i) => [i.id, i])),
    newId,
  });
  const templateId = newId();
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    insertStmt(db, 'templates', {
      id: templateId,
      name,
      trip_type: trip.trip_type,
      climate: trip.climate,
      activities: json(trip.activities),
      category_order: json(trip.category_order),
      notes: null,
      created_at: now,
      updated_at: now,
    }),
  ];
  // The trip's bags become the template's bag setup, without the trip's name in front.
  bags.forEach((bg, i) => {
    const tbId = newId();
    stmts.push(
      insertStmt(db, 'template_bags', {
        id: tbId,
        template_id: templateId,
        suitcase_id: bg.suitcase_id,
        label: shortBagLabel(bg.label, trip.name),
        role: bg.role,
        carry_on: b(bg.carry_on),
        notes: bg.notes,
        sort_order: i,
        created_at: now,
        updated_at: now,
      }),
      ...bg.people.map((p) =>
        db
          .prepare(
            'INSERT OR IGNORE INTO template_bag_people (template_bag_id, person_id) VALUES (?, ?)',
          )
          .bind(tbId, p),
      ),
    );
  });
  for (const t of planTemplateTodos(tripTodos, trip)) {
    stmts.push(
      insertStmt(db, 'template_todos', {
        id: newId(),
        template_id: templateId,
        title: t.title,
        phase: t.phase,
        ...whenCols(t),
        notes: t.notes,
        sort_order: t.sort_order,
        created_at: now,
        updated_at: now,
      }),
    );
  }
  for (const ni of plan.newCatalogItems) {
    stmts.push(
      insertStmt(db, 'items', {
        id: ni.id,
        name: ni.name,
        qty_mode: 'fixed',
        qty: ni.qty,
        not_in_suitcase: b(ni.not_in_suitcase),
        category: ni.category,
        created_at: now,
        updated_at: now,
      }),
    );
  }
  for (const ti of plan.templateItems) {
    const tiId = newId();
    stmts.push(
      insertStmt(db, 'template_items', {
        id: tiId,
        template_id: templateId,
        item_id: ti.item_id,
        qty_mode_override: ti.qty_mode_override,
        qty_override: ti.qty_override,
        qty_offset_override: ti.qty_offset_override,
        carry_on: b(ti.carry_on),
        pack_type: ti.pack_type,
        category: ti.category,
        notes: ti.notes,
        sort_order: ti.sort_order,
        created_at: now,
        updated_at: now,
      }),
    );
    for (const p of ti.assignees) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO template_item_assignees (template_item_id, person_id) VALUES (?, ?)',
          )
          .bind(tiId, p),
      );
    }
  }
  await db.batch(stmts);
  return c.json((await loadTemplates(db, templateId))[0], 201);
});

trips.get('/trips/:id/export.csv', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const [{ trip, bags, items }, people] = await Promise.all([tripDetail(db, id), loadPeople(db)]);
  const pName = new Map(people.map((p) => [p.id, p.name]));
  const bag = new Map(bags.map((bg) => [bg.id, bg]));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Item', 'Person', 'Bag', 'Carry-on', 'Qty', 'Packed', 'Notes'].join(',')];
  for (const r of items) {
    const bg = r.trip_bag_id ? bag.get(r.trip_bag_id) : undefined;
    lines.push(
      [
        r.name,
        r.person_id ? (pName.get(r.person_id) ?? '') : 'Shared',
        bg ? bg.label : r.no_bag ? 'No bag' : '',
        bg?.carry_on ? 'yes' : '',
        displayQty(r) ?? '',
        r.packed ? 'yes' : '',
        r.notes ?? '',
      ]
        .map(esc)
        .join(','),
    );
  }
  const file = trip.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'trip';
  return c.body(lines.join('\n') + '\n', 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${file}.csv"`,
  });
});

// ---------- trip bags ----------
trips.post('/trips/:id/bags', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await getTrip(db, id);
  const input = await body(c, tripBagInput);
  const suitcase = input.suitcase_id
    ? (await loadSuitcases(db)).find((s) => s.id === input.suitcase_id)
    : undefined;
  const max = await first<{ m: number | null }>(
    db,
    'SELECT MAX(sort_order) AS m FROM trip_bags WHERE trip_id = ?',
    id,
  );
  const now = nowIso();
  const bagId = newId();
  await db.batch([
    insertStmt(db, 'trip_bags', {
      id: bagId,
      trip_id: id,
      suitcase_id: suitcase?.id ?? null,
      label: input.label,
      role: input.role ?? null,
      carry_on: b(input.carry_on ?? defaultBagCarryOn(suitcase?.carry_on, input.role)),
      notes: input.notes ?? null,
      sort_order: input.sort_order ?? (max?.m ?? -1) + 1,
      created_at: now,
      updated_at: now,
    }),
    ...(await setBagPeople(
      db,
      'trip_bag_people',
      'trip_bag_id',
      bagId,
      input.people ?? suitcase?.people ?? [],
    )),
  ]);
  return c.json(await tripDetail(db, id), 201);
});

trips.patch('/trip-bags/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first<{ trip_id: string }>(
    db,
    'SELECT trip_id FROM trip_bags WHERE id = ?',
    id,
  );
  if (!row) throw notFound('Bag');
  const input = await body(c, tripBagPatch);
  const f: Record<string, unknown> = defined({
    label: input.label,
    role: input.role,
    notes: input.notes,
    sort_order: input.sort_order,
  });
  if (input.suitcase_id !== undefined) {
    f.suitcase_id =
      input.suitcase_id && (await existingIds(db, 'suitcases', [input.suitcase_id])).size
        ? input.suitcase_id
        : null;
  }
  if (input.carry_on !== undefined) f.carry_on = b(input.carry_on);
  const stmts: D1PreparedStatement[] = [];
  if (Object.keys(f).length) stmts.push(updateStmt(db, 'trip_bags', id, f));
  if (input.people)
    stmts.push(...(await setBagPeople(db, 'trip_bag_people', 'trip_bag_id', id, input.people)));
  if (stmts.length) await db.batch(stmts);
  return c.json(await tripDetail(db, row.trip_id));
});

trips.delete('/trip-bags/:id', async (c) => {
  const id = c.req.param('id');
  const row = await first<{ trip_id: string }>(
    c.env.DB,
    'SELECT trip_id FROM trip_bags WHERE id = ?',
    id,
  );
  if (!row) return c.json({ ok: true });
  const moved = await first<{ n: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS n FROM trip_items WHERE trip_bag_id = ?',
    id,
  );
  await c.env.DB.prepare('DELETE FROM trip_bags WHERE id = ?').bind(id).run();
  // Its items fall back to "No bag yet" (ON DELETE SET NULL); say how many.
  return c.json({ ...(await tripDetail(c.env.DB, row.trip_id)), moved: moved?.n ?? 0 });
});

/** A trip's bags with their catalog type, for auto pack. */
/** Entries for people added to a trip later: theirs from the template or the copied trip. */
async function rowsForNewTravelers(
  db: D1Database,
  trip: Trip,
  people: string[],
  len: ReturnType<typeof lenOf>,
): Promise<D1PreparedStatement[]> {
  const rows = await loadTripItems(db, trip.id);
  // Only people with nothing on the list yet, so nobody gets things twice.
  const fresh = people.filter((p) => !rows.some((r) => r.person_id === p));
  if (!fresh.length) return [];
  const [bags, fallback] = await Promise.all([placeableBags(db, trip.id), getAutoPackFallback(db)]);
  let drafts: TripItemDraft[] = [];
  const tpl = trip.template_id ? (await loadTemplates(db, trip.template_id))[0] : undefined;
  if (tpl) {
    const items = new Map((await loadItems(db)).map((i) => [i.id, i]));
    drafts = planFromTemplate(tpl.items, items, { len, travelers: fresh, bags, fallback }).filter(
      (d) => d.person_id && fresh.includes(d.person_id),
    );
  } else if (trip.cloned_from_trip_id) {
    const src = await loadTripItems(db, trip.cloned_from_trip_id).catch(() => []);
    const plan = planClone({
      sourceName: '',
      newName: '',
      bags: [],
      items: src.filter((r) => r.person_id && fresh.includes(r.person_id)),
      len,
      newId,
    });
    drafts = plan.items.map((d) => ({
      ...d,
      ...(d.no_bag
        ? { trip_bag_id: null }
        : placeRow(
            {
              person_id: d.person_id,
              carry: d.carry_hint,
              not_in_suitcase: false,
              pack_type: d.pack_type,
            },
            bags,
            fallback,
          )),
    }));
  }
  if (!drafts.length) return [];
  const start = await nextSortOrder(db, trip.id);
  const now = nowIso();
  return drafts.map((d, i) => tripItemStmt(db, trip.id, d, start + i, now));
}

async function placeableBags(db: D1Database, tripId: string) {
  const [bags, suitcases] = await Promise.all([loadTripBags(db, tripId), loadSuitcases(db)]);
  return typedBags(bags, new Map(suitcases.map((s) => [s.id, s])));
}

/** Rows waiting in "No bag yet" that now have a matching bag. */
trips.get('/trips/:id/placements', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await getTrip(db, id);
  const [bags, rows, fallback] = await Promise.all([
    placeableBags(db, id),
    loadTripItems(db, id),
    getAutoPackFallback(db),
  ]);
  return c.json({ moves: suggestPlacements(rows, bags, fallback) });
});

/** Moves every waiting row that now has a matching bag into it. */
trips.post('/trips/:id/placements/apply', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await getTrip(db, id);
  const [bags, rows, fallback] = await Promise.all([
    placeableBags(db, id),
    loadTripItems(db, id),
    getAutoPackFallback(db),
  ]);
  const moves = suggestPlacements(rows, bags, fallback);
  if (moves.length) {
    const now = nowIso();
    await db.batch(
      moves.map((m) =>
        db
          .prepare(
            'UPDATE trip_items SET trip_bag_id = ?, updated_at = ? WHERE id = ? AND trip_bag_id IS NULL AND no_bag = 0',
          )
          .bind(m.trip_bag_id, now, m.id),
      ),
    );
  }
  return c.json({ ...(await tripDetail(db, id)), moved: moves.length });
});

// ---------- trip items ----------
/** A row moved into a bag takes that bag's carry-on-ness as its intent. */
function syncCarryHint(db: D1Database, rowId: string) {
  return db
    .prepare(
      'UPDATE trip_items SET carry_hint = (SELECT carry_on FROM trip_bags WHERE id = trip_items.trip_bag_id) WHERE id = ? AND trip_bag_id IS NOT NULL',
    )
    .bind(rowId);
}

async function checkPlacement(
  db: D1Database,
  tripId: string,
  input: { person_id?: string | null; trip_bag_id?: string | null },
) {
  if (input.trip_bag_id) {
    const bg = await first(
      db,
      'SELECT id FROM trip_bags WHERE id = ? AND trip_id = ?',
      input.trip_bag_id,
      tripId,
    );
    if (!bg) throw new ApiError(400, 'invalid', 'That bag is not on this trip.');
  }
  if (input.person_id) {
    if (!(await existingIds(db, 'people', [input.person_id])).size)
      throw new ApiError(400, 'invalid', 'That person does not exist.');
  }
}

trips.post('/trips/:id/items', async (c) => {
  const tripId = c.req.param('id');
  const db = c.env.DB;
  const trip = await getTrip(db, tripId);
  const input = await body(c, tripItemInput);
  await checkPlacement(db, tripId, input);
  const item = input.item_id
    ? (await loadItems(db)).find((i) => i.id === input.item_id)
    : undefined;
  const calc = item ? resolveCalc(item) : null;
  const now = nowIso();
  const id = input.id ?? newId();
  let bagId = input.no_bag ? null : (input.trip_bag_id ?? null);
  let noBag = !!input.no_bag;
  // Auto pack: a catalog item with no bag chosen goes where it would on a new trip (its
  // bag type, carry-on or luggage, or No bag). An undo (it has its id) goes back as it was.
  if (item && !bagId && !noBag && !input.id) {
    const [bags, fallback] = await Promise.all([
      placeableBags(db, tripId),
      getAutoPackFallback(db),
    ]);
    const placed = placeRow(
      {
        person_id: input.person_id ?? null,
        carry: item.usually_carry_on,
        not_in_suitcase: item.not_in_suitcase,
        pack_type: item.not_in_suitcase ? null : item.pack_type,
      },
      bags,
      fallback,
    );
    bagId = placed.trip_bag_id;
    noBag = placed.no_bag;
  }
  await insertStmt(db, 'trip_items', {
    id,
    trip_id: tripId,
    item_id: item?.id ?? null,
    name: input.name,
    person_id: input.person_id ?? null,
    trip_bag_id: bagId,
    no_bag: b(noBag),
    calc_mode: calc?.mode ?? null,
    calc_unit_qty: calc?.unitQty ?? null,
    calc_max: calc?.max ?? null,
    calc_offset: calc?.offset ?? null,
    qty: calc ? calcQty(calc, lenOf(trip)) : (input.qty ?? 1),
    qty_override: input.qty_override ?? null,
    packed: b(input.packed),
    packed_at: input.packed ? now : null,
    carry_hint: b(
      bagId
        ? ((
            await first<{ c: number }>(
              db,
              'SELECT carry_on AS c FROM trip_bags WHERE id = ?',
              bagId,
            )
          )?.c ?? 0) === 1
        : (item?.usually_carry_on ?? false),
    ),
    pack_type: item?.pack_type ?? null,
    category: input.category !== undefined ? input.category : (item?.category ?? null),
    notes: input.notes ?? null,
    sort_order: input.sort_order ?? (await nextSortOrder(db, tripId)),
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(
    (await loadTripItems(db, tripId)).find((r) => r.id === id),
    201,
  );
});

trips.patch('/trip-items/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first<{ trip_id: string; packed: number }>(
    db,
    'SELECT trip_id, packed FROM trip_items WHERE id = ?',
    id,
  );
  if (!row) throw notFound('Item');
  const input = await body(c, tripItemPatch);
  await checkPlacement(db, row.trip_id, input);
  const f: Record<string, unknown> = defined({
    name: input.name,
    person_id: input.person_id,
    trip_bag_id: input.trip_bag_id,
    qty: input.qty,
    qty_override: input.qty_override,
    category: input.category,
    notes: input.notes,
    sort_order: input.sort_order,
  });
  if (input.no_bag !== undefined) {
    f.no_bag = b(input.no_bag);
    if (input.no_bag) f.trip_bag_id = null;
  } else if (input.trip_bag_id) {
    f.no_bag = 0;
  }
  if (input.packed !== undefined) {
    f.packed = b(input.packed);
    if (input.packed !== (row.packed === 1)) f.packed_at = input.packed ? nowIso() : null;
  }
  if (Object.keys(f).length) {
    await db.batch([
      updateStmt(db, 'trip_items', id, f),
      ...(f.trip_bag_id ? [syncCarryHint(db, id)] : []),
    ]);
  }
  return c.json((await loadTripItems(db, row.trip_id)).find((r) => r.id === id));
});

/** Change or delete many rows of one trip at once (multi-select). */
trips.post('/trips/:id/items/bulk', async (c) => {
  const tripId = c.req.param('id');
  const db = c.env.DB;
  await getTrip(db, tripId);
  const input = await body(c, tripItemsBulk);
  const ids = [...new Set(input.ids)];
  const onTrip = new Set(
    (await loadTripItems(db, tripId)).map((r) => r.id).filter((x) => ids.includes(x)),
  );
  const missing = ids.filter((x) => !onTrip.has(x));
  if (missing.length)
    throw new ApiError(400, 'invalid', 'Some of those items are not on this trip.');
  if (input.delete) {
    await db.batch(ids.map((x) => db.prepare('DELETE FROM trip_items WHERE id = ?').bind(x)));
    return c.json(await tripDetail(db, tripId));
  }
  if (input.assign) {
    await db.batch(await assignRows(db, tripId, ids, input.assign));
    return c.json(await tripDetail(db, tripId));
  }
  const patch = input.patch ?? {};
  await checkPlacement(db, tripId, patch);
  const f: Record<string, unknown> = defined({
    person_id: patch.person_id,
    trip_bag_id: patch.trip_bag_id,
    category: patch.category,
  });
  if (patch.no_bag !== undefined) {
    f.no_bag = b(patch.no_bag);
    if (patch.no_bag) f.trip_bag_id = null;
  } else if (patch.trip_bag_id) {
    f.no_bag = 0;
  }
  const now = nowIso();
  const stmts = ids.map((x) => {
    const g: Record<string, unknown> = { ...f };
    if (patch.packed !== undefined) g.packed = b(patch.packed);
    return updateStmt(db, 'trip_items', x, g);
  });
  if (patch.packed !== undefined) {
    // packed_at only changes for rows whose packed state actually flips.
    stmts.push(
      ...ids.map((x) =>
        db
          .prepare(
            patch.packed
              ? 'UPDATE trip_items SET packed_at = COALESCE(packed_at, ?) WHERE id = ?'
              : 'UPDATE trip_items SET packed_at = NULL WHERE id = ? AND ? IS NOT NULL',
          )
          .bind(...(patch.packed ? [now, x] : [x, now])),
      ),
    );
  }
  if (f.trip_bag_id) stmts.push(...ids.map((x) => syncCarryHint(db, x)));
  if (Object.keys(f).length || patch.packed !== undefined) await db.batch(stmts);
  return c.json(await tripDetail(db, tripId));
});

/** Saves new positions (and groups) after rows are dragged around. */
trips.post('/trips/:id/items/reorder', async (c) => {
  const tripId = c.req.param('id');
  const db = c.env.DB;
  const { moves } = await body(c, reorderRows);
  const onTrip = new Set((await loadTripItems(db, tripId)).map((r) => r.id));
  if (moves.some((m) => !onTrip.has(m.id)))
    throw new ApiError(400, 'invalid', 'Some of those items are not on this trip.');
  await db.batch(
    moves.map((m) =>
      updateStmt(db, 'trip_items', m.id, {
        sort_order: m.sort_order,
        ...(m.category !== undefined ? { category: m.category } : {}),
      }),
    ),
  );
  return c.json(await tripDetail(db, tripId));
});

// ---------- to-dos ----------
trips.post('/trips/:id/todos', async (c) => {
  const tripId = c.req.param('id');
  const db = c.env.DB;
  await getTrip(db, tripId);
  const input = await body(c, tripTodoInput);
  const max = await first<{ m: number | null }>(
    db,
    'SELECT MAX(sort_order) AS m FROM trip_todos WHERE trip_id = ?',
    tripId,
  );
  const now = nowIso();
  await insertStmt(db, 'trip_todos', {
    id: newId(),
    trip_id: tripId,
    title: input.title,
    phase: input.phase,
    ...whenCols(normalizeWhen(input)),
    notes: input.notes ?? null,
    done: b(input.done),
    done_at: input.done ? now : null,
    sort_order: input.sort_order ?? (max?.m ?? -1) + 1,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(await tripDetail(db, tripId), 201);
});

trips.patch('/trip-todos/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first<{ trip_id: string; done: number } & Record<string, unknown>>(
    db,
    'SELECT * FROM trip_todos WHERE id = ?',
    id,
  );
  if (!row) throw notFound('To-do');
  const input = await body(c, tripTodoPatch);
  const f: Record<string, unknown> = defined({
    title: input.title,
    phase: input.phase,
    notes: input.notes,
    sort_order: input.sort_order,
  });
  if (WHEN_KEYS.some((k) => input[k] !== undefined))
    Object.assign(f, whenCols(mergeWhen(row as Partial<TodoWhen>, input)));
  if (input.done !== undefined) {
    f.done = b(input.done);
    if (input.done !== (row.done === 1)) f.done_at = input.done ? nowIso() : null;
  }
  if (Object.keys(f).length) await updateStmt(db, 'trip_todos', id, f).run();
  return c.json(await tripDetail(db, row.trip_id));
});

trips.delete('/trip-todos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM trip_todos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/**
 * Gives rows to one person, to nobody (Shared), or to several people (each their own copy).
 * A row keeps its bag if it's shared or already theirs; otherwise it goes to their bag.
 */
async function assignRows(
  db: D1Database,
  tripId: string,
  ids: string[],
  assign: string[],
): Promise<D1PreparedStatement[]> {
  const valid = await existingIds(db, 'people', assign);
  const people: (string | null)[] = assign.filter((p) => valid.has(p));
  if (!people.length) people.push(null);
  const [rows, bags, fallback] = await Promise.all([
    loadTripItems(db, tripId),
    placeableBags(db, tripId),
    getAutoPackFallback(db),
  ]);
  const bagById = new Map(bags.map((bg) => [bg.id, bg]));
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows.filter((x) => ids.includes(x.id))) {
    const bagFor = (person: string | null) => {
      if (r.no_bag) return { trip_bag_id: null, no_bag: true };
      const cur = r.trip_bag_id ? bagById.get(r.trip_bag_id) : undefined;
      if (cur && (!cur.people.length || (person && cur.people.includes(person))))
        return { trip_bag_id: cur.id, no_bag: false };
      return placeRow(
        { person_id: person, carry: r.carry_hint, not_in_suitcase: false, pack_type: r.pack_type },
        bags,
        fallback,
      );
    };
    const [first, ...rest] = people;
    const place = bagFor(first!);
    stmts.push(
      updateStmt(db, 'trip_items', r.id, {
        person_id: first,
        trip_bag_id: place.trip_bag_id,
        no_bag: b(place.no_bag),
      }),
    );
    for (const person of rest) {
      const p = bagFor(person);
      stmts.push(
        insertStmt(db, 'trip_items', {
          id: newId(),
          trip_id: tripId,
          item_id: r.item_id,
          name: r.name,
          person_id: person,
          trip_bag_id: p.trip_bag_id,
          no_bag: b(p.no_bag),
          calc_mode: r.calc_mode,
          calc_unit_qty: r.calc_unit_qty,
          calc_max: r.calc_max,
          calc_offset: r.calc_offset,
          qty: r.qty,
          qty_override: r.qty_override,
          packed: 0,
          packed_at: null,
          carry_hint: b(r.carry_hint),
          pack_type: r.pack_type,
          category: r.category,
          notes: r.notes,
          sort_order: r.sort_order,
          created_at: now,
          updated_at: now,
        }),
      );
    }
  }
  return stmts;
}

trips.delete('/trip-items/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM trip_items WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
