// Builds src/shared/airports.json: airports with scheduled flights, by IATA code, with their
// city and time zone. Run with `npm run airports` to refresh it.
//
// Sources (both free to reuse):
// - OurAirports (public domain): which airports have scheduled service, names, cities.
//   https://ourairports.com/data/
// - mwgg/Airports (MIT): each airport's IANA time zone.
//   https://github.com/mwgg/Airports
import { writeFileSync } from 'node:fs';

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const MWGG = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

/** Splits one CSV line, honouring quoted fields. */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const shorten = (name: string) =>
  name
    .replace(/\bInternational\b/g, 'Intl')
    .replace(/\bAirport\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function main() {
  const [csv, tzData] = await Promise.all([
    fetch(OURAIRPORTS).then((r) => r.text()),
    fetch(MWGG).then((r) => r.json() as Promise<Record<string, { iata: string; tz: string }>>),
  ]);
  const tzByCode = new Map<string, string>();
  for (const [icao, a] of Object.entries(tzData)) {
    if (!a.tz) continue;
    tzByCode.set(icao, a.tz);
    if (a.iata) tzByCode.set(`iata:${a.iata}`, a.tz);
  }

  const [header, ...lines] = csv.split('\n');
  const col = Object.fromEntries(csvLine(header!).map((h, i) => [h, i]));
  const rows = new Map<string, [string, string, string, string]>();
  for (const line of lines) {
    if (!line) continue;
    const f = csvLine(line);
    const iata = f[col.iata_code!]?.trim() ?? '';
    const type = f[col.type!] ?? '';
    if (!/^[A-Z]{3}$/.test(iata) || f[col.scheduled_service!] !== 'yes') continue;
    if (type === 'closed' || type === 'heliport') continue;
    const tz =
      tzByCode.get(`iata:${iata}`) ??
      tzByCode.get(f[col.icao_code!] ?? '') ??
      tzByCode.get(f[col.ident!] ?? '');
    if (!tz) continue;
    // Prefer the bigger airport when two share a code.
    if (rows.has(iata) && type !== 'large_airport') continue;
    rows.set(iata, [
      shorten(f[col.name!] ?? ''),
      f[col.municipality!] ?? '',
      f[col.iso_country!] ?? '',
      tz,
    ]);
  }

  // Compact: time zones listed once, each airport "CODE|name|city|country|tzIndex".
  const zones = [...new Set([...rows.values()].map((r) => r[3]))].sort();
  const zoneIndex = new Map(zones.map((z, i) => [z, i]));
  const airports = [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, [name, city, country, tz]]) =>
      [code, name, city, country, zoneIndex.get(tz)].join('|'),
    );
  writeFileSync(
    new URL('../src/shared/airports.json', import.meta.url),
    JSON.stringify({ zones, airports }) + '\n',
  );
  console.log(`${airports.length} airports, ${zones.length} time zones.`);
}

void main();
