// "Quét chọn" on the map of Bóc tách DWG: the objects of a drawing caught by a polygon drawn by the user, to be
// left out of the export (stray hatches, legend leftovers…). Works on the previewed document (WGS84, the same
// coordinates as the swept polygon); objects are identified by their preview handle (inventory.previewHandle).
import type { CadEntity, CadDocument, Vec2 } from '@/lib/cad/types';
import { pointInRing } from './geometry';
import { previewIndex } from './inventory';

/** Vertices that stand for an object. */
function verticesOf(e: CadEntity): Vec2[] {
  switch (e.kind) {
    case 'polyline':
      return e.points;
    case 'polygon':
      return e.rings.flat();
    case 'text':
    case 'point':
      return [e.position];
    case 'table':
      return [e.origin];
  }
}

/**
 * Indexes of the objects of `layers` caught by the sweep: wholly inside (every vertex) or, with `touch`, any vertex
 * inside or any edge of the sweep inside the object's area.
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
  const out: number[] = [];
  for (const e of doc.entities) {
    const i = previewIndex(e.handle);
    if (i === null || !layers.has(e.layer)) continue;
    const pts = verticesOf(e);
    if (!pts.length) continue;
    const hit = touch
      ? pts.some(inside) || (e.kind === 'polygon' && e.rings.some((r) => sweep.some((q) => pointInRing(q, r))))
      : pts.every(inside);
    if (hit) out.push(i);
  }
  return out;
}
