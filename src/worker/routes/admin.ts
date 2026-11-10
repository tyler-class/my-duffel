// App state, settings, backup/restore and sample data.
import { Hono } from 'hono';
import { mergeLookups, type LookupKind } from '@shared/lookups';
import { settingsPatch } from '@shared/schemas';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  PRIVATE_SETTINGS,
  TABLE_ORDER,
  isDuffelExport,
  rowValues,
  type DuffelExport,
  type ExportRow,
} from '@shared/exportFormat';
import type { AppState } from '@shared/types';
import { dayNumber } from '@shared/logic';
import {
  all,
  first,
  getAutoPackFallback,
  getSetting,
  loadItems,
  loadPeople,
  loadSuitcases,
  loadTemplates,
  loadTrips,
} from '../db';
import sample from '../../../seed/sample.json';
import { ApiError, body, type AppEnv } from './util';
import { kitState, setKitState } from '../kit/telemetry';

export const admin = new Hono<AppEnv>();

export const DEFAULT_INSTANCE_NAME = 'Duffel';

async function distinct(db: D1Database, sql: string): Promise<string[]> {
  return (await all<{ v: string }>(db, sql)).map((r) => r.v).filter(Boolean);
}

async function lookupsInUse(db: D1Database): Promise<Partial<Record<LookupKind, string[]>>> {
  const tags = (col: string, table: string) =>
    distinct(db, `SELECT DISTINCT j.value AS v FROM ${table}, json_each(${table}.${col}) j`);
  const [
    role,
    category,
    categoryTrips,
    categoryTemplates,
    climateItems,
    climateTrips,
    climateTemplates,
    activityItems,
    activityTrips,
    activityTemplates,
    suitcaseType,
    tripType,
    tripTypeT,
    tripStatus,
    bagRole,
  ] = await Promise.all([
    distinct(db, 'SELECT DISTINCT role AS v FROM people'),
    distinct(db, 'SELECT DISTINCT category AS v FROM items'),
    distinct(db, 'SELECT DISTINCT category AS v FROM trip_items'),
    distinct(db, 'SELECT DISTINCT category AS v FROM template_items'),
    tags('climate_tags', 'items'),
    distinct(db, 'SELECT DISTINCT climate AS v FROM trips'),
    distinct(db, 'SELECT DISTINCT climate AS v FROM templates'),
    tags('activity_tags', 'items'),
    tags('activities', 'trips'),
    tags('activities', 'templates'),
    distinct(db, 'SELECT DISTINCT type AS v FROM suitcases'),
    distinct(db, 'SELECT DISTINCT trip_type AS v FROM trips'),
    distinct(db, 'SELECT DISTINCT trip_type AS v FROM templates'),
    distinct(db, 'SELECT DISTINCT status AS v FROM trips'),
    distinct(db, 'SELECT DISTINCT role AS v FROM trip_bags'),
  ]);
  return {
    role,
    category: [...category, ...categoryTrips, ...categoryTemplates],
    climate: [...climateItems, ...climateTrips, ...climateTemplates],
    activity: [...activityItems, ...activityTrips, ...activityTemplates],
    suitcaseType,
    tripType: [...tripType, ...tripTypeT],
    tripStatus,
    bagRole,
  };
}

admin.get('/state', async (c) => {
  const db = c.env.DB;
  const [instanceName, fallback, kit, people, items, suitcases, templates, trips, inUse] =
    await Promise.all([
      getSetting(db, 'instance_name'),
      getAutoPackFallback(db),
      kitState(db),
      loadPeople(db),
      loadItems(db),
      loadSuitcases(db),
      loadTemplates(db),
      loadTrips(db),
      lookupsInUse(db),
    ]);
  const state: AppState = {
    settings: {
      instance_name: instanceName ?? DEFAULT_INSTANCE_NAME,
      autopack_fallback: fallback,
      updates_set_up: kit.updates_set_up,
      telemetry: kit.telemetry,
    },
    people,
    items,
    suitcases,
    templates,
    trips,
    lookups: mergeLookups(inUse),
  };
  return c.json(state);
});

admin.patch('/settings', async (c) => {
  const input = await body(c, settingsPatch);
  const db = c.env.DB;
  const set = (key: string, value: string) =>
    db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .bind(key, value);
  const stmts = [];
  if (input.instance_name !== undefined) stmts.push(set('instance_name', input.instance_name));
  if (input.autopack_fallback !== undefined)
    stmts.push(set('autopack_fallback', input.autopack_fallback));
  if (stmts.length) await db.batch(stmts);
  if (input.updates_set_up !== undefined || input.telemetry !== undefined)
    await setKitState(db, { updates_set_up: input.updates_set_up, telemetry: input.telemetry });
  return c.json(input);
});

export async function exportAll(db: D1Database): Promise<DuffelExport> {
  const tables: DuffelExport['tables'] = {};
  for (const t of TABLE_ORDER) {
    let rows = await all<ExportRow>(db, `SELECT * FROM ${t}`);
    if (t === 'settings') rows = rows.filter((r) => !PRIVATE_SETTINGS.includes(String(r.key)));
    tables[t] = rows;
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    tables,
  };
}

/** Replaces all data with the export's rows in one atomic batch. */
export async function importAll(
  db: D1Database,
  data: DuffelExport,
  { replace }: { replace: boolean },
) {
  const stmts: D1PreparedStatement[] = [];
  if (replace) {
    for (const t of [...TABLE_ORDER].reverse()) {
      stmts.push(
        t === 'settings'
          ? db
              .prepare(
                `DELETE FROM settings WHERE key NOT IN (${PRIVATE_SETTINGS.map(() => '?').join(',')})`,
              )
              .bind(...PRIVATE_SETTINGS)
          : db.prepare(`DELETE FROM ${t}`),
      );
    }
  }
  for (const t of TABLE_ORDER) {
    for (const row of data.tables[t] ?? []) {
      if (t === 'settings' && PRIVATE_SETTINGS.includes(String(row.key))) continue;
      const { cols, vals } = rowValues(t, row);
      if (!cols.length) continue;
      stmts.push(
        db
          .prepare(
            `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          )
          .bind(...vals),
      );
    }
  }
  await db.batch(stmts);
}

admin.get('/export', async (c) => {
  const data = await exportAll(c.env.DB);
  const stamp = data.exported_at.slice(0, 10);
  return c.json(data, 200, {
    'Content-Disposition': `attachment; filename="duffel-backup-${stamp}.json"`,
  });
});

admin.post('/import', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!isDuffelExport(raw)) throw new ApiError(400, 'invalid', 'That file is not a Duffel backup.');
  if (raw.version > EXPORT_VERSION)
    throw new ApiError(
      400,
      'invalid',
      'That backup is from a newer version of Duffel. Update this instance first.',
    );
  try {
    await importAll(c.env.DB, raw, { replace: true });
  } catch (e) {
    throw new ApiError(400, 'invalid', `Could not restore that backup: ${(e as Error).message}`);
  }
  return c.json({ ok: true });
});

/** Moves the sample trip so it starts three weeks from today. */
function shiftSampleDates(data: DuffelExport): DuffelExport {
  const trips = data.tables.trips ?? [];
  const firstStart = trips
    .map((t) => dayNumber(t.start_date as string | null))
    .find((d) => d !== null);
  if (firstStart === undefined || firstStart === null) return data;
  const today = Math.floor(Date.now() / 86_400_000);
  const offset = today + 21 - firstStart;
  const shift = (d: unknown) => {
    const n = dayNumber(d as string | null);
    return n === null ? d : new Date((n + offset) * 86_400_000).toISOString().slice(0, 10);
  };
  return {
    ...data,
    tables: {
      ...data.tables,
      trips: trips.map(
        (t) =>
          ({ ...t, start_date: shift(t.start_date), end_date: shift(t.end_date) }) as ExportRow,
      ),
    },
  };
}

async function isEmpty(db: D1Database): Promise<boolean> {
  const r = await first<{ n: number }>(
    db,
    'SELECT (SELECT COUNT(*) FROM people) + (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM trips) AS n',
  );
  return (r?.n ?? 0) === 0;
}

admin.post('/sample-data', async (c) => {
  if (!(await isEmpty(c.env.DB)))
    throw new ApiError(409, 'not_empty', 'Sample data can only be loaded into an empty Duffel.');
  await importAll(c.env.DB, shiftSampleDates(sample as unknown as DuffelExport), {
    replace: false,
  });
  return c.json({ ok: true }, 201);
});
