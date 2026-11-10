import { describe, expect, it } from 'vitest';
import type { AppState, Item, Template, TripDetail } from '../../src/shared/types';
import { session } from './helpers';

const cats = (d: { items: { name: string; category: string | null }[] }) =>
  Object.fromEntries(d.items.map((r) => [r.name, r.category]));

describe('item groups', () => {
  it('carry from the catalog to templates, trips, copies and saved templates', async () => {
    const api = await session();
    const shirt = (await api.post<Item>('/items', { name: 'Shirt', category: 'Clothing' })).data;
    const cable = (await api.post<Item>('/items', { name: 'Cable', category: 'Electronics' })).data;
    const misc = (await api.post<Item>('/items', { name: 'Thing' })).data;

    let tpl = (await api.post<Template>('/templates', { name: 'Trip' })).data;
    tpl = (
      await api.post<Template>(`/templates/${tpl.id}/items`, {
        item_ids: [shirt.id, cable.id, misc.id],
      })
    ).data;
    expect(Object.fromEntries(tpl.items.map((i) => [i.item_id, i.category]))).toEqual({
      [shirt.id]: 'Clothing',
      [cable.id]: 'Electronics',
      [misc.id]: null,
    });

    // Regroup one template item and order the groups.
    const cableTi = tpl.items.find((i) => i.item_id === cable.id)!;
    await api.patch(`/template-items/${cableTi.id}`, { category: 'Gadgets' });
    tpl = (
      await api.patch<Template>(`/templates/${tpl.id}`, {
        category_order: ['Gadgets', 'Clothing'],
      })
    ).data;
    expect(tpl.category_order).toEqual(['Gadgets', 'Clothing']);

    const trip = (
      await api.post<TripDetail>('/trips', {
        name: 'Beach',
        source: { kind: 'template', template_id: tpl.id },
      })
    ).data;
    expect(cats(trip)).toEqual({ Shirt: 'Clothing', Cable: 'Gadgets', Thing: null });
    expect(trip.trip.category_order).toEqual(['Gadgets', 'Clothing']);

    // Ad-hoc rows can have a group; catalog rows default to the catalog's.
    await api.post(`/trips/${trip.trip.id}/items`, { name: 'Snacks', category: 'Food & drink' });
    await api.post(`/trips/${trip.trip.id}/items`, { name: 'Shirt', item_id: shirt.id });
    const withAdds = (await api.get<TripDetail>(`/trips/${trip.trip.id}`)).data;
    expect(withAdds.items.filter((r) => r.name === 'Shirt').map((r) => r.category)).toEqual([
      'Clothing',
      'Clothing',
    ]);
    expect(cats(withAdds).Snacks).toBe('Food & drink');

    const copy = (
      await api.post<TripDetail>('/trips', {
        name: 'Beach again',
        source: { kind: 'clone', trip_id: trip.trip.id },
      })
    ).data;
    expect(cats(copy)).toEqual(cats(withAdds));
    expect(copy.trip.category_order).toEqual(['Gadgets', 'Clothing']);

    const saved = (
      await api.post<Template>(`/trips/${trip.trip.id}/save-as-template`, { name: 'Saved' })
    ).data;
    expect(saved.category_order).toEqual(['Gadgets', 'Clothing']);
    const state = (await api.get<AppState>('/state')).data;
    const snacks = state.items.find((i) => i.name === 'Snacks')!;
    expect(snacks.category).toBe('Food & drink');
    expect(saved.items.find((i) => i.item_id === snacks.id)?.category).toBe('Food & drink');
    expect(state.lookups.category).toContain('Gadgets');
  });

  it('reorders and regroups rows on a trip and a template', async () => {
    const api = await session();
    const trip = (await api.post<TripDetail>('/trips', { name: 'T' })).data;
    for (const name of ['A', 'B', 'C'])
      await api.post(`/trips/${trip.trip.id}/items`, { name, category: 'Clothing' });
    const rows = (await api.get<TripDetail>(`/trips/${trip.trip.id}`)).data.items;
    const [a, b, c] = rows;
    const after = (
      await api.post<TripDetail>(`/trips/${trip.trip.id}/items/reorder`, {
        moves: [
          { id: c!.id, sort_order: 0, category: null },
          { id: a!.id, sort_order: 1 },
          { id: b!.id, sort_order: 2 },
        ],
      })
    ).data;
    expect(after.items.map((r) => [r.name, r.category])).toEqual([
      ['C', null],
      ['A', 'Clothing'],
      ['B', 'Clothing'],
    ]);

    const other = (await api.post<TripDetail>('/trips', { name: 'Other' })).data;
    const res = await api.post(`/trips/${other.trip.id}/items/reorder`, {
      moves: [{ id: a!.id, sort_order: 0 }],
    });
    expect(res.status).toBe(400);

    const item = (await api.post<Item>('/items', { name: 'X', category: 'Clothing' })).data;
    let tpl = (await api.post<Template>('/templates', { name: 'Tp' })).data;
    tpl = (await api.post<Template>(`/templates/${tpl.id}/items`, { item_ids: [item.id, item.id] }))
      .data;
    const [t1, t2] = tpl.items;
    tpl = (
      await api.post<Template>(`/templates/${tpl.id}/items/reorder`, {
        moves: [
          { id: t2!.id, sort_order: 0, category: 'Other' },
          { id: t1!.id, sort_order: 1 },
        ],
      })
    ).data;
    expect(
      [...tpl.items].sort((x, y) => x.sort_order - y.sort_order).map((i) => [i.id, i.category]),
    ).toEqual([
      [t2!.id, 'Other'],
      [t1!.id, 'Clothing'],
    ]);
  });
});
