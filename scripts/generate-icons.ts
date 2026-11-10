// Renders the app icons in public/ from the duffel glyph.
// Run: npm run icons
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const BG = '#f97316';
const FG = '#fafaf8';
// The glyph on a 64-unit grid, without the rounded tile.
const glyph = `<g fill="none" stroke="${FG}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M24 25c0-6 3.5-9 8-9s8 3 8 9"/><rect x="9" y="25" width="46" height="25" rx="12.5"/><path d="M19 33h26"/><path d="M21 25.5v24M43 25.5v24" stroke-width="2.6"/></g>`;

/** Full-bleed square with the glyph scaled into the middle `scale` of the tile. */
function svg(scale: number): string {
  const offset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BG}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g></svg>`;
}

const out = new URL('../public/', import.meta.url);
const jobs: [string, number, number][] = [
  ['pwa-192x192.png', 192, 1],
  ['pwa-512x512.png', 512, 1],
  ['maskable-512x512.png', 512, 0.72], // keeps the glyph inside the maskable safe zone
  ['apple-touch-icon.png', 180, 0.92],
];
for (const [name, size, scale] of jobs) {
  const png = await sharp(Buffer.from(svg(scale)))
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(new URL(name, out), png);
  console.log(`public/${name}`);
}
