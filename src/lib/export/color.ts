// Colour helpers: CAD `#rrggbb` (+ alpha 0..1) <-> KML `aabbggrr`.

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f]{3})$/i;

function clamp01(a: number): number {
  return Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1;
}

function byteHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Parse `#rrggbb` / `rrggbb` / `#rgb` → lowercase `rrggbb`; invalid → `ffffff`. */
export function normalizeHex(hex: string): string {
  const m6 = HEX6.exec(hex.trim());
  if (m6) return m6[1].toLowerCase();
  const m3 = HEX3.exec(hex.trim());
  if (m3) {
    const [r, g, b] = m3[1].toLowerCase();
    return r + r + g + g + b + b;
  }
  return 'ffffff';
}

/** `#rrggbb` + alpha (0..1) → KML `aabbggrr` (lowercase). */
export function hexToKmlColor(hex: string, alpha = 1): string {
  const h = normalizeHex(hex);
  const a = byteHex(Math.round(clamp01(alpha) * 255));
  return a + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
}

/** KML `aabbggrr` → `{ hex: '#rrggbb', alpha: 0..1 }`. Throws on malformed input. */
export function kmlColorToHex(kml: string): { hex: string; alpha: number } {
  if (!/^[0-9a-f]{8}$/i.test(kml)) throw new Error(`invalid KML color: ${kml}`);
  const k = kml.toLowerCase();
  return {
    hex: '#' + k.slice(6, 8) + k.slice(4, 6) + k.slice(2, 4),
    alpha: parseInt(k.slice(0, 2), 16) / 255,
  };
}
