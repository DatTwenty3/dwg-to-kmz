// Plane geometry on drawing coordinates (VN-2000 metres) for "Bóc tách DWG → TT16".
import type { CadDocument, Vec2 } from '@/lib/cad/types';

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

/** Ends of a line closer than this (drawing units, metres) are the same point. */
export const SNAP = 0.01;

const near = (a: Vec2, b: Vec2, tol = SNAP) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/** A polyline that encloses an area: flagged closed, or its last vertex back on the first (CAD often leaves the flag off). */
export const isClosedLine = (pts: Vec2[], closed: boolean) => pts.length >= 3 && (closed || (pts.length >= 4 && near(pts[0], pts[pts.length - 1])));

/**
 * A long outline whose ends stop short of each other by a drafting slip (gap < 2 % of its length): how the planning
 * boundary is often drawn (one open polyline, the closing stretch left out). Read as an area like findBoundary does.
 */
export function nearlyClosedOutline(pts: Vec2[]): boolean {
  if (pts.length < 10) return false;
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.02 * len;
}

/**
 * Rings made of open lines whose ends meet (outlines drawn in several pieces: a boundary of LINE segments, a lot
 * split at each corner). Each line is used at most once; at a junction the first free piece is taken. Returns the
 * rings (without the repeated closing vertex), how many lines went into them and which ones (indexes in `lines`).
 */
export function chainRings(lines: Vec2[][], tol = SNAP): { rings: Vec2[][]; used: number; members: number[][] } {
  const cell = (p: Vec2) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const ends = new Map<string, number[]>();
  const live = lines.map((l) => l.length >= 2);
  lines.forEach((l, i) => {
    if (!live[i]) return;
    for (const p of [l[0], l[l.length - 1]]) {
      const k = cell(p);
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  });
  /** A free line with an end at p (3×3 cells around it, so ends straddling a cell edge still meet). */
  const take = (p: Vec2): { i: number; reversed: boolean } | null => {
    const cx = Math.round(p[0] / tol);
    const cy = Math.round(p[1] / tol);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of ends.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (!live[i]) continue;
          const l = lines[i];
          if (near(l[0], p, tol)) return { i, reversed: false };
          if (near(l[l.length - 1], p, tol)) return { i, reversed: true };
        }
    return null;
  };
  const rings: Vec2[][] = [];
  const ringMembers: number[][] = [];
  let used = 0;
  for (let s = 0; s < lines.length; s++) {
    if (!live[s]) continue;
    live[s] = false;
    const chain: Vec2[] = [...lines[s]];
    const members = [s];
    for (let guard = 0; guard < lines.length && !near(chain[0], chain[chain.length - 1], tol); guard++) {
      const next = take(chain[chain.length - 1]);
      if (!next) break;
      live[next.i] = false;
      members.push(next.i);
      const pts = next.reversed ? [...lines[next.i]].reverse() : lines[next.i];
      chain.push(...pts.slice(1));
    }
    const ring = chain.length >= 4 && near(chain[0], chain[chain.length - 1], tol) ? cleanRing(chain) : null;
    if (ring) {
      rings.push(ring);
      ringMembers.push(members);
      used += members.length;
    } else for (const i of members.slice(1)) live[i] = true; // a spur led nowhere: its pieces may still close from elsewhere
  }
  return { rings, used, members: ringMembers };
}

const NUMERIC = /^[+\-±]?\d{1,4}([.,]\d{1,3})?$/;
type LabelGrid = PointGrid<{ text: string; height: number }>;

/** Label texts of a drawing (inside the area, not numbers), indexed for point-in-polygon lookups. */
export function labelIndex(d: { doc: CadDocument; inside: Uint8Array }) {
  const grid = new PointGrid<{ text: string; height: number }>(200);
  d.doc.entities.forEach((e, i) => {
    if (e.kind !== 'text' || !d.inside[i]) return;
    const text = e.text.replace(/\s+/g, ' ').trim();
    if (text.length < 2 || NUMERIC.test(text) || !/\p{L}/u.test(text)) return;
    grid.add(e.position, { text: text.slice(0, 100), height: e.height });
  });
  return grid;
}

export function labelIn(grid: LabelGrid, poly: Vec2[][]): string | null {
  const [outer, ...holes] = poly;
  let best: { text: string; height: number } | null = null;
  for (const { p, v } of grid.query(bboxOf(outer))) {
    if (!pointInRing(p, outer) || holes.some((h) => pointInRing(p, h))) continue;
    if (!best || v.height > best.height || (v.height === best.height && v.text.length > best.text.length)) best = v;
  }
  return best?.text ?? null;
}
