// "Bản vẽ CAD" of the QGIS project: the CAD objects of the summary drawing (summary.ts) with the look they have in
// AutoCAD — line widths in metres (the white dashes of a road axis, the 15 m ditch), solid fills (arrows, manholes,
// stations), hatch line families, texts with their height / rotation / alignment — written as GeoPackage layers
// (BanVeCAD.gpkg, next to the geodatabases) that qgis.ts draws with data-defined symbology. The land-use hatches
// stay with the geodatabase layers (Phụ lục I symbols), so they are left out here.
import type { CadDocument, CadEntity, HAlign, VAlign, Vec2 } from '@/lib/cad/types';
import type { NormalizePlan, NormalizeStep } from '@/lib/gdb/normalize';
import { inkForPaper } from '@/lib/map/cadGrid';
import { ringsToPolygons } from './geometry';

export const CAD_GPKG = 'BanVeCAD';
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

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pt = (p: Vec2): Vec2 => [r3(p[0]), r3(p[1])];

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
  for (const e of doc.entities) {
    if (LAND_USE_LAYER.test(e.layer)) continue;
    const mau = inkOnWhite(e.color);
    if (e.kind === 'polyline') {
      if (e.points.length < 2) continue;
      const coords = e.points.map(pt);
      if (e.closed && coords.length > 2) coords.push(coords[0]);
      lines.push({ type: 'Feature', properties: { lop: e.layer, mau, rong: r3(e.width ?? 0) }, geometry: { type: 'LineString', coordinates: coords } });
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
    } else if (e.kind === 'point') points.push({ type: 'Feature', properties: { lop: e.layer, mau }, geometry: { type: 'Point', coordinates: pt(e.position) } });
  }
  const all = { lines, areas, texts, points };
  const json: CadData['json'] = {};
  for (const k of Object.keys(all) as CadTable[]) if (all[k].length) json[k] = collection(all[k]);
  const patternColors = [...patterns].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { json, patternColors, counts: { lines: lines.length, areas: areas.length, texts: texts.length, points: points.length } };
}

const NLT: Record<CadTable, string> = { lines: 'LINESTRING', areas: 'MULTIPOLYGON', texts: 'POINT', points: 'POINT' };

export interface CadGpkgPlan extends NormalizePlan {
  inputs: { key: string; fileName: string; json: string }[];
}

/** ogr2ogr steps writing BanVeCAD.gpkg from the GeoJSON layers (one dataset per table). */
export function planCadGpkg(data: CadData, wkt: string): CadGpkgPlan {
  const inputs: CadGpkgPlan['inputs'] = [];
  const steps: NormalizeStep[] = [];
  (Object.keys(CAD_TABLES) as CadTable[]).forEach((k, i) => {
    const json = data.json[k];
    if (!json) return;
    const key = `cad${i}`;
    inputs.push({ key, fileName: `${key}.geojson`, json });
    steps.push({
      out: CAD_GPKG,
      source: key,
      args: ['-f', 'GPKG', ...(steps.length ? ['-update'] : []), '-a_srs', wkt, '-nln', CAD_TABLES[k], '-nlt', NLT[k], '-lco', 'SPATIAL_INDEX=YES', '-lco', 'GEOMETRY_NAME=geom'],
      label: `Bản vẽ CAD / ${CAD_TABLES[k]}`,
      features: data.counts[k],
    });
  });
  return { steps, inputs, outputs: steps.length ? [CAD_GPKG] : [], notes: [], schemas: [] };
}
