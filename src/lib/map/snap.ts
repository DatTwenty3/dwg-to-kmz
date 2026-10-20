// Object snapping ("bắt điểm") on the deck.gl map: the vertices and the edge midpoints of what lies under the pointer.
// Shared by the measuring tools and the vertex dragging; the draw / edit tools still use the vertex-only helpers
// of measureTool.ts.
import type { MapboxOverlay } from '@deck.gl/mapbox';
import type { Vec2 } from '@/lib/cad/types';
import { midpointsOf } from '@/lib/cad/grips';

export interface SnapTarget {
  p: Vec2;
  /** The midpoint of an edge (else a vertex / end point). */
  mid: boolean;
}

/** Snap targets of whatever deck.gl picked (PathItem / PolygonItem / PointItem / TextItem). */
export function snapTargetsOf(obj: unknown): SnapTarget[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as { path?: Vec2[]; polygon?: Vec2[][]; position?: Vec2 };
  const out: SnapTarget[] = [];
  const paths = Array.isArray(o.path) ? [o.path] : Array.isArray(o.polygon) ? o.polygon : null;
  if (paths) {
    const closed = !Array.isArray(o.path);
    for (const p of paths.flat()) out.push({ p, mid: false });
    for (const p of midpointsOf(paths, closed)) out.push({ p, mid: true });
  } else if (Array.isArray(o.position)) out.push({ p: o.position, mid: false });
  return out;
}

export interface PickSnapOptions {
  /** Layers the pick must not use (the tool's own previews, highlights): by layer id. */
  skipLayer?: (id: string) => boolean;
  /** Positions to leave out ("lng,lat" as strings): e.g. the vertices being dragged. */
  ignore?: ReadonlySet<string>;
}

/**
 * The vertex or edge midpoint nearest to the pointer (x, y in px) within `radius` px, among the objects under it.
 * A vertex wins over a midpoint at about the same distance.
 */
export function pickSnap(
  overlay: MapboxOverlay | null,
  project: (p: Vec2) => [number, number],
  x: number,
  y: number,
  radius: number,
  opts: PickSnapOptions = {},
): SnapTarget | null {
  if (!overlay) return null;
  try {
    const infos = overlay.pickMultipleObjects({ x, y, radius, depth: 6 });
    let best: SnapTarget | null = null;
    let bestD = radius * radius;
    for (const info of infos) {
      if (opts.skipLayer?.(info.layer?.id ?? '')) continue;
      for (const t of snapTargetsOf(info.object)) {
        if (opts.ignore?.has(`${t.p[0]},${t.p[1]}`)) continue;
        const [qx, qy] = project(t.p);
        const d = (qx - x) ** 2 + (qy - y) ** 2 + (t.mid ? 4 : 0);
        if (d <= bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  } catch {
    return null;
  }
}
