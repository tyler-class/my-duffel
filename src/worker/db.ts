import type { RelAnchor, RelDir, TodoDateMode, TodoPhase } from '@shared/lookups';
import type { EntryKind, SectionKind, TransportMode } from '@shared/lookups';
import type {
  EntryEnd,
  Item,
  ItineraryEntry,
  ItinerarySection,
  Person,
  Suitcase,
  Template,
  TemplateBag,
  TemplateItem,
  TemplateTodo,
  TodoWhen,
  Trip,
  TripBag,
  TripItem,
  TripTodo,
} from '@shared/types';
import type { AutoPackFallback, QtyMode } from '@shared/lookups';

export type Row = Record<string, unknown>;

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export async function all<T = Row>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<T>();
  return res.results;
}

export async function first<T = Row>(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...binds)
    .first<T>();
}

/** UPDATE helper: only the given columns, plus updated_at. */
export function updateStmt(
  db: D1Database,
  table: string,
  id: string,
  fields: Record<string, unknown>,
) {
  const cols = Object.keys(fields);
  const sets = [...cols.map((c) => `${c} = ?`), 'updated_at = ?'].join(', ');
  return db
    .prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`)
    .bind(...cols.map((c) => fields[c]), nowIso(), id);
}

export function insertStmt(db: D1Database, table: string, fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  return db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => fields[c]));
}

const bool = (v: unknown) => v === 1 || v === true;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const arr = (v: unknown): string[] => {
  try {
    const p = JSON.parse(String(v ?? '[]'));
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
};
export const b = (v: boolean | undefined | null) => (v ? 1 : 0);
export const json = (v: string[] | undefined) => JSON.stringify(v ?? []);

export function toPerson(r: Row): Person {
  return {
    id: String(r.id),
    name: String(r.name),
    role: s(r.role),
    color: String(r.color),
    emoji: s(r.emoji),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
  };
}

export function toItem(r: Row, defaultPeople: string[] = []): Item {
  return {
    id: String(r.id),
    name: String(r.name),
    category: s(r.category),
    qty_mode: r.qty_mode as QtyMode,
    qty: Number(r.qty),
    max_qty: n(r.max_qty),
    qty_offset: n(r.qty_offset) ?? 0,
    climate_tags: arr(r.climate_tags),
    activity_tags: arr(r.activity_tags),
    length_in: n(r.length_in),
    width_in: n(r.width_in),
    height_in: n(r.height_in),
    dimensions_source: s(r.dimensions_source),
    not_in_suitcase: bool(r.not_in_suitcase),
    usually_carry_on: bool(r.usually_carry_on),
    pack_type: s(r.pack_type),
    notes: s(r.notes),
    archived: bool(r.archived),
    default_people: defaultPeople,
  };
}

export function toSuitcase(r: Row, people: string[] = []): Suitcase {
  return {
    id: String(r.id),
    name: String(r.name),
    type: s(r.type),
    length_in: n(r.length_in),
    width_in: n(r.width_in),
    height_in: n(r.height_in),
    capacity_l: n(r.capacity_l),
    max_weight_lb: n(r.max_weight_lb),
    notes: s(r.notes),
    carry_on: bool(r.carry_on),
    people,
  };
}

export function toTemplateItem(r: Row, assignees: string[] = []): TemplateItem {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    item_id: String(r.item_id),
    qty_mode_override: (r.qty_mode_override as QtyMode | null) ?? null,
    qty_override: n(r.qty_override),
    qty_offset_override: n(r.qty_offset_override),
    carry_on: bool(r.carry_on),
    pack_type: s(r.pack_type),
    category: s(r.category),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
    assignees,
  };
}

export function toTemplateBag(r: Row, people: string[] = []): TemplateBag {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    suitcase_id: s(r.suitcase_id),
    label: String(r.label),
    role: s(r.role),
    carry_on: bool(r.carry_on),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
    people,
  };
}

function toWhen(r: Row): TodoWhen {
  return {
    date_mode: (r.date_mode as TodoDateMode) ?? 'none',
    due_date: s(r.due_date),
    rel_days: n(r.rel_days),
    rel_dir: (r.rel_dir as RelDir | null) ?? null,
    rel_anchor: (r.rel_anchor as RelAnchor | null) ?? null,
  };
}

export function toTemplateTodo(r: Row): TemplateTodo {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    title: String(r.title),
    phase: (r.phase as TodoPhase) ?? 'pre',
    ...toWhen(r),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
  };
}

export function toTripTodo(r: Row): TripTodo {
  return {
    id: String(r.id),
    trip_id: String(r.trip_id),
    title: String(r.title),
    phase: (r.phase as TodoPhase) ?? 'pre',
    ...toWhen(r),
    notes: s(r.notes),
    done: bool(r.done),
    done_at: s(r.done_at),
    sort_order: Number(r.sort_order),
  };
}

export function toTemplate(
  r: Row,
  items: TemplateItem[] = [],
  bags: TemplateBag[] = [],
  todos: TemplateTodo[] = [],
): Template {
  return {
    id: String(r.id),
    name: String(r.name),
    trip_type: s(r.trip_type),
    climate: s(r.climate),
    activities: arr(r.activities),
    notes: s(r.notes),
    category_order: arr(r.category_order),
    items,
    bags,
    todos,
  };
}

export function toTrip(r: Row, travelers: string[] = []): Trip {
  return {
    id: String(r.id),
    name: String(r.name),
    template_id: s(r.template_id),
    cloned_from_trip_id: s(r.cloned_from_trip_id),
    trip_type: s(r.trip_type),
    start_date: s(r.start_date),
    end_date: s(r.end_date),
    days: n(r.days),
    nights: n(r.nights),
    destination: s(r.destination),
    climate: s(r.climate),
    activities: arr(r.activities),
    status: s(r.status),
    notes: s(r.notes),
    archived_at: s(r.archived_at),
    category_order: arr(r.category_order),
    travelers,
    item_count: Number(r.item_count ?? 0),
    packed_count: Number(r.packed_count ?? 0),
  };
}

export function toTripBag(r: Row, people: string[] = []): TripBag {
  return {
    id: String(r.id),
    trip_id: String(r.trip_id),
    suitcase_id: s(r.suitcase_id),
    label: String(r.label),
    role: s(r.role),
    carry_on: bool(r.carry_on),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
    people,
  };
}

export function toTripItem(r: Row): TripItem {
  return {
    id: String(r.id),
    trip_id: String(r.trip_id),
    item_id: s(r.item_id),
    name: String(r.name),
    person_id: s(r.person_id),
    trip_bag_id: s(r.trip_bag_id),
    no_bag: bool(r.no_bag),
    calc_mode: (r.calc_mode as QtyMode | null) ?? null,
    calc_unit_qty: n(r.calc_unit_qty),
    calc_max: n(r.calc_max),
    calc_offset: n(r.calc_offset),
    qty: n(r.qty),
    qty_override: n(r.qty_override),
    packed: bool(r.packed),
    packed_at: s(r.packed_at),
    carry_hint: bool(r.carry_hint),
    pack_type: s(r.pack_type),
    category: s(r.category),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
  };
}

function groupPairs(rows: Row[], key: string, val: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = String(r[key]);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(String(r[val]));
  }
  return m;
}

export async function loadPeople(db: D1Database): Promise<Person[]> {
  return (await all(db, 'SELECT * FROM people ORDER BY sort_order, name')).map(toPerson);
}

export async function loadItems(db: D1Database): Promise<Item[]> {
  const [rows, links] = await Promise.all([
    all(db, 'SELECT * FROM items ORDER BY name COLLATE NOCASE'),
    all(db, 'SELECT item_id, person_id FROM item_default_people'),
  ]);
  const byItem = groupPairs(links, 'item_id', 'person_id');
  return rows.map((r) => toItem(r, byItem.get(String(r.id)) ?? []));
}

export async function loadSuitcases(db: D1Database): Promise<Suitcase[]> {
  const [rows, links] = await Promise.all([
    all(db, 'SELECT * FROM suitcases ORDER BY name COLLATE NOCASE'),
    all(db, 'SELECT suitcase_id, person_id FROM suitcase_people'),
  ]);
  const by = groupPairs(links, 'suitcase_id', 'person_id');
  return rows.map((r) => toSuitcase(r, by.get(String(r.id)) ?? []));
}

export async function loadTemplates(db: D1Database, templateId?: string): Promise<Template[]> {
  const where = templateId ? ' WHERE id = ?' : '';
  const tWhere = templateId ? ' WHERE template_id = ?' : '';
  const binds = templateId ? [templateId] : [];
  const [rows, items, assignees] = await Promise.all([
    all(db, `SELECT * FROM templates${where} ORDER BY name COLLATE NOCASE`, ...binds),
    all(db, `SELECT * FROM template_items${tWhere} ORDER BY sort_order, created_at`, ...binds),
    all(
      db,
      `SELECT a.template_item_id, a.person_id FROM template_item_assignees a
       JOIN template_items ti ON ti.id = a.template_item_id${templateId ? ' WHERE ti.template_id = ?' : ''}`,
      ...binds,
    ),
  ]);
  const [bagRows, bagPeople] = await Promise.all([
    all(db, `SELECT * FROM template_bags${tWhere} ORDER BY sort_order, created_at`, ...binds),
    all(
      db,
      `SELECT p.template_bag_id, p.person_id FROM template_bag_people p
       JOIN template_bags tb ON tb.id = p.template_bag_id${templateId ? ' WHERE tb.template_id = ?' : ''}`,
      ...binds,
    ),
  ]);
  const todoRows = await all(
    db,
    `SELECT * FROM template_todos${tWhere} ORDER BY sort_order, created_at`,
    ...binds,
  );
  const todosByTemplate = new Map<string, TemplateTodo[]>();
  for (const r of todoRows) {
    const t = toTemplateTodo(r);
    if (!todosByTemplate.has(t.template_id)) todosByTemplate.set(t.template_id, []);
    todosByTemplate.get(t.template_id)!.push(t);
  }
  const byBag = groupPairs(bagPeople, 'template_bag_id', 'person_id');
  const bagsByTemplate = new Map<string, TemplateBag[]>();
  for (const r of bagRows) {
    const tb = toTemplateBag(r, byBag.get(String(r.id)) ?? []);
    if (!bagsByTemplate.has(tb.template_id)) bagsByTemplate.set(tb.template_id, []);
    bagsByTemplate.get(tb.template_id)!.push(tb);
  }
  const byTi = groupPairs(assignees, 'template_item_id', 'person_id');
  const byTemplate = new Map<string, TemplateItem[]>();
  for (const r of items) {
    const ti = toTemplateItem(r, byTi.get(String(r.id)) ?? []);
    if (!byTemplate.has(ti.template_id)) byTemplate.set(ti.template_id, []);
    byTemplate.get(ti.template_id)!.push(ti);
  }
  return rows.map((r) =>
    toTemplate(
      r,
      byTemplate.get(String(r.id)) ?? [],
      bagsByTemplate.get(String(r.id)) ?? [],
      todosByTemplate.get(String(r.id)) ?? [],
    ),
  );
}

const TRIP_SELECT = `SELECT t.*,
  (SELECT COUNT(*) FROM trip_items i WHERE i.trip_id = t.id) AS item_count,
  (SELECT COUNT(*) FROM trip_items i WHERE i.trip_id = t.id AND i.packed = 1) AS packed_count
  FROM trips t`;

export async function loadTrips(db: D1Database, tripId?: string): Promise<Trip[]> {
  const [rows, travelers] = await Promise.all([
    all(
      db,
      `${TRIP_SELECT}${tripId ? ' WHERE t.id = ?' : ''} ORDER BY t.start_date`,
      ...(tripId ? [tripId] : []),
    ),
    all(
      db,
      `SELECT trip_id, person_id FROM trip_travelers${tripId ? ' WHERE trip_id = ?' : ''}`,
      ...(tripId ? [tripId] : []),
    ),
  ]);
  const byTrip = groupPairs(travelers, 'trip_id', 'person_id');
  return rows.map((r) => toTrip(r, byTrip.get(String(r.id)) ?? []));
}

export async function loadTrip(db: D1Database, tripId: string): Promise<Trip | null> {
  return (await loadTrips(db, tripId))[0] ?? null;
}

export async function loadTripBags(db: D1Database, tripId: string): Promise<TripBag[]> {
  const [rows, links] = await Promise.all([
    all(db, 'SELECT * FROM trip_bags WHERE trip_id = ? ORDER BY sort_order, created_at', tripId),
    all(
      db,
      'SELECT p.trip_bag_id, p.person_id FROM trip_bag_people p JOIN trip_bags b ON b.id = p.trip_bag_id WHERE b.trip_id = ?',
      tripId,
    ),
  ]);
  const by = groupPairs(links, 'trip_bag_id', 'person_id');
  return rows.map((r) => toTripBag(r, by.get(String(r.id)) ?? []));
}

/** Replaces the people linked to a bag (suitcase, template bag or trip bag). */
export async function setBagPeople(
  db: D1Database,
  table: 'suitcase_people' | 'template_bag_people' | 'trip_bag_people',
  column: 'suitcase_id' | 'template_bag_id' | 'trip_bag_id',
  bagId: string,
  people: string[],
): Promise<D1PreparedStatement[]> {
  const valid = await existingIds(db, 'people', people);
  return [
    db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(bagId),
    ...[...valid].map((p) =>
      db.prepare(`INSERT INTO ${table} (${column}, person_id) VALUES (?, ?)`).bind(bagId, p),
    ),
  ];
}

export async function loadTripItems(db: D1Database, tripId: string): Promise<TripItem[]> {
  return (
    await all(
      db,
      'SELECT * FROM trip_items WHERE trip_id = ? ORDER BY sort_order, created_at',
      tripId,
    )
  ).map(toTripItem);
}

export async function loadTripTodos(db: D1Database, tripId: string): Promise<TripTodo[]> {
  return (
    await all(
      db,
      'SELECT * FROM trip_todos WHERE trip_id = ? ORDER BY sort_order, created_at',
      tripId,
    )
  ).map(toTripTodo);
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  return (
    (await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key))?.value ??
    null
  );
}

export async function existingIds(
  db: D1Database,
  table: string,
  ids: string[],
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const out = new Set<string>();
  // D1 allows 100 bound parameters per statement.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await all<{ id: string }>(
      db,
      `SELECT id FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk,
    );
    rows.forEach((r) => out.add(r.id));
  }
  return out;
}

/** Where an item with a bag type goes when its person has no bag of that type. */
export async function getAutoPackFallback(db: D1Database): Promise<AutoPackFallback> {
  return (await getSetting(db, 'autopack_fallback')) === 'main' ? 'main' : 'unplaced';
}

function toEnd(r: Row, side: 'start' | 'end'): EntryEnd {
  return {
    place: s(r[`${side}_place`]),
    code: s(r[`${side}_code`]),
    date: s(r[`${side}_date`]),
    time: s(r[`${side}_time`]),
    tz: s(r[`${side}_tz`]),
  };
}

export function toEntry(r: Row): ItineraryEntry {
  return {
    id: String(r.id),
    section_id: String(r.section_id),
    kind: (r.kind as EntryKind) ?? 'plan',
    mode: (r.mode as TransportMode | null) ?? null,
    title: s(r.title),
    carrier: s(r.carrier),
    number: s(r.number),
    start: toEnd(r, 'start'),
    end: toEnd(r, 'end'),
    address: s(r.address),
    confirmation: s(r.confirmation),
    details: s(r.details),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
  };
}

/** Columns for one end of an entry, from a request (only the fields it sent). */
export function endCols(side: 'start' | 'end', e: Partial<EntryEnd> | undefined) {
  const out: Record<string, unknown> = {};
  if (!e) return out;
  for (const k of ['place', 'code', 'date', 'time', 'tz'] as const)
    if (e[k] !== undefined) out[`${side}_${k}`] = e[k];
  return out;
}

export async function loadItinerary(db: D1Database, tripId: string): Promise<ItinerarySection[]> {
  const [sections, entries] = await Promise.all([
    all(
      db,
      'SELECT * FROM itinerary_sections WHERE trip_id = ? ORDER BY sort_order, created_at',
      tripId,
    ),
    all(
      db,
      `SELECT e.* FROM itinerary_entries e JOIN itinerary_sections s ON s.id = e.section_id
       WHERE s.trip_id = ? ORDER BY e.sort_order, e.created_at`,
      tripId,
    ),
  ]);
  const bySection = new Map<string, ItineraryEntry[]>();
  for (const r of entries) {
    const e = toEntry(r);
    if (!bySection.has(e.section_id)) bySection.set(e.section_id, []);
    bySection.get(e.section_id)!.push(e);
  }
  return sections.map((r) => ({
    id: String(r.id),
    trip_id: String(r.trip_id),
    kind: (r.kind as SectionKind) ?? 'stay',
    title: String(r.title),
    notes: s(r.notes),
    sort_order: Number(r.sort_order),
    entries: bySection.get(String(r.id)) ?? [],
  }));
}
