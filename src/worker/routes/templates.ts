import { Hono } from 'hono';
import {
  reorderRows,
  templateBagInput,
  templateBagPatch,
  templateInput,
  templateItemPatch,
  templateItemsAdd,
  templatePatch,
  templateTodoInput,
  templateTodoPatch,
} from '@shared/schemas';
import { defaultBagCarryOn, mergeWhen, normalizeWhen, WHEN_KEYS, whenCols } from '@shared/logic';
import type { TodoWhen } from '@shared/types';
import {
  b,
  existingIds,
  first,
  insertStmt,
  json,
  loadSuitcases,
  loadTemplates,
  newId,
  nowIso,
  setBagPeople,
  updateStmt,
} from '../db';
import { ApiError, body, defined, notFound, type AppEnv } from './util';

export const templates = new Hono<AppEnv>();

function templateFields(input: Partial<ReturnType<typeof templateInput.parse>>) {
  const f: Record<string, unknown> = defined({
    name: input.name,
    trip_type: input.trip_type,
    climate: input.climate,
    notes: input.notes,
  });
  if (input.activities !== undefined) f.activities = json(input.activities);
  if (input.category_order !== undefined) f.category_order = json(input.category_order);
  return f;
}

async function one(db: D1Database, id: string) {
  const t = (await loadTemplates(db, id))[0];
  if (!t) throw notFound('Template');
  return t;
}

templates.post('/templates', async (c) => {
  const input = await body(c, templateInput);
  const id = newId();
  const now = nowIso();
  await insertStmt(c.env.DB, 'templates', {
    id,
    ...templateFields(input),
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(await one(c.env.DB, id), 201);
});

templates.patch('/templates/:id', async (c) => {
  const id = c.req.param('id');
  await one(c.env.DB, id);
  const fields = templateFields(await body(c, templatePatch));
  if (Object.keys(fields).length) await updateStmt(c.env.DB, 'templates', id, fields).run();
  return c.json(await one(c.env.DB, id));
});

templates.delete('/templates/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/** Adds catalog items to a template. Adding one that's already there is allowed. */
templates.post('/templates/:id/items', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const t = await one(db, id);
  const { item_ids, assignees = [] } = await body(c, templateItemsAdd);
  const people = [...(await existingIds(db, 'people', assignees))];
  const valid = await existingIds(db, 'items', item_ids);
  // Each new row starts in its catalog item's group.
  const cats = new Map(
    (
      await db
        .prepare('SELECT id, category FROM items')
        .all<{ id: string; category: string | null }>()
    ).results.map((r) => [r.id, r.category]),
  );
  let order = Math.max(-1, ...t.items.map((i) => i.sort_order)) + 1;
  const now = nowIso();
  const stmts = item_ids
    .filter((i) => valid.has(i))
    .flatMap((itemId) => {
      const tiId = newId();
      return [
        insertStmt(db, 'template_items', {
          id: tiId,
          template_id: id,
          item_id: itemId,
          carry_on: 0,
          category: cats.get(itemId) ?? null,
          sort_order: order++,
          created_at: now,
          updated_at: now,
        }),
        ...people.map((p) =>
          db
            .prepare(
              'INSERT INTO template_item_assignees (template_item_id, person_id) VALUES (?, ?)',
            )
            .bind(tiId, p),
        ),
      ];
    });
  if (stmts.length) await db.batch(stmts);
  return c.json(await one(db, id), 201);
});

templates.patch('/template-items/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first<{ template_id: string }>(
    db,
    'SELECT template_id FROM template_items WHERE id = ?',
    id,
  );
  if (!row) throw notFound('Template item');
  const input = await body(c, templateItemPatch);
  const f: Record<string, unknown> = defined({
    qty_mode_override: input.qty_mode_override,
    qty_override: input.qty_override,
    qty_offset_override: input.qty_offset_override,
    pack_type: input.pack_type,
    category: input.category,
    notes: input.notes,
    sort_order: input.sort_order,
  });
  if (input.carry_on !== undefined) f.carry_on = b(input.carry_on);
  // A bag type and carry-on are one choice: a type wins.
  if (input.pack_type) f.carry_on = 0;
  const stmts = [];
  if (Object.keys(f).length) stmts.push(updateStmt(db, 'template_items', id, f));
  if (input.assignees) {
    const valid = await existingIds(db, 'people', input.assignees);
    stmts.push(
      db.prepare('DELETE FROM template_item_assignees WHERE template_item_id = ?').bind(id),
    );
    for (const p of valid)
      stmts.push(
        db
          .prepare(
            'INSERT INTO template_item_assignees (template_item_id, person_id) VALUES (?, ?)',
          )
          .bind(id, p),
      );
  }
  if (stmts.length) await db.batch(stmts);
  return c.json(await one(db, row.template_id));
});

// ---------- to-dos ----------
templates.post('/templates/:id/todos', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const t = await one(db, id);
  const input = await body(c, templateTodoInput);
  const now = nowIso();
  await insertStmt(db, 'template_todos', {
    id: newId(),
    template_id: id,
    title: input.title,
    phase: input.phase,
    ...whenCols(normalizeWhen(input)),
    notes: input.notes ?? null,
    sort_order: input.sort_order ?? Math.max(-1, ...t.todos.map((x) => x.sort_order)) + 1,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(await one(db, id), 201);
});

templates.patch('/template-todos/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first<{ template_id: string } & Record<string, unknown>>(
    db,
    'SELECT * FROM template_todos WHERE id = ?',
    id,
  );
  if (!row) throw notFound('To-do');
  const input = await body(c, templateTodoPatch);
  const f: Record<string, unknown> = defined({
    title: input.title,
    phase: input.phase,
    notes: input.notes,
    sort_order: input.sort_order,
  });
  if (WHEN_KEYS.some((k) => input[k] !== undefined))
    Object.assign(f, whenCols(mergeWhen(row as Partial<TodoWhen>, input)));
  if (Object.keys(f).length) await updateStmt(db, 'template_todos', id, f).run();
  return c.json(await one(db, row.template_id));
});

templates.delete('/template-todos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM template_todos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/** Saves new positions (and groups) after template items are dragged around. */
templates.post('/templates/:id/items/reorder', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const t = await one(db, id);
  const { moves } = await body(c, reorderRows);
  const mine = new Set(t.items.map((i) => i.id));
  if (moves.some((m) => !mine.has(m.id)))
    throw new ApiError(400, 'invalid', 'Some of those items are not on this template.');
  await db.batch(
    moves.map((m) =>
      updateStmt(db, 'template_items', m.id, {
        sort_order: m.sort_order,
        ...(m.category !== undefined ? { category: m.category } : {}),
      }),
    ),
  );
  return c.json(await one(db, id));
});

templates.delete('/template-items/:id', async (c) => {
  const id = c.req.param('id');
  const row = await first<{ template_id: string }>(
    c.env.DB,
    'SELECT template_id FROM template_items WHERE id = ?',
    id,
  );
  await c.env.DB.prepare('DELETE FROM template_items WHERE id = ?').bind(id).run();
  if (!row) return c.json({ ok: true });
  return c.json(await one(c.env.DB, row.template_id));
});

// ---------- a template's bag setup ----------
templates.post('/templates/:id/bags', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const t = await one(db, id);
  const input = await body(c, templateBagInput);
  const suitcase = input.suitcase_id
    ? (await loadSuitcases(db)).find((s) => s.id === input.suitcase_id)
    : undefined;
  const bagId = newId();
  const now = nowIso();
  await db.batch([
    insertStmt(db, 'template_bags', {
      id: bagId,
      template_id: id,
      suitcase_id: suitcase?.id ?? null,
      label: input.label,
      role: input.role ?? null,
      carry_on: b(input.carry_on ?? defaultBagCarryOn(suitcase?.carry_on, input.role)),
      notes: input.notes ?? null,
      sort_order: input.sort_order ?? Math.max(-1, ...t.bags.map((x) => x.sort_order)) + 1,
      created_at: now,
      updated_at: now,
    }),
    ...(await setBagPeople(
      db,
      'template_bag_people',
      'template_bag_id',
      bagId,
      input.people ?? suitcase?.people ?? [],
    )),
  ]);
  return c.json(await one(db, id), 201);
});

templates.patch('/template-bags/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await first<{ template_id: string }>(
    db,
    'SELECT template_id FROM template_bags WHERE id = ?',
    id,
  );
  if (!row) throw notFound('Bag');
  const input = await body(c, templateBagPatch);
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
  if (Object.keys(f).length) stmts.push(updateStmt(db, 'template_bags', id, f));
  if (input.people)
    stmts.push(
      ...(await setBagPeople(db, 'template_bag_people', 'template_bag_id', id, input.people)),
    );
  if (stmts.length) await db.batch(stmts);
  return c.json(await one(db, row.template_id));
});

templates.delete('/template-bags/:id', async (c) => {
  const id = c.req.param('id');
  const row = await first<{ template_id: string }>(
    c.env.DB,
    'SELECT template_id FROM template_bags WHERE id = ?',
    id,
  );
  await c.env.DB.prepare('DELETE FROM template_bags WHERE id = ?').bind(id).run();
  if (!row) return c.json({ ok: true });
  return c.json(await one(c.env.DB, row.template_id));
});
