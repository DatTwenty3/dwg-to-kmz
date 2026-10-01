// HATCH boundary loops → closed rings, grouped into polygons (outer ring + holes) by nesting depth.
import type { Vec2 } from '../types';
import type { SrcEdge, SrcLoop } from './source';
import { arcPoints, ccwSweep, ellipsePoints, expandBulges, splinePoints } from './tessellate';

function pushUnique(out: Vec2[], p: Vec2) {
  const last = out[out.length - 1];
  if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) return;
  out.push(p);
}

function edgePoints(e: SrcEdge): Vec2[] {
  switch (e.type) {
    case 'line':
      return [e.a, e.b];
    case 'arc': {
      const sweep = ccwSweep(e.start, e.end);
      // Clockwise edges store negated angles.
      return e.ccw ? arcPoints(e.center, e.radius, e.start, sweep) : arcPoints(e.center, e.radius, -e.start, -sweep);
    }
    case 'ellipse':
      return ellipsePoints(e.center, e.majorAxis, e.ratio, e.start, e.end, e.ccw);
    case 'spline':
      return splinePoints(e);
  }
}

/** Tessellate one loop into a ring (no repeated closing point). */
export function loopToRing(loop: SrcLoop): Vec2[] {
  let pts: Vec2[];
  if (loop.kind === 'poly') {
    pts = expandBulges(loop.vertices, true);
  } else {
    pts = [];
    for (const e of loop.edges) for (const p of edgePoints(e)) pushUnique(pts, p);
  }
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
  }
  return pts;
}

export function ringArea(r: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return s / 2;
}

export function pointInRing(x: number, y: number, r: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0];
    const yi = r[i][1];
    const xj = r[j][0];
    const yj = r[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface RingInfo {
  ring: Vec2[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Group rings into polygons using even–odd nesting: a ring nested in an even number of rings is an
 * outer boundary, otherwise a hole of its smallest container. Returns [outer, ...holes] arrays.
 */
export function nestRings(rings: Vec2[][]): Vec2[][][] {
  const infos: RingInfo[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    infos.push({ ring, area: Math.abs(ringArea(ring)), minX, minY, maxX, maxY });
  }
  if (infos.length === 0) return [];
  if (infos.length === 1) return [[infos[0].ring]];
  // Largest first, so containers precede contained rings.
  infos.sort((a, b) => b.area - a.area);
  const parent = new Array<number>(infos.length).fill(-1);
  const depth = new Array<number>(infos.length).fill(0);
  for (let i = 1; i < infos.length; i++) {
    const r = infos[i];
    // Test point: midpoint of the first edge (less likely to sit exactly on a shared vertex).
    const tx = (r.ring[0][0] + r.ring[1][0]) / 2;
    const ty = (r.ring[0][1] + r.ring[1][1]) / 2;
    // Smallest container = last matching among larger rings.
    for (let j = i - 1; j >= 0; j--) {
      const c = infos[j];
      if (c.area <= r.area) continue;
      if (r.minX < c.minX || r.maxX > c.maxX || r.minY < c.minY || r.maxY > c.maxY) continue;
      if (pointInRing(tx, ty, c.ring)) {
        parent[i] = j;
        depth[i] = depth[j] + 1;
        break;
      }
    }
  }
  const polys = new Map<number, Vec2[][]>();
  const order: number[] = [];
  for (let i = 0; i < infos.length; i++) {
    if (depth[i] % 2 === 0) {
      polys.set(i, [infos[i].ring]);
      order.push(i);
    }
  }
  for (let i = 0; i < infos.length; i++) {
    if (depth[i] % 2 === 1) polys.get(parent[i])?.push(infos[i].ring);
  }
  return order.map((i) => polys.get(i)!);
}
