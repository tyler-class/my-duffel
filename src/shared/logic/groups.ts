// Item groups: rows on a packing list or template, grouped by category.

/**
 * The order to show groups in: the list's saved order first, then any other
 * categories in the default (suggestion) order, then the rest alphabetically.
 */
export function orderCategories(
  present: Iterable<string>,
  saved: readonly string[],
  defaults: readonly string[],
): string[] {
  const want = new Set(present);
  const out: string[] = [];
  const add = (c: string) => {
    if (want.has(c) && !out.includes(c)) out.push(c);
  };
  saved.forEach(add);
  defaults.forEach(add);
  [...want].sort((a, b) => a.localeCompare(b)).forEach(add);
  return out;
}

export interface GroupLayout<T> {
  /** Rows with no group, shown first without a heading. */
  loose: T[];
  groups: { category: string; rows: T[] }[];
}

/** Splits rows (already in display order) into ungrouped rows and ordered groups. */
export function layoutGroups<T extends { category: string | null }>(
  rows: readonly T[],
  saved: readonly string[],
  defaults: readonly string[],
): GroupLayout<T> {
  const loose: T[] = [];
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const c = r.category?.trim();
    if (!c) loose.push(r);
    else (by.get(c) ?? by.set(c, []).get(c)!).push(r);
  }
  const order = orderCategories(by.keys(), saved, defaults);
  return { loose, groups: order.map((category) => ({ category, rows: by.get(category)! })) };
}

export interface ReorderMove {
  id: string;
  sort_order: number;
  category?: string | null;
}

/**
 * After a drag and drop inside one part of a list (a person, a bag, a template),
 * works out the rows whose position or group changed. `all` is every row on the
 * list in its current order; `next` is the new order of the rows that were shown.
 * Those rows keep the slots they had among the others, and the whole list is
 * renumbered so positions stay unique.
 */
export function reorderMoves(
  all: readonly { id: string; sort_order: number; category: string | null }[],
  next: readonly { id: string; category: string | null }[],
): ReorderMove[] {
  const moved = new Set(next.map((r) => r.id));
  const byId = new Map(all.map((r) => [r.id, r]));
  const seq: { id: string; category: string | null }[] = all.map((r) => ({
    id: r.id,
    category: r.category,
  }));
  let k = 0;
  for (let i = 0; i < seq.length; i++) {
    if (moved.has(seq[i]!.id)) seq[i] = next[k++]!;
  }
  const out: ReorderMove[] = [];
  seq.forEach((r, i) => {
    const old = byId.get(r.id)!;
    const regrouped = (old.category ?? null) !== (r.category ?? null);
    if (old.sort_order !== i || regrouped)
      out.push({ id: r.id, sort_order: i, ...(regrouped ? { category: r.category } : {}) });
  });
  return out;
}

/**
 * Puts the groups shown in one part of a list into their new order, keeping the
 * slots they had in the list's full group order.
 */
export function mergeCategoryOrder(full: readonly string[], next: readonly string[]): string[] {
  const moved = new Set(next);
  const out = [...full];
  let k = 0;
  for (let i = 0; i < out.length; i++) if (moved.has(out[i]!)) out[i] = next[k++]!;
  return out;
}
