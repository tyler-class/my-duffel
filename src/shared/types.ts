import type {
  AutoPackFallback,
  EntryKind,
  SectionKind,
  TransportMode,
  QtyMode,
  RelAnchor,
  RelDir,
  TodoDateMode,
  TodoPhase,
} from './lookups';

export interface Person {
  id: string;
  name: string;
  role: string | null;
  color: string;
  emoji: string | null;
  notes: string | null;
  sort_order: number;
}

export interface Item {
  id: string;
  name: string;
  category: string | null;
  qty_mode: QtyMode;
  qty: number;
  max_qty: number | null;
  /** Added to a per-day or per-night count: 1 per day plus 2. Can be negative. */
  qty_offset: number;
  climate_tags: string[];
  activity_tags: string[];
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  dimensions_source: string | null;
  not_in_suitcase: boolean;
  usually_carry_on: boolean;
  /** Auto pack: goes into its person's bag of this type ("Diaper bag"). */
  pack_type: string | null;
  notes: string | null;
  archived: boolean;
  default_people: string[];
}

export interface Suitcase {
  id: string;
  name: string;
  type: string | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  capacity_l: number | null;
  max_weight_lb: number | null;
  notes: string | null;
  /** Its items count as carry-on; carry-on items go here when a trip is built. */
  carry_on: boolean;
  /** Who this bag is for. Empty = shared. */
  people: string[];
}

export interface TemplateItem {
  id: string;
  template_id: string;
  item_id: string;
  qty_mode_override: QtyMode | null;
  qty_override: number | null;
  /** Null = the catalog item's offset. */
  qty_offset_override: number | null;
  carry_on: boolean;
  /** Auto pack bag type; wins over carry_on and the catalog's choice. */
  pack_type: string | null;
  /** Item group on the template ("Clothing"). Null = not in a group. */
  category: string | null;
  notes: string | null;
  sort_order: number;
  assignees: string[];
}

/** A bag in a template's bag setup; copied onto trips built from the template. */
export interface TemplateBag {
  id: string;
  template_id: string;
  suitcase_id: string | null;
  label: string;
  role: string | null;
  carry_on: boolean;
  notes: string | null;
  sort_order: number;
  people: string[];
}

/** When a to-do is due: no date, a fixed date, or relative to the trip's dates. */
export interface TodoWhen {
  date_mode: TodoDateMode;
  /** Fixed mode. */
  due_date: string | null;
  /** Relative mode: `rel_days` days `rel_dir` the `rel_anchor` of the trip. */
  rel_days: number | null;
  rel_dir: RelDir | null;
  rel_anchor: RelAnchor | null;
}

/** A to-do on a template. */
export interface TemplateTodo extends TodoWhen {
  id: string;
  template_id: string;
  title: string;
  phase: TodoPhase;
  notes: string | null;
  sort_order: number;
}

export interface Template {
  id: string;
  name: string;
  trip_type: string | null;
  climate: string | null;
  activities: string[];
  notes: string | null;
  /** Order of the item groups; groups not listed follow in the default order. */
  category_order: string[];
  items: TemplateItem[];
  bags: TemplateBag[];
  todos: TemplateTodo[];
}

export interface Trip {
  id: string;
  name: string;
  template_id: string | null;
  cloned_from_trip_id: string | null;
  trip_type: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  nights: number | null;
  destination: string | null;
  climate: string | null;
  activities: string[];
  status: string | null;
  notes: string | null;
  archived_at: string | null;
  /** Order of the item groups; groups not listed follow in the default order. */
  category_order: string[];
  travelers: string[];
  item_count: number;
  packed_count: number;
}

export interface TripBag {
  id: string;
  trip_id: string;
  suitcase_id: string | null;
  label: string;
  role: string | null;
  carry_on: boolean;
  notes: string | null;
  sort_order: number;
  /** Who this bag is for. Empty = shared. */
  people: string[];
}

export interface TripItem {
  id: string;
  trip_id: string;
  item_id: string | null;
  name: string;
  person_id: string | null;
  trip_bag_id: string | null;
  no_bag: boolean;
  calc_mode: QtyMode | null;
  calc_unit_qty: number | null;
  calc_max: number | null;
  calc_offset: number | null;
  qty: number | null;
  qty_override: number | null;
  packed: boolean;
  packed_at: string | null;
  /** Should ride in its person's carry-on bag. */
  carry_hint: boolean;
  /** Auto pack bag type: the row moves into a bag of this type when one is added. */
  pack_type: string | null;
  /** Item group on the list ("Clothing"). Null = not in a group. */
  category: string | null;
  notes: string | null;
  sort_order: number;
}

export interface TripTodo extends TodoWhen {
  id: string;
  trip_id: string;
  title: string;
  phase: TodoPhase;
  notes: string | null;
  done: boolean;
  done_at: string | null;
  sort_order: number;
}

export interface Settings {
  instance_name: string;
  /** Where an item with a bag type goes when its person has no bag of that type. */
  autopack_fallback: AutoPackFallback;
  /** Someone added the update workflow to this copy's GitHub repo (from Settings → Updates). */
  updates_set_up: boolean;
  /** Send the anonymous daily check-in (row counts only). */
  telemetry: boolean;
}

/** Everything except trip items: small enough to load in one request. */
export interface AppState {
  settings: Settings;
  people: Person[];
  items: Item[];
  suitcases: Suitcase[];
  templates: Template[];
  trips: Trip[];
  lookups: Record<string, string[]>;
}

/** One end of an itinerary entry: a departure or arrival, check-in or check-out, start or end. */
export interface EntryEnd {
  place: string | null;
  /** Airport or station code, like "BOS". */
  code: string | null;
  date: string | null;
  /** Local "HH:MM", as printed on the booking. */
  time: string | null;
  /** IANA time zone of the place, like "America/New_York". */
  tz: string | null;
}

export interface ItineraryEntry {
  id: string;
  section_id: string;
  kind: EntryKind;
  mode: TransportMode | null;
  title: string | null;
  carrier: string | null;
  number: string | null;
  start: EntryEnd;
  end: EntryEnd;
  address: string | null;
  confirmation: string | null;
  details: string | null;
  notes: string | null;
  sort_order: number;
}

export interface ItinerarySection {
  id: string;
  trip_id: string;
  kind: SectionKind;
  title: string;
  notes: string | null;
  sort_order: number;
  entries: ItineraryEntry[];
}

export interface TripDetail {
  trip: Trip;
  bags: TripBag[];
  items: TripItem[];
  todos: TripTodo[];
  itinerary: ItinerarySection[];
}
