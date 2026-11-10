// The backup format: raw rows per table, in insert order (parents first).

export const EXPORT_FORMAT = 'duffel';
export const EXPORT_VERSION = 1;

export const TABLE_COLUMNS = {
  settings: ['key', 'value'],
  people: [
    'id',
    'name',
    'role',
    'color',
    'emoji',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  items: [
    'id',
    'name',
    'category',
    'qty_mode',
    'qty',
    'max_qty',
    'qty_offset',
    'climate_tags',
    'activity_tags',
    'length_in',
    'width_in',
    'height_in',
    'dimensions_source',
    'not_in_suitcase',
    'usually_carry_on',
    'pack_type',
    'notes',
    'archived',
    'created_at',
    'updated_at',
  ],
  item_default_people: ['item_id', 'person_id'],
  suitcases: [
    'id',
    'name',
    'type',
    'length_in',
    'width_in',
    'height_in',
    'capacity_l',
    'max_weight_lb',
    'carry_on',
    'notes',
    'created_at',
    'updated_at',
  ],
  suitcase_people: ['suitcase_id', 'person_id'],
  templates: [
    'id',
    'name',
    'trip_type',
    'climate',
    'activities',
    'category_order',
    'notes',
    'created_at',
    'updated_at',
  ],
  template_items: [
    'id',
    'template_id',
    'item_id',
    'qty_mode_override',
    'qty_override',
    'qty_offset_override',
    'carry_on',
    'pack_type',
    'category',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  template_item_assignees: ['template_item_id', 'person_id'],
  template_bags: [
    'id',
    'template_id',
    'suitcase_id',
    'label',
    'role',
    'carry_on',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  template_bag_people: ['template_bag_id', 'person_id'],
  template_todos: [
    'id',
    'template_id',
    'title',
    'phase',
    'date_mode',
    'due_date',
    'rel_days',
    'rel_dir',
    'rel_anchor',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  trips: [
    'id',
    'name',
    'template_id',
    'cloned_from_trip_id',
    'trip_type',
    'start_date',
    'end_date',
    'days',
    'nights',
    'destination',
    'climate',
    'activities',
    'category_order',
    'status',
    'notes',
    'archived_at',
    'created_at',
    'updated_at',
  ],
  trip_travelers: ['trip_id', 'person_id'],
  trip_bags: [
    'id',
    'trip_id',
    'suitcase_id',
    'label',
    'role',
    'carry_on',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  trip_bag_people: ['trip_bag_id', 'person_id'],
  trip_todos: [
    'id',
    'trip_id',
    'title',
    'phase',
    'date_mode',
    'due_date',
    'rel_days',
    'rel_dir',
    'rel_anchor',
    'notes',
    'done',
    'done_at',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  itinerary_sections: [
    'id',
    'trip_id',
    'kind',
    'title',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  itinerary_entries: [
    'id',
    'section_id',
    'kind',
    'mode',
    'title',
    'carrier',
    'number',
    'start_place',
    'start_code',
    'start_date',
    'start_time',
    'start_tz',
    'end_place',
    'end_code',
    'end_date',
    'end_time',
    'end_tz',
    'address',
    'confirmation',
    'details',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  trip_items: [
    'id',
    'trip_id',
    'item_id',
    'name',
    'person_id',
    'trip_bag_id',
    'no_bag',
    'calc_mode',
    'calc_unit_qty',
    'calc_max',
    'calc_offset',
    'qty',
    'qty_override',
    'packed',
    'packed_at',
    'carry_hint',
    'pack_type',
    'category',
    'notes',
    'sort_order',
    'created_at',
    'updated_at',
  ],
} as const;

export type TableName = keyof typeof TABLE_COLUMNS;
export const TABLE_ORDER = Object.keys(TABLE_COLUMNS) as TableName[];

/** Settings that never leave the instance (the session-signing salt). */
export const PRIVATE_SETTINGS = ['session_salt'];

export type Cell = string | number | null;
export type ExportRow = Record<string, Cell>;

export interface DuffelExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exported_at: string;
  tables: Partial<Record<TableName, ExportRow[]>>;
}

export function isDuffelExport(v: unknown): v is DuffelExport {
  const o = v as DuffelExport;
  return (
    !!o &&
    o.format === EXPORT_FORMAT &&
    typeof o.version === 'number' &&
    !!o.tables &&
    typeof o.tables === 'object'
  );
}

/** Column names and values for one row, keeping only known columns. */
export function rowValues(table: TableName, row: ExportRow): { cols: string[]; vals: Cell[] } {
  const cols: string[] = [];
  const vals: Cell[] = [];
  for (const c of TABLE_COLUMNS[table]) {
    if (c in row) {
      const v = row[c];
      cols.push(c);
      vals.push(v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
  }
  return { cols, vals };
}

function sqlLiteral(v: Cell): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${v.replace(/'/g, "''")}'`;
}

/** Plain SQL inserts for `wrangler d1 execute --file`. Does not delete existing rows. */
export function exportToSql(data: DuffelExport): string {
  const lines: string[] = ['PRAGMA defer_foreign_keys = ON;'];
  for (const table of TABLE_ORDER) {
    for (const row of data.tables[table] ?? []) {
      const { cols, vals } = rowValues(table, row);
      lines.push(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.map(sqlLiteral).join(', ')});`,
      );
    }
  }
  return lines.join('\n') + '\n';
}
