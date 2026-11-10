// People, catalog items and suitcases.
import { Hono } from 'hono';
import {
  personInput,
  personPatch,
  itemInput,
  itemPatch,
  suitcaseInput,
  suitcasePatch,
} from '@shared/schemas';
import { pickPersonColor } from '@shared/logic';
import {
  all,
  b,
  existingIds,
  first,
  insertStmt,
  json,
  loadItems,
  loadPeople,
  loadSuitcases,
  newId,
  nowIso,
  setBagPeople,
  updateStmt,
} from '../db';
import { body, defined, notFound, type AppEnv } from './util';

export const catalog = new Hono<AppEnv>();

// ---------- people ----------
catalog.post('/people', async (c) => {
  const input = await body(c, personInput);
  const db = c.env.DB;
  const existing = await all<{ color: string; sort_order: number }>(
    db,
    'SELECT color, sort_order FROM people',
  );
  const id = newId();
  const now = nowIso();
  await insertStmt(db, 'people', {
    id,
    name: input.name,
    role: input.role ?? null,
    color: input.color ?? pickPersonColor(existing.map((p) => p.color)),
    emoji: input.emoji ?? null,
    notes: input.notes ?? null,
    sort_order: input.sort_order ?? Math.max(-1, ...existing.map((p) => p.sort_order)) + 1,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(
    (await loadPeople(db)).find((p) => p.id === id),
    201,
  );
});

catalog.patch('/people/:id', async (c) => {
  const id = c.req.param('id');
  const input = defined(await body(c, personPatch));
  if (!(await first(c.env.DB, 'SELECT id FROM people WHERE id = ?', id))) throw notFound('Person');
  if (Object.keys(input).length) await updateStmt(c.env.DB, 'people', id, input).run();
  return c.json((await loadPeople(c.env.DB)).find((p) => p.id === id));
});

catalog.delete('/people/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM people WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- items ----------
function itemFields(input: Partial<ReturnType<typeof itemInput.parse>>) {
  const f: Record<string, unknown> = {};
  for (const k of [
    'name',
    'category',
    'qty_mode',
    'qty',
    'max_qty',
    'qty_offset',
    'length_in',
    'width_in',
    'height_in',
    'dimensions_source',
    'pack_type',
    'notes',
  ] as const) {
    if (input[k] !== undefined) f[k] = input[k];
  }
  if (input.climate_tags !== undefined) f.climate_tags = json(input.climate_tags);
  if (input.activity_tags !== undefined) f.activity_tags = json(input.activity_tags);
  for (const k of ['not_in_suitcase', 'usually_carry_on', 'archived'] as const) {
    if (input[k] !== undefined) f[k] = b(input[k]);
  }
  return f;
}

async function setDefaultPeople(db: D1Database, itemId: string, people: string[]) {
  const valid = await existingIds(db, 'people', people);
  await db.batch([
    db.prepare('DELETE FROM item_default_people WHERE item_id = ?').bind(itemId),
    ...[...valid].map((p) =>
      db
        .prepare('INSERT INTO item_default_people (item_id, person_id) VALUES (?, ?)')
        .bind(itemId, p),
    ),
  ]);
}

/** Auto pack is one choice: no bag, a bag type, carry-on, or their luggage. */
async function noCarryOnWithoutBag(db: D1Database, itemId: string) {
  await db.batch([
    db
      .prepare(
        'UPDATE items SET usually_carry_on = 0, pack_type = NULL WHERE id = ? AND not_in_suitcase = 1',
      )
      .bind(itemId),
    db
      .prepare('UPDATE items SET usually_carry_on = 0 WHERE id = ? AND pack_type IS NOT NULL')
      .bind(itemId),
  ]);
}

catalog.post('/items', async (c) => {
  const input = await body(c, itemInput);
  const id = newId();
  const now = nowIso();
  await insertStmt(c.env.DB, 'items', {
    id,
    ...itemFields(input),
    created_at: now,
    updated_at: now,
  }).run();
  if (input.default_people.length) await setDefaultPeople(c.env.DB, id, input.default_people);
  await noCarryOnWithoutBag(c.env.DB, id);
  return c.json(
    (await loadItems(c.env.DB)).find((i) => i.id === id),
    201,
  );
});

catalog.patch('/items/:id', async (c) => {
  const id = c.req.param('id');
  const input = await body(c, itemPatch);
  if (!(await first(c.env.DB, 'SELECT id FROM items WHERE id = ?', id))) throw notFound('Item');
  const fields = itemFields(input);
  if (Object.keys(fields).length) await updateStmt(c.env.DB, 'items', id, fields).run();
  if (input.default_people) await setDefaultPeople(c.env.DB, id, input.default_people);
  await noCarryOnWithoutBag(c.env.DB, id);
  return c.json((await loadItems(c.env.DB)).find((i) => i.id === id));
});

catalog.delete('/items/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- suitcases ----------
catalog.post('/suitcases', async (c) => {
  const { people, ...input } = await body(c, suitcaseInput);
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    insertStmt(c.env.DB, 'suitcases', {
      id,
      ...input,
      carry_on: b(input.carry_on),
      created_at: now,
      updated_at: now,
    }),
    ...(await setBagPeople(c.env.DB, 'suitcase_people', 'suitcase_id', id, people)),
  ]);
  return c.json(
    (await loadSuitcases(c.env.DB)).find((s) => s.id === id),
    201,
  );
});

catalog.patch('/suitcases/:id', async (c) => {
  const id = c.req.param('id');
  const { people, ...rest } = await body(c, suitcasePatch);
  const input: Record<string, unknown> = defined(rest);
  if (rest.carry_on !== undefined) input.carry_on = b(rest.carry_on);
  if (!(await first(c.env.DB, 'SELECT id FROM suitcases WHERE id = ?', id)))
    throw notFound('Suitcase');
  const stmts: D1PreparedStatement[] = [];
  if (Object.keys(input).length) stmts.push(updateStmt(c.env.DB, 'suitcases', id, input));
  if (people)
    stmts.push(...(await setBagPeople(c.env.DB, 'suitcase_people', 'suitcase_id', id, people)));
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json((await loadSuitcases(c.env.DB)).find((s) => s.id === id));
});

catalog.delete('/suitcases/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM suitcases WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
