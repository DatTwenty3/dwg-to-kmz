// Plane geometry on drawing coordinates (VN-2000 metres) for "Bóc tách DWG → TT16".
import type { Vec2 } from '@/lib/cad/types';

/** Signed area (shoelace, around the first vertex: VN-2000 coordinates are large); > 0 counter-clockwise. */
export function signedArea(ring: Vec2[]): number {
  if (!ring.length) return 0;
  const [ox, oy] = ring[0];
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const x1 = ring[i][0] - ox;
    const y1 = ring[i][1] - oy;
    const x2 = ring[(i + 1) % n][0] - ox;
    const y2 = ring[(i + 1) % n][1] - oy;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const ringArea = (ring: Vec2[]) => Math.abs(signedArea(ring));

/** Even-odd point in ring. */
export function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

/** Distance from a point to the edges of a ring. */
export function distanceToRing(p: Vec2, ring: Vec2[]): number {
  let d = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) d = Math.min(d, segDist2(p, ring[i], ring[(i + 1) % n]));
  return Math.sqrt(d);
}

/** Area centroid of a ring (vertex mean for degenerate rings). */
export function ringCentroid(ring: Vec2[]): Vec2 {
  // Relative to the first vertex: with coordinates of ~10⁶ m the products cancel catastrophically otherwise.
  const [ox, oy] = ring[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const x1 = ring[i][0] - ox;
    const y1 = ring[i][1] - oy;
    const x2 = ring[(i + 1) % n][0] - ox;
    const y2 = ring[(i + 1) % n][1] - oy;
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const m = ring.reduce<Vec2>((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]);
    return [m[0] / ring.length, m[1] / ring.length];
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)];
}

/** A point inside the ring: the centroid when it is inside, else the middle of the widest horizontal chord. */
export function interiorPoint(ring: Vec2[]): Vec2 {
  const c = ringCentroid(ring);
  if (pointInRing(c, ring)) return c;
  const y = c[1];
  const xs: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  let best: Vec2 = ring[0];
  let w = -1;
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i + 1] - xs[i] > w) {
      w = xs[i + 1] - xs[i];
      best = [(xs[i] + xs[i + 1]) / 2, y];
    }
  return best;
}

/** Point half-way along a polyline. */
export function lineMidpoint(pts: Vec2[]): Vec2 {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (l >= left && l > 0) {
      const t = left / l;
      return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
    }
    left -= l;
  }
  return pts[0];
}

/** Ring without the repeated closing vertex and without consecutive duplicates; null when degenerate. */
export function cleanRing(ring: Vec2[]): Vec2[] | null {
  const out: Vec2[] = [];
  for (const p of ring) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-6 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out.length >= 3 && ringArea(out) > 1e-6 ? out : null;
}

/**
 * Rings (outer boundaries and holes in any order / orientation, as hatches give them) → polygons, each
 * [outer, ...holes]: a ring inside an odd number of bigger rings is a hole of the smallest one containing it.
 */
export function ringsToPolygons(rings: Vec2[][]): Vec2[][][] {
  const clean = rings.map(cleanRing).filter((r): r is Vec2[] => !!r);
  clean.sort((a, b) => ringArea(b) - ringArea(a));
  const polys: { outer: Vec2[]; holes: Vec2[][] }[] = [];
  const depth: number[] = [];
  const parent: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i][0];
    let d = 0;
    let par = -1;
    for (let j = 0; j < i; j++)
      if (pointInRing(p, clean[j])) {
        d++;
        par = j; // larger rings come first, so the last container found is the smallest
      }
    depth.push(d);
    parent.push(par);
  }
  const polyOf = new Map<number, number>();
  for (let i = 0; i < clean.length; i++) {
    if (depth[i] % 2 === 0) {
      polyOf.set(i, polys.length);
      polys.push({ outer: clean[i], holes: [] });
    } else {
      const k = polyOf.get(parent[i]);
      if (k !== undefined) polys[k].holes.push(clean[i]);
    }
  }
  return polys.map((p) => [p.outer, ...p.holes]);
}

export type BBox = [number, number, number, number];

export function bboxOf(pts: Vec2[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Uniform grid of points with payloads, for "texts inside this polygon" lookups. */
export class PointGrid<T> {
  private cells = new Map<string, { p: Vec2; v: T }[]>();
  constructor(private size: number) {}
  private key(x: number, y: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }
  add(p: Vec2, v: T) {
    const k = this.key(p[0], p[1]);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push({ p, v });
  }
  /** Items whose point lies in the box. */
  query([x0, y0, x1, y1]: BBox): { p: Vec2; v: T }[] {
    const out: { p: Vec2; v: T }[] = [];
    const i0 = Math.floor(x0 / this.size);
    const i1 = Math.floor(x1 / this.size);
    const j0 = Math.floor(y0 / this.size);
    const j1 = Math.floor(y1 / this.size);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 250_000) return out;
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const c = this.cells.get(`${i},${j}`);
        if (c) for (const it of c) if (it.p[0] >= x0 && it.p[0] <= x1 && it.p[1] >= y0 && it.p[1] <= y1) out.push(it);
      }
    return out;
  }
}
