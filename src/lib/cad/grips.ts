// Vertices ("grips") of the selected objects: which ones exist, moving the chosen ones by a delta, deleting them.
// Works on sketches (SketchFeature.points) and on any object of an opened file (CadEntity), in WGS84 degrees. Pure.
import { SKETCH_MIN_POINTS, type SketchFeature } from './sketch';
import type { CadEntity, Vec2 } from './types';

const SEP = '\u0001';
const KSEP = '\u0002';

/** Who a grip belongs to: a sketch ("s<id>") or an object of an opened file ("o<file><index in doc.entities>"). */
export const sketchOwner = (id: string) => `s${SEP}${id}`;
/** Owner of the vertices of a measurement of the measuring tools. */
export const measureOwner = (id: number) => `m${SEP}${id}`;
export const objectOwner = (fileId: string, index: number) => `o${SEP}${fileId}${SEP}${index}`;
export function parseOwner(owner: string): { sketch: string } | { fileId: string; index: number } | null {
  const [t, a, b] = owner.split(SEP);
  if (t === 's' && a) return { sketch: a };
  if (t === 'o' && a && b !== undefined && /^\d+$/.test(b)) return { fileId: a, index: Number(b) };
  return null;
}

/** One grip: the owner, the path (ring) and the vertex in it. */
export const gripKey = (owner: string, r: number, i: number) => `${owner}${KSEP}${r}:${i}`;
export function parseGripKey(key: string): { owner: string; r: number; i: number } | null {
  const k = key.lastIndexOf(KSEP);
  if (k < 0) return null;
  const [r, i] = key.slice(k + 1).split(':').map(Number);
  return Number.isInteger(r) && Number.isInteger(i) ? { owner: key.slice(0, k), r, i } : null;
}

/** Geometry of one object as paths of vertices. `dup[r]` = the last vertex of path r only repeats the first (closed outline). */
export interface GripShape {
  owner: string;
  paths: Vec2[][];
  /** Paths are closed outlines (areas, closed lines). */
  closed: boolean;
  dup: boolean[];
  /** Fewest vertices a path may keep. */
  min: number;
}

const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];
const clone = (pts: readonly Vec2[]): Vec2[] => pts.map((p) => [p[0], p[1]] as Vec2);

/** A shape from plain vertex lists (measurements, anything that is not a sketch or an object of a file). */
export function shapeOfPoints(owner: string, paths: readonly Vec2[][], closed: boolean, min: number): GripShape {
  return {
    owner,
    paths: paths.map(clone),
    closed,
    dup: paths.map((p) => closed && p.length >= 4 && same(p[0], p[p.length - 1])),
    min,
  };
}

/** The vertices of an object of a file; null for kinds without a usable geometry. */
export function shapeOfEntity(owner: string, e: CadEntity): GripShape | null {
  switch (e.kind) {
    case 'polyline': {
      const closed = e.closed || (e.points.length >= 4 && same(e.points[0], e.points[e.points.length - 1]));
      return shapeOfPoints(owner, [e.points], closed, closed ? 3 : 2);
    }
    case 'polygon':
      return e.rings.length ? shapeOfPoints(owner, e.rings, true, 3) : null;
    case 'point':
      return shapeOfPoints(owner, [[e.position]], false, 1);
    case 'text':
      return shapeOfPoints(owner, [[e.position]], false, 1);
    case 'table':
      return shapeOfPoints(owner, [[e.origin]], false, 1);
  }
}

export function shapeOfSketch(f: SketchFeature): GripShape {
  return shapeOfPoints(sketchOwner(f.id), [f.points], f.kind === 'polygon', SKETCH_MIN_POINTS[f.kind]);
}

/** The object with its vertices replaced by `paths` (same structure as `shapeOfEntity`). */
export function entityWithPaths(e: CadEntity, paths: readonly Vec2[][]): CadEntity {
  switch (e.kind) {
    case 'polyline':
      return { ...e, points: paths[0] };
    case 'polygon':
      return { ...e, rings: paths.map((p) => p) };
    case 'point':
      return { ...e, position: paths[0][0] };
    case 'text':
      return { ...e, position: paths[0][0] };
    case 'table':
      return { ...e, origin: paths[0][0] };
  }
}

/** Grips of a shape: every vertex except the closing repeat of an outline. */
export function gripsOfShape(s: GripShape): { key: string; p: Vec2 }[] {
  const out: { key: string; p: Vec2 }[] = [];
  s.paths.forEach((path, r) => {
    const n = s.dup[r] ? path.length - 1 : path.length;
    for (let i = 0; i < n; i++) out.push({ key: gripKey(s.owner, r, i), p: path[i] });
  });
  return out;
}

/** Vertices of `shape` moved by `delta` where `chosen` ("r:i") says so. Returns new paths (the shape is not changed). */
export function movedPaths(shape: GripShape, chosen: ReadonlySet<string>, delta: Vec2): Vec2[][] {
  return shape.paths.map((path, r) => {
    const out = clone(path);
    const n = path.length;
    for (let i = 0; i < n; i++) {
      // The closing repeat follows the first vertex.
      const src = shape.dup[r] && i === n - 1 ? 0 : i;
      if (chosen.has(`${r}:${src}`)) out[i] = [path[i][0] + delta[0], path[i][1] + delta[1]];
    }
    return out;
  });
}

/**
 * Paths without the chosen vertices, or null when that would leave a path with too few (nothing is removed from
 * a shape that cannot lose them). Single-vertex shapes (points, texts) are never reduced.
 */
export function pathsWithout(shape: GripShape, chosen: ReadonlySet<string>): Vec2[][] | null {
  if (shape.min <= 1 && shape.paths.every((p) => p.length === 1)) return null;
  const out: Vec2[][] = [];
  let any = false;
  for (let r = 0; r < shape.paths.length; r++) {
    const path = shape.paths[r];
    const n = shape.dup[r] ? path.length - 1 : path.length;
    const kept: Vec2[] = [];
    for (let i = 0; i < n; i++) if (!chosen.has(`${r}:${i}`)) kept.push(path[i]);
    if (kept.length !== n) any = true;
    if (kept.length < shape.min) return null;
    out.push(shape.dup[r] ? [...kept, kept[0]] : kept);
  }
  return any ? out : null;
}

/** Splits grip keys by owner: owner → set of "r:i". */
export function groupGrips(keys: Iterable<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const k of keys) {
    const g = parseGripKey(k);
    if (!g) continue;
    const set = out.get(g.owner) ?? new Set<string>();
    set.add(`${g.r}:${g.i}`);
    out.set(g.owner, set);
  }
  return out;
}

/** Midpoints of the edges of a shape, to snap to. */
export function midpointsOf(paths: readonly Vec2[][], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const path of paths) {
    const n = closed ? path.length : path.length - 1;
    for (let i = 0; i < n; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      if (!same(a, b)) out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
  }
  return out;
}
