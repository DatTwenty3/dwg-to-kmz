// Esri File Geodatabase shape blobs ("compressed" extended shape buffer, as read by GDAL's OpenFileGDB driver).
//   varuint geometry type (low byte = shape type, high bits = has Z / M / curves for the "general" types);
//   point:  varuint x, y  → (v - 1) / xyScale + origin  (0 = empty);
//   multi*: varuint nPoints, [nParts], [nCurves], 4 varuint bbox, (nParts-1) varuint part sizes,
//           then signed varint deltas of x/y (scaled), then Z / M arrays, then curve segments (ignored: drawn straight).
// Pure, no DOM — returns map coordinates in the class's own coordinate system.
import type { GeomParams } from './filegdb';

export type Shape = (
  | { type: 'point'; points: [number, number][] }
  | { type: 'line'; parts: [number, number][][] }
  | { type: 'polygon'; parts: [number, number][][] }
) & {
  /** The shape has curve segments (drawn as straight chords). */
  curved?: boolean;
};

class Reader {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  varuint(): number {
    let x = 0;
    let shift = 0;
    for (;;) {
      if (this.p >= this.b.length) throw new Error('shape truncated');
      const v = this.b[this.p++];
      x += (v & 0x7f) * 2 ** shift;
      if (!(v & 0x80)) return x;
      shift += 7;
    }
  }
  /** Signed varint: first byte = continuation bit, sign bit (0x40), 6 value bits; then 7 bits per byte. */
  varint(): number {
    if (this.p >= this.b.length) throw new Error('shape truncated');
    let v = this.b[this.p++];
    const neg = (v & 0x40) !== 0;
    let x = v & 0x3f;
    let shift = 6;
    while (v & 0x80) {
      if (this.p >= this.b.length) throw new Error('shape truncated');
      v = this.b[this.p++];
      x += (v & 0x7f) * 2 ** shift;
      shift += 7;
    }
    return neg ? -x : x;
  }
}

const POINT = new Set([1, 9, 11, 21, 52]);
const MULTIPOINT = new Set([8, 18, 20, 28, 53]);
const LINE = new Set([3, 10, 13, 23, 50]);
const POLYGON = new Set([5, 15, 19, 25, 51]);
const HAS_Z = new Set([9, 10, 11, 13, 15, 18, 19, 20]);

/** Decodes one shape blob; null for empty / unsupported (multipatch) shapes. */
export function decodeShape(blob: Uint8Array, g: GeomParams): Shape | null {
  const r = new Reader(blob);
  const full = r.varuint();
  const base = full & 0xff;
  const general = base >= 50;
  const hasCurves = general && full >= 0x20000000 && Math.floor(full / 0x20000000) % 2 === 1;
  // Z/M presence is a property of the field for the general types; legacy types carry it in the type code.
  const hasZ = general ? g.hasZ : HAS_Z.has(base);
  const sx = (v: number) => v / g.xyScale + g.xOrigin;
  const sy = (v: number) => v / g.xyScale + g.yOrigin;

  if (POINT.has(base)) {
    const x = r.varuint();
    const y = r.varuint();
    if (x === 0 && y === 0) return null;
    return { type: 'point', points: [[sx(x - 1), sy(y - 1)]] };
  }
  const isMulti = MULTIPOINT.has(base);
  if (!isMulti && !LINE.has(base) && !POLYGON.has(base)) return null; // multipatch etc.

  const nPoints = r.varuint();
  if (nPoints === 0) return null;
  const nParts = isMulti ? 1 : r.varuint();
  if (!isMulti && hasCurves) r.varuint(); // number of curve segments (skipped: arcs drawn as chords)
  for (let k = 0; k < 4; k++) r.varuint(); // bbox
  const sizes: number[] = [];
  let used = 0;
  for (let k = 0; k < nParts - 1; k++) {
    const n = r.varuint();
    sizes.push(n);
    used += n;
  }
  sizes.push(nPoints - used);
  void hasZ; // Z/M follow the XY array and are not needed for display.

  let dx = 0;
  let dy = 0;
  const parts: [number, number][][] = [];
  for (const n of sizes) {
    const part: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      dx += r.varint();
      dy += r.varint();
      part.push([sx(dx), sy(dy)]);
    }
    parts.push(part);
  }
  if (isMulti) return { type: 'point', points: parts[0] };
  return { type: LINE.has(base) ? 'line' : 'polygon', parts, curved: hasCurves };
}

/** Shoelace area (positive = counter-clockwise in a y-up system). */
export function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/**
 * Esri polygons store outer rings clockwise and holes counter-clockwise: group them into [outer, ...holes].
 * A hole is attached to the smallest preceding outer ring that contains its first vertex (falls back to the last).
 */
export function groupRings(parts: [number, number][][]): [number, number][][][] {
  const polys: [number, number][][][] = [];
  for (const ring of parts) {
    if (ring.length < 3) continue;
    if (ringArea(ring) <= 0 || polys.length === 0) {
      polys.push([ring]);
      continue;
    }
    const [px, py] = ring[0];
    const host =
      [...polys]
        .reverse()
        .find((poly) => insideRing(poly[0], px, py)) ?? polys[polys.length - 1];
    host.push(ring);
  }
  return polys;
}

function insideRing(ring: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
