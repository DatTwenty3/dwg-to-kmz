// Measurement tool: pure helpers (snapping, segment info) and the deck.gl layers that draw measurements.
import type { Layer } from '@deck.gl/core';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Vec2 } from '@/lib/cad/types';
import { formatArea, formatLength, geodesicArea, geodesicDistance } from '@/lib/geo';
import { VIETNAMESE_CHARSET } from '@/lib/text';
import { DEFAULT_FONT_FAMILY } from './layers';

export type MeasureTool = 'distance' | 'area' | 'point';

export interface Measurement {
  id: number;
  kind: MeasureTool;
  /** [lng, lat] vertices. */
  points: Vec2[];
}

export interface MeasureDraft {
  kind: MeasureTool;
  points: Vec2[];
  /** Live cursor position (rubber band); null when the pointer left the map. */
  cursor: Vec2 | null;
}

/** Vertices that can be snapped to, from whatever deck.gl picked (PathItem / PolygonItem / TextItem / PointItem). */
export function snapCandidatesOf(obj: unknown): Vec2[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as { path?: Vec2[]; polygon?: Vec2[][]; position?: Vec2 };
  if (Array.isArray(o.path)) return o.path;
  if (Array.isArray(o.polygon)) return o.polygon.flat();
  if (Array.isArray(o.position)) return [o.position];
  return [];
}

/** Nearest candidate to `cursor` (screen px) within `radiusPx`, or null. `project` maps [lng,lat] → [x,y] px. */
export function nearestSnap(
  candidates: readonly Vec2[],
  cursor: [number, number],
  project: (p: Vec2) => [number, number],
  radiusPx = 8,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = radiusPx * radiusPx;
  for (const c of candidates) {
    const [x, y] = project(c);
    const d = (x - cursor[0]) ** 2 + (y - cursor[1]) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export interface SegmentInfo {
  a: Vec2;
  b: Vec2;
  mid: Vec2;
  /** Geodesic length in metres (NaN if it could not be computed). */
  length: number;
}

const safe = (f: () => number): number => {
  try {
    return f();
  } catch {
    return NaN;
  }
};

/** Segments of a vertex list (plus the closing one when `closed`). */
export function segmentsOf(points: readonly Vec2[], closed = false): SegmentInfo[] {
  const out: SegmentInfo[] = [];
  const n = points.length;
  const last = closed && n > 2 ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push({ a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], length: safe(() => geodesicDistance(a, b)) });
  }
  return out;
}

export function centroidOf(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  const n = Math.max(1, points.length);
  return [x / n, y / n];
}

const fmtLen = (m: number) => {
  if (!Number.isFinite(m)) return '—';
  try {
    return formatLength(m);
  } catch {
    return `${m.toFixed(1)} m`;
  }
};
const fmtArea = (m2: number) => {
  if (!Number.isFinite(m2)) return '—';
  try {
    return formatArea(m2);
  } catch {
    return `${m2.toFixed(1)} m²`;
  }
};

export const fmtLngLat = (p: Vec2) => `${p[1].toFixed(6)}, ${p[0].toFixed(6)}`;

// ---- layers ---------------------------------------------------------------------------------

const ACCENT: [number, number, number, number] = [37, 99, 235, 255];
const dashExt = new PathStyleExtension({ dash: true, dashMode: 'path' });

interface Label {
  position: Vec2;
  text: string;
  /** Total / area labels are drawn bolder, offset from the anchor. */
  strong: boolean;
  offset: [number, number];
}

export interface MeasureAnim {
  /** 0..1 fade of the labels. */
  labelOpacity: number;
  /** Scale (about 0..1.2) of the most recently placed vertex. */
  pop: number;
}

export interface BuildMeasureOptions {
  finished: readonly Measurement[];
  draft: MeasureDraft | null;
  fontFamily?: string;
  anim?: MeasureAnim;
}

export function buildMeasureLayers(opts: BuildMeasureOptions): Layer[] {
  const anim = opts.anim ?? { labelOpacity: 1, pop: 1 };
  const lines: { path: Vec2[] }[] = [];
  const fills: { polygon: Vec2[] }[] = [];
  const dots: { position: Vec2; r: number; kind: MeasureTool }[] = [];
  const labels: Label[] = [];

  const add = (kind: MeasureTool, pts: Vec2[], closed: boolean, opts2: { isDraft: boolean; cursor?: Vec2 | null; popLast: boolean }) => {
    const all = opts2.cursor ? [...pts, opts2.cursor] : pts;
    if (kind === 'point') {
      pts.forEach((p) => {
        dots.push({ position: p, r: 1, kind });
        labels.push({ position: p, text: fmtLngLat(p), strong: false, offset: [0, -16] });
      });
      return;
    }
    if (all.length >= 2) lines.push({ path: closed && all.length > 2 ? [...all, all[0]] : all });
    if (kind === 'area' && all.length >= 3) fills.push({ polygon: all });
    pts.forEach((p, i) => dots.push({ position: p, r: opts2.popLast && i === pts.length - 1 ? anim.pop : 1, kind }));
    for (const s of segmentsOf(all, closed)) {
      if (Number.isFinite(s.length) && s.length > 0) labels.push({ position: s.mid, text: fmtLen(s.length), strong: false, offset: [0, 0] });
    }
    if (kind === 'area' && all.length >= 3) {
      labels.push({ position: centroidOf(all), text: fmtArea(safe(() => geodesicArea(all))), strong: true, offset: [0, 0] });
    } else if (kind === 'distance' && all.length >= 2) {
      const total = segmentsOf(all).reduce((s, x) => s + (Number.isFinite(x.length) ? x.length : 0), 0);
      labels.push({ position: all[all.length - 1], text: `Tổng ${fmtLen(total)}`, strong: true, offset: [0, -22] });
    }
  };

  for (const m of opts.finished) add(m.kind, m.points, m.kind === 'area', { isDraft: false, popLast: false });
  if (opts.draft) {
    const d = opts.draft;
    add(d.kind, d.points, d.kind === 'area', { isDraft: true, cursor: d.cursor, popLast: true });
  }

  const layers: Layer[] = [];
  if (fills.length)
    layers.push(
      new PolygonLayer<{ polygon: Vec2[] }>({
        id: 'measure:fill',
        data: fills,
        getPolygon: (d) => d.polygon,
        getFillColor: [37, 99, 235, 56],
        stroked: false,
      }),
    );
  if (lines.length) {
    layers.push(
      new PathLayer<{ path: Vec2[] }>({
        id: 'measure:casing',
        data: lines,
        widthUnits: 'pixels',
        getWidth: 5,
        getPath: (d) => d.path,
        getColor: [255, 255, 255, 230],
        capRounded: true,
        jointRounded: true,
      }),
      new PathLayer<{ path: Vec2[] }, PathStyleExtensionProps<{ path: Vec2[] }>>({
        id: 'measure:line',
        data: lines,
        widthUnits: 'pixels',
        getWidth: 2.5,
        getPath: (d) => d.path,
        getColor: ACCENT,
        getDashArray: [7, 4],
        dashUnits: 'pixels',
        dashJustified: false,
        extensions: [dashExt],
      }),
    );
  }
  if (dots.length)
    layers.push(
      new ScatterplotLayer<{ position: Vec2; r: number; kind: MeasureTool }>({
        id: 'measure:dots',
        data: dots,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        stroked: true,
        getPosition: (d) => d.position,
        getRadius: (d) => (d.kind === 'point' ? 6 : 4.5) * d.r,
        getFillColor: (d) => (d.kind === 'point' ? ACCENT : [255, 255, 255, 255]),
        getLineColor: (d) => (d.kind === 'point' ? [255, 255, 255, 255] : ACCENT),
        getLineWidth: 2,
        updateTriggers: { getRadius: anim.pop },
      }),
    );
  if (labels.length)
    layers.push(
      new TextLayer<Label>({
        id: 'measure:labels',
        data: labels,
        opacity: anim.labelOpacity,
        characterSet: VIETNAMESE_CHARSET,
        fontFamily: opts.fontFamily ?? DEFAULT_FONT_FAMILY,
        fontWeight: 600,
        sizeUnits: 'pixels',
        getText: (d) => d.text,
        getPosition: (d) => d.position,
        getPixelOffset: (d) => d.offset,
        getSize: (d) => (d.strong ? 13 : 11.5),
        getColor: (d) => (d.strong ? [255, 255, 255, 255] : [24, 24, 27, 255]),
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        background: true,
        getBackgroundColor: (d) => (d.strong ? [24, 24, 27, 235] : [255, 255, 255, 235]),
        backgroundPadding: [6, 3, 6, 3],
        pickable: false,
      }),
    );
  return layers;
}
