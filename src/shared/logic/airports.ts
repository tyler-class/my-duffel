// Airport lookup by IATA code, over the compact list in ../airports.json (see
// scripts/build-airports.ts). The data is passed in so the client can load it lazily.

export interface AirportData {
  zones: string[];
  airports: string[];
}

export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  tz: string;
}

const cache = new WeakMap<AirportData, Map<string, Airport>>();

function index(data: AirportData): Map<string, Airport> {
  let m = cache.get(data);
  if (m) return m;
  m = new Map();
  for (const row of data.airports) {
    const [code, name, city, country, zi] = row.split('|') as [
      string,
      string,
      string,
      string,
      string,
    ];
    m.set(code, { code, name, city, country, tz: data.zones[Number(zi)] ?? 'UTC' });
  }
  cache.set(data, m);
  return m;
}

/** The airport with this IATA code ("bos" works too), or null. */
export function findAirport(data: AirportData, code: string | null | undefined): Airport | null {
  if (!code) return null;
  return index(data).get(code.trim().toUpperCase()) ?? null;
}

/**
 * Airports matching what's typed: exact code, then codes starting with it, then cities and
 * names starting with it, then ones containing it.
 */
export function searchAirports(data: AirportData, q: string, limit = 100): Airport[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const score = (a: Airport) => {
    const code = a.code.toLowerCase();
    const city = a.city.toLowerCase();
    const name = a.name.toLowerCase();
    if (code === s) return 0;
    if (code.startsWith(s)) return 1;
    if (s.length < 2) return 9;
    if (city.startsWith(s)) return 2;
    if (name.startsWith(s)) return 3;
    if (city.includes(s) || name.includes(s)) return 4;
    return 9;
  };
  return [...index(data).values()]
    .map((a) => [a, score(a)] as const)
    .filter(([, n]) => n < 9)
    .sort((x, y) => x[1] - y[1] || x[0].code.localeCompare(y[0].code))
    .slice(0, limit)
    .map(([a]) => a);
}

/** "Boston" for an airport, falling back to its name. */
export const airportPlace = (a: Airport) => a.city || a.name;
