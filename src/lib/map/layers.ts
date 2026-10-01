// CadDocument (WGS84) → deck.gl layers. Pure: no DOM access, testable in Node.
//
// Performance model:
// - Per document, entities are converted ONCE into flat render items grouped by CAD layer
//   (cached in a WeakMap keyed by the document object).
// - Per visibility set, the items of the visible CAD layers are concatenated ONCE (cached);
//   calling buildLayers again with the same doc + same visible set returns layers whose `data`
//   arrays are identical (===), so deck.gl diffs them as unchanged and pan/zoom never
//   regenerates attributes. Toggling a layer regenerates only the affected kinds.
// - One deck layer per entity kind (not per CAD layer): a drawing with hundreds of CAD layers
//   would otherwise cost hundreds of draw calls per frame.
import type { Layer } from '@deck.gl/core';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type {
  CadDocument,
  CadEntity,
  DashStyle,
  HAlign,
  LayerStyle,
  TableEntity,
  TextEntity,
  VAlign,
  Vec2,
} from '@/lib/cad/types';
import { isGeographic, metresPerDegree } from '@/lib/geo';
import { VIETNAMESE_CHARSET } from '@/lib/text';
import { TextSizeCullExtension } from './text-cull';

export type RGBA = [number, number, number, number];

/** Cap height / em size for Roboto-like fonts: CAD text height is the cap height. */
export const CAP_HEIGHT_RATIO = 0.7;
/** Default: hide text whose capital letters would be smaller than this on screen. */
export const DEFAULT_MIN_TEXT_PIXELS = 4;
export const DEFAULT_FONT_FAMILY = 'Roboto, Arial, sans-serif';

export interface BuildLayersOptions {
  visibleLayers: Set<string>;
  /** Handle of the entity to highlight (selected in the popup). */
  highlightHandle?: string;
  /** Resolved, loaded font family for TextLayer (see resolveFontFamily in components). */
  fontFamily?: string;
  /** Cap-height threshold in pixels below which text is hidden (default 4). */
  minTextPixels?: number;
  /**
   * Set false until the web font is loaded: deck.gl caches glyph atlases by font name, so an
   * atlas built with fallback glyphs would stick. Default true.
   */
  showText?: boolean;
  /** Prefix for every deck layer id (e.g. `${fileId}:`) so several documents can coexist on one map. */
  idPrefix?: string;
  /** Whole-document opacity 0..1 (deck.gl layer `opacity`); default 1. Highlight layers stay opaque. */
  opacity?: number;
}

/** What a picked deck object refers to (the original entity + table cell, if any). */
export interface PickRef {
  entity: CadEntity;
  layer: string;
  /** Present for table grid lines / cell texts. */
  cell?: { r: number; c: number; text: string };
}

export interface PathItem extends PickRef {
  path: Vec2[];
  color: RGBA;
  width: number;
  /** [dash, gap] in screen pixels; undefined = solid line. */
  dash?: [number, number];
}
export interface PolygonItem extends PickRef {
  polygon: Vec2[][];
  color: RGBA;
}
export interface TextItem extends PickRef {
  text: string;
  position: Vec2;
  /** Em size in metres. */
  size: number;
  angle: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'top' | 'center' | 'bottom';
  color: RGBA;
}
export interface PointItem extends PickRef {
  position: Vec2;
  color: RGBA;
}

interface LayerGroup {
  paths: PathItem[];
  /** Paths drawn with a dash pattern (separate deck layer with PathStyleExtension). */
  dashed: PathItem[];
  polygons: PolygonItem[];
  /** Texts with light fill colour (dark outline). */
  textsLight: TextItem[];
  /** Texts with dark fill colour (light outline). */
  textsDark: TextItem[];
  points: PointItem[];
}

export interface PreparedDocument {
  groups: Map<string, LayerGroup>;
  /** Layer order for drawing (document order). */
  order: string[];
  /** Entity count per CAD layer (tables count once). */
  counts: Map<string, number>;
  byHandle: Map<string, PickRef[]>;
}

export interface VisibleData {
  key: string;
  paths: PathItem[];
  dashed: PathItem[];
  polygons: PolygonItem[];
  textsLight: TextItem[];
  textsDark: TextItem[];
  points: PointItem[];
}

// ---- helpers ----------------------------------------------------------------------------------

export function hexToRgba(hex: string, alpha = 255): RGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255, alpha];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function isLight([r, g, b]: RGBA): boolean {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 128;
}

const ANCHOR: Record<HAlign, TextItem['anchor']> = { left: 'start', center: 'middle', right: 'end' };
const BASELINE: Record<VAlign, TextItem['baseline']> = {
  top: 'top',
  middle: 'center',
  bottom: 'bottom',
  baseline: 'bottom',
};

/** Dash pattern in pixels for a line style at a given line width; undefined = solid. */
export function dashPattern(dash: DashStyle | undefined, widthPx: number): [number, number] | undefined {
  const u = Math.max(1, widthPx);
  switch (dash) {
    case 'dashed':
      return [4 * u + 3, 2 * u + 2];
    case 'dotted':
      return [u, 2 * u + 2];
    case 'dashdot':
      // PathStyleExtension only supports one dash + one gap: a long dash with a short gap stands in for dash-dot.
      return [7 * u + 3, 2 * u + 2];
    default:
      return undefined;
  }
}

/** Pixel width for a CAD constant width in metres: hairline → 1 px, else 1 + w, clamped to 6. */
export function pathWidthPx(widthM: number | undefined): number {
  if (!widthM || !(widthM > 0) || !Number.isFinite(widthM)) return 1;
  return Math.min(6, Math.max(1, Math.round((1 + widthM) * 2) / 2));
}

const finiteVec = (v: Vec2) => Number.isFinite(v[0]) && Number.isFinite(v[1]);

/**
 * Local metric frame at `origin`: returns a function mapping (right, down) metres in the
 * rotated table frame to document coordinates (lng/lat if geographic, else drawing units).
 */
function tableFrame(origin: Vec2, rotationDeg: number, geographic: boolean): (x: number, yDown: number) => Vec2 {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const mpd = geographic ? metresPerDegree(origin[1]) : { lng: 1, lat: 1 };
  return (x, yDown) => {
    const y = -yDown;
    const e = x * cos - y * sin;
    const n = x * sin + y * cos;
    return [origin[0] + e / mpd.lng, origin[1] + n / mpd.lat];
  };
}

function cumulative(sizes: number[]): number[] {
  const out = [0];
  for (const s of sizes) out.push(out[out.length - 1] + (Number.isFinite(s) && s > 0 ? s : 0));
  return out;
}

function addTable(e: TableEntity, geographic: boolean, group: LayerGroup, refs: PickRef[], style?: LayerStyle) {
  if (!finiteVec(e.origin)) return;
  const rows = Math.min(e.rows, e.rowHeights.length);
  const cols = Math.min(e.cols, e.colWidths.length);
  if (rows <= 0 || cols <= 0) return;
  const xs = cumulative(e.colWidths.slice(0, cols));
  const ys = cumulative(e.rowHeights.slice(0, rows));
  const at = tableFrame(e.origin, e.rotation, geographic);
  const color = hexToRgba(e.color);
  const lineWidth = style?.width ?? 1;
  const dash = dashPattern(style?.dash, lineWidth);

  const covered = new Set<number>();
  const rects: { r0: number; c0: number; r1: number; c1: number; cell?: TableEntity['cells'][number] }[] = [];
  for (const cell of e.cells) {
    if (cell.r < 0 || cell.c < 0 || cell.r >= rows || cell.c >= cols) continue;
    const r1 = Math.min(rows, cell.r + Math.max(1, cell.rowSpan));
    const c1 = Math.min(cols, cell.c + Math.max(1, cell.colSpan));
    for (let r = cell.r; r < r1; r++) for (let c = cell.c; c < c1; c++) covered.add(r * cols + c);
    rects.push({ r0: cell.r, c0: cell.c, r1, c1, cell });
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (!covered.has(r * cols + c)) rects.push({ r0: r, c0: c, r1: r + 1, c1: c + 1 });

  for (const rect of rects) {
    const x0 = xs[rect.c0];
    const x1 = xs[rect.c1];
    const y0 = ys[rect.r0];
    const y1 = ys[rect.r1];
    const cellRef = rect.cell ? { r: rect.cell.r, c: rect.cell.c, text: rect.cell.text } : undefined;
    const item: PathItem = {
      entity: e,
      layer: e.layer,
      cell: cellRef,
      path: [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)],
      color,
      width: lineWidth,
      dash,
    };
    (dash ? group.dashed : group.paths).push(item);
    refs.push(item);
    const cell = rect.cell;
    if (cell && cell.text.trim()) {
      const rowH = y1 - y0;
      const lines = cell.text.split('\n').length;
      const capH = cell.textHeight && cell.textHeight > 0 ? cell.textHeight : Math.max(0, (rowH * 0.5) / lines);
      if (capH <= 0) continue;
      const t: TextItem = {
        entity: e,
        layer: e.layer,
        cell: cellRef,
        text: cell.text,
        position: at((x0 + x1) / 2, (y0 + y1) / 2),
        size: capH / CAP_HEIGHT_RATIO,
        angle: e.rotation,
        anchor: 'middle',
        baseline: 'center',
        color,
      };
      (isLight(color) ? group.textsLight : group.textsDark).push(t);
      refs.push(t);
    }
  }
}

// ---- preparation (once per document) ----------------------------------------------------------

const prepCache = new WeakMap<CadDocument, PreparedDocument>();

export function prepareDocument(doc: CadDocument): PreparedDocument {
  const cached = prepCache.get(doc);
  if (cached) return cached;

  const geographic = !!doc.crs && isGeographic(doc.crs);
  const groups = new Map<string, LayerGroup>();
  const counts = new Map<string, number>();
  const byHandle = new Map<string, PickRef[]>();
  const order: string[] = doc.layers.map((l) => l.name);
  const styleOf = new Map(doc.layers.map((l) => [l.name, l.style] as const));
  const getGroup = (name: string): LayerGroup => {
    let g = groups.get(name);
    if (!g) {
      g = { paths: [], dashed: [], polygons: [], textsLight: [], textsDark: [], points: [] };
      groups.set(name, g);
      if (!order.includes(name)) order.push(name);
    }
    return g;
  };

  for (const e of doc.entities) {
    const g = getGroup(e.layer);
    counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
    const refs: PickRef[] = [];
    switch (e.kind) {
      case 'polyline': {
        const pts = e.points.filter(finiteVec);
        if (pts.length < 2) break;
        const path = e.closed && pts.length > 2 ? [...pts, pts[0]] : pts;
        const st = styleOf.get(e.layer);
        const width = st?.width ?? pathWidthPx(e.width);
        const dash = dashPattern(st?.dash, width);
        const item: PathItem = { entity: e, layer: e.layer, path, color: hexToRgba(e.color), width, dash };
        (dash ? g.dashed : g.paths).push(item);
        refs.push(item);
        break;
      }
      case 'polygon': {
        const rings = e.rings.map((r) => r.filter(finiteVec)).filter((r) => r.length >= 3);
        if (rings.length === 0) break;
        const alpha = Math.round(Math.min(1, Math.max(0, e.fillOpacity)) * 255);
        const item: PolygonItem = { entity: e, layer: e.layer, polygon: rings, color: hexToRgba(e.color, alpha) };
        g.polygons.push(item);
        refs.push(item);
        break;
      }
      case 'text': {
        if (!e.text.trim() || !finiteVec(e.position) || !(e.height > 0)) break;
        const item = textItem(e);
        (isLight(item.color) ? g.textsLight : g.textsDark).push(item);
        refs.push(item);
        break;
      }
      case 'table':
        addTable(e, geographic, g, refs, styleOf.get(e.layer));
        break;
      case 'point': {
        if (!finiteVec(e.position)) break;
        const item: PointItem = { entity: e, layer: e.layer, position: e.position, color: hexToRgba(e.color) };
        g.points.push(item);
        refs.push(item);
        break;
      }
    }
    if (e.handle && refs.length) {
      const list = byHandle.get(e.handle);
      if (list) list.push(...refs);
      else byHandle.set(e.handle, refs);
    }
  }

  const prepared: PreparedDocument = { groups, order, counts, byHandle };
  prepCache.set(doc, prepared);
  return prepared;
}

function textItem(e: TextEntity): TextItem {
  return {
    entity: e,
    layer: e.layer,
    text: e.text,
    position: e.position,
    size: e.height / CAP_HEIGHT_RATIO,
    angle: Number.isFinite(e.rotation) ? e.rotation : 0,
    anchor: ANCHOR[e.hAlign] ?? 'start',
    baseline: BASELINE[e.vAlign] ?? 'bottom',
    color: hexToRgba(e.color),
  };
}

// ---- visible data (once per visibility set) ---------------------------------------------------

const visibleCache = new WeakMap<CadDocument, VisibleData>();

export function visibleData(doc: CadDocument, visibleLayers: Set<string>): VisibleData {
  const prep = prepareDocument(doc);
  const names = prep.order.filter((n) => visibleLayers.has(n) && prep.groups.has(n));
  const key = names.join('\u0000');
  const cached = visibleCache.get(doc);
  if (cached && cached.key === key) return cached;

  const pick = <K extends keyof LayerGroup>(k: K): LayerGroup[K] => {
    // Reuse previous array if this kind's content did not change (e.g. toggling a text-only layer).
    const out = names.flatMap((n) => prep.groups.get(n)![k] as unknown[]) as LayerGroup[K];
    const prev = cached?.[k];
    if (prev && prev.length === out.length && prev.every((v, i) => v === out[i])) return prev as LayerGroup[K];
    return out;
  };
  const data: VisibleData = {
    key,
    paths: pick('paths'),
    dashed: pick('dashed'),
    polygons: pick('polygons'),
    textsLight: pick('textsLight'),
    textsDark: pick('textsDark'),
    points: pick('points'),
  };
  visibleCache.set(doc, data);
  return data;
}

// ---- deck layers ------------------------------------------------------------------------------

// Module-level accessors keep stable identities across rebuilds.
const getPath = (d: PathItem) => d.path;
const getPathColor = (d: PathItem) => d.color;
const getPathWidth = (d: PathItem) => d.width;
const getPathDash = (d: PathItem) => d.dash ?? [0, 0];
const dashExtension = new PathStyleExtension({ dash: true, dashMode: 'path' });
const getPolygon = (d: PolygonItem) => d.polygon;
const getPolyColor = (d: PolygonItem) => d.color;
const getText = (d: TextItem) => d.text;
const getTextPos = (d: TextItem) => d.position;
const getTextSize = (d: TextItem) => d.size;
const getTextAngle = (d: TextItem) => d.angle;
const getTextAnchor = (d: TextItem) => d.anchor;
const getTextBaseline = (d: TextItem) => d.baseline;
const getTextColor = (d: TextItem) => d.color;
const getPointPos = (d: PointItem) => d.position;
const getPointColor = (d: PointItem) => d.color;

const HIGHLIGHT: RGBA = [255, 230, 0, 255];
const cullExtensions = new Map<number, TextSizeCullExtension>();
function cullExtension(minEmPixels: number): TextSizeCullExtension {
  let ext = cullExtensions.get(minEmPixels);
  if (!ext) {
    ext = new TextSizeCullExtension({ minEmPixels });
    cullExtensions.set(minEmPixels, ext);
  }
  return ext;
}

function textLayer(
  id: string,
  data: TextItem[],
  light: boolean,
  opts: BuildLayersOptions,
  opacity = 1,
): TextLayer<TextItem> {
  const minCap = opts.minTextPixels ?? DEFAULT_MIN_TEXT_PIXELS;
  return new TextLayer<TextItem>({
    id,
    opacity,
    data,
    pickable: true,
    billboard: false,
    sizeUnits: 'meters',
    sizeMinPixels: 0,
    characterSet: VIETNAMESE_CHARSET,
    fontFamily: opts.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontWeight: 500,
    // SDF atlas: crisp at any scale and enables the contrast outline over imagery.
    fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.25 },
    outlineWidth: 2,
    outlineColor: light ? [0, 0, 0, 200] : [255, 255, 255, 220],
    lineHeight: 1.2,
    getText,
    getPosition: getTextPos,
    getSize: getTextSize,
    getAngle: getTextAngle,
    getTextAnchor,
    getAlignmentBaseline: getTextBaseline,
    getColor: getTextColor,
    extensions: [cullExtension(minCap / CAP_HEIGHT_RATIO)],
  });
}

/** Cheap signature of the layer styles, so deck.gl re-evaluates accessors when only a style changed. */
function styleSignature(doc: CadDocument): string {
  let out = '';
  for (const l of doc.layers) {
    const s = l.style;
    if (s) out += `${l.name}|${s.color ?? ''}|${s.width ?? ''}|${s.dash ?? ''}|${s.fillOpacity ?? ''};`;
  }
  return out;
}

export function buildLayers(doc: CadDocument, opts: BuildLayersOptions): Layer[] {
  const data = visibleData(doc, opts.visibleLayers);
  const layers: Layer[] = [];
  const sig = styleSignature(doc);
  const prefix = opts.idPrefix ?? '';
  const opacity = Math.min(1, Math.max(0, opts.opacity ?? 1));

  if (data.polygons.length)
    layers.push(
      new PolygonLayer<PolygonItem>({
        id: `${prefix}cad-polygons`,
        opacity,
        data: data.polygons,
        pickable: true,
        stroked: false,
        filled: true,
        getPolygon,
        getFillColor: getPolyColor,
        updateTriggers: { getFillColor: sig },
      }),
    );
  if (data.paths.length)
    layers.push(
      new PathLayer<PathItem>({
        id: `${prefix}cad-paths`,
        opacity,
        data: data.paths,
        pickable: true,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        getPath,
        getColor: getPathColor,
        getWidth: getPathWidth,
        updateTriggers: { getColor: sig, getWidth: sig },
      }),
    );
  if (data.dashed.length)
    layers.push(
      new PathLayer<PathItem, PathStyleExtensionProps<PathItem>>({
        id: `${prefix}cad-paths-dashed`,
        opacity,
        data: data.dashed,
        pickable: true,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        getPath,
        getColor: getPathColor,
        getWidth: getPathWidth,
        getDashArray: getPathDash,
        dashUnits: 'pixels',
        dashJustified: false,
        extensions: [dashExtension],
        updateTriggers: { getColor: sig, getWidth: sig, getDashArray: sig },
      }),
    );
  if (data.points.length)
    layers.push(
      new ScatterplotLayer<PointItem>({
        id: `${prefix}cad-points`,
        opacity,
        data: data.points,
        pickable: true,
        radiusUnits: 'pixels',
        getRadius: 3,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        getLineColor: [0, 0, 0, 200],
        getPosition: getPointPos,
        getFillColor: getPointColor,
        updateTriggers: { getFillColor: sig },
      }),
    );
  if (opts.showText !== false) {
    if (data.textsDark.length) layers.push(textLayer(`${prefix}cad-text-dark`, data.textsDark, false, opts, opacity));
    if (data.textsLight.length) layers.push(textLayer(`${prefix}cad-text-light`, data.textsLight, true, opts, opacity));
  }

  layers.push(...highlightLayers(doc, opts));
  return layers;
}

function highlightLayers(doc: CadDocument, opts: BuildLayersOptions): Layer[] {
  if (!opts.highlightHandle) return [];
  const refs = prepareDocument(doc).byHandle.get(opts.highlightHandle);
  if (!refs || refs.length === 0) return [];
  const paths: Vec2[][] = [];
  const points: Vec2[] = [];
  for (const r of refs) {
    if ('path' in r) paths.push((r as PathItem).path);
    else if ('polygon' in r) for (const ring of (r as PolygonItem).polygon) paths.push([...ring, ring[0]]);
    else if ('position' in r) points.push((r as TextItem | PointItem).position);
  }
  const out: Layer[] = [];
  if (paths.length)
    out.push(
      new PathLayer<Vec2[]>({
        id: `${opts.idPrefix ?? ''}cad-highlight-paths`,
        data: paths,
        widthUnits: 'pixels',
        getWidth: 4,
        getColor: HIGHLIGHT,
        getPath: (d) => d,
      }),
    );
  if (points.length)
    out.push(
      new ScatterplotLayer<Vec2>({
        id: `${opts.idPrefix ?? ''}cad-highlight-points`,
        data: points,
        radiusUnits: 'pixels',
        getRadius: 7,
        filled: false,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 3,
        getLineColor: HIGHLIGHT,
        getPosition: (d) => d,
      }),
    );
  return out;
}

/** [[west, south], [east, north]] of a transformed document, or null if unusable. */
export function documentBounds(doc: CadDocument): [Vec2, Vec2] | null {
  const [[x0, y0], [x1, y1]] = doc.bbox;
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  if (x1 < x0 || y1 < y0) return null;
  if (Math.abs(x0) > 180 || Math.abs(x1) > 180 || Math.abs(y0) > 90 || Math.abs(y1) > 90) return null;
  return [
    [x0, y0],
    [x1, y1],
  ];
}
