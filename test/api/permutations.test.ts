// Templates and trips work in any combination of items, people and bags, and nothing has to
// be set up in a particular order to avoid getting stuck.
import { describe, expect, it } from 'vitest';
import type { Item, Person, Suitcase, Template, TripDetail } from '../../src/shared/types';
import { session } from './helpers';

async function household() {
  const api = await session();
  const sam = (await api.post<Person>('/people', { name: 'Sam' })).data;
  const mia = (await api.post<Person>('/people', { name: 'Mia' })).data;
  const shirt = (await api.post<Item>('/items', { name: 'Shirt', category: 'Clothing' })).data;
  const map = (await api.post<Item>('/items', { name: 'Map' })).data;
  const samCase = (
    await api.post<Suitcase>('/suitcases', { name: 'Sam case', type: 'Suitcase', people: [sam.id] })
  ).data;
  const miaCase = (
    await api.post<Suitcase>('/suitcases', { name: 'Mia case', type: 'Suitcase', people: [mia.id] })
  ).data;
  return { api, sam, mia, shirt, map, samCase, miaCase };
}

const who = (d: TripDetail, names: Map<string, string>) =>
  d.items.map((r) => `${r.name}:${r.person_id ? names.get(r.person_id) : 'Shared'}`).sort();

describe('templates and trips in any combination', () => {
  it('items only: everything shared and in No bag, then assigned in bulk', async () => {
    const { api, sam, mia, shirt, map } = await household();
    let tpl = (await api.post<Template>('/templates', { name: 'Bare' })).data;
    tpl = (await api.post<Template>(`/templates/${tpl.id}/items`, { item_ids: [shirt.id, map.id] }))
      .data;
    const trip = (
      await api.post<TripDetail>('/trips', {
        name: 'Bare trip',
        source: { kind: 'template', template_id: tpl.id },
      })
    ).data;
    expect(trip.items.every((r) => r.person_id === null && r.trip_bag_id === null)).toBe(true);

    // Shirt becomes one each for Sam and Mia; Map goes to Sam.
    const shirtRow = trip.items.find((r) => r.name === 'Shirt')!;
    const mapRow = trip.items.find((r) => r.name === 'Map')!;
    await api.post(`/trips/${trip.trip.id}/items/bulk`, {
      ids: [shirtRow.id],
      assign: [sam.id, mia.id],
    });
    let d = (
      await api.post<TripDetail>(`/trips/${trip.trip.id}/items/bulk`, {
        ids: [mapRow.id],
        assign: [sam.id],
      })
    ).data;
    const names = new Map([
      [sam.id, 'Sam'],
      [mia.id, 'Mia'],
    ]);
    expect(who(d, names)).toEqual(['Map:Sam', 'Shirt:Mia', 'Shirt:Sam']);
    expect(d.items.find((r) => r.name === 'Shirt' && r.person_id === mia.id)?.category).toBe(
      'Clothing',
    );
    // Back to shared.
    d = (
      await api.post<TripDetail>(`/trips/${trip.trip.id}/items/bulk`, {
        ids: [mapRow.id],
        assign: [],
      })
    ).data;
    expect(d.items.find((r) => r.id === mapRow.id)?.person_id).toBeNull();
  });

  it('items + people, no bags: bags added on the trip later take their items', async () => {
    const { api, sam, mia, shirt, samCase } = await household();
    let tpl = (await api.post<Template>('/templates', { name: 'People' })).data;
    tpl = (
      await api.post<Template>(`/templates/${tpl.id}/items`, {
        item_ids: [shirt.id],
        assignees: [sam.id, mia.id],
      })
    ).data;
    expect(tpl.items[0]!.assignees.sort()).toEqual([sam.id, mia.id].sort());
    const trip = (
      await api.post<TripDetail>('/trips', {
        name: 'People trip',
        source: { kind: 'template', template_id: tpl.id },
      })
    ).data;
    expect(trip.items).toHaveLength(2);
    expect(trip.items.every((r) => r.trip_bag_id === null)).toBe(true);
    await api.post(`/trips/${trip.trip.id}/bags`, { suitcase_id: samCase.id, label: 'Sam case' });
    const fill = (await api.get<{ moves: { id: string }[] }>(`/trips/${trip.trip.id}/placements`))
      .data;
    expect(fill.moves).toHaveLength(1);
  });

  it('items + bags, no people: a shared bag takes shared items', async () => {
    const { api, map } = await household();
    let tpl = (await api.post<Template>('/templates', { name: 'Bags' })).data;
    tpl = (await api.post<Template>(`/templates/${tpl.id}/items`, { item_ids: [map.id] })).data;
    tpl = (await api.post<Template>(`/templates/${tpl.id}/bags`, { label: 'Trunk' })).data;
    const trip = (
      await api.post<TripDetail>('/trips', {
        name: 'Bags trip',
        source: { kind: 'template', template_id: tpl.id },
      })
    ).data;
    expect(trip.items[0]!.trip_bag_id).toBe(trip.bags[0]!.id);
  });

  it('someone added to a trip later gets their things from the template', async () => {
    const { api, sam, mia, shirt, map, samCase, miaCase } = await household();
    let tpl = (await api.post<Template>('/templates', { name: 'Full' })).data;
    tpl = (
      await api.post<Template>(`/templates/${tpl.id}/items`, {
        item_ids: [shirt.id],
        assignees: [sam.id, mia.id],
      })
    ).data;
    tpl = (await api.post<Template>(`/templates/${tpl.id}/items`, { item_ids: [map.id] })).data;
    for (const s of [samCase, miaCase])
      tpl = (
        await api.post<Template>(`/templates/${tpl.id}/bags`, { suitcase_id: s.id, label: s.name })
      ).data;
    const trip = (
      await api.post<TripDetail>('/trips', {
        name: 'Just Sam',
        travelers: [sam.id],
        source: { kind: 'template', template_id: tpl.id },
      })
    ).data;
    const names = new Map([
      [sam.id, 'Sam'],
      [mia.id, 'Mia'],
    ]);
    expect(who(trip, names)).toEqual(['Map:Shared', 'Shirt:Sam']);

    const d = (
      await api.patch<TripDetail>(`/trips/${trip.trip.id}`, { travelers: [sam.id, mia.id] })
    ).data;
    expect(who(d, names)).toEqual(['Map:Shared', 'Shirt:Mia', 'Shirt:Sam']);
    const miaShirt = d.items.find((r) => r.person_id === mia.id)!;
    expect(d.bags.find((b) => b.id === miaShirt.trip_bag_id)?.label).toBe('Mia case');
    // Saving again with the same people adds nothing.
    const again = (
      await api.patch<TripDetail>(`/trips/${trip.trip.id}`, { travelers: [sam.id, mia.id] })
    ).data;
    expect(again.items).toHaveLength(3);

    // A copy of this trip does the same for someone added later.
    const copy = (
      await api.post<TripDetail>('/trips', {
        name: 'Copy',
        travelers: [sam.id],
        source: { kind: 'clone', trip_id: trip.trip.id },
      })
    ).data;
    expect(copy.items.some((r) => r.person_id === mia.id)).toBe(false);
  });

  it('saving a trip as a template keeps its bags and who they’re for', async () => {
    const { api, sam, shirt, samCase } = await household();
    const trip = (
      await api.post<TripDetail>('/trips', {
        name: 'Lisbon',
        bags: [{ suitcase_id: samCase.id, label: 'Lisbon - Sam case' }],
      })
    ).data;
    await api.post(`/trips/${trip.trip.id}/items`, {
      name: 'Shirt',
      item_id: shirt.id,
      person_id: sam.id,
    });
    const tpl = (
      await api.post<Template>(`/trips/${trip.trip.id}/save-as-template`, { name: 'From Lisbon' })
    ).data;
    expect(tpl.bags.map((b) => [b.label, b.suitcase_id, b.people])).toEqual([
      ['Sam case', samCase.id, [sam.id]],
    ]);
  });
});
