// Generates seed/sample.json: a small, generic household for demos and "Load sample data".
// Run: npx tsx scripts/build-sample.ts
import { writeFileSync } from 'node:fs';
import {
  planFromTemplate,
  planTodosFromTemplate,
  tripLength,
  defaultBagCarryOn,
} from '../src/shared/logic';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type DuffelExport,
  type ExportRow,
} from '../src/shared/exportFormat';
import type { Item, TemplateItem, TemplateTodo } from '../src/shared/types';
import type { QtyMode } from '../src/shared/lookups';

let n = 0;
const id = (p: string) => `sample-${p}-${String(++n).padStart(3, '0')}`;
const T = '2026-01-01T00:00:00.000Z';
const stamp = { created_at: T, updated_at: T };

const people = [
  { id: id('person'), name: 'Sam', role: 'Adult', color: 'blue' },
  { id: id('person'), name: 'Alex', role: 'Adult', color: 'violet' },
  { id: id('person'), name: 'Mia', role: 'Child', color: 'coral' },
  { id: id('person'), name: 'Leo', role: 'Baby', color: 'amber' },
];
const [sam, alex, mia, leo] = people.map((p) => p.id) as [string, string, string, string];
const adults = [sam, alex];
const kids = [mia, leo];
const everyone = [...adults, ...kids];

type Def = [
  name: string,
  category: string,
  mode: QtyMode,
  qty: number,
  max: number | null,
  people: string[],
  extra?: Partial<Item>,
];
const defs: Def[] = [
  ['T-shirt', 'Clothing', 'per_day', 1, 7, everyone],
  ['Underwear', 'Clothing', 'per_day', 1, 8, [sam, alex, mia]],
  ['Socks', 'Clothing', 'per_day', 1, 7, everyone],
  ['Pants', 'Clothing', 'per_day', 0.5, 4, everyone],
  ['Pajamas', 'Clothing', 'fixed', 2, null, everyone],
  ['Swimsuit', 'Beach & pool', 'fixed', 2, null, everyone, { activity_tags: ['Beach', 'Pool'] }],
  [
    'Sun hat',
    'Beach & pool',
    'fixed',
    1,
    null,
    everyone,
    { climate_tags: ['Hot'], length_in: 12, width_in: 12, height_in: 4 },
  ],
  [
    'Sunscreen',
    'Toiletries',
    'fixed',
    1,
    null,
    [],
    { climate_tags: ['Hot', 'Mild'], length_in: 2, width_in: 2, height_in: 6 },
  ],
  [
    'Puffer jacket',
    'Clothing',
    'fixed',
    1,
    null,
    everyone,
    { climate_tags: ['Cold'], length_in: 14, width_in: 10, height_in: 6 },
  ],
  [
    'Toiletry kit',
    'Toiletries',
    'fixed',
    1,
    null,
    adults,
    { length_in: 10, width_in: 6, height_in: 4 },
  ],
  ['Toothbrush', 'Toiletries', 'fixed', 1, null, kids],
  ['Diapers', 'Diapering', 'per_day', 6, null, [leo], { length_in: 4, width_in: 3, height_in: 1 }],
  ['Wipes', 'Diapering', 'fixed', 2, null, [leo], { length_in: 8, width_in: 5, height_in: 2 }],
  ['Bottles', 'Feeding', 'fixed', 4, null, [leo], { length_in: 3, width_in: 3, height_in: 7 }],
  ['Sippy cup', 'Feeding', 'fixed', 2, null, [mia]],
  ['Sleep sack', 'Sleep', 'fixed', 1, null, [leo], { length_in: 10, width_in: 8, height_in: 3 }],
  ['Travel crib', 'Baby gear', 'fixed', 1, null, [leo], { not_in_suitcase: true }],
  ['Car seat', 'Baby gear', 'fixed', 1, null, kids, { not_in_suitcase: true }],
  ['Stroller', 'Baby gear', 'fixed', 1, null, [], { not_in_suitcase: true }],
  ['Medications', 'Health & safety', 'fixed', 1, null, [], { usually_carry_on: true }],
  [
    'First-aid kit',
    'Health & safety',
    'fixed',
    1,
    null,
    [],
    { length_in: 7, width_in: 5, height_in: 2 },
  ],
  ['Phone charger', 'Electronics', 'fixed', 1, null, adults, { usually_carry_on: true }],
  ['Headphones', 'Electronics', 'fixed', 1, null, [sam, alex, mia], { usually_carry_on: true }],
  ['Tablet', 'Entertainment', 'fixed', 1, null, [mia], { usually_carry_on: true }],
  ['Books', 'Entertainment', 'fixed', 2, null, [sam, alex]],
  ['Passports', 'Documents', 'fixed', 1, null, [], { usually_carry_on: true }],
  ['Snacks', 'Feeding', 'per_day', 1, 5, [], { usually_carry_on: true }],
  ['Nice outfit', 'Clothing', 'fixed', 1, null, adults, { activity_tags: ['Nice dinners'] }],
  [
    'Hiking boots',
    'Outdoor',
    'fixed',
    1,
    null,
    adults,
    { activity_tags: ['Hiking'], length_in: 13, width_in: 9, height_in: 6 },
  ],
  [
    'Ski goggles',
    'Outdoor',
    'fixed',
    1,
    null,
    adults,
    { activity_tags: ['Skiing'], climate_tags: ['Cold'] },
  ],
];

const items: Item[] = defs.map(([name, category, qty_mode, qty, max_qty, def, extra]) => ({
  id: id('item'),
  name,
  category,
  qty_mode,
  qty,
  max_qty,
  qty_offset: 0,
  pack_type: null,
  climate_tags: [],
  activity_tags: [],
  length_in: null,
  width_in: null,
  height_in: null,
  dimensions_source: null,
  not_in_suitcase: false,
  usually_carry_on: false,
  notes: null,
  archived: false,
  default_people: def,
  ...extra,
}));
const byName = new Map(items.map((i) => [i.name, i]));
const itemMap = new Map(items.map((i) => [i.id, i]));

const suitcases = [
  {
    id: id('suitcase'),
    name: 'Big checked',
    type: 'Suitcase',
    carry_on: false,
    length_in: 30,
    width_in: 20,
    height_in: 12,
    capacity_l: 110,
  },
  {
    id: id('suitcase'),
    name: 'Medium spinner',
    type: 'Suitcase',
    carry_on: false,
    length_in: 26,
    width_in: 18,
    height_in: 11,
    capacity_l: 80,
  },
  {
    id: id('suitcase'),
    name: 'Roller carry-on',
    type: 'Suitcase',
    carry_on: true,
    length_in: 22,
    width_in: 14,
    height_in: 9,
    capacity_l: 40,
  },
  {
    id: id('suitcase'),
    name: 'Everyday backpack',
    type: 'Backpack',
    carry_on: true,
    length_in: 18,
    width_in: 12,
    height_in: 7,
    capacity_l: 25,
  },
];

function template(
  name: string,
  trip_type: string,
  climate: string,
  activities: string[],
  names: (string | [string, Partial<TemplateItem>])[],
) {
  const tid = id('template');
  const tItems: TemplateItem[] = names.map((x, i) => {
    const [nm, over] = typeof x === 'string' ? [x, {}] : x;
    const it = byName.get(nm);
    if (!it) throw new Error(nm);
    return {
      id: id('titem'),
      template_id: tid,
      item_id: it.id,
      qty_mode_override: null,
      qty_offset_override: null,
      pack_type: null,
      qty_override: null,
      carry_on: false,
      category: it.category,
      notes: null,
      sort_order: i,
      assignees: [],
      ...over,
    };
  });
  return {
    tpl: {
      id: tid,
      name,
      trip_type,
      climate,
      activities: JSON.stringify(activities),
      notes: null,
      ...stamp,
    },
    tItems,
  };
}

const beach = template(
  'Beach week',
  'Domestic flight',
  'Hot',
  ['Beach', 'Pool'],
  [
    'T-shirt',
    'Underwear',
    'Socks',
    'Pants',
    'Pajamas',
    'Swimsuit',
    'Sun hat',
    'Sunscreen',
    'Toiletry kit',
    'Toothbrush',
    'Diapers',
    'Wipes',
    'Bottles',
    'Sippy cup',
    'Sleep sack',
    'Travel crib',
    'Car seat',
    'Medications',
    'First-aid kit',
    'Phone charger',
    'Headphones',
    'Tablet',
    'Books',
    'Snacks',
    ['Nice outfit', { notes: 'For the anniversary dinner' }],
  ],
);
const weekend = template(
  'Weekend away',
  'Car trip',
  'Mild',
  [],
  [
    'T-shirt',
    'Underwear',
    'Socks',
    'Pajamas',
    'Toiletry kit',
    'Toothbrush',
    'Diapers',
    'Wipes',
    'Sleep sack',
    'Travel crib',
    'Car seat',
    'Stroller',
    'Phone charger',
    'Snacks',
  ],
);

// One upcoming trip built from the beach template. Dates are shifted to the future when loaded.
const tripId = id('trip');
const start = '2026-12-12';
const end = '2026-12-19';
const len = tripLength(start, end)!;

// Things to do around the trip; the trip gets them with real dates.
const beachTodos: TemplateTodo[] = (
  [
    ['Book a pet sitter', 'pre', 21, 'before', 'start', null],
    ['Check passports are valid', 'pre', 30, 'before', 'start', 'Six months past the return date'],
    ['Hold the mail', 'pre', 3, 'before', 'start', null],
    ['Book the snorkel trip', 'during', 0, 'on', 'middle', null],
    ['Return the rental car', 'after', 0, 'on', 'end', 'Fill the tank first'],
    ['Unpack and do laundry', 'after', 1, 'after', 'end', null],
  ] as const
).map(([title, phase, rel_days, rel_dir, rel_anchor, notes], i) => ({
  id: id('ttodo'),
  template_id: beach.tpl.id,
  title,
  phase,
  date_mode: 'relative',
  due_date: null,
  rel_days,
  rel_dir,
  rel_anchor,
  notes,
  sort_order: i,
}));
const tripTodos = planTodosFromTemplate(beachTodos);
const bagDefs = [
  [suitcases[0]!, 'Big checked', 'Checked'],
  [suitcases[1]!, 'Kids’ suitcase', 'Checked'],
  [suitcases[2]!, 'Sam carry-on', 'Carry-on'],
  [suitcases[3]!, 'Alex backpack', 'Personal item'],
] as const;
// Who each bag is for: Sam and Alex share the big one, the kids share theirs.
const owners: Record<string, string[]> = {
  'Big checked': adults,
  'Kids’ suitcase': kids,
  'Sam carry-on': [sam],
  'Alex backpack': [alex],
};
const bags = bagDefs.map(([s, label, role], i) => ({
  id: id('bag'),
  trip_id: tripId,
  suitcase_id: s.id,
  label,
  role,
  carry_on: defaultBagCarryOn(s.carry_on, role) ? 1 : 0,
  notes: null,
  sort_order: i,
  ...stamp,
}));
// The beach template has the same bag setup.
const templateBags = bagDefs.map(([s, label, role], i) => ({
  id: id('tbag'),
  template_id: beach.tpl.id,
  suitcase_id: s.id,
  label,
  role,
  carry_on: defaultBagCarryOn(s.carry_on, role) ? 1 : 0,
  notes: null,
  sort_order: i,
  ...stamp,
}));
const drafts = planFromTemplate(beach.tItems, itemMap, {
  len,
  travelers: everyone,
  bags: bags.map((b) => ({
    id: b.id,
    carry_on: b.carry_on === 1,
    people: owners[b.label] ?? [],
    sort_order: b.sort_order,
  })),
});
// Put clothing in sensible bags so "By bag" looks real.
const kidsBag = bags[1]!.id;
const bigBag = bags[0]!.id;
const tripItems = drafts.map((d, i) => {
  let bag = d.trip_bag_id;
  if (!bag && !d.no_bag && i % 5 !== 4)
    bag = d.person_id && kids.includes(d.person_id) ? kidsBag : bigBag;
  return {
    id: id('row'),
    trip_id: tripId,
    ...d,
    trip_bag_id: bag,
    no_bag: d.no_bag ? 1 : 0,
    packed: i % 4 === 0 ? 1 : 0,
    packed_at: i % 4 === 0 ? T : null,
    sort_order: i,
    ...stamp,
  };
});

const b = (v: boolean) => (v ? 1 : 0);
const data: DuffelExport = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exported_at: T,
  tables: {
    people: people.map((p, i) => ({ ...p, emoji: null, notes: null, sort_order: i, ...stamp })),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      qty_mode: i.qty_mode,
      qty: i.qty,
      max_qty: i.max_qty,
      climate_tags: JSON.stringify(i.climate_tags),
      activity_tags: JSON.stringify(i.activity_tags),
      length_in: i.length_in,
      width_in: i.width_in,
      height_in: i.height_in,
      dimensions_source: null,
      not_in_suitcase: b(i.not_in_suitcase),
      usually_carry_on: b(i.usually_carry_on),
      notes: null,
      archived: 0,
      ...stamp,
    })),
    item_default_people: items.flatMap((i) =>
      i.default_people.map((p) => ({ item_id: i.id, person_id: p })),
    ),
    suitcases: suitcases.map((s) => ({
      ...s,
      carry_on: s.carry_on ? 1 : 0,
      max_weight_lb: null,
      notes: null,
      ...stamp,
    })),
    suitcase_people: suitcases.flatMap((s) =>
      (
        owners[
          s.name === 'Roller carry-on'
            ? 'Sam carry-on'
            : s.name === 'Everyday backpack'
              ? 'Alex backpack'
              : s.name === 'Medium spinner'
                ? 'Kids’ suitcase'
                : s.name
        ] ?? []
      ).map((p) => ({ suitcase_id: s.id, person_id: p })),
    ),
    templates: [beach.tpl, weekend.tpl],
    template_items: [...beach.tItems, ...weekend.tItems].map(({ assignees: _a, ...t }) => ({
      ...t,
      carry_on: b(t.carry_on),
      ...stamp,
    })) as ExportRow[],
    template_item_assignees: [],
    template_bags: templateBags,
    template_todos: beachTodos.map((t) => ({ ...t, ...stamp })) as unknown as ExportRow[],
    template_bag_people: templateBags.flatMap((b) =>
      (owners[b.label] ?? []).map((p) => ({ template_bag_id: b.id, person_id: p })),
    ),
    trips: [
      {
        id: tripId,
        name: 'Lisbon',
        template_id: beach.tpl.id,
        cloned_from_trip_id: null,
        trip_type: 'International flight',
        start_date: start,
        end_date: end,
        days: len.days,
        nights: len.nights,
        destination: 'Portugal',
        climate: 'Hot',
        activities: '["Beach","Pool"]',
        status: 'Packing',
        notes: null,
        archived_at: null,
        ...stamp,
      },
    ],
    trip_travelers: everyone.map((p) => ({ trip_id: tripId, person_id: p })),
    trip_bags: bags,
    trip_bag_people: bags.flatMap((b) =>
      (owners[b.label] ?? []).map((p) => ({ trip_bag_id: b.id, person_id: p })),
    ),
    trip_items: tripItems as unknown as ExportRow[],
    trip_todos: tripTodos.map((t) => ({
      ...t,
      id: id('todo'),
      trip_id: tripId,
      done: 0,
      done_at: null,
      ...stamp,
    })) as unknown as ExportRow[],
  },
};

writeFileSync(
  new URL('../seed/sample.json', import.meta.url),
  JSON.stringify(data, null, 1) + '\n',
);
console.log(`sample: ${items.length} items, ${tripItems.length} trip rows`);
