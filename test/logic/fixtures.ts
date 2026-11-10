import type { Item, TemplateItem, TripBag, TripItem } from '../../src/shared/types';

export function item(p: Partial<Item> & { id: string; name?: string }): Item {
  return {
    name: p.id,
    category: null,
    qty_mode: 'fixed',
    qty: 1,
    max_qty: null,
    qty_offset: 0,
    climate_tags: [],
    activity_tags: [],
    length_in: null,
    width_in: null,
    height_in: null,
    dimensions_source: null,
    not_in_suitcase: false,
    usually_carry_on: false,
    pack_type: null,
    notes: null,
    archived: false,
    default_people: [],
    ...p,
  };
}

export function tItem(p: Partial<TemplateItem> & { id: string; item_id: string }): TemplateItem {
  return {
    template_id: 't1',
    qty_mode_override: null,
    qty_override: null,
    qty_offset_override: null,
    carry_on: false,
    pack_type: null,
    category: null,
    notes: null,
    sort_order: 0,
    assignees: [],
    ...p,
  };
}

export function bag(p: Partial<TripBag> & { id: string }): TripBag {
  return {
    trip_id: 'trip',
    suitcase_id: null,
    label: p.id,
    role: null,
    carry_on: false,
    notes: null,
    sort_order: 0,
    people: [],
    ...p,
  };
}

export function row(p: Partial<TripItem> & { id: string }): TripItem {
  return {
    trip_id: 'trip',
    item_id: null,
    name: p.id,
    person_id: null,
    trip_bag_id: null,
    no_bag: false,
    calc_mode: null,
    calc_unit_qty: null,
    calc_max: null,
    calc_offset: null,
    qty: 1,
    qty_override: null,
    category: null,
    packed: false,
    packed_at: null,
    carry_hint: false,
    pack_type: null,
    notes: null,
    sort_order: 0,
    ...p,
  };
}

export function seqIds(prefix = 'n') {
  let i = 0;
  return () => `${prefix}${++i}`;
}
