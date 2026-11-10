import { describe, expect, it } from 'vitest';
import { bagRank, placeRow, type PlaceableBag } from '../../src/shared/logic/bags';

const bag = (id: string, p: Partial<PlaceableBag>): PlaceableBag => ({
  id,
  carry_on: false,
  people: [],
  sort_order: 0,
  type: null,
  ...p,
});
const place = (bags: PlaceableBag[], person: string | null, carry = false) =>
  placeRow({ person_id: person, carry, not_in_suitcase: false }, bags).trip_bag_id;

describe('bag ranking', () => {
  it('ranks suitcase, duffel, backpack, tote, others, then special bags', () => {
    const order = ['Cooler', 'Other', 'Tote', null, 'Backpack', 'Diaper bag', 'Duffel', 'Suitcase'];
    expect([...order].sort((a, b) => bagRank(a) - bagRank(b))).toEqual([
      'Suitcase',
      'Duffel',
      'Backpack',
      'Tote',
      'Other',
      null,
      'Cooler',
      'Diaper bag',
    ]);
  });

  it('puts everyday items in the suitcase even when another bag is listed first', () => {
    const bags = [
      bag('diaper', { type: 'Diaper bag', people: ['baby'], sort_order: 0 }),
      bag('backpack', { type: 'Backpack', people: ['baby'], sort_order: 1 }),
      bag('suitcase', { type: 'Suitcase', people: ['baby', 'kid'], sort_order: 2 }),
    ];
    expect(place(bags, 'baby')).toBe('suitcase');
    expect(place(bags, 'kid')).toBe('suitcase');
  });

  it('uses a special bag only when the person has nothing else', () => {
    expect(place([bag('diaper', { type: 'Diaper bag', people: ['baby'] })], 'baby')).toBe('diaper');
  });

  it('falls back to the best shared bag, never a shared cooler', () => {
    const bags = [
      bag('cooler', { type: 'Cooler', sort_order: 0 }),
      bag('duffel', { type: 'Duffel', sort_order: 1 }),
      bag('trunk', { type: 'Suitcase', sort_order: 2 }),
    ];
    expect(place(bags, 'sam')).toBe('trunk');
    expect(place(bags, null)).toBe('trunk');
    expect(place([bag('cooler', { type: 'Cooler' })], null)).toBeNull();
  });

  it('keeps carry-on items in carry-on bags, by the same ranking', () => {
    const bags = [
      bag('suitcase', { type: 'Suitcase', people: ['sam'] }),
      bag('tote', { type: 'Tote', carry_on: true, people: ['sam'], sort_order: 0 }),
      bag('pack', { type: 'Backpack', carry_on: true, people: ['sam'], sort_order: 1 }),
    ];
    expect(place(bags, 'sam', true)).toBe('pack');
    expect(place(bags, 'sam')).toBe('suitcase');
  });
});
