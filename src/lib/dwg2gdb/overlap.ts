// Areas of one class drawn on top of each other (two hatches of the same symbol, a patch of the same land use over a bigger parcel):
// they are one region, not two overlapping rows. Overlapping polygons of the same phanLoai (and not of two different names) are
// united into one MultiPolygon; polygons that only share an edge stay what they are, two neighbouring parcels.
import polygonClipping from 'polygon-clipping';
import type { GisFeature, SourceRef } from './features';

type Poly = number[][][];
type Multi = number[][][][];

/** Overlap smaller than this (m², or this share of the smaller polygon, whichever is bigger) is a sliver at an edge, not an overlap. */
const MIN_OVERLAP_M2 = 1;
const MIN_OVERLAP_SHARE = 0.002;
/** A class with more polygons of one phanLoai than this is left alone (the sweep would be too slow for the browser). */
const MAX_GROUP = 40_000;
const MAX_PAIR_CHECKS = 600_000;

const ring = (r: number[][]): number => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[0][0]) * (r[i][1] - r[0][1]) - (r[i][0] - r[0][0]) * (r[j][1] - r[0][1]);
  return Math.abs(s) / 2;
};
const polyArea = (p: Poly): number => p.reduce((t, r, k) => t + (k === 0 ? ring(r) : -ring(r)), 0);
export const multiArea = (m: Multi): number => m.reduce((t, p) => t + polyArea(p), 0);

function bounds(m: Multi): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of m) for (const [x, y] of p[0]) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rounded = (m: Multi): Multi =>
  m
    .map((p) => p.map((r) => r.map(([x, y]) => [r3(x), r3(y)])).filter((r, k) => r.length >= 4 && (k === 0 || ring(r) > 1e-6)))
    .filter((p) => p.length > 0 && ring(p[0]) > 1e-6);

const namesAgree = (a: GisFeature, b: GisFeature) => !a.tenDoiTuong || !b.tenDoiTuong || a.tenDoiTuong === b.tenDoiTuong;

export interface MergeResult {
  features: GisFeature[];
  /** Polygons absorbed into another (the features that disappeared). */
  absorbed: number;
  /** Regions made of more than one polygon. */
  groups: number;
}

/** United feature: the biggest polygon gives the name and the fields, the others fill what it lacks; every source object is kept. */
function unite(parts: GisFeature[], areas: number[]): GisFeature {
  const order = parts.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  const first = parts[order[0]];
  const merged: GisFeature = { ...first };
  for (const i of order.slice(1)) {
    const f = parts[i];
    merged.tenDoiTuong ??= f.tenDoiTuong;
    merged.ghiChu ??= f.ghiChu;
    if (f.attrs) merged.attrs = { ...f.attrs, ...(merged.attrs ?? {}) };
  }
  // One alternative holding every object of every part (a region goes when any of its objects is taken out).
  const seen = new Set<string>();
  const objects: SourceRef[] = [];
  for (const f of parts) for (const alt of f.refs ?? []) for (const ref of alt) {
    const k = `${ref[0]}\u0001${ref[1]}`;
    if (!seen.has(k)) {
      seen.add(k);
      objects.push(ref);
    }
  }
  merged.refs = objects.length ? [objects] : first.refs;
  return merged;
}

/**
 * Unites the overlapping polygons of one class. Only polygons of the same phanLoai whose names do not contradict each other are
 * joined, and only where they overlap by an area (not by an edge). Features of other geometry are returned untouched.
 */
export function mergeOverlappingAreas(features: readonly GisFeature[]): MergeResult {
  const byLoai = new Map<string, number[]>();
  features.forEach((f, i) => {
    if (f.geometry.type !== 'MultiPolygon') return;
    const k = f.phanLoai ?? '';
    (byLoai.get(k) ?? byLoai.set(k, []).get(k)!).push(i);
  });
  const parent = features.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const geoms = new Map<number, { m: Multi; box: [number, number, number, number]; area: number }>();
  const geomOf = (i: number) => {
    let g = geoms.get(i);
    if (!g) {
      const m = (features[i].geometry as { coordinates: Multi }).coordinates;
      g = { m, box: bounds(m), area: multiArea(m) };
      geoms.set(i, g);
    }
    return g;
  };
  let checks = 0;
  for (const idx of byLoai.values()) {
    if (idx.length < 2 || idx.length > MAX_GROUP) continue;
    const order = idx.slice().sort((a, b) => geomOf(a).box[0] - geomOf(b).box[0]);
    for (let a = 0; a < order.length; a++) {
      const A = geomOf(order[a]);
      for (let b = a + 1; b < order.length; b++) {
        const B = geomOf(order[b]);
        if (B.box[0] > A.box[2]) break;
        if (B.box[1] > A.box[3] || B.box[3] < A.box[1]) continue;
        if (find(order[a]) === find(order[b]) || !namesAgree(features[order[a]], features[order[b]])) continue;
        const ox = Math.min(A.box[2], B.box[2]) - Math.max(A.box[0], B.box[0]);
        const oy = Math.min(A.box[3], B.box[3]) - Math.max(A.box[1], B.box[1]);
        if (ox * oy < MIN_OVERLAP_M2 || ++checks > MAX_PAIR_CHECKS) continue;
        let inter: Multi;
        try {
          inter = polygonClipping.intersection(A.m as never, B.m as never) as Multi;
        } catch {
          continue; // a damaged outline: left as it is
        }
        if (multiArea(inter) >= Math.max(MIN_OVERLAP_M2, MIN_OVERLAP_SHARE * Math.min(A.area, B.area))) parent[find(order[b])] = find(order[a]);
      }
    }
  }
  const comps = new Map<number, number[]>();
  features.forEach((f, i) => {
    if (f.geometry.type !== 'MultiPolygon') return;
    const r = find(i);
    (comps.get(r) ?? comps.set(r, []).get(r)!).push(i);
  });
  const out: GisFeature[] = [];
  let absorbed = 0;
  let groups = 0;
  const done = new Set<number>();
  features.forEach((f, i) => {
    if (f.geometry.type !== 'MultiPolygon') {
      out.push(f);
      return;
    }
    const r = find(i);
    const members = comps.get(r)!;
    if (members.length === 1) {
      out.push(f);
      return;
    }
    if (done.has(r)) return;
    done.add(r);
    let united: Multi;
    try {
      const [head, ...rest] = members.map((k) => geomOf(k).m);
      united = rounded(polygonClipping.union(head as never, ...(rest as never[])) as Multi);
    } catch {
      members.forEach((k) => out.push(features[k]));
      return;
    }
    if (!united.length) {
      members.forEach((k) => out.push(features[k]));
      return;
    }
    const merged = unite(members.map((k) => features[k]), members.map((k) => geomOf(k).area));
    merged.geometry = { type: 'MultiPolygon', coordinates: united };
    out.push(merged);
    absorbed += members.length - 1;
    groups++;
  });
  return { features: out, absorbed, groups };
}
