// Builds the favicon / home-screen icons from the brand mark (src/components/brand.ts).
// Run after changing the logo:  node scripts/gen-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const brand = readFileSync(new URL('../src/components/brand.ts', import.meta.url), 'utf8');
const pick = (name) => brand.match(new RegExp(`${name} =\\s*'([^']+)'`))[1];
const NAVY = pick('BRAND_NAVY');
const VIEWBOX = pick('LOGO_VIEWBOX');
const PATH = pick('LOGO_PATH');
const [vx, vy, vs] = VIEWBOX.split(' ').map(Number);

/** The mark centred on a square canvas: `scale` = share of the edge it fills, `bg` = null for transparent. */
function svg(scale, bg) {
  const pad = (vs / scale - vs) / 2;
  const box = `${vx - pad} ${vy - pad} ${vs + 2 * pad} ${vs + 2 * pad}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">` +
    (bg ? `<rect x="${vx - pad}" y="${vy - pad}" width="${vs + 2 * pad}" height="${vs + 2 * pad}" fill="${bg}"/>` : '') +
    `<path d="${PATH}" fill="${NAVY}" fill-rule="evenodd"/></svg>`
  );
}
const png = (s, size) => sharp(Buffer.from(s), { density: 600 }).resize(size, size).png().toBuffer();

// Browser tab: SVG (white mark on dark tab strips) + ICO fallback for browsers without SVG favicons.
writeFileSync(
  new URL('../src/app/icon.svg', import.meta.url),
  svg(0.94, null).replace(
    '<path',
    `<style>@media (prefers-color-scheme: dark){path{fill:#fff}}</style><path`,
  ),
);
const icoSizes = [16, 32, 48];
const icoPngs = await Promise.all(icoSizes.map((n) => png(svg(0.94, null), n)));
const header = Buffer.alloc(6 + 16 * icoPngs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoPngs.length, 4);
let offset = header.length;
icoPngs.forEach((buf, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(icoSizes[i], e);
  header.writeUInt8(icoSizes[i], e + 1);
  header.writeUInt16LE(1, e + 4); // planes
  header.writeUInt16LE(32, e + 6); // bpp
  header.writeUInt32LE(buf.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += buf.length;
});
writeFileSync(new URL('../src/app/favicon.ico', import.meta.url), Buffer.concat([header, ...icoPngs]));

// iOS home screen: opaque (iOS paints transparency black), iOS rounds the corners itself.
writeFileSync(new URL('../src/app/apple-icon.png', import.meta.url), await png(svg(0.7, '#ffffff'), 180));

// Android / PWA (app/manifest.ts): regular icons + maskable one with the mark inside the 80 % safe zone.
mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const n of [192, 512]) writeFileSync(new URL(`../public/icons/icon-${n}.png`, import.meta.url), await png(svg(0.78, '#ffffff'), n));
writeFileSync(new URL('../public/icons/icon-maskable-512.png', import.meta.url), await png(svg(0.6, '#ffffff'), 512));
console.log('icons written');
