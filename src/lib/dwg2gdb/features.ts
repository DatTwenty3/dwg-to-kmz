// CAD entities (drawing coordinates, VN-2000 metres) → GIS features per TT16 class, following the mapping table.
// Geometry conversions: hatch → vùng; closed polyline → vùng; vùng/đường → điểm (a point inside / mid-way);
// vùng → đường (its outline); chữ → điểm (with the text as tenDoiTuong). tenDoiTuong of a vùng is the biggest
// non-numeric text inside it (labels like "TRƯỜNG TIỂU HỌC LONG HIỆP").
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { bboxOf, cleanRing, interiorPoint, lineMidpoint, PointGrid, pointInRing, ringsToPolygons } from './geometry';
import { KIND_OF, rowKey } from './inventory';
import { parseTarget, type TargetPath } from './suggest';
import { targetOption, type MappingEntry } from './template';

export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface GisFeature {
  geometry: GeoJsonGeometry;
  tenDoiTuong: string | null;
  phanLoai: string | null;
  ghiChu: string | null;
}

export interface ClassData {
  target: TargetPath;
  db: string;
  dataset: string;
  cls: string;
  geom: 'A' | 'L' | 'P';
  features: GisFeature[];
  /** How the CAD drew each phanLoai (most used colour, a hatch pattern if any) — for the QGIS project. */
  styles: CategoryStyle[];
}

export interface CategoryStyle {
  phanLoai: string | null;
  /** #rrggbb */
  color: string;
  /** Pattern hatch: angle (degrees) and spacing (metres) of its first line family. */
  hatch: { angle: number; distance: number } | null;
  count: number;
}

export interface DrawingInput {
  id: string;
  /** File name, for ghiChu. */
  name: string;
  doc: CadDocument;
  /** 1 = inside the planning area (inventory.insideFlags). */
  inside: Uint8Array;
}

export interface BuildOptions {
  /** Planning boundary (written as RanhGioiQuyHoach_A when no layer was mapped to it). */
  boundary: Vec2[] | null;
  /** Write "Nguồn: <file> · <layer>" into ghiChu. */
  sourceInGhiChu: boolean;
}

export interface BuildResult {
  classes: ClassData[];
  /** Counts of what could not be converted, for the user. */
  notes: string[];
}

const NUMERIC = /^[+\-±]?\d{1,4}([.,]\d{1,3})?$/;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pt = (p: Vec2) => [r3(p[0]), r3(p[1])];
const closeRing = (ring: Vec2[]) => [...ring.map(pt), pt(ring[0])];

/** Label texts of a drawing (inside the area, not numbers), indexed for point-in-polygon lookups. */
function labelIndex(d: DrawingInput) {
  const grid = new PointGrid<{ text: string; height: number }>(200);
  d.doc.entities.forEach((e, i) => {
    if (e.kind !== 'text' || !d.inside[i]) return;
    const text = e.text.replace(/\s+/g, ' ').trim();
    if (text.length < 2 || NUMERIC.test(text) || !/\p{L}/u.test(text)) return;
    grid.add(e.position, { text: text.slice(0, 100), height: e.height });
  });
  return grid;
}

function labelIn(grid: PointGrid<{ text: string; height: number }>, poly: Vec2[][]): string | null {
  const [outer, ...holes] = poly;
  let best: { text: string; height: number } | null = null;
  for (const { p, v } of grid.query(bboxOf(outer))) {
    if (!pointInRing(p, outer) || holes.some((h) => pointInRing(p, h))) continue;
    if (!best || v.height > best.height || (v.height === best.height && v.text.length > best.text.length)) best = v;
  }
  return best?.text ?? null;
}

/**
 * Duplicate key: same geometry kind, vertex count and rounded extent (the same object drawn on two maps). Points
 * closer than ~1 m are one: a symbol made of several hatches (hố ga, trạm) gives one point.
 */
function dupKey(g: GeoJsonGeometry): string {
  if (g.type === 'Point') return `P|${Math.round(g.coordinates[0])}|${Math.round(g.coordinates[1])}`;
  const flat: number[][] = g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates.flat(2);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of flat) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const q = (v: number) => Math.round(v * 10);
  return `${g.type}|${flat.length}|${q(x0)}|${q(y0)}|${q(x1)}|${q(y1)}`;
}

interface Tally {
  phanLoai: string | null;
  colors: Map<string, number>;
  hatch: { angle: number; distance: number } | null;
  count: number;
}

function tally(t: Map<string, Tally>, phanLoai: string | null, e: CadEntity) {
  const key = phanLoai ?? '';
  let x = t.get(key);
  if (!x) t.set(key, (x = { phanLoai, colors: new Map(), hatch: null, count: 0 }));
  x.count++;
  x.colors.set(e.color, (x.colors.get(e.color) ?? 0) + 1);
  const line = e.kind === 'polygon' ? e.hatch?.lines[0] : undefined;
  if (line && !x.hatch) {
    const a = (line.angle * Math.PI) / 180;
    // Spacing = offset measured across the lines.
    const distance = Math.abs(-line.offset[0] * Math.sin(a) + line.offset[1] * Math.cos(a));
    if (distance > 1e-3) x.hatch = { angle: line.angle, distance };
  }
}

function stylesOf(t: Map<string, Tally>): CategoryStyle[] {
  return [...t.values()]
    .map((x) => ({ phanLoai: x.phanLoai, color: [...x.colors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#888888', hatch: x.hatch, count: x.count }))
    .sort((a, b) => (a.phanLoai ?? '').localeCompare(b.phanLoai ?? '', 'vi'));
}

export function buildFeatures(drawings: DrawingInput[], mapping: Map<string, MappingEntry>, o: BuildOptions): BuildResult {
  const byTarget = new Map<TargetPath, Omit<ClassData, 'styles'> & { seen: Set<string>; tally: Map<string, Tally> }>();
  const notes: string[] = [];
  let openToArea = 0;
  let duplicates = 0;

  const classOf = (target: TargetPath) => {
    let c = byTarget.get(target);
    if (!c) {
      const t = parseTarget(target)!;
      const opt = targetOption(target)!;
      c = { target, db: t.db, dataset: t.dataset, cls: t.cls, geom: opt.geom, features: [], seen: new Set(), tally: new Map() };
      byTarget.set(target, c);
    }
    return c;
  };
  const add = (c: ReturnType<typeof classOf>, f: GisFeature) => {
    const k = dupKey(f.geometry);
    if (c.seen.has(k)) {
      duplicates++;
      return;
    }
    c.seen.add(k);
    c.features.push(f);
  };

  for (const d of drawings) {
    let labels: ReturnType<typeof labelIndex> | null = null;
    const label = (poly: Vec2[][]) => labelIn((labels ??= labelIndex(d)), poly);
    d.doc.entities.forEach((e, i) => {
      if (!d.inside[i]) return;
      const kind = KIND_OF[e.kind];
      if (!kind) return;
      const m = mapping.get(rowKey(d.id, e.layer, kind));
      if (!m?.target || !targetOption(m.target)) return;
      const c = classOf(m.target);
      const base = { phanLoai: m.phanLoai.trim().slice(0, 250) || null, ghiChu: o.sourceInGhiChu ? `Nguồn: ${d.name} · ${e.layer}`.slice(0, 250) : null };
      tally(c.tally, base.phanLoai, e);

      if (c.geom === 'A') {
        let polys: Vec2[][][] = [];
        if (e.kind === 'polygon') polys = ringsToPolygons(e.rings);
        else if (e.kind === 'polyline') {
          if (!e.closed) {
            openToArea++;
            return;
          }
          const ring = cleanRing(e.points);
          if (ring) polys = [[ring]];
        }
        if (!polys.length) return;
        add(c, { ...base, tenDoiTuong: c.dataset === 'ViTriRanhGioi' ? null : label(polys[0]), geometry: { type: 'MultiPolygon', coordinates: polys.map((p) => p.map(closeRing)) } });
      } else if (c.geom === 'L') {
        let lines: Vec2[][] = [];
        if (e.kind === 'polyline') lines = [e.closed ? [...e.points, e.points[0]] : e.points];
        else if (e.kind === 'polygon') lines = e.rings.map(cleanRing).filter((r): r is Vec2[] => !!r).map((r) => [...r, r[0]]);
        lines = lines.filter((l) => l.length >= 2);
        if (!lines.length) return;
        add(c, { ...base, tenDoiTuong: null, geometry: { type: 'MultiLineString', coordinates: lines.map((l) => l.map(pt)) } });
      } else {
        let p: Vec2 | null = null;
        let name: string | null = null;
        if (e.kind === 'point') p = e.position;
        else if (e.kind === 'text') {
          p = e.position;
          name = e.text.replace(/\s+/g, ' ').trim().slice(0, 100) || null;
        } else if (e.kind === 'polygon') {
          const polys = ringsToPolygons(e.rings);
          if (polys.length) {
            p = interiorPoint(polys[0][0]);
            name = label(polys[0]);
          }
        } else if (e.kind === 'polyline' && e.points.length) {
          const ring = e.closed ? cleanRing(e.points) : null;
          p = ring ? interiorPoint(ring) : lineMidpoint(e.points);
          if (ring) name = label([ring]);
        }
        if (!p) return;
        add(c, { ...base, tenDoiTuong: name, geometry: { type: 'Point', coordinates: pt(p) } });
      }
    });
  }

  // Ranh giới quy hoạch: the detected boundary when no layer was mapped to it.
  const ranhPath = 'QuyHoach/ViTriRanhGioi/RanhGioiQuyHoach_A';
  if (o.boundary && !byTarget.get(ranhPath)?.features.length) {
    const ring = cleanRing(o.boundary);
    if (ring) {
      add(classOf(ranhPath), { tenDoiTuong: null, phanLoai: 'Ranh giới lập quy hoạch', ghiChu: null, geometry: { type: 'MultiPolygon', coordinates: [[closeRing(ring)]] } });
      notes.push('Ranh giới quy hoạch lấy từ đường ranh lập quy hoạch tìm thấy trong bản vẽ');
    }
  }
  // The same boundary belongs to the existing-state database too.
  const hasHienTrang = [...byTarget.values()].some((c) => c.db === 'HienTrang' && c.dataset !== 'ViTriRanhGioi' && c.features.length);
  if (hasHienTrang)
    for (const c of [...byTarget.values()]) {
      if (c.db !== 'QuyHoach' || c.dataset !== 'ViTriRanhGioi' || !c.features.length) continue;
      const twin = `HienTrang/ViTriRanhGioi/${c.cls}`;
      if (byTarget.get(twin)?.features.length) continue;
      const t = classOf(twin);
      for (const f of c.features) add(t, f);
    }

  if (openToArea) notes.push(`Bỏ qua ${openToArea} đường hở được ghép vào lớp vùng (chỉ đường khép kín mới thành vùng)`);
  if (duplicates) notes.push(`Bỏ ${duplicates} đối tượng trùng (cùng một đối tượng vẽ ở nhiều bản đồ)`);
  const classes: ClassData[] = [...byTarget.values()]
    .filter((c) => c.features.length)
    .map((c) => ({ target: c.target, db: c.db, dataset: c.dataset, cls: c.cls, geom: c.geom, features: c.features, styles: stylesOf(c.tally) }));
  return { classes, notes };
}
