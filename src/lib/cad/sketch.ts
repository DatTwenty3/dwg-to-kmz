// User sketches drawn on the map (lines, areas, points) and their conversion to a CadDocument.
// Each feature becomes its own layer, so the existing per-layer style pipeline (map, KML/KMZ, DXF)
// applies to it unchanged. Pure (no DOM).
import type { CadDocument, CadEntity, CadLayer, LayerStyle, Vec2 } from './types';

export type SketchKind = 'line' | 'polygon' | 'point';

export interface SketchFeature {
  id: string;
  kind: SketchKind;
  /** Shown in the list; becomes the layer (KML folder / DXF layer) name. */
  name: string;
  /** [lng, lat] WGS84 vertices (one for a point; polygon rings are open — no repeated first vertex). */
  points: Vec2[];
  /** Colour is always set; width / dash / fillOpacity optional. */
  style: LayerStyle & { color: string };
  /** Optional text drawn next to the feature (point: at the point; line: at its midpoint; area: at its centroid). */
  label?: string;
  /** Label height in metres (default 4). */
  labelSize?: number;
  /** Hidden in the map (still listed). */
  hidden?: boolean;
}

export const WGS84_CRS = '+proj=longlat +datum=WGS84 +no_defs';
export const SKETCH_DEFAULT_COLOR = '#e11d48';
export const SKETCH_DEFAULT_FILL = 0.3;
export const SKETCH_DEFAULT_LABEL_SIZE = 4;

const KIND_NAME: Record<SketchKind, string> = { line: 'Đường', polygon: 'Vùng', point: 'Điểm' };

/** "Đường 3": first free number for that kind among `existing` names. */
export function nextSketchName(kind: SketchKind, existing: readonly string[]): string {
  const base = KIND_NAME[kind];
  const taken = new Set(existing);
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name)) return name;
  }
}

/** Names must be unique (they are layer names): "Tên", "Tên (2)", "Tên (3)"… */
export function uniqueName(wanted: string, existing: readonly string[], selfName?: string): string {
  const name = wanted.trim() || 'Nét vẽ';
  const taken = new Set(existing.filter((n) => n !== selfName));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const cand = `${name} (${n})`;
    if (!taken.has(cand)) return cand;
  }
}

/** Point along a polyline at half its (planar, degree-space) length — good enough for a label anchor. */
function midpointOf(pts: readonly Vec2[]): Vec2 {
  if (pts.length === 1) return pts[0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let half = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? Math.min(1, half / seg[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    half -= seg[i];
  }
  return pts[0];
}

/** Area-weighted centroid of a ring (falls back to the vertex mean for degenerate rings). */
function centroidOf(ring: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-18) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Minimum vertex count per kind. */
export const SKETCH_MIN_POINTS: Record<SketchKind, number> = { line: 2, polygon: 3, point: 1 };

/** True when the feature has enough vertices to be drawn / exported. */
export function isValidFeature(f: SketchFeature): boolean {
  return f.points.length >= SKETCH_MIN_POINTS[f.kind] && f.points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

/**
 * WGS84 document for the sketches: one layer per feature (layer.style = feature style), so colours,
 * widths, dashes and fills survive rendering and every export. Hidden / invalid features are left out.
 */
export function sketchToDocument(features: readonly SketchFeature[]): CadDocument {
  const layers: CadLayer[] = [];
  const entities: CadEntity[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of features) {
    if (f.hidden || !isValidFeature(f)) continue;
    const color = f.style.color;
    layers.push({ name: f.name, color, visible: true, style: { ...f.style } });
    const handle = f.id;
    for (const p of f.points) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    let anchor: Vec2;
    if (f.kind === 'point') {
      anchor = f.points[0];
      entities.push({ kind: 'point', layer: f.name, color, position: anchor, handle });
    } else if (f.kind === 'line') {
      anchor = midpointOf(f.points);
      entities.push({ kind: 'polyline', layer: f.name, color, points: f.points.slice(), closed: false, handle });
    } else {
      anchor = centroidOf(f.points);
      entities.push({
        kind: 'polygon',
        layer: f.name,
        color,
        rings: [f.points.slice()],
        fillOpacity: f.style.fillOpacity ?? SKETCH_DEFAULT_FILL,
        handle,
      });
      // Outline as its own entity so the layer's width / dash show on the border.
      entities.push({ kind: 'polyline', layer: f.name, color, points: f.points.slice(), closed: true, handle });
    }
    const label = f.label?.trim();
    if (label) {
      entities.push({
        kind: 'text',
        layer: f.name,
        color,
        text: label.normalize('NFC'),
        position: anchor,
        height: f.labelSize ?? SKETCH_DEFAULT_LABEL_SIZE,
        rotation: 0,
        hAlign: f.kind === 'point' ? 'left' : 'center',
        vAlign: f.kind === 'point' ? 'bottom' : 'middle',
        handle,
      });
    }
  }
  return {
    units: 'deg',
    crs: WGS84_CRS,
    layers,
    entities,
    bbox:
      x0 === Infinity
        ? [
            [0, 0],
            [0, 0],
          ]
        : [
            [x0, y0],
            [x1, y1],
          ],
    warnings: [],
  };
}

/** Parse features saved to storage; drops anything malformed. */
export function parseSketchJson(text: string | null): SketchFeature[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.filter((f): f is SketchFeature => {
      if (!f || typeof f !== 'object') return false;
      const o = f as Partial<SketchFeature>;
      return (
        typeof o.id === 'string' &&
        (o.kind === 'line' || o.kind === 'polygon' || o.kind === 'point') &&
        typeof o.name === 'string' &&
        Array.isArray(o.points) &&
        !!o.style &&
        typeof o.style.color === 'string' &&
        isValidFeature(o as SketchFeature)
      );
    });
  } catch {
    return [];
  }
}
