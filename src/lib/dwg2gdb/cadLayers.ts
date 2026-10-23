// "Bản vẽ CAD" of the QGIS project: the CAD objects of the summary drawing (summary.ts) with the look they have in
// AutoCAD — line widths in metres (the white dashes of a road axis, the 15 m ditch), solid fills (arrows, manholes,
// stations), hatch line families, texts with their height / rotation / alignment — written as GeoPackage layers
// (<project name>.gpkg, next to the geodatabases and the .qgz of the same name) that qgis.ts draws with data-defined symbology. The land-use hatches
// stay with the geodatabase layers (Phụ lục I symbols), so they are left out here.
import type { CadDocument, CadEntity, HAlign, LineTypeDef, VAlign, Vec2 } from '@/lib/cad/types';
import type { NormalizePlan, NormalizeStep } from '@/lib/gdb/normalize';
import { inkForPaper } from '@/lib/map/cadGrid';
import { ringsToPolygons } from './geometry';
import type { DrawingInput, SourceRef } from './features';
import { entityRowKey, PLAN_BOUNDARY_LAYER } from './inventory';
import { roleById, type DbName, type RoleId } from './roles';
import { compactName, layerLandUse, parseTarget } from './suggest';
import { objectKey } from './summary';
import { entryFor, type MappingEntry, type ReassignEntry } from './template';

/** Default file name (without .gpkg); the export names it like the project (.qgz). */
export const CAD_GPKG = 'BanVeCAD';

const SHORT: Record<string, string> = { HienTrang: 'HT', QuyHoach: 'QH', MocGioi: 'MG', NenDiaHinh: 'DH' };
const SDD_ROLES = new Set<RoleId>(['ht-sdd', 'qh-sdd']);

/**
 * The drawing the project shows as AutoCAD does: **every** object inside the planning area of the drawings in use —
 * mapped to a class or not (the 110kV line, the number in its box, the arrows were never mapped) — once each, on
 * layers named `<HT|QH>_<CAD layer>`. Left out: what the geodatabase layers draw (land use) and, in the maps that only
 * repeat the land use as a background, its hatches and outlines.
 */
/** Layers that are the sheet (frame, legend, title, scale, notes), never the map: left out of the margin around the area. */
const SHEET_LAYER = /khung|chugiai|chuthich|logo|hoagio|tyle|thuoc|banve|tieude|dientich|ghichu|kyhieu|bangthongke|mattcat|defpoints|viewport|^bv|^(0|1|2|3)$/;

function entityBox(e: CadEntity): [number, number, number, number] | null {
  const pts: Vec2[] = e.kind === 'polyline' ? e.points : e.kind === 'polygon' ? e.rings.flat() : e.kind === 'table' ? [e.origin] : [e.position];
  if (!pts.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return [x0, y0, x1, y1];
}

/** The CAD objects the project would get, each with the objects of the drawings it comes from. */
export interface CadSource {
  doc: CadDocument;
  /**
   * Per entity of `doc`: its source alternatives — one `[drawing, index]` per copy of the same object in the drawings
   * (what "Biên tập" removes together), the drawing id prefixed `cad:` (`CAD_EDIT_PREFIX`) so they do not mix up with
   * the objects removed from the geodatabases. Empty for the boundary the app adds.
   */
  refs: SourceRef[][][];
}

/** Drawing id prefix of the CAD drawing's own list of removed objects (Biên tập → "Bản vẽ CAD"). */
export const CAD_EDIT_PREFIX = 'cad:';

export function cadSourceDocument(drawings: (DrawingInput & { role: RoleId; db?: DbName | null; removed?: ReadonlySet<number> })[], mapping: Map<string, MappingEntry>, boundary: Vec2[] | null, reassign?: ReadonlyMap<string, ReassignEntry>): CadDocument {
  return cadSource(drawings, mapping, boundary, reassign).doc;
}

export function cadSource(drawings: (DrawingInput & { role: RoleId; db?: DbName | null; removed?: ReadonlySet<number> })[], mapping: Map<string, MappingEntry>, boundary: Vec2[] | null, reassign?: ReadonlyMap<string, ReassignEntry>): CadSource {
  // The signs at the ends of the roads (route number in a diamond, arrow) stand just outside the boundary: a margin of
  // 10 % of its size takes them — from the layers of the map, not of the sheet.
  let around: [number, number, number, number] | null = null;
  if (boundary?.length) {
    const b = entityBox({ kind: 'polyline', layer: '', color: '', points: boundary, closed: true })!;
    const m = 0.1 * Math.max(b[2] - b[0], b[3] - b[1]);
    around = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  }
  const entities: CadEntity[] = [];
  const refs: SourceRef[][][] = [];
  const seen = new Map<string, number>();
  const lineTypes: Record<string, LineTypeDef> = {};
  for (const d of drawings) {
    const db = roleById(d.role).db && (d.db ?? roleById(d.role).db);
    if (!db) continue;
    for (const [name, def] of Object.entries(d.doc.lineTypes ?? {})) lineTypes[name] ??= def;
    const background = !SDD_ROLES.has(d.role);
    d.doc.entities.forEach((e, i) => {
      if (e.kind === 'table' || d.removed?.has(i)) return;
      if (!d.inside[i]) {
        if (!around || SHEET_LAYER.test(compactName(e.layer)) || (e.kind === 'polygon' && layerLandUse(compactName(e.layer)))) return;
        const box = entityBox(e);
        if (!box || box[0] < around[0] || box[1] < around[1] || box[2] > around[2] || box[3] > around[3]) return;
      }
      const key = entityRowKey(d.id, e, d.color);
      const m = key ? entryFor(mapping, reassign, d.id, i, key) : undefined;
      const t = m?.target ? parseTarget(m.target) : null;
      // Land use is drawn by the geodatabase layer — but a polyline with a width is a road or a band, never a parcel.
      if (t?.cls === 'ChucNangSuDungDat_A' && !(e.kind === 'polyline' && (e.width ?? 0) > 0)) return;
      if (background && (e.kind === 'polygon' || e.kind === 'polyline') && layerLandUse(compactName(e.layer))) return;
      const k = objectKey(e.layer, e);
      const ref: SourceRef = [`${CAD_EDIT_PREFIX}${d.id}`, i];
      const first = seen.get(k);
      if (first !== undefined) {
        refs[first].push([ref]); // the same object drawn in another map: removed together
        return;
      }
      seen.set(k, entities.length);
      entities.push({ ...e, layer: `${SHORT[db] ?? db}_${e.layer}` });
      refs.push([[ref]]);
    });
  }
  if (boundary && !entities.some((e) => e.kind === 'polyline' && PLAN_BOUNDARY_LAYER.test(compactName(e.layer)))) {
    entities.push({ kind: 'polyline', layer: 'QH_Ranh giới lập quy hoạch', color: '#ff0000', points: boundary, closed: true, width: 0 });
    refs.push([]);
  }
  return { doc: { units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [0, 0]], warnings: [], lineTypes }, refs };
}
export const CAD_TABLES = { lines: 'cad_duong', areas: 'cad_vung', texts: 'cad_chu', points: 'cad_diem' } as const;
export type CadTable = keyof typeof CAD_TABLES;

/** Layers of the summary drawing drawn by the geodatabase layers instead: the land-use hatches. */
const LAND_USE_LAYER = /^(?:HT|QH|MG)_ChucNangSuDungDat_A_/;

/** QGIS label quadrant (QgsPalLayerSettings::QuadrantPosition) that puts the text where its CAD alignment would. */
export function labelQuadrant(h: HAlign, v: VAlign): number {
  // Left-aligned text starts at the point, so the label lies to the right of it (column 2 / 5 / 8).
  const col = h === 'left' ? 2 : h === 'center' ? 1 : 0;
  const row = v === 'middle' ? 3 : v === 'top' ? 6 : 0;
  return row + col;
}

/** CAD colour 7 (white) and near-white greys are drawn black on a white sheet, as AutoCAD does on a white background. */
export function inkOnWhite(hex: string): string {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!h) return '#000000';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const c = inkForPaper([r, g, b, 255], 'light');
  return `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A line type as a QGIS custom dash ("dash;gap;dash;gap", map units): positive lengths are dashes, negative ones gaps
 * (the gap that holds a text included), a dot is a very short dash. '' for a pattern too fine to draw.
 */
export function dashString(def: LineTypeDef, scale: number): string {
  const parts: number[] = []; // dash, gap, dash, gap…
  const add = (kind: 'dash' | 'gap', len: number) => {
    const wantDash = parts.length % 2 === 0;
    if ((kind === 'dash') === wantDash) parts.push(len);
    else if (parts.length) parts[parts.length - 1] += len;
    else if (kind === 'gap') parts.push(0, len);
  };
  for (const el of def.elements) {
    const len = Math.abs(el.length) * scale;
    if (el.length > 0) add('dash', len);
    else if (el.length < 0) add('gap', len);
    else if (!el.text) add('dash', 0.001);
  }
  if (parts.length % 2) parts.pop();
  const total = parts.reduce((t, v) => t + v, 0);
  if (parts.length < 2 || !(total > 0.05)) return '';
  return parts.map((v) => String(Math.round(v * 1000) / 1000)).join(';');
}

/** A line type element made of this single letter is a dot (symbol font). */
const DOT_TEXT = 'l';

export interface LineTypeText {
  at: Vec2;
  angle: number;
  text: string;
  height: number;
  /** Diameter of the circle to draw instead of the letter. */
  dot?: number;
}

/** Width of a text in Arial, from the usual advance widths (digits 0.56 em, capitals 0.67, narrow letters 0.22…). */
export function textWidth(text: string, height: number): number {
  let em = 0;
  for (const ch of text) em += /[0-9]/.test(ch) ? 0.556 : /[ilj.,:;!|']/.test(ch) ? 0.25 : /[A-ZĐ]/.test(ch) ? 0.68 : /[mwMW]/.test(ch) ? 0.85 : ch === ' ' ? 0.28 : 0.52;
  return em * height;
}

/**
 * The texts a line type writes along a line ("110kV" in the gaps of the 110 kV line): each character at its place of
 * the pattern, turned with the line. Capped per line, a pattern of fences repeating a letter every metre is no text.
 */
export function lineTypeTexts(points: Vec2[], closed: boolean, def: LineTypeDef, scale: number, cap = 4000): LineTypeText[] {
  if (!def.elements.some((el) => el.text)) return [];
  const pts = closed && points.length > 2 ? [...points, points[0]] : points;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const period = def.elements.reduce((t, el) => t + Math.abs(el.length), 0) * scale;
  if (!(total > 0) || !(period > 0.05)) return [];
  const out: LineTypeText[] = [];
  let seg = 0;
  for (let t0 = 0; t0 < total && out.length < cap; t0 += period) {
    let t = t0;
    for (const el of def.elements) {
      if (t > total) break;
      if (el.text) {
        while (seg > 0 && cum[seg] > t) seg--;
        while (seg < pts.length - 2 && cum[seg + 1] < t) seg++;
        const a = pts[seg];
        const b = pts[seg + 1];
        const len = cum[seg + 1] - cum[seg] || 1;
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        const u = t - cum[seg];
        const ox = (el.offset?.[0] ?? 0) * scale;
        const oy = (el.offset?.[1] ?? 0) * scale;
        const lineAngle = (Math.atan2(uy, ux) * 180) / Math.PI;
        const height = (el.textScale ?? 1) * scale;
        let at: Vec2 = [a[0] + ux * (u + ox) - uy * oy, a[1] + uy * (u + ox) + ux * oy];
        let angle = el.absolute ? (el.rotation ?? 0) : lineAngle + (el.rotation ?? 0);
        if (el.text === DOT_TEXT) {
          // The planning boundary writes its dots as the letter "l" of a symbol font (Wingdings: a black circle). The circle
          // is about 0.7 of the text height across, its centre 0.4 across and 0.45 above the text origin (the pattern lowers the letter by 0.45 of its height so the circle sits on the line).
          const r = (angle * Math.PI) / 180;
          const d = height * 0.7;
          out.push({
            at: [at[0] + Math.cos(r) * height * 0.4 - Math.sin(r) * height * 0.45, at[1] + Math.sin(r) * height * 0.4 + Math.cos(r) * height * 0.45],
            angle: 0,
            text: el.text,
            height,
            dot: d,
          });
          t += Math.abs(el.length) * scale;
          continue;
        }
        // QGIS turns a label that would read upside down; the text then keeps its place only if its anchor (bottom-left of
        // the text box) moves to the far corner: A' = A + width·(direction of the text) + height·(its "up").
        const norm = ((angle % 360) + 360) % 360;
        if (norm > 90 && norm <= 270) {
          const w = textWidth(el.text, height);
          const r = (angle * Math.PI) / 180;
          at = [at[0] + Math.cos(r) * w - Math.sin(r) * height, at[1] + Math.sin(r) * w + Math.cos(r) * height];
          angle -= 180;
        }
        out.push({ at, angle, text: el.text, height });
      }
      t += Math.abs(el.length) * scale;
    }
  }
  return out;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Coordinates to the centimetre: the file is big enough already. */
const pt = (p: Vec2): Vec2 => [r2(p[0]), r2(p[1])];

type Props = Record<string, string | number>;
interface Feature {
  type: 'Feature';
  properties: Props;
  geometry: unknown;
}
const collection = (features: Feature[]) => JSON.stringify({ type: 'FeatureCollection', features });

export interface CadData {
  /** GeoJSON text per table (VN-2000 metres); a table without objects is missing. */
  json: Partial<Record<CadTable, string>>;
  counts: Record<CadTable, number>;
  /** Colours of the pattern hatches (most used first): each gets its own rule, a pattern's colour cannot be data-defined. */
  patternColors: string[];
  /** Layers whose smallest lines were left out to keep the file within `MAX_LINE_VERTICES`. */
  thinned: { layer: string; dropped: number }[];
}

/**
 * Vertices of all the lines of the CAD layer. A survey drawing explodes its tree symbols into hundreds of thousands of
 * small polylines (Long Hiệp: 684 000 in one layer, 8 million vertices, a 300 MB file the browser could not even build).
 * Over this, the smallest lines of the heaviest layers are left out — at any scale a map is read at they are specks.
 */
export const MAX_LINE_VERTICES = 1_200_000;

type PolylineEnt = Extract<CadEntity, { kind: 'polyline' }>;

const lineLength = (pts: Vec2[]) => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
};

/** Decided on the entities, before any GeoJSON is built: 8 million vertices as JS arrays would be hundreds of MB. */
export function thinLines(entities: CadEntity[], budget: number): { drop: Set<CadEntity>; thinned: CadData['thinned'] } {
  const lines = entities.filter((e): e is PolylineEnt => e.kind === 'polyline' && e.points.length >= 2);
  let excess = lines.reduce((t, e) => t + e.points.length, 0) - budget;
  const drop = new Set<CadEntity>();
  const thinned: CadData['thinned'] = [];
  if (excess <= 0) return { drop, thinned };
  const byLayer = new Map<string, PolylineEnt[]>();
  for (const e of lines) {
    const list = byLayer.get(e.layer);
    if (list) list.push(e);
    else byLayer.set(e.layer, [e]);
  }
  const weight = (list: PolylineEnt[]) => list.reduce((t, e) => t + e.points.length, 0);
  for (const [layer, list] of [...byLayer].sort((x, y) => weight(y[1]) - weight(x[1]))) {
    if (excess <= 0) break;
    const allowed = Math.min(excess, weight(list) * 0.95);
    const withLen = list.map((e) => [e, lineLength(e.points)] as const).sort((x, y) => x[1] - y[1]);
    let removed = 0;
    let n = 0;
    for (const [e] of withLen) {
      if (removed >= allowed) break;
      removed += e.points.length;
      drop.add(e);
      n++;
    }
    excess -= removed;
    thinned.push({ layer, dropped: n });
  }
  return { drop, thinned };
}

function hatchSpacing(e: Extract<CadEntity, { kind: 'polygon' }>): { angle: number; distance: number } | null {
  const line = e.hatch?.lines[0];
  if (!line) return null;
  const a = (line.angle * Math.PI) / 180;
  const distance = Math.abs(-line.offset[0] * Math.sin(a) + line.offset[1] * Math.cos(a));
  return distance > 1e-3 ? { angle: Math.round(line.angle * 100) / 100, distance: r3(distance) } : null;
}

/** The CAD objects of a summary drawing as GeoJSON layers: lines, areas (solid or line hatch), texts, points. */
export function cadLayerData(doc: CadDocument): CadData {
  const lines: Feature[] = [];
  const areas: Feature[] = [];
  const texts: Feature[] = [];
  const points: Feature[] = [];
  const patterns = new Map<string, number>();
  const thin = thinLines(doc.entities, MAX_LINE_VERTICES);
  for (const e of doc.entities) {
    if (LAND_USE_LAYER.test(e.layer) || thin.drop.has(e)) continue;
    const mau = inkOnWhite(e.color);
    if (e.kind === 'polyline') {
      if (e.points.length < 2) continue;
      const coords = e.points.map(pt);
      if (e.closed && coords.length > 2) coords.push(coords[0]);
      const def = e.lineType ? doc.lineTypes?.[e.lineType] : undefined;
      const scale = e.lineScale ?? 1;
      lines.push({ type: 'Feature', properties: { lop: e.layer, mau, rong: r3(e.width ?? 0), net: def ? dashString(def, scale) : '' }, geometry: { type: 'LineString', coordinates: coords } });
      if (def && texts.length < 400000)
        for (const t of lineTypeTexts(e.points, e.closed, def, scale))
          if (t.dot) points.push({ type: 'Feature', properties: { lop: e.layer, mau, kt: r3(t.dot) }, geometry: { type: 'Point', coordinates: pt(t.at) } });
          else
            texts.push({
              type: 'Feature',
              properties: { lop: e.layer, mau, chu: t.text, cao: r3(t.height), goc: Math.round(t.angle * 100) / 100, canh: 2 },
              geometry: { type: 'Point', coordinates: pt(t.at) },
            });
    } else if (e.kind === 'polygon') {
      const polys = ringsToPolygons(e.rings);
      if (!polys.length) continue;
      const h = hatchSpacing(e);
      if (h) patterns.set(mau, (patterns.get(mau) ?? 0) + 1);
      areas.push({
        type: 'Feature',
        // A pattern hatch has no fill of its own; a solid one is opaque as in CAD.
        properties: { lop: e.layer, mau, goc: h?.angle ?? 0, cach: h?.distance ?? 0 },
        geometry: { type: 'MultiPolygon', coordinates: polys.map((p) => p.map((ring) => ring.map(pt))) },
      });
    } else if (e.kind === 'text') {
      if (!e.text.trim()) continue;
      texts.push({
        type: 'Feature',
        properties: { lop: e.layer, mau, chu: e.text, cao: r3(e.height), goc: Math.round(e.rotation * 100) / 100, canh: labelQuadrant(e.hAlign, e.vAlign) },
        geometry: { type: 'Point', coordinates: pt(e.position) },
      });
    } else if (e.kind === 'point') points.push({ type: 'Feature', properties: { lop: e.layer, mau, kt: 0 }, geometry: { type: 'Point', coordinates: pt(e.position) } });
  }
  const all = { lines, areas, texts, points };
  const json: CadData['json'] = {};
  for (const k of Object.keys(all) as CadTable[]) if (all[k].length) json[k] = collection(all[k]);
  const patternColors = [...patterns].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { json, patternColors, thinned: thin.thinned, counts: { lines: lines.length, areas: areas.length, texts: texts.length, points: points.length } };
}

const NLT: Record<CadTable, string> = { lines: 'LINESTRING', areas: 'MULTIPOLYGON', texts: 'POINT', points: 'POINT' };

export interface CadGpkgPlan extends NormalizePlan {
  inputs: { key: string; fileName: string; json: string }[];
}

/** ogr2ogr steps writing <file>.gpkg from the GeoJSON layers (one dataset per table). */
export function planCadGpkg(data: CadData, wkt: string, file = CAD_GPKG): CadGpkgPlan {
  const inputs: CadGpkgPlan['inputs'] = [];
  const steps: NormalizeStep[] = [];
  (Object.keys(CAD_TABLES) as CadTable[]).forEach((k, i) => {
    const json = data.json[k];
    if (!json) return;
    const key = `cad${i}`;
    inputs.push({ key, fileName: `${key}.geojson`, json });
    steps.push({
      out: file,
      source: key,
      args: ['-f', 'GPKG', ...(steps.length ? ['-update'] : []), '-a_srs', wkt, '-nln', CAD_TABLES[k], '-nlt', NLT[k], '-lco', 'SPATIAL_INDEX=YES', '-lco', 'GEOMETRY_NAME=geom'],
      label: `Bản vẽ CAD / ${CAD_TABLES[k]}`,
      features: data.counts[k],
    });
  });
  return { steps, inputs, outputs: steps.length ? [file] : [], notes: [], schemas: [] };
}
