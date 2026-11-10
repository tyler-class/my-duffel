// Converts an Airtable packing base (shaped like the original PackIt base) into a Duffel backup
// and SQL. See docs/importing-from-airtable.md.
//
// Usage: npx tsx scripts/airtable-to-sql.ts [data/airtable-export.json] [data/duffel-import]
// Writes <out>.json (restore it in Settings) and <out>.sql (for wrangler d1 execute).
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { calcQty, defaultBagCarryOn, pickPersonColor, tripLength } from '../src/shared/logic';
import type { QtyMode } from '../src/shared/lookups';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportToSql,
  type DuffelExport,
  type ExportRow,
} from '../src/shared/exportFormat';

type Fields = Record<string, unknown>;
interface Rec {
  id: string;
  createdTime?: string;
  fields: Fields;
}
interface AirtableExport {
  tables: Record<string, Rec[]>;
}

const [input = 'data/airtable-export.json', out = 'data/duffel-import'] = process.argv.slice(2);
const src = JSON.parse(readFileSync(input, 'utf8')) as AirtableExport;
const table = (name: string): Rec[] => src.tables[name] ?? [];
const log: string[] = [];
const now = new Date().toISOString();

// Optional per-person look, matched by first name. Everyone else gets the next free color.
const LOOK: Record<string, { color: string; emoji: string }> = JSON.parse(
  process.env.DUFFEL_PEOPLE_LOOK ?? '{}',
);

const ids = new Map<string, string>();
const idFor = (rec: string) => {
  if (!ids.has(rec)) ids.set(rec, randomUUID());
  return ids.get(rec)!;
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (v === true ? 1 : 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const one = (v: unknown) => list(v)[0] ?? null;
const MODE: Record<string, QtyMode> = {
  Fixed: 'fixed',
  'Per day': 'per_day',
  'Per night': 'per_night',
};
const mode = (v: unknown): QtyMode | null => (typeof v === 'string' ? (MODE[v] ?? null) : null);
const stamp = (r: Rec) => ({ created_at: r.createdTime ?? now, updated_at: now });
/** "T-shirts - Sam" → "T-shirts" (the old label convention appended the person). */
const cleanLabel = (s: string) => s.replace(/\s-\s[^-]*$/, '').trim() || s.trim();

// ---------- people ----------
const usedColors: string[] = [];
const people: ExportRow[] = table('People').map((r, i) => {
  const name = str(r.fields['Name']) ?? 'Someone';
  const look = LOOK[name.toLowerCase()];
  const color = look?.color ?? pickPersonColor(usedColors);
  usedColors.push(color);
  return {
    id: idFor(r.id),
    name,
    role: str(r.fields['Role']),
    color,
    emoji: look?.emoji ?? null,
    notes: str(r.fields['Notes']),
    sort_order: i,
    ...stamp(r),
  };
});
const personIds = new Set(table('People').map((r) => r.id));

// ---------- items ----------
const itemRecs = new Map(table('Items').map((r) => [r.id, r]));
const items: ExportRow[] = [];
const itemDefaultPeople: ExportRow[] = [];
for (const r of table('Items')) {
  const f = r.fields;
  items.push({
    id: idFor(r.id),
    name: str(f['Item']) ?? 'Unnamed item',
    category: str(f['Category']),
    qty_mode: mode(f['Quantity Mode']) ?? 'fixed',
    qty: num(f['Qty']) ?? 1,
    max_qty: num(f['Max Qty']),
    climate_tags: JSON.stringify(list(f['Climate Tags'])),
    activity_tags: JSON.stringify(list(f['Activity Tags'])),
    length_in: num(f['Length (in)']),
    width_in: num(f['Width (in)']),
    height_in: num(f['Height (in)']),
    dimensions_source: str(f['Dimensions Source']),
    not_in_suitcase: bool(f['Not in suitcase']),
    usually_carry_on: bool(f['Usually carry-on']),
    notes: str(f['Notes']),
    archived: 0,
    ...stamp(r),
  });
  for (const p of list(f['For']))
    if (personIds.has(p)) itemDefaultPeople.push({ item_id: idFor(r.id), person_id: idFor(p) });
}

// ---------- suitcases ----------
const suitcaseRecs = new Map(table('Suitcases').map((r) => [r.id, r]));
const CARRY_TYPES = ['carry-on', 'backpack', 'diaper bag'];
const suitcaseCarry = (r: Rec) => CARRY_TYPES.includes((str(r.fields['Type']) ?? '').toLowerCase());
const suitcases: ExportRow[] = table('Suitcases').map((r) => ({
  id: idFor(r.id),
  name: str(r.fields['Suitcase']) ?? 'Bag',
  // "Carry-on" and "Checked" aren't bag types in Duffel; carry-on is its own flag.
  type: /^(carry-on|checked)$/i.test(str(r.fields['Type']) ?? '')
    ? 'Suitcase'
    : str(r.fields['Type']),
  carry_on: suitcaseCarry(r) ? 1 : 0,
  length_in: num(r.fields['Length (in)']),
  width_in: num(r.fields['Width (in)']),
  height_in: num(r.fields['Height (in)']),
  capacity_l: num(r.fields['Capacity (L)']),
  max_weight_lb: num(r.fields['Max Weight (lb)']),
  notes: str(r.fields['Notes']),
  ...stamp(r),
}));

// ---------- templates ----------
const templateRecs = new Map(table('Templates').map((r) => [r.id, r]));
const templates: ExportRow[] = table('Templates').map((r) => ({
  id: idFor(r.id),
  name: str(r.fields['Template']) ?? 'Template',
  trip_type: str(r.fields['Trip Type']),
  climate: str(r.fields['Climate']),
  activities: JSON.stringify(list(r.fields['Activities'])),
  notes: str(r.fields['Notes']),
  ...stamp(r),
}));
const templateItems: ExportRow[] = [];
const templateItemAssignees: ExportRow[] = [];
table('Template Items').forEach((r, i) => {
  const tpl = one(r.fields['Template']);
  const item = one(r.fields['Item']);
  if (!tpl || !item || !templateRecs.has(tpl) || !itemRecs.has(item)) {
    log.push(
      `Template item “${str(r.fields['Label']) ?? r.id}” skipped: missing template or item.`,
    );
    return;
  }
  templateItems.push({
    id: idFor(r.id),
    template_id: idFor(tpl),
    item_id: idFor(item),
    qty_mode_override: mode(r.fields['Quantity Mode Override']),
    qty_override: num(r.fields['Qty Override']),
    carry_on: bool(r.fields['Carry-on']),
    notes: str(r.fields['Notes']),
    sort_order: i,
    ...stamp(r),
  });
  for (const p of list(r.fields['Assignee']))
    if (personIds.has(p))
      templateItemAssignees.push({ template_item_id: idFor(r.id), person_id: idFor(p) });
});

// ---------- trips ----------
const tripRecs = table('Trips');
const tripByName = new Map(
  tripRecs.map((r) => [(str(r.fields['Trip']) ?? '').toLowerCase(), r.id]),
);
const tripLen = new Map<string, { days: number | null; nights: number | null }>();
const trips: ExportRow[] = [];
const tripTravelers: ExportRow[] = [];
for (const r of tripRecs) {
  const f = r.fields;
  const start = str(f['Start Date']);
  const end = str(f['End Date']);
  const fromDates = tripLength(start, end);
  const days = num(f['Days']) ?? fromDates?.days ?? null;
  const nights = num(f['Nights']) ?? fromDates?.nights ?? null;
  tripLen.set(r.id, { days, nights });
  const tpl = one(f['Template']);
  const tplRec = tpl ? templateRecs.get(tpl) : undefined;
  const clonedName = str(f['Cloned From']);
  const clonedFrom = clonedName ? tripByName.get(clonedName.toLowerCase()) : undefined;
  if (clonedName && !clonedFrom)
    log.push(`Trip “${str(f['Trip'])}”: Cloned From “${clonedName}” matches no trip; left blank.`);
  trips.push({
    id: idFor(r.id),
    name: str(f['Trip']) ?? 'Trip',
    template_id: tplRec ? idFor(tplRec.id) : null,
    cloned_from_trip_id: clonedFrom ? idFor(clonedFrom) : null,
    trip_type: tplRec ? str(tplRec.fields['Trip Type']) : null,
    start_date: start,
    end_date: end,
    days,
    nights,
    destination: str(f['Destination']),
    climate: tplRec ? str(tplRec.fields['Climate']) : null,
    activities: JSON.stringify(tplRec ? list(tplRec.fields['Activities']) : []),
    status: str(f['Status']),
    notes: str(f['Notes']),
    archived_at: null,
    ...stamp(r),
  });
  for (const p of list(f['Travelers']))
    if (personIds.has(p)) tripTravelers.push({ trip_id: idFor(r.id), person_id: idFor(p) });
}

// ---------- trip bags ----------
const bagCarry = new Map<string, boolean>();
const bagTrip = new Map<string, string>();
const tripBags: ExportRow[] = [];
table('Trip Suitcases').forEach((r, i) => {
  const trip = one(r.fields['Trip']);
  if (!trip || !tripLen.has(trip)) {
    log.push(`Bag “${str(r.fields['Label']) ?? r.id}” skipped: no trip.`);
    return;
  }
  const suitcase = one(r.fields['Suitcase']);
  const sRec = suitcase ? suitcaseRecs.get(suitcase) : undefined;
  const role = str(r.fields['Role']);
  const carry = defaultBagCarryOn(sRec ? suitcaseCarry(sRec) : null, role);
  bagCarry.set(r.id, carry);
  bagTrip.set(r.id, trip);
  tripBags.push({
    id: idFor(r.id),
    trip_id: idFor(trip),
    suitcase_id: sRec ? idFor(sRec.id) : null,
    label: str(r.fields['Label']) ?? (sRec ? str(sRec.fields['Suitcase']) : null) ?? 'Bag',
    role,
    carry_on: carry ? 1 : 0,
    notes: str(r.fields['Notes']),
    sort_order: i,
    ...stamp(r),
  });
});

// ---------- trip items ----------
const tripItems: ExportRow[] = [];
const rows = [...table('Trip Items')].sort(
  (a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? '') || a.id.localeCompare(b.id),
);
rows.forEach((r, i) => {
  const f = r.fields;
  const label = str(f['Label']) ?? '';
  const trip = one(f['Trip']);
  if (!trip || !tripLen.has(trip)) {
    log.push(`Row “${label || r.id}” skipped: no trip.`);
    return;
  }
  const itemRec = one(f['Item']) ? itemRecs.get(one(f['Item'])!) : undefined;
  if (!label && !itemRec) {
    log.push(`Row ${r.id} skipped: no name and no item.`);
    return;
  }
  const name = label ? cleanLabel(label) : str(itemRec!.fields['Item'])!;

  const assignees = list(f['Assignee']).filter((p) => personIds.has(p));
  let person: string | null = assignees[0] ? idFor(assignees[0]) : null;
  if (assignees.length > 1) {
    person = null;
    log.push(`Row “${label}”: ${assignees.length} people assigned; imported as Shared.`);
  }

  const bags = list(f['Trip Suitcase']).filter((b) => bagTrip.get(b) === trip);
  if (list(f['Trip Suitcase']).length > 1)
    log.push(`Row “${label}”: several bags; kept the first.`);
  const bag = bags[0] ?? null;
  const notInSuitcase = itemRec
    ? f['Not in suitcase (from item)'] === true || itemRec.fields['Not in suitcase'] === true
    : false;
  const noBag = !bag && notInSuitcase;

  const rowCarry = f['Carry-on'] === true;
  const bagIsCarry = bag ? bagCarry.get(bag) === true : false;
  if (rowCarry && !bagIsCarry)
    log.push(
      `Row “${label}”: marked carry-on but its bag isn’t a carry-on bag. Carry-on now comes from the bag.`,
    );
  if (!rowCarry && bagIsCarry)
    log.push(`Row “${label}”: in a carry-on bag, so it now counts as carry-on.`);

  const airtableQty = num(f['Qty Override']) ?? num(f['Qty']);
  let calc: { mode: QtyMode; unitQty: number; max: number | null } | null = null;
  let qty: number | null = airtableQty ?? 1;
  let override: number | null = null;
  if (itemRec) {
    calc = {
      mode: mode(itemRec.fields['Quantity Mode']) ?? 'fixed',
      unitQty: num(itemRec.fields['Qty']) ?? 1,
      max: num(itemRec.fields['Max Qty']),
    };
    qty = calcQty(calc, tripLen.get(trip));
    if (airtableQty !== null && airtableQty !== qty) override = airtableQty;
  }

  tripItems.push({
    id: idFor(r.id),
    trip_id: idFor(trip),
    item_id: itemRec ? idFor(itemRec.id) : null,
    name,
    person_id: person,
    trip_bag_id: bag ? idFor(bag) : null,
    no_bag: noBag ? 1 : 0,
    calc_mode: calc?.mode ?? null,
    calc_unit_qty: calc?.unitQty ?? null,
    calc_max: calc?.max ?? null,
    qty,
    qty_override: override,
    packed: bool(f['Packed']),
    packed_at: f['Packed'] === true ? now : null,
    notes: str(f['Notes']),
    sort_order: i,
    ...stamp(r),
  });
});

const data: DuffelExport = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exported_at: now,
  tables: {
    people,
    items,
    item_default_people: itemDefaultPeople,
    suitcases,
    templates,
    template_items: templateItems,
    template_item_assignees: templateItemAssignees,
    trips,
    trip_travelers: tripTravelers,
    trip_bags: tripBags,
    trip_items: tripItems,
  },
};

writeFileSync(`${out}.json`, JSON.stringify(data, null, 1) + '\n');
writeFileSync(`${out}.sql`, exportToSql(data));
console.log(`Wrote ${out}.json and ${out}.sql`);
console.log(
  'Rows:',
  Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v!.length])),
);
console.log(
  log.length ? `Notes (${log.length}):\n- ${log.join('\n- ')}` : 'Nothing needed attention.',
);
