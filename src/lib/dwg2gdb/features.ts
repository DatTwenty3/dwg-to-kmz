// CAD entities (drawing coordinates, VN-2000 metres) → GIS features per TT16 class, following the mapping table.
// Geometry conversions: hatch → vùng; closed polyline → vùng; vùng/đường → điểm (a point inside / mid-way);
// vùng → đường (its outline); chữ → điểm (with the text as tenDoiTuong). tenDoiTuong of a vùng is the biggest
// non-numeric text inside it (labels like "TRƯỜNG TIỂU HỌC LONG HIỆP").
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { foldVietnamese } from '@/lib/geo/provinces';
import { chainRings, cleanRing, interiorPoint, isClosedLine, labelIn, labelIndex, lineMidpoint, nearlyClosedOutline, ringsToPolygons } from './geometry';
import { entityRowKey, PLAN_BOUNDARY_LAYER } from './inventory';
import { colorRole, hatchSymbol, type ColorContext } from './colorClass';
import { compactName, parseTarget, type TargetPath } from './suggest';
import { chainIds, layerRank, layerSurface, parseBridgeText, parseRoadText, parseRouteSign, lineForSign, roadFields, textAlong, type RoadName, type RoadText } from './roads';
import { domainCode } from '@/lib/gdb/tt16Schema';
import { entryFor, targetOption, type MappingEntry, type ReassignEntry } from './template';
import { symbolsOfSection, type Tt16Symbol } from './tt16Symbols';

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
  /** Further TT16 fields the drawing gives (tenDuong, loaiDuong, loaiChatLieuTraiMat…), written as they are. */
  attrs?: Record<string, string | number>;
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
  /** The Phụ lục I symbol (Mục + AutoCAD colour) the hatches of this category are drawn for — picks its SVG in the QGIS project. */
  symbol?: { section: number; aci: number; layer: string | null; name: string };
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
  /** Objects the user sent to another class one by one (reassignKey → class). */
  reassign?: ReadonlyMap<string, ReassignEntry>;
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
  symbols: Map<string, { sym: Tt16Symbol; n: number }>;
  /** Mục of Phụ lục I of the land-use hatches (colour classification on), for the symbol of a category by its land use. */
  sections: Map<number, number>;
  count: number;
}

function tally(t: Map<string, Tally>, phanLoai: string | null, e: CadEntity, sym?: Tt16Symbol | null, section?: number | null) {
  const key = phanLoai ?? '';
  let x = t.get(key);
  if (!x) t.set(key, (x = { phanLoai, colors: new Map(), hatch: null, symbols: new Map(), sections: new Map(), count: 0 }));
  x.count++;
  if (section != null) x.sections.set(section, (x.sections.get(section) ?? 0) + 1);
  if (sym) {
    const k = `${sym.section}:${sym.aci}:${sym.layer ?? sym.name}`;
    const s = x.symbols.get(k);
    if (s) s.n++;
    else x.symbols.set(k, { sym, n: 1 });
  }
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
    .map((x): CategoryStyle => {
      let top: Tt16Symbol | undefined = [...x.symbols.values()].sort((a, b) => b.n - a.n)[0]?.sym;
      // No colour match (grey hatches such as cemeteries, or colours the office chose): the land use itself names the symbol.
      if (!top && x.phanLoai) {
        const section = [...x.sections].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (section != null) top = symbolsOfSection(section).find((s) => s.kind === 'A' && s.landUse === x.phanLoai);
      }
      return {
        phanLoai: x.phanLoai,
        color: [...x.colors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#888888',
        hatch: x.hatch,
        ...(top ? { symbol: { section: top.section, aci: top.aci, layer: top.layer, name: top.name } } : {}),
        count: x.count,
      };
    })
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


/** "+2.35", "1,8", "-0.5": a height written on the drawing (metres). */
const HEIGHT = /^[+\-±]?\d{1,4}([.,]\d{1,3})?$/;
function heightOf(text: string): number | null {
  const t = text.replace(/\s+/g, '').trim();
  if (!HEIGHT.test(t)) return null;
  const v = Number(t.replace(/^[+±]/, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}
const heightAttrs = (text: string): Record<string, number> | undefined => {
  const v = heightOf(text);
  return v === null ? undefined : { caoDo: v };
};

/** caoDo of the contour lines: the number written along each one (any drawing). */
function heightContours(classes: Iterable<{ cls: string; features: GisFeature[] }>, drawings: DrawingInput[]): number {
  const texts: (RoadText & { value: number })[] = [];
  for (const d of drawings)
    d.doc.entities.forEach((e, i) => {
      if (e.kind !== 'text' || !d.inside[i]) return;
      const v = heightOf(e.text);
      if (v !== null) texts.push({ text: e.text, at: e.position, height: e.height, rotation: e.rotation, value: v });
    });
  let n = 0;
  if (!texts.length) return n;
  for (const c of classes) {
    if (c.cls !== 'DuongDongMuc_L') continue;
    for (const f of c.features) {
      if (f.geometry.type !== 'MultiLineString') continue;
      const t = texts[textAlong(f.geometry.coordinates, texts, 45)];
      if (!t) continue;
      f.attrs = { ...f.attrs, caoDo: t.value };
      n++;
    }
  }
  return n;
}

const ROAD_LINE = 'MangLuoiGiaoThongDuongBo_L';
const BRIDGE_LINE = 'CongTrinhGiaoThong_L';

/** Fields a line gets from the name of its layer: a road's surface and rank, a bridge's kind. */
function lineAttrs(c: { db: string; cls: string }, layer: string): Record<string, string> | undefined {
  const cn = compactName(layer);
  if (c.cls === ROAD_LINE) {
    const a = roadFields(c.db, { surface: layerSurface(cn), rank: layerRank(cn) });
    return Object.keys(a).length ? a : undefined;
  }
  if (c.cls === BRIDGE_LINE && /cau/.test(cn)) {
    const out: Record<string, string> = {};
    const hinh = domainCode(c.db, 'LoaiHinhGiaoThong', 'Đường bộ');
    const loai = domainCode(c.db, 'CongTrinhGiaoThong', 'Cầu');
    if (hinh !== null) out.loaiHinhGiaoThong = hinh;
    if (loai !== null) out.loaiCongTrinh = loai;
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/**
 * Roads named by a route sign ("914C" in a diamond at the edge of the planning area, usually outside it). The sign sits
 * on a CAD line of a road layer — often one the planning area cuts off — so the name goes to that line and the lines
 * that continue it (ends meeting alone), and from them to every road feature made of one of those lines.
 */
const polylineLength = (pts: number[][]) => pts.reduce((sum, p, k) => (k ? sum + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0);

function signedRoads(classes: Iterable<{ cls: string; features: GisFeature[] }>, drawings: DrawingInput[], signs: readonly (RoadText & RoadName)[]): Map<GisFeature, RoadName> {
  const out = new Map<GisFeature, RoadName>();
  if (!signs.length) return out;
  const roadFeatures: GisFeature[] = [];
  const layers = new Set<string>();
  const byId = new Map(drawings.map((d) => [d.id, d]));
  for (const c of classes)
    if (c.cls === ROAD_LINE)
      for (const f of c.features) {
        roadFeatures.push(f);
        for (const alt of f.refs ?? []) for (const [id, i] of alt) layers.add(`${id}|${byId.get(id)?.doc.entities[i]?.layer}`);
      }
  // Every line of those layers, outside the planning area too.
  const lines: { id: string; i: number; pts: number[][] }[] = [];
  for (const d of drawings)
    d.doc.entities.forEach((e, i) => {
      // Short or closed lines are not roads (the diamond of the sign itself is on the road layer too).
      if (e.kind === 'polyline' && e.points.length >= 2 && !e.closed && layers.has(`${d.id}|${e.layer}`) && polylineLength(e.points) >= 300) lines.push({ id: d.id, i, pts: e.points });
    });
  const chain = chainIds(lines.map((l) => ({ a: l.pts[0] as Vec2, b: l.pts[l.pts.length - 1] as Vec2 })), 10);
  const named = new Map<number, Set<string>>();
  const chosen = new Map<number, RoadName>();
  for (const s of signs) {
    const k = lineForSign(lines.map((l) => l.pts), s);
    if (k < 0) continue;
    (named.get(chain[k]) ?? named.set(chain[k], new Set()).get(chain[k])!).add(s.name ?? '');
    chosen.set(chain[k], s);
  }
  const ofLine = new Map<string, number>();
  lines.forEach((l, k) => ofLine.set(`${l.id}|${l.i}`, k));
  for (const f of roadFeatures)
    for (const alt of f.refs ?? [])
      for (const [id, i] of alt) {
        const k = ofLine.get(`${id}|${i}`);
        const r = k === undefined ? undefined : chosen.get(chain[k]);
        if (r && named.get(chain[k!])!.size === 1 && !out.has(f)) out.set(f, r);
      }
  return out;
}

/**
 * Names of the roads and bridges, from the texts written along them (any drawing: the same road is named on one map
 * only). A name also goes to the pieces of the road that continue it without a junction.
 */
function nameRoads(classIter: Iterable<{ db: string; cls: string; features: GisFeature[] }>, drawings: DrawingInput[]): { roads: number; bridges: number } {
  const classes = [...classIter];
  const roadTexts: (RoadText & RoadName)[] = [];
  const noteTexts: (RoadText & RoadName)[] = [];
  const signTexts: (RoadText & RoadName)[] = [];
  const bridgeTexts: (RoadText & { name: string | null; note: string })[] = [];
  for (const d of drawings)
    d.doc.entities.forEach((e, i) => {
      if (e.kind !== 'text') return;
      const base: RoadText = { text: e.text, at: e.position, height: e.height, rotation: e.rotation };
      // The number of a road leaving the planning area ("914C" in a diamond at its end) is written outside the boundary,
      // on a road layer: it names the road that reaches it, so it counts wherever it stands.
      const cn = compactName(e.layer);
      const sign = /duong|giaothong|htktgt|quoclo|^gt/.test(cn) ? parseRouteSign(e.text, layerRank(cn)) : null;
      if (sign) {
        signTexts.push({ ...base, ...sign });
        return;
      }
      const r = parseRoadText(e.text);
      // The name of a highway (expressway, national or provincial road) is written beside the road where it leaves the area:
      // outside the boundary it still names the line that goes through. Other texts outside are legends and notes.
      if (!d.inside[i]) {
        if (r?.name && r.rank && r.rank !== 'huyen' && r.rank !== 'khuVuc') roadTexts.push({ ...base, ...r, reach: Math.max(25, 5 * e.height) });
        return;
      }
      if (r) (r.name ? roadTexts : noteTexts).push({ ...base, ...r });
      const b = parseBridgeText(e.text);
      if (b) bridgeTexts.push({ ...base, ...b });
    });
  const bySign = signedRoads(classes, drawings, signTexts);
  let roads = 0;
  let bridges = 0;
  for (const c of classes) {
    if (c.cls === ROAD_LINE && (roadTexts.length || noteTexts.length || signTexts.length)) {
      const own = c.features.map((f) =>
        f.geometry.type === 'MultiLineString' ? (roadTexts[textAlong(f.geometry.coordinates, roadTexts)] ?? bySign.get(f)) : undefined,
      );
      const ends = c.features.map((f) => {
        const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
        const first = lines[0]?.[0] ?? [NaN, NaN];
        const lastLine = lines[lines.length - 1];
        const last = lastLine?.[lastLine.length - 1] ?? [NaN, NaN];
        return { a: [first[0], first[1]] as [number, number], b: [last[0], last[1]] as [number, number] };
      });
      const chain = chainIds(ends);
      const names = new Map<number, Set<string>>();
      own.forEach((o, i) => {
        if (o?.name) (names.get(chain[i]) ?? names.set(chain[i], new Set()).get(chain[i])!).add(o.name);
      });
      const byChain = new Map<number, RoadName>();
      own.forEach((o, i) => {
        if (o && names.get(chain[i])?.size === 1) byChain.set(chain[i], o);
      });
      c.features.forEach((f, i) => {
        if (f.geometry.type !== 'MultiLineString') return;
        const r = own[i] ?? byChain.get(chain[i]);
        const note = f.attrs?.loaiChatLieuTraiMat ? undefined : noteTexts[textAlong(f.geometry.coordinates, noteTexts)];
        if (!r && !note) return;
        const fields = roadFields(c.db, { name: r?.name, rank: r?.rank, surface: r?.surface ?? note?.surface });
        if (r?.name) {
          f.tenDoiTuong = r.name.slice(0, 100);
          roads++;
        }
        f.attrs = { ...f.attrs, ...fields };
      });
    } else if (c.cls === BRIDGE_LINE && bridgeTexts.length) {
      for (const f of c.features) {
        if (f.geometry.type !== 'MultiLineString' || !f.attrs?.loaiCongTrinh) continue;
        const t = bridgeTexts[textAlong(f.geometry.coordinates, bridgeTexts)];
        if (!t) continue;
        if (t.name) {
          f.tenDoiTuong = t.name.slice(0, 100);
          f.attrs = { ...f.attrs, tenCongTrinh: t.name.slice(0, 100) };
          bridges++;
        } else f.attrs = { ...f.attrs, thongSoKyThuat: t.note.slice(0, 250) };
      }
    }
  }
  return { roads, bridges };
}

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
      // A surveyed point and the height written at it are one point: the one with the height completes the other.
      if (c.cls === 'DiemDoCao_P' && f.attrs?.caoDo != null && first.attrs?.caoDo == null) {
        first.attrs = { ...first.attrs, caoDo: f.attrs.caoDo };
        first.tenDoiTuong = first.tenDoiTuong ?? f.tenDoiTuong;
        first.phanLoai = f.phanLoai;
      }
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
      const m = entryFor(mapping, o.reassign, d.id, i, key);
      if (!m?.target || !targetOption(m.target)) return;
      const c = classOf(m.target);
      const base = { phanLoai: m.phanLoai.trim().slice(0, 250) || null, ghiChu: o.sourceInGhiChu ? `Nguồn: ${d.name} · ${e.layer}`.slice(0, 250) : null };
      const refs: SourceRef[][] = [[[d.id, i]]];
      tally(c.tally, base.phanLoai, e, hatchSymbol(e, d.color), e.kind === 'polygon' && d.color && colorRole(d.color.role) ? d.color.section : null);

      if (c.geom === 'A') {
        let polys: Vec2[][][] = [];
        if (e.kind === 'polygon') polys = ringsToPolygons(e.rings);
        else if (e.kind === 'polyline') {
          // The planning boundary left open by a small gap is the area all the same (the closing stretch is a straight line).
          if (!isClosedLine(e.points, e.closed) && !(PLAN_BOUNDARY_LAYER.test(compactName(e.layer)) && nearlyClosedOutline(e.points))) {
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
        add(c, { ...base, refs, tenDoiTuong: null, attrs: lineAttrs(c, e.layer), geometry: { type: 'MultiLineString', coordinates: lines.map((l) => l.map(pt)) } });
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
        add(c, { ...base, refs, tenDoiTuong: name, attrs: c.cls === 'DiemDoCao_P' && e.kind === 'text' ? heightAttrs(e.text) : undefined, geometry: { type: 'Point', coordinates: pt(p) } });
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

  const heights = heightContours(byTarget.values(), drawings);
  if (heights) notes.push(`Ghi cao độ cho ${heights} đường đồng mức theo số viết dọc đường`);
  const named = nameRoads(byTarget.values(), drawings);
  if (named.roads) notes.push(`Đặt tên cho ${named.roads} đoạn đường theo chữ viết dọc tuyến`);
  if (named.bridges) notes.push(`Đặt tên cho ${named.bridges} cầu theo chữ trên bản vẽ`);

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
