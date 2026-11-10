/** Does a row match the search text? Name, group and notes, ignoring case. */
export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const n = q.trim().toLowerCase();
  return !n || fields.some((f) => !!f && f.toLowerCase().includes(n));
}
