import { describe, expect, it } from 'vitest';
import {
  layoutGroups,
  mergeCategoryOrder,
  orderCategories,
  reorderMoves,
} from '../../src/shared/logic/groups';

const defaults = ['Clothing', 'Toiletries', 'Electronics', 'Documents'];

describe('orderCategories', () => {
  it('uses the saved order, then defaults, then the rest alphabetically', () => {
    expect(
      orderCategories(['Zoo', 'Documents', 'Clothing', 'Apples'], ['Documents'], defaults),
    ).toEqual(['Documents', 'Clothing', 'Apples', 'Zoo']);
  });
  it('ignores saved categories that are not present', () => {
    expect(orderCategories(['Clothing'], ['Documents', 'Clothing'], defaults)).toEqual([
      'Clothing',
    ]);
  });
});

describe('layoutGroups', () => {
  it('puts rows with no group first and keeps row order inside groups', () => {
    const rows = [
      { id: 'a', category: 'Electronics' },
      { id: 'b', category: null },
      { id: 'c', category: 'Clothing' },
      { id: 'd', category: 'Electronics' },
      { id: 'e', category: '  ' },
    ];
    const l = layoutGroups(rows, [], defaults);
    expect(l.loose.map((r) => r.id)).toEqual(['b', 'e']);
    expect(l.groups.map((g) => [g.category, g.rows.map((r) => r.id)])).toEqual([
      ['Clothing', ['c']],
      ['Electronics', ['a', 'd']],
    ]);
  });
});

describe('reorderMoves', () => {
  const all = [
    { id: 'a', sort_order: 0, category: null },
    { id: 'x', sort_order: 1, category: null }, // another person's row
    { id: 'b', sort_order: 2, category: 'Clothing' },
    { id: 'c', sort_order: 5, category: 'Clothing' },
  ];
  it('keeps other rows in place and renumbers', () => {
    const moves = reorderMoves(all, [
      { id: 'c', category: 'Clothing' },
      { id: 'a', category: null },
      { id: 'b', category: 'Clothing' },
    ]);
    expect(moves).toEqual([
      { id: 'c', sort_order: 0 },
      { id: 'a', sort_order: 2 },
      { id: 'b', sort_order: 3 },
    ]);
  });
  it('reports a new group only for rows that changed group', () => {
    const moves = reorderMoves(all, [
      { id: 'a', category: 'Clothing' },
      { id: 'b', category: 'Clothing' },
      { id: 'c', category: null },
    ]);
    expect(moves).toEqual([
      { id: 'a', sort_order: 0, category: 'Clothing' },
      { id: 'c', sort_order: 3, category: null },
    ]);
  });
  it('returns nothing when nothing changed', () => {
    const tidy = all.map((r, i) => ({ ...r, sort_order: i }));
    expect(reorderMoves(tidy, [tidy[0]!, tidy[2]!, tidy[3]!])).toEqual([]);
  });
});

describe('mergeCategoryOrder', () => {
  it('reorders only the groups shown, in their slots', () => {
    expect(mergeCategoryOrder(['A', 'B', 'C', 'D'], ['D', 'B'])).toEqual(['A', 'D', 'C', 'B']);
  });
});
