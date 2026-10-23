// Inventory of the drawings of a "lấy ý kiến" folder: the planning boundary (ranh lập quy hoạch), which entities
// lie inside it (legend swatches, title blocks, cross-sections and frames lie outside and are left out), and one
// row per layer × geometry kind with its counts — the rows of the mapping table.
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { colorKey, describeColorKey, keyColor, type ColorContext, type ColorInfo } from './colorClass';
import { bboxOf, chainRings, interiorPoint, isClosedLine, labelIn, labelIndex, ringArea } from './geometry';
import { compactName, isAnnotationLayer, landUseOf, sameLandUse, type GeomKind } from './suggest';

/** Layer names of the planning boundary ("BV_Rg_Lapquyhoach", "Ranh giới lập quy hoạch", "RANH QH"…). */
export const PLAN_BOUNDARY_LAYER = /rglap|ranh\w*lap|lapquyhoach|ranhquyhoach|ranhqh\b|rgqh|ranhnghiencuu|phamvinghiencuu|ranhgioilapqh/;

/**
 * When no layer is named as a planning boundary: the outline of the commune drawn as an administrative boundary
 * (Đôn Châu: the area of the plan is the closed "Ranh giới huyện" line; its "Lập quy hoạch" layer is only a legend sample).
 */
const ADMIN_BOUNDARY_LAYER = /ranhgioi(huyen|xa|phuong|thitran|hanhchinh)/;

/** Layer of the planning boundary in previews. */
export const BOUNDARY_LAYER = 'Ranh giới quy hoạch';

export interface BoundaryCandidate {
  ring: Vec2[];
  area: number;
  layer: string;
}

/** Largest closed outline (≥ 1 ha) on a planning-boundary layer of the drawing. */
export function findBoundary(doc: CadDocument): BoundaryCandidate | null {
  let best: BoundaryCandidate | null = null;
  const consider = (ring: Vec2[], layer: string) => {
    if (ring.length < 3) return;
    const area = ringArea(ring);
    if (area >= 1e4 && (!best || area > best.area)) best = { ring, area, layer };
  };
  const pieces = new Map<string, Vec2[][]>();
  for (const e of doc.entities) {
    if (!PLAN_BOUNDARY_LAYER.test(compactName(e.layer))) continue;
    if (e.kind === 'polyline') {
      if (isClosedLine(e.points, e.closed)) consider(e.points, e.layer);
      else {
        const list = pieces.get(e.layer);
        if (list) list.push(e.points);
        else pieces.set(e.layer, [e.points]);
      }
    } else if (e.kind === 'polygon') for (const r of e.rings) consider(r, e.layer);
  }
  // A boundary drawn in several pieces.
  for (const [layer, lines] of pieces) for (const ring of chainRings(lines).rings) consider(ring, layer);
  // A boundary left open by a small gap (Đôn Châu: BV_Rg_Lapquyhoach is one polyline that stops short of its start).
  for (const [layer, lines] of pieces)
    for (const pts of lines) {
      if (pts.length < 4) continue;
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
      if (gap <= length * 0.02) consider(pts, layer);
    }
  if (!best) {
    // No boundary layer at all: take the commune outline (≥ 100 ha).
    for (const e of doc.entities)
      if (e.kind === 'polyline' && ADMIN_BOUNDARY_LAYER.test(compactName(e.layer)) && isClosedLine(e.points, e.closed)) {
        const area = ringArea(e.points);
        if (area >= 1e6 && (!best || area > (best as BoundaryCandidate).area)) best = { ring: e.points, area, layer: e.layer };
      }
  }
  return best;
}

/**
 * The boundary of the whole folder: the outline found in most drawings (same area ± 0.5 %), else the largest.
 * Drawings reuse the same "ranh" xref, so the majority is the real one.
 */
export function pickBoundary(cands: (BoundaryCandidate | null)[]): BoundaryCandidate | null {
  const list = cands.filter((c): c is BoundaryCandidate => !!c);
  let best: BoundaryCandidate | null = null;
  let votes = -1;
  for (const c of list) {
    const v = list.filter((o) => Math.abs(o.area - c.area) <= c.area * 0.005).length;
    if (v > votes || (v === votes && best && c.area > best.area)) {
      best = c;
      votes = v;
    }
  }
  return best;
}

/**
 * Fast "is this point in the planning area" test: the ring rasterised on a grid; cells crossed by the ring
 * count as inside (a tolerance of one cell, ~1/600 of the extent), others by their centre.
 */
export class RegionMask {
  private cells: Uint8Array;
  private nx: number;
  private ny: number;
  private size: number;
  private x0: number;
  private y0: number;
  constructor(ring: Vec2[]) {
    const [x0, y0, x1, y1] = bboxOf(ring);
    this.size = Math.max(5, Math.max(x1 - x0, y1 - y0) / 600);
    this.x0 = x0 - this.size;
    this.y0 = y0 - this.size;
    this.nx = Math.ceil((x1 - x0) / this.size) + 3;
    this.ny = Math.ceil((y1 - y0) / this.size) + 3;
    this.cells = new Uint8Array(this.nx * this.ny);
    // Row scan: crossings of each row centre line → inside spans.
    for (let j = 0; j < this.ny; j++) {
      const y = this.y0 + (j + 0.5) * this.size;
      const xs: number[] = [];
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, ya] = ring[a];
        const [xb, yb] = ring[b];
        if (ya > y !== yb > y) xs.push(((xb - xa) * (y - ya)) / (yb - ya) + xa);
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / this.size - 0.5));
        const i1 = Math.min(this.nx - 1, Math.floor((xs[k + 1] - this.x0) / this.size - 0.5));
        for (let i = i0; i <= i1; i++) this.cells[j * this.nx + i] = 1;
      }
    }
    // Cells the ring passes through.
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[b];
      const [xb, yb] = ring[a];
      const steps = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya) / (this.size / 2)));
      for (let s = 0; s <= steps; s++) this.mark(xa + ((xb - xa) * s) / steps, ya + ((yb - ya) * s) / steps);
    }
  }
  private mark(x: number, y: number) {
    const i = Math.floor((x - this.x0) / this.size);
    const j = Math.floor((y - this.y0) / this.size);
    if (i >= 0 && j >= 0 && i < this.nx && j < this.ny) this.cells[j * this.nx + i] = 1;
  }
  contains([x, y]: Vec2): boolean {
    const i = Math.floor((x - this.x0) / this.size);
    const j = Math.floor((y - this.y0) / this.size);
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny && this.cells[j * this.nx + i] === 1;
  }
  /** A segment that passes through the area, ends outside or not. */
  crosses(a: Vec2, b: Vec2): boolean {
    const steps = Math.min(4000, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / this.size));
    for (let s = 0; s <= steps; s++) if (this.contains([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps])) return true;
    return false;
  }
}

/** Up to `max` evenly spaced vertices. */
function sample(pts: Vec2[], max = 48): Vec2[] {
  if (pts.length <= max) return pts;
  const out: Vec2[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.floor((i * (pts.length - 1)) / (max - 1))]);
  return out;
}

export function entityInside(e: CadEntity, mask: RegionMask): boolean {
  switch (e.kind) {
    case 'point':
    case 'text':
      return mask.contains(e.position);
    case 'table':
      return mask.contains(e.origin);
    case 'polyline': {
      if (sample(e.points).some((p) => mask.contains(p))) return true;
      // Both ends outside, the middle through the area (a route drawn as one long straight line): walk the segments.
      let walked = 0;
      for (let k = 1; k < e.points.length && walked < 20000; k++) {
        walked += 1;
        if (mask.crosses(e.points[k - 1], e.points[k])) return true;
      }
      return false;
    }
    case 'polygon': {
      const outer = e.rings.reduce((a, r) => (r.length > 2 && ringArea(r) > ringArea(a) ? r : a), e.rings[0] ?? []);
      if (outer.length < 3) return false;
      if (mask.contains(interiorPoint(outer))) return true;
      const s = sample(outer);
      return s.filter((p) => mask.contains(p)).length * 2 >= s.length;
    }
  }
}

/** 1 = entity inside the planning area (all ones when there is no boundary). */
export function insideFlags(doc: CadDocument, boundary: Vec2[] | null): Uint8Array {
  const flags = new Uint8Array(doc.entities.length);
  if (!boundary) return flags.fill(1);
  const mask = new RegionMask(boundary);
  doc.entities.forEach((e, i) => (flags[i] = entityInside(e, mask) ? 1 : 0));
  return flags;
}

export const KIND_OF: Record<CadEntity['kind'], GeomKind | null> = { polygon: 'A', polyline: 'L', point: 'P', text: 'T', table: null };

/**
 * Key of a mapping row: drawing × layer × geometry kind, plus the colour group (colorClass.ts colorKey) of a hatch
 * the colours of Phụ lục I tell apart. An empty colour keeps the plain three-part key (templates, tests).
 */
export const rowKey = (drawing: string, layer: string, kind: GeomKind, color = '') =>
  `${drawing}\u0001${layer}\u0001${kind}${color ? `\u0001${color}` : ''}`;

/**
 * The row an entity belongs to — the ONE place that decides it, shared by the mapping table, buildFeatures,
 * summaryDocument and the edit view so they never disagree. Null for entities no row covers (tables).
 */
export function entityRowKey(drawing: string, e: CadEntity, ctx?: ColorContext): string | null {
  const kind = KIND_OF[e.kind];
  return kind ? rowKey(drawing, e.layer, kind, rowGroup(e, ctx)) : null;
}

/** Group of the long wide lines on an annotation-named layer, kept apart from the rest of the layer (see wideLine). */
export const WIDE_LINE = 'wide';
const WIDE_MIN_WIDTH = 8;
const WIDE_MIN_LENGTH = 1000;

/**
 * A line drawn as a carriageway — wide (≥ 8 m) and long (≥ 1 km), open — on a layer whose name says annotation
 * ("TEXT", "KYHIEU"…). Such a layer holds arrows, frames and the like, so its lines are one row; but the route the
 * drawing marks with a wide dashed line on it (Đôn Châu 914C) is a road, and gets a row of its own to say so.
 */
export function wideLine(e: CadEntity): boolean {
  if (e.kind !== 'polyline' || e.closed || (e.width ?? 0) < WIDE_MIN_WIDTH || !isAnnotationLayer(compactName(e.layer))) return false;
  let len = 0;
  for (let k = 1; k < e.points.length && len < WIDE_MIN_LENGTH; k++) len += Math.hypot(e.points[k][0] - e.points[k - 1][0], e.points[k][1] - e.points[k - 1][1]);
  return len >= WIDE_MIN_LENGTH;
}

/** Colour group of a hatch, or the wide-line group of a polyline. */
const rowGroup = (e: CadEntity, ctx?: ColorContext): string => (wideLine(e) ? WIDE_LINE : ctx ? colorKey(e, ctx) : '');

export interface LayerRow {
  key: string;
  drawing: string;
  layer: string;
  kind: GeomKind;
  /** Entities inside the planning area. */
  count: number;
  /** All entities of the layer × kind in the drawing. */
  total: number;
  /** L rows: polylines inside that enclose an area (closed flag, or last vertex on the first). */
  closed: number;
  /** L rows: further areas made of open pieces whose ends meet (chainRings) — what a vùng class gets besides `closed`. */
  chained: number;
  /** L rows: open pieces that close no area (dropped when the row goes to a vùng class). */
  openLeft: number;
  /** T rows: share of texts that are numbers (elevations). */
  numericShare: number;
  /** T rows: a few distinct texts. */
  samples: string[];
  color: string;
  /** A rows of a land-use map the colours of Phụ lục I tell apart: the colour group ('c<rrggbb>'), else ''. */
  colorKey: string;
  /** L rows of the long wide lines on an annotation-named layer (WIDE_LINE): a row of their own. */
  wide?: boolean;
  /** What that colour stands for (Số N, land use, confidence) — set when colorKey is. */
  colorMatch?: ColorInfo;
  /** Hatches of the group whose label text names another land use than the colour ("KHU THƯƠNG MẠI…" on số 34). */
  labelConflicts?: number;
}

const NUMERIC = /^[+\-±]?\d{1,4}([.,]\d{1,3})?$/;

export function layerRows(drawing: string, doc: CadDocument, flags: Uint8Array, ctx?: ColorContext): LayerRow[] {
  const rows = new Map<string, LayerRow & { numeric: number }>();
  let labels: ReturnType<typeof labelIndex> | null = null;
  const colorOf = new Map(doc.layers.map((l) => [l.name, l.color]));
  const open = new Map<string, Vec2[][]>();
  doc.entities.forEach((e, i) => {
    const kind = KIND_OF[e.kind];
    if (!kind) return;
    const wide = wideLine(e);
    const group = wide ? '' : ctx ? colorKey(e, ctx) : '';
    const key = rowKey(drawing, e.layer, kind, wide ? WIDE_LINE : group);
    let r = rows.get(key);
    if (!r) {
      const info = group ? describeColorKey(group, ctx!.section) : null;
      r = {
        key, drawing, layer: e.layer, kind, count: 0, total: 0, closed: 0, chained: 0, openLeft: 0, numericShare: 0, samples: [],
        color: (group && keyColor(group)) || (colorOf.get(e.layer) ?? e.color), colorKey: group, colorMatch: info ?? undefined, numeric: 0,
        ...(wide ? { wide: true } : {}),
      };
      rows.set(key, r);
    }
    r.total++;
    if (!flags[i]) return;
    r.count++;
    if (e.kind === 'polygon' && r.colorMatch && (r.colorMatch.level === 'exact' || r.colorMatch.level === 'near')) {
      const text = (labels ??= labelIndex({ doc, inside: flags })) && labelIn(labels, e.rings);
      const use = text ? landUseOf(compactName(text)) : null;
      if (use && !sameLandUse(use, r.colorMatch.landUse)) r.labelConflicts = (r.labelConflicts ?? 0) + 1;
    }
    if (e.kind === 'polyline') {
      if (isClosedLine(e.points, e.closed)) r.closed++;
      else {
        const list = open.get(key);
        if (list) list.push(e.points);
        else open.set(key, [e.points]);
      }
    }
    if (e.kind === 'text') {
      const t = e.text.replace(/\s+/g, ' ').trim();
      if (NUMERIC.test(t)) r.numeric++;
      if (r.samples.length < 4 && t && !r.samples.includes(t)) r.samples.push(t.slice(0, 60));
    }
  });
  for (const [key, lines] of open) {
    const r = rows.get(key)!;
    const { rings, used } = chainRings(lines);
    r.chained = rings.length;
    r.openLeft = lines.length - used;
  }
  return [...rows.values()].map(({ numeric, ...r }) => ({ ...r, numericShare: r.count ? numeric / r.count : 0 }));
}

/** Texts of a drawing (for the role guess). */
export const drawingTexts = (doc: CadDocument) => doc.entities.flatMap((e) => (e.kind === 'text' ? [e.text] : []));


/** Handle of a previewed object: its index in the drawing ("e123"), so the page can exclude it from the export. */
export const previewHandle = (index: number) => `e${index}`;
/** Index of a previewed object (null for the boundary and other added outlines). */
export function previewIndex(handle: string | undefined): number | null {
  const m = handle ? /^e(\d+)$/.exec(handle) : null;
  return m ? Number(m[1]) : null;
}
