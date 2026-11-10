import { describe, expect, it } from 'vitest';
import {
  templatePack,
  defaultBagCarryOn,
  placeRow,
  suggestPlacements,
  unplacedSummary,
  planClone,
  planFromTemplate,
  planTemplateFromTrip,
  rewriteLabelPrefix,
  shortBagLabel,
  suggestItems,
} from '../../src/shared/logic';
import { bag, item, row, seqIds, tItem } from './fixtures';

const ctx = (over: Partial<Parameters<typeof planFromTemplate>[2]> = {}) => ({
  len: { days: 8, nights: 7 },
  travelers: [],
  bags: [],
  ...over,
});

describe('planFromTemplate', () => {
  const shirts = item({
    id: 'shirt',
    name: 'T-shirt',
    qty_mode: 'per_day',
    qty: 1,
    max_qty: 5,
    default_people: ['p1', 'p2'],
  });
  const sunscreen = item({ id: 'sun', name: 'Sunscreen' });
  const carseat = item({
    id: 'seat',
    name: 'Car seat',
    not_in_suitcase: true,
    default_people: ['p3'],
  });
  const kindle = item({
    id: 'kindle',
    name: 'Kindle',
    usually_carry_on: true,
    default_people: ['p1'],
  });
  const items = new Map([shirts, sunscreen, carseat, kindle].map((i) => [i.id, i]));

  it('fans out one row per default person with per-person qty', () => {
    const rows = planFromTemplate([tItem({ id: 'a', item_id: 'shirt' })], items, ctx());
    expect(rows.map((r) => [r.person_id, r.qty, r.name])).toEqual([
      ['p1', 5, 'T-shirt'],
      ['p2', 5, 'T-shirt'],
    ]);
    expect(rows[0]).toMatchObject({
      calc_mode: 'per_day',
      calc_unit_qty: 1,
      calc_max: 5,
      qty_override: null,
    });
  });

  it('template assignees override the item defaults', () => {
    const rows = planFromTemplate(
      [tItem({ id: 'a', item_id: 'shirt', assignees: ['p3'] })],
      items,
      ctx(),
    );
    expect(rows.map((r) => r.person_id)).toEqual(['p3']);
  });

  it('restricts to travelers and skips items for people staying home', () => {
    const rows = planFromTemplate(
      [tItem({ id: 'a', item_id: 'shirt' }), tItem({ id: 'b', item_id: 'seat', sort_order: 1 })],
      items,
      ctx({ travelers: ['p1'] }),
    );
    expect(rows.map((r) => [r.item_id, r.person_id])).toEqual([['shirt', 'p1']]);
  });

  it('makes one shared row when nobody is assigned', () => {
    const rows = planFromTemplate(
      [tItem({ id: 'a', item_id: 'sun' })],
      items,
      ctx({ travelers: ['p1'] }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.person_id).toBeNull();
  });

  it('applies template overrides and notes', () => {
    const rows = planFromTemplate(
      [
        tItem({
          id: 'a',
          item_id: 'shirt',
          qty_mode_override: 'fixed',
          qty_override: 3,
          notes: 'linen',
          assignees: ['p1'],
        }),
      ],
      items,
      ctx(),
    );
    expect(rows[0]).toMatchObject({ qty: 3, calc_mode: 'fixed', notes: 'linen' });
  });

  it('marks not-in-suitcase items as no bag', () => {
    const rows = planFromTemplate([tItem({ id: 'a', item_id: 'seat' })], items, ctx());
    expect(rows[0]).toMatchObject({ no_bag: true, trip_bag_id: null });
  });

  it('places each person’s items in their own bags by carry-on vs checked', () => {
    const bags = [
      bag({ id: 'b1', label: 'Sam suitcase', people: ['p1'] }),
      bag({ id: 'b2', label: 'Sam carry-on', carry_on: true, people: ['p1'] }),
      bag({ id: 'b3', label: 'Kids', people: ['p3'], sort_order: 2 }),
    ];
    const rows = planFromTemplate(
      [tItem({ id: 'a', item_id: 'kindle' }), tItem({ id: 'b', item_id: 'shirt', sort_order: 1 })],
      items,
      ctx({ bags }),
    );
    expect(rows.map((r) => [r.item_id, r.person_id, r.trip_bag_id, r.carry_hint])).toEqual([
      ['kindle', 'p1', 'b2', true],
      ['shirt', 'p1', 'b1', false],
      ['shirt', 'p2', null, false],
    ]);
  });

  it('leaves per-day qty empty when the trip has no dates', () => {
    const rows = planFromTemplate(
      [tItem({ id: 'a', item_id: 'shirt', assignees: ['p1'] })],
      items,
      ctx({ len: null }),
    );
    expect(rows[0]!.qty).toBeNull();
  });

  it('skips template items whose catalog item is gone', () => {
    expect(planFromTemplate([tItem({ id: 'a', item_id: 'nope' })], items, ctx())).toEqual([]);
  });
});

describe('placeRow', () => {
  const mk = (id: string, carry: boolean, people: string[], sort_order = 0) => ({
    id,
    carry_on: carry,
    people,
    sort_order,
  });
  it('uses the person’s bag of the right kind, first by order', () => {
    const bags = [
      mk('later', false, ['p1'], 5),
      mk('first', false, ['p1'], 1),
      mk('carry', true, ['p1']),
    ];
    expect(
      placeRow({ person_id: 'p1', carry: false, not_in_suitcase: false }, bags).trip_bag_id,
    ).toBe('first');
    expect(
      placeRow({ person_id: 'p1', carry: true, not_in_suitcase: false }, bags).trip_bag_id,
    ).toBe('carry');
  });
  it('auto packs into the person’s bag of that type, then a shared one', () => {
    const bags = [
      { ...mk('main', false, ['p1']), type: 'Suitcase' },
      { ...mk('diapers', false, ['p1']), type: 'Diaper bag' },
      { ...mk('cooler', false, []), type: 'Cooler' },
    ];
    const r = (pack_type: string, person_id = 'p1') =>
      placeRow({ person_id, carry: false, not_in_suitcase: false, pack_type }, bags).trip_bag_id;
    expect(r('diaper bag')).toBe('diapers');
    expect(r('Cooler', 'p2')).toBe('cooler');
  });
  it('with no bag of that type, waits or uses the main bag per the setting', () => {
    const bags = [{ ...mk('main', false, ['p1']), type: 'Suitcase' }];
    const row = { person_id: 'p1', carry: false, not_in_suitcase: false, pack_type: 'Cooler' };
    expect(placeRow(row, bags)).toEqual({ trip_bag_id: null, no_bag: false });
    expect(placeRow(row, bags, 'main').trip_bag_id).toBe('main');
    expect(placeRow({ ...row, not_in_suitcase: true }, bags).no_bag).toBe(true);
  });
  it('a template’s bag type or carry-on wins over the catalog’s', () => {
    const cat = { usually_carry_on: true, pack_type: null };
    expect(templatePack({ carry_on: false, pack_type: 'Cooler' }, cat)).toEqual({
      carryHint: false,
      packType: 'Cooler',
    });
    expect(templatePack({ carry_on: false, pack_type: null }, cat)).toEqual({
      carryHint: true,
      packType: null,
    });
    expect(
      templatePack(
        { carry_on: true, pack_type: null },
        { usually_carry_on: false, pack_type: 'Tote' },
      ),
    ).toEqual({ carryHint: true, packType: null });
  });
  it('bags for several people work for each of them', () => {
    const bags = [mk('kids', false, ['p3', 'p4'])];
    expect(
      placeRow({ person_id: 'p4', carry: false, not_in_suitcase: false }, bags).trip_bag_id,
    ).toBe('kids');
  });
  it('falls back to the one shared bag of that kind', () => {
    expect(
      placeRow({ person_id: 'p2', carry: false, not_in_suitcase: false }, [mk('shared', false, [])])
        .trip_bag_id,
    ).toBe('shared');
    expect(
      placeRow({ person_id: 'p2', carry: false, not_in_suitcase: false }, [
        mk('s1', false, []),
        mk('s2', false, []),
      ]).trip_bag_id,
    ).toBeNull();
  });
  it('shared carry-on items use the only carry-on bag', () => {
    expect(
      placeRow({ person_id: null, carry: true, not_in_suitcase: false }, [mk('c', true, ['p1'])])
        .trip_bag_id,
    ).toBe('c');
    expect(
      placeRow({ person_id: null, carry: true, not_in_suitcase: false }, [
        mk('c', true, ['p1']),
        mk('d', true, ['p2']),
      ]).trip_bag_id,
    ).toBeNull();
  });
  it('never mixes carry-on and checked', () => {
    expect(
      placeRow({ person_id: 'p1', carry: false, not_in_suitcase: false }, [mk('c', true, ['p1'])]),
    ).toEqual({ trip_bag_id: null, no_bag: false });
  });
  it('items that never go in a bag are No bag', () => {
    expect(
      placeRow({ person_id: 'p1', carry: true, not_in_suitcase: true }, [mk('c', true, ['p1'])]),
    ).toEqual({ trip_bag_id: null, no_bag: true });
  });
  it('summarizes and re-places waiting rows', () => {
    const rows = [
      row({ id: 'r1', person_id: 'p1', carry_hint: true }),
      row({ id: 'r2', person_id: 'p1', carry_hint: true }),
      row({ id: 'r3', person_id: 'p2' }),
      row({ id: 'r4', no_bag: true }),
      row({ id: 'r5', person_id: 'p1', trip_bag_id: 'x' }),
    ];
    expect(unplacedSummary(rows)).toEqual([
      { person_id: 'p1', carry: true, pack_type: null, count: 2 },
      { person_id: 'p2', carry: false, pack_type: null, count: 1 },
    ]);
    expect(suggestPlacements(rows, [mk('c1', true, ['p1'])])).toEqual([
      { id: 'r1', trip_bag_id: 'c1' },
      { id: 'r2', trip_bag_id: 'c1' },
    ]);
  });
});

describe('defaultBagCarryOn / labels', () => {
  it('defaults carry-on from the suitcase, else the role', () => {
    expect(defaultBagCarryOn(true, 'Checked')).toBe(true);
    expect(defaultBagCarryOn(false, 'Carry-on')).toBe(false);
    expect(defaultBagCarryOn(undefined, 'Personal item')).toBe(true);
    expect(defaultBagCarryOn(null, 'Checked')).toBe(false);
    expect(defaultBagCarryOn(null, null)).toBe(false);
  });
  it('rewrites only a matching trip-name prefix', () => {
    expect(
      rewriteLabelPrefix('Mexico Dec 2026 - Big checked bag', 'Mexico Dec 2026', 'Lisbon'),
    ).toBe('Lisbon - Big checked bag');
    expect(rewriteLabelPrefix('Kids – suitcase', 'Mexico', 'Lisbon')).toBe('Kids – suitcase');
    expect(shortBagLabel('Lisbon - Big checked', 'lisbon')).toBe('Big checked');
    expect(shortBagLabel('Big checked', 'Lisbon')).toBe('Big checked');
  });
});

describe('planClone', () => {
  const bags = [
    bag({ id: 'b1', label: 'Mexico - Big', carry_on: false }),
    bag({ id: 'b2', label: 'Carry', carry_on: true, sort_order: 1 }),
  ];
  const rows = [
    row({
      id: 'r1',
      person_id: 'p1',
      trip_bag_id: 'b1',
      packed: true,
      packed_at: '2026-01-01T00:00:00Z',
      calc_mode: 'per_day',
      calc_unit_qty: 1,
      calc_max: null,
      qty: 8,
    }),
    row({
      id: 'r2',
      person_id: 'p2',
      trip_bag_id: 'b2',
      packed: true,
      qty: 3,
      qty_override: 2,
      sort_order: 1,
    }),
    row({ id: 'r3', person_id: null, no_bag: true, packed: false, sort_order: 2 }),
  ];
  const plan = planClone({
    sourceName: 'Mexico',
    newName: 'Lisbon',
    bags,
    items: rows,
    len: { days: 4, nights: 3 },
    newId: seqIds(),
  });

  it('copies bags with new ids and rewritten labels', () => {
    expect(plan.bags.map((b) => [b.id, b.source_id, b.label, b.carry_on])).toEqual([
      ['n1', 'b1', 'Lisbon - Big', false],
      ['n2', 'b2', 'Carry', true],
    ]);
  });
  it('maps rows to the new bags and keeps no-bag', () => {
    expect(plan.items.map((r) => [r.trip_bag_id, r.no_bag])).toEqual([
      ['n1', false],
      ['n2', false],
      [null, true],
    ]);
  });
  it('never carries over packed state', () => {
    for (const r of plan.items) {
      expect(r).not.toHaveProperty('packed');
      expect(r).not.toHaveProperty('packed_at');
    }
  });
  it('recomputes calculated qty for the new length and keeps overrides', () => {
    expect(plan.items.map((r) => [r.qty, r.qty_override])).toEqual([
      [4, null],
      [3, 2],
      [1, null],
    ]);
  });
  it('drops rows for people not traveling, keeps shared rows', () => {
    const p = planClone({
      sourceName: 'Mexico',
      newName: 'Lisbon',
      bags,
      items: rows,
      len: null,
      travelers: ['p2'],
      newId: seqIds(),
    });
    expect(p.items.map((r) => r.person_id)).toEqual(['p2', null]);
  });
});

describe('planTemplateFromTrip', () => {
  const items = new Map([
    ['shirt', { id: 'shirt', qty_mode: 'per_day' as const, qty: 1 }],
    ['sun', { id: 'sun', qty_mode: 'fixed' as const, qty: 1 }],
  ]);
  const bags = new Map([
    ['carry', { carry_on: true }],
    ['big', { carry_on: false }],
  ]);
  const rows = [
    row({
      id: '1',
      item_id: 'shirt',
      person_id: 'p1',
      calc_mode: 'per_day',
      calc_unit_qty: 1,
      packed: true,
      trip_bag_id: 'big',
    }),
    row({
      id: '2',
      item_id: 'shirt',
      person_id: 'p2',
      calc_mode: 'per_day',
      calc_unit_qty: 1,
      packed: false,
      trip_bag_id: 'big',
      sort_order: 1,
    }),
    row({
      id: '3',
      item_id: 'sun',
      person_id: null,
      calc_mode: 'fixed',
      calc_unit_qty: 2,
      qty_override: 5,
      trip_bag_id: 'carry',
      sort_order: 2,
    }),
    row({ id: '4', item_id: null, name: 'Snacks ', person_id: 'p1', qty: 3, sort_order: 3 }),
    row({ id: '5', item_id: null, name: 'snacks', person_id: 'p2', qty: 3, sort_order: 4 }),
  ];
  const plan = planTemplateFromTrip({ rows, bags, items, newId: seqIds('new') });

  it('merges rows that differ only by person', () => {
    expect(plan.templateItems[0]).toMatchObject({
      item_id: 'shirt',
      assignees: ['p1', 'p2'],
      qty_mode_override: null,
      qty_override: null,
      carry_on: false,
    });
  });
  it('keeps unit overrides, takes carry-on from the bag, drops manual totals', () => {
    expect(plan.templateItems[1]).toMatchObject({
      item_id: 'sun',
      assignees: [],
      qty_override: 2,
      carry_on: true,
    });
  });
  it('adds ad-hoc rows to the catalog once', () => {
    expect(plan.newCatalogItems).toEqual([
      { id: 'new1', name: 'Snacks', qty: 3, not_in_suitcase: false, category: null },
    ]);
    expect(plan.templateItems[2]).toMatchObject({ item_id: 'new1', assignees: ['p1', 'p2'] });
  });
  it('has no packed state anywhere', () => {
    expect(JSON.stringify(plan)).not.toMatch(/packed/);
  });
});

describe('suggestItems', () => {
  const all = [
    item({ id: 'any' }),
    item({ id: 'hot', climate_tags: ['Hot'] }),
    item({ id: 'beach', activity_tags: ['Beach', 'Pool'] }),
    item({ id: 'ski', climate_tags: ['Cold'], activity_tags: ['Skiing'] }),
    item({ id: 'old', archived: true }),
  ];
  it('matches climate and activities, excluding items already on the trip', () => {
    const ids = suggestItems(all, 'hot', ['pool'], new Set(['any'])).map((i) => i.id);
    expect(ids).toEqual(['hot', 'beach']);
  });
  it('climate-tagged items need a trip climate', () => {
    expect(suggestItems(all, null, [], new Set()).map((i) => i.id)).toEqual(['any']);
  });
});
