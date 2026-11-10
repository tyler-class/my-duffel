import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  buildItineraryPdf,
  itineraryFileName,
  paperFor,
  type Printable,
} from '../../src/client/lib/itineraryPdf';
import type { EntryEnd, ItineraryEntry, ItinerarySection, Trip } from '../../src/shared/types';

const fonts = {
  regular: new Uint8Array(readFileSync('src/client/assets/fonts/Geist-Regular.ttf')),
  bold: new Uint8Array(readFileSync('src/client/assets/fonts/Geist-SemiBold.ttf')),
};

const end = (p: Partial<EntryEnd> = {}): EntryEnd => ({
  place: null,
  code: null,
  date: null,
  time: null,
  tz: null,
  ...p,
});
let n = 0;
const entry = (p: Partial<ItineraryEntry>): ItineraryEntry => ({
  id: `e${++n}`,
  section_id: 's',
  kind: 'plan',
  mode: null,
  title: null,
  carrier: null,
  number: null,
  start: end(),
  end: end(),
  address: null,
  confirmation: null,
  details: null,
  notes: null,
  sort_order: n,
  ...p,
});
const section = (title: string, entries: ItineraryEntry[], i = 0): ItinerarySection => ({
  id: `s${i}`,
  trip_id: 't',
  kind: 'travel',
  title,
  notes: null,
  sort_order: i,
  entries,
});
const trip = (name: string): Trip => ({
  id: 't',
  name,
  template_id: null,
  cloned_from_trip_id: null,
  trip_type: null,
  start_date: '2026-12-17',
  end_date: '2026-12-21',
  days: 5,
  nights: 4,
  destination: 'Cancún',
  climate: null,
  activities: [],
  status: null,
  notes: null,
  archived_at: null,
  category_order: [],
  travelers: [],
  item_count: 0,
  packed_count: 0,
});

/** Each page's text, as a PDF reader sees it. */
async function pagesText(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: pdf.slice(), useSystemFonts: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return out;
}

describe('itinerary PDF', () => {
  it('has the trip, its flights, stays and booking numbers, in readable text', async () => {
    const data: Printable = {
      trip: trip('Mexico 🌴 Dec'),
      itinerary: [
        section('Getting there ✈️', [
          entry({
            kind: 'transport',
            mode: 'plane',
            carrier: 'AA',
            number: '2417',
            start: end({ code: 'CLT', date: '2026-12-17', time: '10:00', tz: 'America/New_York' }),
            end: end({ code: 'CUN', date: '2026-12-17', time: '12:30', tz: 'America/Cancun' }),
            confirmation: 'QX7P2L',
          }),
        ]),
        section(
          'Cancún',
          [
            entry({
              kind: 'lodging',
              title: 'Hotel São Paulo',
              start: end({ date: '2026-12-17', time: '15:00', tz: 'America/Cancun' }),
              end: end({ date: '2026-12-21', time: '11:00', tz: 'America/Cancun' }),
              confirmation: 'BK-881',
            }),
          ],
          1,
        ),
      ],
    };
    const pdf = await buildItineraryPdf(data, fonts, 'letter');
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const text = (await pagesText(pdf)).join(' ');
    expect(text).toContain('Mexico Dec'); // the emoji is left out, not drawn as a box
    expect(text).toContain('Cancún');
    expect(text).toContain('Hotel São Paulo');
    expect(text).toMatch(/CLT 10:00.?AM → CUN 12:30.?PM/);
    expect(text).toContain('2h 30m');
    expect(text).toContain('Check in');
    expect(text).toContain('Check out');
    expect(text).toContain('4 nights');
    expect(text).toContain('Confirmation QX7P2L');
    expect(text).toContain('Times are local');
    expect(text).not.toMatch(/[🌴✈]/u);
  });

  it('runs onto more pages without splitting a line, numbering them', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      entry({
        kind: 'plan',
        title: `Plan number ${i + 1}`,
        start: end({ date: `2026-12-${String(10 + (i % 15)).padStart(2, '0')}`, time: '09:00' }),
        notes: 'A note that goes with this plan, long enough to wrap onto a second line maybe.',
      }),
    );
    const pdf = await buildItineraryPdf(
      { trip: trip('Long trip'), itinerary: [section('Everything', many)] },
      fonts,
      'a4',
    );
    const pages = await pagesText(pdf);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0]).toContain(`1 of ${pages.length}`);
    expect(pages.at(-1)).toContain(`${pages.length} of ${pages.length}`);
    // Every plan made it, once.
    for (let i = 1; i <= 60; i++)
      expect(pages.join(' ').match(new RegExp(`Plan number ${i}\\b`, 'g'))).toHaveLength(1);
  });

  it('names the file after the trip and picks the paper by region', () => {
    expect(itineraryFileName('Portugal (demo)')).toBe('Portugal (demo) itinerary.pdf');
    expect(itineraryFileName('A/B: trip?')).toBe('A B trip itinerary.pdf');
    expect(paperFor('en-US')).toBe('letter');
    expect(paperFor('en-GB')).toBe('a4');
    expect(paperFor('pt-BR')).toBe('a4');
    expect(paperFor('es-MX')).toBe('letter');
    expect(paperFor('en')).toBe('a4');
  });
});
