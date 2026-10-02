// Branded QR code: rounded modules, navy finder eyes and a "logo + LEDAT-GIS / GEOSPATIAL SOLUTIONS" badge in
// the middle.
import { encode, QrCodeDataType } from 'uqr';
import { BRAND_NAVY, LOGO_PATH, LOGO_VIEWBOX } from './brand';

const INK = BRAND_NAVY;
const WORDMARK = 'LEDAT-GIS';
const TAGLINE = 'GEOSPATIAL SOLUTIONS';

/** The brand mark (same drawing as <Logo/> in icons.tsx). */
const LOGO = `<path d="${LOGO_PATH}" fill="${BRAND_NAVY}" fill-rule="evenodd"/>`;

/**
 * The badge hides the modules under it (~8 % of the code), which error correction level M (15 %) makes up for.
 * Level Q would leave more headroom but makes the code denser and harder to scan off a screen (measured with
 * jsQR: M with the badge decodes at the same sizes as a plain M code); links too long for M fall back to level
 * L without a badge.
 */
const LEVELS = [
  { ecc: 'M', badge: 0.14 },
  { ecc: 'L', badge: 0 },
] as const;

export interface BrandedQr {
  svg: string;
  /**
   * Where the wordmark and tagline go (centre lines), as fractions of the image edge — for painting them with the
   * brand font on a canvas. The tagline is spread to the wordmark's width, which is at most `width`.
   */
  label: { x: number; width: number; word: { y: number; size: number; text: string }; tag: { y: number; size: number; text: string } } | null;
}

/**
 * `withText: false` leaves the wordmark and tagline out of the SVG (an SVG drawn through <img> cannot use the page's web
 * fonts), so the caller can paint `label` itself.
 */
export function brandedQr(data: string, { withText = true }: { withText?: boolean } = {}): BrandedQr | null {
  for (const { ecc, badge } of LEVELS) {
    let qr;
    try {
      qr = encode(data, { ecc, border: 0 });
    } catch {
      continue; // too long for this level
    }
    const n = qr.size;
    const margin = 2;
    const v = n + margin * 2;

    // Badge geometry in modules: logo square + two text lines (wordmark, tagline spread to the same width).
    const h = Math.round(n * badge);
    const logo = h * 0.78;
    const pad = (h - logo) / 2;
    const gap = pad * 0.9;
    const wordSize = h * 0.38;
    const tagSize = h * 0.115;
    const textW = wordSize * 6.4;
    const wordY = n / 2 - h * 0.1;
    const tagY = n / 2 + h * 0.22;
    const width = h ? pad + logo + gap + textW + pad * 1.4 : 0;
    const bx = n / 2 - width / 2;
    const by = n / 2 - h / 2;
    // Modules touching the badge (plus half a module of air) are left out.
    const hidden = (x: number, y: number) => h > 0 && x + 1 > bx - 0.5 && x < bx + width + 0.5 && y + 1 > by - 0.5 && y < by + h + 0.5;

    const cells: string[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.data[y][x] || qr.types[y][x] === QrCodeDataType.Position || hidden(x, y)) continue;
        cells.push(`M${x + 0.08} ${y}h0.84a0.08 0.08 0 0 1 .08.08v0.84a.08.08 0 0 1-.08.08h-0.84a.08.08 0 0 1-.08-.08v-0.84a.08.08 0 0 1 .08-.08z`);
      }
    }
    // Finder patterns: rounded ring + centre, in the brand navy.
    const eye = (x: number, y: number) =>
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="${INK}"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${INK}"/>`;

    const textX = bx + pad + logo + gap;
    const badgeSvg = h
      ? `<svg x="${bx + pad}" y="${by + pad}" width="${logo}" height="${logo}" viewBox="${LOGO_VIEWBOX}">${LOGO}</svg>` +
        (withText
          ? `<g fill="${INK}" style="font-family: var(--font-brand), Arial, sans-serif">` +
            `<text x="${textX}" y="${wordY}" dominant-baseline="central" font-size="${wordSize}" font-weight="700" ` +
            `textLength="${textW}" lengthAdjust="spacing">${WORDMARK}</text>` +
            `<text x="${textX}" y="${tagY}" dominant-baseline="central" font-size="${tagSize}" font-weight="500" ` +
            `textLength="${textW}" lengthAdjust="spacing">${TAGLINE}</text></g>`
          : '')
      : '';

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${-margin} ${-margin} ${v} ${v}" shape-rendering="geometricPrecision">` +
      `<rect x="${-margin}" y="${-margin}" width="${v}" height="${v}" fill="#fff"/>` +
      `<path fill="${INK}" d="${cells.join('')}"/>` +
      eye(0, 0) +
      eye(n - 7, 0) +
      eye(0, n - 7) +
      badgeSvg +
      `</svg>`;
    const label = h
      ? {
          x: (textX + margin) / v,
          width: textW / v,
          word: { y: (wordY + margin) / v, size: wordSize / v, text: WORDMARK },
          tag: { y: (tagY + margin) / v, size: tagSize / v, text: TAGLINE },
        }
      : null;
    return { svg, label };
  }
  return null;
}
