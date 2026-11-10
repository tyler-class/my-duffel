import { PERSON_COLORS, type PersonColor } from '../lookups';

/** The first palette color nobody uses yet, cycling when all are taken. */
export function pickPersonColor(used: string[]): PersonColor {
  const counts = new Map<string, number>(PERSON_COLORS.map((c) => [c, 0]));
  for (const u of used) if (counts.has(u)) counts.set(u, counts.get(u)! + 1);
  let best: PersonColor = PERSON_COLORS[0];
  for (const c of PERSON_COLORS) if (counts.get(c)! < counts.get(best)!) best = c;
  return best;
}
