// Branded QR code: rounded modules, accent finder eyes and a "logo + LEDAT-GIS" badge in the middle.
import { encode, QrCodeDataType } from 'uqr';

const INK = '#18181b';
const ACCENT = '#2563eb';
const WORDMARK = 'LEDAT-GIS';

/** The app logo (same drawing as <Logo/> in icons.tsx) as SVG markup in a 28×28 box. */
const LOGO =
  '<rect width="28" height="28" rx="8" fill="#18181b"/>' +
  '<path d="M8 10.5 14 7l6 3.5-6 3.5z" fill="#fff"/>' +
  '<path d="m8 14.5 6 3.5 6-3.5M8 18l6 3.5 6-3.5" fill="none" stroke="#60a5fa" stroke-width="1.6" stroke-linejoin="round"/>';

/**
 * The badge hides the modules under it (~6 % of the code), which error correction level M (15 %) makes up for.
 * Level Q would leave more headroom but makes the code denser and harder to scan off a screen (measured with
 * jsQR: M with the badge decodes at the same sizes as a plain M code); links too long for M fall back to level
 * L without a badge.
 */
const LEVELS = [
  { ecc: 'M', badge: 0.12 },
  { ecc: 'L', badge: 0 },
] as const;

export interface BrandedQr {
  svg: string;
  /** Where the wordmark goes, as fractions of the image edge — for drawing it with the UI font on a canvas. */
  label: { x: number; y: number; size: number; maxWidth: number; text: string } | null;
}

/**
 * `withText: false` leaves the wordmark out of the SVG (an SVG drawn through <img> cannot use the page's web
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

    // Badge geometry in modules: logo square + wordmark, centred.
    const h = Math.round(n * badge);
    const logo = h * 0.72;
    const pad = (h - logo) / 2;
    const gap = pad * 0.8;
    const fontSize = h * 0.42;
    const width = h ? pad + logo + gap + fontSize * 5.9 + pad * 1.4 : 0;
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
    // Finder patterns: rounded ring + accent centre.
    const eye = (x: number, y: number) =>
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="${INK}"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${ACCENT}"/>`;

    const textX = bx + pad + logo + gap;
    const badgeSvg = h
      ? `<svg x="${bx + pad}" y="${by + pad}" width="${logo}" height="${logo}" viewBox="0 0 28 28">${LOGO}</svg>` +
        (withText
          ? `<text x="${textX}" y="${n / 2}" dominant-baseline="central" font-size="${fontSize}" font-weight="700" fill="${INK}" ` +
            `style="font-family: var(--font-ui), Arial, sans-serif; letter-spacing: -0.02em">${WORDMARK}</text>`
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
    const label = h ? { x: (textX + margin) / v, y: (n / 2 + margin) / v, size: fontSize / v, maxWidth: (fontSize * 5.9) / v, text: WORDMARK } : null;
    return { svg, label };
  }
  return null;
}
