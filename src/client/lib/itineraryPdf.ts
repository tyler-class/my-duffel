// A trip's itinerary as a PDF: the same content as the Itinerary tab, laid out for paper.
// Loaded only when someone taps Print (it pulls in pdf-lib and the fonts). Times are local, as
// printed on the bookings. Text is real text (selectable, searchable), set in Geist.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  connections,
  dayNumber,
  dayShift,
  entryMinutes,
  entryName,
  formatMinutes,
  itineraryRows,
  orderEntries,
  sectionDays,
  sortSections,
  type ItineraryRow,
} from '@shared/logic';
import type { ItinerarySection, TripDetail } from '@shared/types';
import { formatDay, formatRange } from './format';
import { formatClock } from './itinerary';

export type PaperSize = 'letter' | 'a4';
export type Printable = Pick<TripDetail, 'trip' | 'itinerary'>;

const SIZES: Record<PaperSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};
/** Countries that use US Letter paper; everyone else uses A4. */
const LETTER = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR']);

/** Letter for US-style locales ("en-US", "es-MX"), else A4. */
export function paperFor(locale: string | undefined): PaperSize {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale ?? '')?.[1]?.toUpperCase();
  return region && LETTER.has(region) ? 'letter' : 'a4';
}

/** "Portugal (demo) itinerary.pdf", safe as a file name everywhere. */
export function itineraryFileName(tripName: string): string {
  const base =
    tripName
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Trip';
  return `${base} itinerary.pdf`;
}

// Colours from the app's light theme.
const INK = rgb(0.067, 0.067, 0.063);
const SOFT = rgb(0.4, 0.4, 0.38);
const FAINT = rgb(0.58, 0.58, 0.56);
const LINE = rgb(0.89, 0.886, 0.86);
const CHIP = rgb(0.937, 0.933, 0.91);
const DANGER = rgb(0.75, 0.18, 0.15);

const MARGIN = 54;
const FOOTER = 30;

interface Fonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

/** Text a font can draw: emoji and anything it has no glyph for are dropped (accents kept). */
function cleaner(font: { hasGlyphForCodePoint(cp: number): boolean }) {
  return (s: string | null | undefined): string => {
    if (!s) return '';
    const out: string[] = [];
    for (const ch of s
      .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3/gu, '')
      .replace(/[\u{1f3fb}-\u{1f3ff}]/gu, '')) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n' || font.hasGlyphForCodePoint(cp)) out.push(ch);
      else {
        // "ḑ" → "d": the letter without its mark, when the font has that.
        const base = ch.normalize('NFKD').replace(/\p{M}/gu, '');
        if (base && [...base].every((c) => font.hasGlyphForCodePoint(c.codePointAt(0)!)))
          out.push(base);
      }
    }
    return out
      .join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  };
}

/** One line of a block: text in a font, size and colour, optionally indented. */
interface Line {
  text: string;
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
  /** Right-aligned text on the same line (a flight's duration). */
  right?: string;
  /** A small raised note after the text ("+1"). */
  sup?: string;
  gapBefore?: number;
}

/** Wraps text to a width, by words (long words break where they must). */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

/** The words for one itinerary line, as on the Itinerary tab (local times). */
function rowText(r: ItineraryRow) {
  const e = r.entry;
  const name = entryName(e);
  const lines: string[] = [];
  let lead: string | null = null;
  let sup: string | undefined;
  if (e.kind === 'transport') {
    const from = e.start.code ?? e.start.place;
    const to = e.end.code ?? e.end.place;
    const route = [
      [from, formatClock(e.start.time)].filter(Boolean).join(' '),
      [to, formatClock(e.end.time)].filter(Boolean).join(' '),
    ];
    const shift = dayShift(e);
    if (route.some(Boolean)) {
      lines.push(`${route[0] || '?'} → ${route[1] || '?'}`);
      if (shift > 0) sup = `+${shift}`;
    }
    const sub = [e.carrier, e.number].filter(Boolean).join(' ');
    if (e.title && sub && sub !== name) lines.push(sub);
    if (e.end.date && e.start.date && e.end.date !== e.start.date && shift > 1)
      lines.push(`Arrives ${formatDay(e.end.date)}`);
  } else if (e.kind === 'lodging') {
    if (r.part === 'out') {
      lead = 'Check out';
      if (e.end.time) lines.push(formatClock(e.end.time));
    } else {
      lead = r.part === 'in' ? 'Check in' : null;
      const nights =
        e.start.date && e.end.date ? dayNumber(e.end.date)! - dayNumber(e.start.date)! : null;
      const bits = [
        formatClock(e.start.time),
        nights ? `${nights} night${nights === 1 ? '' : 's'}` : '',
        e.address ?? '',
      ].filter(Boolean);
      if (bits.length) lines.push(bits.join(' · '));
    }
  } else if (e.kind === 'plan') {
    const time = [formatClock(e.start.time), formatClock(e.end.time)].filter(Boolean).join(' – ');
    const where = e.start.place;
    if (time || where) lines.push([time, where].filter(Boolean).join(' · '));
  }
  const out = r.part === 'out';
  const minutes = e.kind === 'transport' ? entryMinutes(e) : null;
  return {
    lead,
    name,
    sup,
    lines,
    duration: minutes !== null ? formatMinutes(minutes) : null,
    note: e.kind === 'note' ? e.notes : null,
    extra: !out && e.kind !== 'note' ? [e.details, e.notes].filter(Boolean).join(' · ') : '',
    confirmation: !out ? e.confirmation : null,
    out,
  };
}

/** The itinerary of a trip as a PDF file's bytes. */
export async function buildItineraryPdf(
  data: Printable,
  fonts: Fonts,
  paper: PaperSize = 'a4',
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const clean = cleaner(fontkit.create(fonts.regular as never));
  const t = data.trip;
  const title = clean(t.name) || 'Trip';
  doc.setTitle(`${title} itinerary`);
  doc.setCreator('Duffel');
  doc.setProducer('Duffel');

  const [W, H] = SIZES[paper];
  const width = W - MARGIN * 2;
  const bottom = MARGIN + FOOTER;
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - MARGIN;
  };
  newPage();

  const text = (s: string, x: number, size: number, font: PDFFont, color = INK, at = y - size) =>
    page.drawText(s, { x, y: at, size, font, color });

  // Header.
  for (const l of wrap(title, bold, 22, width)) {
    text(l, MARGIN, 22, bold);
    y -= 27;
  }
  const meta = clean(
    [formatRange(t.start_date, t.end_date), t.destination].filter(Boolean).join(' · '),
  );
  if (meta) {
    text(meta, MARGIN, 11.5, regular, SOFT);
    y -= 17;
  }
  text('Times are local, as on the bookings.', MARGIN, 9, regular, FAINT);
  y -= 22;

  const sections = sortSections(data.itinerary);
  if (!sections.length) {
    text('No itinerary yet.', MARGIN, 11, regular, SOFT);
    y -= 16;
  }

  /** Room left on the page. */
  const room = () => y - bottom;

  const sectionBar = (s: ItinerarySection) => {
    const h = 26;
    // A rounded bar, like the app's section headings.
    const r = 7;
    page.drawSvgPath(
      `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${h - r} Q ${width} ${h} ${width - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
      { x: MARGIN, y, color: CHIP, borderWidth: 0 },
    );
    const days = sectionDays(s);
    const dates = days ? clean(formatRange(days[0], days[1])) : '';
    const dw = dates ? regular.widthOfTextAtSize(dates, 9.5) : 0;
    let name = clean(s.title);
    const max = width - 24 - (dw ? dw + 12 : 0);
    while (name.length > 1 && bold.widthOfTextAtSize(name, 12.5) > max)
      name = `${name.slice(0, -2)}…`;
    text(name, MARGIN + 12, 12.5, bold, INK, y - h / 2 - 4.5);
    if (dates) text(dates, MARGIN + width - 12 - dw, 9.5, regular, SOFT, y - h / 2 - 3.5);
    y -= h + 4;
  };

  for (const s of sections) {
    const entries = orderEntries(s.entries);
    const rows = itineraryRows(entries);
    const conns = new Map(connections(entries).map((c) => [c.after, c]));

    // Each line of the section as a block that never splits across pages.
    let lastDay: string | null = null;
    const blocks = rows.map((r) => {
      const showDay = !!r.date && r.date !== lastDay;
      if (r.date) lastDay = r.date;
      const w = rowText(r);
      const lines: Line[] = [];
      const indent = 12;
      const inner = width - indent * 2;
      const head = clean(`${w.lead ? `${w.lead} · ` : ''}${w.name}`);
      const durW = w.duration ? regular.widthOfTextAtSize(w.duration, 9.5) + 10 : 0;
      wrap(head, regular, 12, inner - durW).forEach((t2, i) =>
        lines.push({
          text: t2,
          font: regular,
          size: 12,
          color: w.out ? SOFT : INK,
          right: i === 0 ? (w.duration ?? undefined) : undefined,
        }),
      );
      w.lines.forEach((l, i) =>
        wrap(clean(l), regular, 10, inner).forEach((t2, j, all) =>
          lines.push({
            text: t2,
            font: regular,
            size: 10,
            color: SOFT,
            sup: i === 0 && j === all.length - 1 ? w.sup : undefined,
            gapBefore: i === 0 && j === 0 ? 2 : 0,
          }),
        ),
      );
      if (w.note)
        wrap(clean(w.note), regular, 10, inner).forEach((t2) =>
          lines.push({ text: t2, font: regular, size: 10, color: SOFT }),
        );
      if (w.extra)
        wrap(clean(w.extra), regular, 9.5, inner).forEach((t2) =>
          lines.push({ text: t2, font: regular, size: 9.5, color: FAINT }),
        );
      if (w.confirmation)
        lines.push({
          text: `Confirmation ${clean(w.confirmation)}`,
          font: bold,
          size: 9.5,
          color: INK,
          gapBefore: 3,
        });
      const c = r.part === 'all' ? conns.get(r.entry.id) : undefined;
      const layover = c
        ? {
            text: clean(`Layover${c.at ? ` in ${c.at}` : ''} · ${formatMinutes(c.minutes)}`),
            change: c.change ? clean(` · change ${c.change.from} → ${c.change.to}`) : '',
          }
        : null;
      const height =
        (showDay ? 22 : 0) +
        10 +
        lines.reduce((n, l) => n + (l.gapBefore ?? 0) + l.size * 1.32, 0) +
        8 +
        (layover ? 20 : 0);
      return { r, showDay, lines, layover, height };
    });

    // A section bar stays with its first line.
    const first = blocks[0]?.height ?? 0;
    const notesLines = s.notes ? wrap(clean(s.notes), regular, 10, width - 24) : [];
    const barH = 30 + notesLines.length * 13.5 + (notesLines.length ? 4 : 0);
    if (room() < barH + first && y < H - MARGIN - 1) newPage();
    else y -= 8;
    sectionBar(s);
    for (const l of notesLines) {
      text(l, MARGIN + 12, 10, regular, SOFT);
      y -= 13.5;
    }
    if (notesLines.length) y -= 4;

    for (const b of blocks) {
      if (room() < b.height) {
        newPage();
        // Say which section and day a new page continues.
        text(`${clean(s.title)}, continued`, MARGIN, 9, regular, FAINT);
        y -= 14;
        b.showDay = !!b.r.date;
      }
      if (b.showDay && b.r.date) {
        y -= 8;
        text(clean(formatDay(b.r.date)), MARGIN + 12, 9.5, bold, FAINT);
        y -= 14;
      }
      y -= 10;
      for (const l of b.lines) {
        y -= l.gapBefore ?? 0;
        text(l.text, MARGIN + 12, l.size, l.font, l.color);
        if (l.sup) {
          const x = MARGIN + 12 + l.font.widthOfTextAtSize(l.text, l.size) + 2;
          text(l.sup, x, 7, regular, FAINT, y - l.size + 4);
        }
        if (l.right) {
          const rw = regular.widthOfTextAtSize(l.right, 9.5);
          text(l.right, MARGIN + width - 12 - rw, 9.5, regular, FAINT, y - 11);
        }
        y -= l.size * 1.32;
      }
      y -= 8;
      if (b.layover) {
        text(b.layover.text, MARGIN + 28, 9.5, regular, SOFT, y - 12);
        if (b.layover.change) {
          const x = MARGIN + 28 + regular.widthOfTextAtSize(b.layover.text, 9.5);
          text(b.layover.change, x, 9.5, regular, DANGER, y - 12);
        }
        y -= 20;
      }
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: MARGIN + width, y },
        thickness: 0.6,
        color: LINE,
      });
    }
    y -= 12;
  }

  // Footers: the trip and the page number.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `${i + 1} of ${pages.length}`;
    const lw = regular.widthOfTextAtSize(label, 8.5);
    p.drawText(label, {
      x: W - MARGIN - lw,
      y: MARGIN - 6,
      size: 8.5,
      font: regular,
      color: FAINT,
    });
    let name = `${title} · Duffel`;
    while (name.length > 1 && regular.widthOfTextAtSize(name, 8.5) > width - lw - 20)
      name = `${name.slice(0, -2)}…`;
    p.drawText(name, { x: MARGIN, y: MARGIN - 6, size: 8.5, font: regular, color: FAINT });
  });

  return doc.save();
}
