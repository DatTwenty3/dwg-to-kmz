// Inventory of the drawings of a "lấy ý kiến" folder: the planning boundary (ranh lập quy hoạch), which entities
// lie inside it (legend swatches, title blocks, cross-sections and frames lie outside and are left out), and one
// row per layer × geometry kind with its counts — the rows of the mapping table.
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { bboxOf, chainRings, interiorPoint, isClosedLine, ringArea } from './geometry';
import { compactName, type GeomKind } from './suggest';

/** Layer names of the planning boundary ("BV_Rg_Lapquyhoach", "Ranh giới lập quy hoạch", "RANH QH"…). */
export const PLAN_BOUNDARY_LAYER = /rglap|ranh\w*lap|lapquyhoach|ranhquyhoach|ranhqh\b|rgqh|ranhnghiencuu|phamvinghiencuu|ranhgioilapqh/;

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
    case 'polyline':
      return sample(e.points).some((p) => mask.contains(p));
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

export const rowKey = (drawing: string, layer: string, kind: GeomKind) => `${drawing}\u0001${layer}\u0001${kind}`;

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
}

const NUMERIC = /^[+\-±]?\d{1,4}([.,]\d{1,3})?$/;

export function layerRows(drawing: string, doc: CadDocument, flags: Uint8Array): LayerRow[] {
  const rows = new Map<string, LayerRow & { numeric: number }>();
  const colorOf = new Map(doc.layers.map((l) => [l.name, l.color]));
  const open = new Map<string, Vec2[][]>();
  doc.entities.forEach((e, i) => {
    const kind = KIND_OF[e.kind];
    if (!kind) return;
    const key = rowKey(drawing, e.layer, kind);
    let r = rows.get(key);
    if (!r) {
      r = { key, drawing, layer: e.layer, kind, count: 0, total: 0, closed: 0, chained: 0, openLeft: 0, numericShare: 0, samples: [], color: colorOf.get(e.layer) ?? e.color, numeric: 0 };
      rows.set(key, r);
    }
    r.total++;
    if (!flags[i]) return;
    r.count++;
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
