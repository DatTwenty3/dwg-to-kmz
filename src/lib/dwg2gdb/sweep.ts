// "Quét khung" on the map of Bóc tách DWG: the objects of a drawing caught by the selection box (any polygon), to be
// left out of the export (stray hatches, legend leftovers…). Works on the previewed document (WGS84, the same
// coordinates as the swept polygon); objects are identified by their preview handle (inventory.previewHandle).
import type { CadEntity, CadDocument, Vec2 } from '@/lib/cad/types';
import { isClosedLine, pointInRing } from './geometry';
import { previewIndex } from './inventory';

/** The paths of an object (rings of areas, the line of a polyline, a single point for texts/points) and whether they enclose an area. */
function pathsOf(e: CadEntity): { paths: Vec2[][]; closed: boolean } {
  switch (e.kind) {
    case 'polyline':
      return { paths: [e.closed ? [...e.points, e.points[0]] : e.points], closed: isClosedLine(e.points, e.closed) };
    case 'polygon':
      return { paths: e.rings.map((r) => [...r, r[0]]), closed: true };
    case 'text':
    case 'point':
      return { paths: [[e.position]], closed: false };
    case 'table':
      return { paths: [[e.origin]], closed: false };
  }
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Segments ab and cd intersect (touching counts). */
function segmentsMeet(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}

/**
 * Indexes of the objects of `layers` caught by the sweep (the selection box, or any polygon): wholly inside (every
 * vertex — AutoCAD "window"), or with `touch` anything touching it ("crossing"): a vertex inside, an edge crossing
 * the box, or the box inside a closed shape.
 */
export function sweepSelect(doc: CadDocument, sweep: Vec2[], layers: Set<string>, touch: boolean): number[] {
  if (sweep.length < 3) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of sweep) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const inBox = (p: Vec2) => p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
  const inside = (p: Vec2) => inBox(p) && pointInRing(p, sweep);
  const edges: [Vec2, Vec2][] = sweep.map((p, k) => [p, sweep[(k + 1) % sweep.length]]);
  const out: number[] = [];
  for (const e of doc.entities) {
    const i = previewIndex(e.handle);
    if (i === null || !layers.has(e.layer)) continue;
    const { paths, closed } = pathsOf(e);
    const pts = paths.flat();
    if (!pts.length) continue;
    if (!touch) {
      if (pts.every(inside)) out.push(i);
      continue;
    }
    // Quick reject: the object's box does not meet the sweep's box.
    let ex0 = Infinity;
    let ey0 = Infinity;
    let ex1 = -Infinity;
    let ey1 = -Infinity;
    for (const [x, y] of pts) {
      ex0 = Math.min(ex0, x);
      ey0 = Math.min(ey0, y);
      ex1 = Math.max(ex1, x);
      ey1 = Math.max(ey1, y);
    }
    if (ex1 < minX || ex0 > maxX || ey1 < minY || ey0 > maxY) continue;
    const hit =
      pts.some(inside) ||
      paths.some((path) => path.some((p, k) => k > 0 && edges.some(([a, b]) => segmentsMeet(path[k - 1], p, a, b)))) ||
      (closed && paths.some((ring) => sweep.some((q) => pointInRing(q, ring))));
    if (hit) out.push(i);
  }
  return out;
}
