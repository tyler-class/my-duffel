// Seed suggestions for free-text fields. Users can type anything; pickers offer
// these plus every value already in use.

export const QTY_MODES = ['fixed', 'per_day', 'per_night'] as const;
export type QtyMode = (typeof QTY_MODES)[number];
export const QTY_MODE_LABELS: Record<QtyMode, string> = {
  fixed: 'Fixed',
  per_day: 'Per day',
  per_night: 'Per night',
};

/** When a to-do happens: before, during or after the trip. */
export const TODO_PHASES = ['pre', 'during', 'after'] as const;
export type TodoPhase = (typeof TODO_PHASES)[number];
export const TODO_PHASE_LABELS: Record<TodoPhase, string> = {
  pre: 'Pre-trip',
  during: 'During trip',
  after: 'After trip',
};

/** A to-do's date: none, a fixed date, or relative to the trip. */
export const TODO_DATE_MODES = ['none', 'fixed', 'relative'] as const;
export type TodoDateMode = (typeof TODO_DATE_MODES)[number];
export const REL_DIRS = ['before', 'on', 'after'] as const;
export type RelDir = (typeof REL_DIRS)[number];
export const REL_ANCHORS = ['start', 'middle', 'end'] as const;
export type RelAnchor = (typeof REL_ANCHORS)[number];

/** Itinerary sections: getting from one place to another, or time in one place. */
export const SECTION_KINDS = ['travel', 'stay'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Itinerary entries. Transport is a departure and its arrival; lodging a check-in and out. */
export const ENTRY_KINDS = ['transport', 'lodging', 'plan', 'note'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  transport: 'Transport',
  lodging: 'Lodging',
  plan: 'Plan',
  note: 'Note',
};

export const TRANSPORT_MODES = ['plane', 'train', 'bus', 'boat', 'car', 'other'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];
export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  plane: 'Flight',
  train: 'Train',
  bus: 'Bus',
  boat: 'Boat',
  car: 'Car',
  other: 'Other',
};

export const DEFAULT_LOOKUPS = {
  role: ['Adult', 'Child', 'Baby'],
  category: [
    'Clothing',
    'Toiletries',
    'Baby gear',
    'Feeding',
    'Diapering',
    'Sleep',
    'Health & safety',
    'Electronics',
    'Documents',
    'Food & drink',
    'Beach & pool',
    'Outdoor',
    'Entertainment',
    'Misc',
  ],
  climate: ['Cold', 'Mild', 'Hot'],
  activity: ['Beach', 'Pool', 'City', 'Hiking', 'Camping', 'Skiing', 'Nice dinners'],
  suitcaseType: ['Suitcase', 'Duffel', 'Backpack', 'Diaper bag', 'Tote', 'Cooler'],
  tripType: ['Car trip', 'Domestic flight', 'International flight'],
  tripStatus: ['Planning', 'Packing', 'Packed', 'Done'],
  bagRole: ['Checked', 'Carry-on', 'Personal item', 'Car trunk', 'Car cabin'],
} as const;

export type LookupKind = keyof typeof DEFAULT_LOOKUPS;
export type Lookups = Record<LookupKind, string[]>;

/** Where an item with a bag type goes when its person has no bag of that type. */
export const AUTOPACK_FALLBACKS = ['unplaced', 'main'] as const;
export type AutoPackFallback = (typeof AUTOPACK_FALLBACKS)[number];

/** Bag roles that make a trip bag carry-on when it has no suitcase. */
export const CARRY_ON_BAG_ROLES = ['carry-on', 'personal item'];

/** Person colors. Keys map to CSS tokens (--person-<key>). */
export const PERSON_COLORS = [
  'blue',
  'violet',
  'coral',
  'amber',
  'green',
  'rose',
  'teal',
  'slate',
] as const;
export type PersonColor = (typeof PERSON_COLORS)[number];

export function mergeLookups(inUse: Partial<Record<LookupKind, string[]>>): Lookups {
  const out = {} as Lookups;
  for (const kind of Object.keys(DEFAULT_LOOKUPS) as LookupKind[]) {
    const seen = new Map<string, string>();
    for (const v of [...DEFAULT_LOOKUPS[kind], ...(inUse[kind] ?? [])]) {
      const t = v.trim();
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    }
    out[kind] = [...seen.values()];
  }
  return out;
}
