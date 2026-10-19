// CAD entities (drawing coordinates, VN-2000 metres) → GIS features per TT16 class, following the mapping table.
// Geometry conversions: hatch → vùng; closed polyline → vùng; vùng/đường → điểm (a point inside / mid-way);
// vùng → đường (its outline); chữ → điểm (with the text as tenDoiTuong). tenDoiTuong of a vùng is the biggest
// non-numeric text inside it (labels like "TRƯỜNG TIỂU HỌC LONG HIỆP").
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { foldVietnamese } from '@/lib/geo/provinces';
import { chainRings, cleanRing, interiorPoint, isClosedLine, labelIn, labelIndex, lineMidpoint, ringsToPolygons } from './geometry';
import { entityRowKey } from './inventory';
import type { ColorContext } from './colorClass';
import { parseTarget, type TargetPath } from './suggest';
import { targetOption, type MappingEntry } from './template';

export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** A CAD object: [drawing id, index of the entity in the drawing]. */
export type SourceRef = [string, number];

export interface GisFeature {
  geometry: GeoJsonGeometry;
  tenDoiTuong: string | null;
  phanLoai: string | null;
  ghiChu: string | null;
  /**
   * The CAD objects this feature comes from: alternatives (the same object drawn on several maps, duplicates
   * removed) each made of one or more objects (an outline chained from pieces). The feature is written as long
   * as one alternative has none of its objects left out. Empty: added by the app (detected boundary…).
   */
  refs?: SourceRef[][];
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
  /** Colour classification of the hatches (colourClass.ts): same context as when the mapping rows were made. */
  color?: ColorContext;
  /** File name, for ghiChu. */
  name: string;
  doc: CadDocument;
  /** 1 = inside the planning area (inventory.insideFlags). */
  inside: Uint8Array;
}

export interface BuildOptions {
  /** Planning boundary (written as RanhGioiQuyHoach_A when no layer was mapped to it). */
  boundary: Vec2[] | null;
  /** Unit the plan is about, from its title ("XÃ LONG HIỆP"): a name point in the middle of the boundary. */
  planUnit?: string | null;
  /** Write "Nguồn: <file> · <layer>" into ghiChu. */
  sourceInGhiChu: boolean;
}

export interface BuildResult {
  classes: ClassData[];
  /** Counts of what could not be converted, for the user. */
  notes: string[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pt = (p: Vec2) => [r3(p[0]), r3(p[1])];
const closeRing = (ring: Vec2[]) => [...ring.map(pt), pt(ring[0])];

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

/** Administrative / residential unit words a label starts with → phanLoai. */
const ADMIN_PREFIX: [RegExp, string][] = [
  [/^(XÃ|X\.)\s*/, 'Xã'],
  [/^(PHƯỜNG|P\.)\s*/, 'Phường'],
  [/^(THỊ TRẤN|TT\.)\s*/, 'Thị trấn'],
  [/^ẤP\s+/, 'Ấp'],
  [/^KHÓM\s+/, 'Khóm'],
  [/^THÔN\s+/, 'Thôn'],
  [/^BẢN\s+/, 'Bản'],
  [/^TỔ DÂN PHỐ\s+/, 'Tổ dân phố'],
  [/^KHU PHỐ\s+/, 'Khu phố'],
];

/**
 * "ẤP TRÀ SẤT" → { name: "ẤP TRÀ SẤT", kind: "Ấp" }. Labels about several units ("XÃ A VÀ XÃ B", neighbours),
 * directions ("HƯỚNG ĐI XÃ…") and long sentences are not names.
 */
export function adminName(raw: string): { name: string; kind: string } | null {
  const name = raw.replace(/\s+/g, ' ').trim().normalize('NFC');
  if (name.length < 4 || name.length > 40) return null;
  const up = name.toLocaleUpperCase('vi');
  if (/ VÀ |[,;:()]/.test(up) || up.split(' ').length > 7) return null;
  for (const [re, kind] of ADMIN_PREFIX) {
    const m = re.exec(up);
    if (m && /\p{L}/u.test(up.slice(m[0].length))) return { name, kind };
  }
  return null;
}

export { labelIn, labelIndex };

export function buildFeatures(drawings: DrawingInput[], mapping: Map<string, MappingEntry>, o: BuildOptions): BuildResult {
  const byTarget = new Map<TargetPath, Omit<ClassData, 'styles'> & { seen: Map<string, GisFeature>; tally: Map<string, Tally> }>();
  const notes: string[] = [];
  let openToArea = 0;
  let chainedToArea = 0;
  let duplicates = 0;

  const classOf = (target: TargetPath) => {
    let c = byTarget.get(target);
    if (!c) {
      const t = parseTarget(target)!;
      const opt = targetOption(target)!;
      c = { target, db: t.db, dataset: t.dataset, cls: t.cls, geom: opt.geom, features: [], seen: new Map(), tally: new Map() };
      byTarget.set(target, c);
    }
    return c;
  };
  const add = (c: ReturnType<typeof classOf>, f: GisFeature) => {
    const k = dupKey(f.geometry);
    const first = c.seen.get(k);
    if (first) {
      duplicates++;
      // The same object on another map: one more way to get the feature.
      if (f.refs?.length) first.refs = [...(first.refs ?? []), ...f.refs];
      return;
    }
    c.seen.set(k, f);
    c.features.push(f);
  };

  for (const d of drawings) {
    let labels: ReturnType<typeof labelIndex> | null = null;
    const label = (poly: Vec2[][]) => labelIn((labels ??= labelIndex(d)), poly);
    const pieces = new Map<string, { c: ReturnType<typeof classOf>; base: { phanLoai: string | null; ghiChu: string | null }; lines: Vec2[][]; index: number[] }>();
    d.doc.entities.forEach((e, i) => {
      if (!d.inside[i]) return;
      const key = entityRowKey(d.id, e, d.color);
      if (!key) return;
      const m = mapping.get(key);
      if (!m?.target || !targetOption(m.target)) return;
      const c = classOf(m.target);
      const base = { phanLoai: m.phanLoai.trim().slice(0, 250) || null, ghiChu: o.sourceInGhiChu ? `Nguồn: ${d.name} · ${e.layer}`.slice(0, 250) : null };
      const refs: SourceRef[][] = [[[d.id, i]]];
      tally(c.tally, base.phanLoai, e);

      if (c.geom === 'A') {
        let polys: Vec2[][][] = [];
        if (e.kind === 'polygon') polys = ringsToPolygons(e.rings);
        else if (e.kind === 'polyline') {
          if (!isClosedLine(e.points, e.closed)) {
            // Pieces of an outline: chained into rings once the drawing is read.
            const k = `${m.target}${e.layer}${base.phanLoai ?? ''}`;
            const g = pieces.get(k);
            if (g) {
              g.lines.push(e.points);
              g.index.push(i);
            } else pieces.set(k, { c, base, lines: [e.points], index: [i] });
            return;
          }
          const ring = cleanRing(e.points);
          if (ring) polys = [[ring]];
        }
        if (!polys.length) return;
        add(c, { ...base, refs, tenDoiTuong: c.dataset === 'ViTriRanhGioi' ? null : label(polys[0]), geometry: { type: 'MultiPolygon', coordinates: polys.map((p) => p.map(closeRing)) } });
      } else if (c.geom === 'L') {
        let lines: Vec2[][] = [];
        if (e.kind === 'polyline') lines = [e.closed && !isClosedLine(e.points, false) ? [...e.points, e.points[0]] : e.points];
        else if (e.kind === 'polygon') lines = e.rings.map(cleanRing).filter((r): r is Vec2[] => !!r).map((r) => [...r, r[0]]);
        lines = lines.filter((l) => l.length >= 2);
        if (!lines.length) return;
        add(c, { ...base, refs, tenDoiTuong: null, geometry: { type: 'MultiLineString', coordinates: lines.map((l) => l.map(pt)) } });
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
          const ring = isClosedLine(e.points, e.closed) ? cleanRing(e.points) : null;
          p = ring ? interiorPoint(ring) : lineMidpoint(e.points);
          if (ring) name = label([ring]);
        }
        if (!p) return;
        add(c, { ...base, refs, tenDoiTuong: name, geometry: { type: 'Point', coordinates: pt(p) } });
      }
    });
    for (const { c, base, lines, index } of pieces.values()) {
      const { rings, used, members } = chainRings(lines);
      chainedToArea += rings.length;
      openToArea += lines.length - used;
      rings.forEach((ring, r) =>
        add(c, {
          ...base,
          refs: [members[r].map((m): SourceRef => [d.id, index[m]])],
          tenDoiTuong: c.dataset === 'ViTriRanhGioi' ? null : label([ring]),
          geometry: { type: 'MultiPolygon', coordinates: [[closeRing(ring)]] },
        }),
      );
    }
  }

  // Tên đơn vị hành chính: read from the texts themselves ("ẤP TRÀ SẤT", "X. HÀM GIANG"), whatever their layer —
  // drawings put them on general text layers. One point per name (the biggest label), inside the planning area.
  const adminPath = 'QuyHoach/ViTriRanhGioi/TenDonViHanhChinh_P';
  const adminCls = classOf(adminPath);
  const taken = new Set(adminCls.features.map((f) => foldVietnamese(f.tenDoiTuong ?? '')));
  const found = new Map<string, { name: string; kind: string; at: Vec2; height: number; ref: SourceRef | null }>();
  for (const d of drawings)
    d.doc.entities.forEach((e, i) => {
      if (e.kind !== 'text' || !d.inside[i]) return;
      const a = adminName(e.text);
      if (!a) return;
      const key = foldVietnamese(a.name);
      const old = found.get(key);
      if (!taken.has(key) && (!old || e.height > old.height)) found.set(key, { ...a, at: e.position, height: e.height, ref: [d.id, i] });
    });
  // The unit of the plan itself is only named in the title block (outside the boundary).
  const unit = o.planUnit ? adminName(o.planUnit) : null;
  const ring = o.boundary ? cleanRing(o.boundary) : null;
  if (unit && ring && !taken.has(foldVietnamese(unit.name)) && !found.has(foldVietnamese(unit.name)))
    found.set(foldVietnamese(unit.name), { ...unit, at: interiorPoint(ring), height: Infinity, ref: null });
  for (const a of found.values()) {
    add(adminCls, { tenDoiTuong: a.name, phanLoai: a.kind, ghiChu: null, refs: a.ref ? [[a.ref]] : [], geometry: { type: 'Point', coordinates: pt(a.at) } });
    tally(adminCls.tally, a.kind, { kind: 'point', layer: '', color: '#1f2937', position: a.at });
  }
  if (found.size) notes.push(`Lấy ${found.size} tên đơn vị hành chính từ chữ trên bản vẽ (${[...new Set([...found.values()].map((a) => a.kind))].join(', ')})`);

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

  if (chainedToArea) notes.push(`Nối ${chainedToArea} vùng từ các đoạn đường hở khép kín với nhau (ranh vẽ nhiều đoạn)`);
  if (openToArea) notes.push(`Bỏ qua ${openToArea} đường hở ghép vào lớp vùng nhưng không khép kín được thành vùng`);
  if (duplicates) notes.push(`Bỏ ${duplicates} đối tượng trùng (cùng một đối tượng vẽ ở nhiều bản đồ)`);
  const classes: ClassData[] = [...byTarget.values()]
    .filter((c) => c.features.length)
    .map((c) => ({ target: c.target, db: c.db, dataset: c.dataset, cls: c.cls, geom: c.geom, features: c.features, styles: stylesOf(c.tally) }));
  return { classes, notes };
}
