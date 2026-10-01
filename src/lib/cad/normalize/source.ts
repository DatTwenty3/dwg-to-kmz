// Format-neutral "source" model produced by the DWG and DXF adapters and consumed by `buildDocument`.
// Angles are radians (CCW). Coordinates are those of the owning container (model space or block),
// in the entity's OCS when `extrusion` is set (the builder applies the OCS→WCS matrix).
import type { HAlign, VAlign, Vec2 } from '../types';
import type { Vec3 } from './matrix';

/** aci: 0 = ByBlock, 256 = ByLayer, 1..255 = index. rgb (true colour) wins when present. */
export interface SrcColor {
  aci: number;
  rgb?: number;
}

export interface SrcVertex {
  x: number;
  y: number;
  bulge?: number;
}

export interface SrcCommon {
  handle?: string;
  layer: string;
  color: SrcColor;
  /** Present only for OCS-based entities with a non-default extrusion. */
  extrusion?: Vec3;
}

export interface SrcLine extends SrcCommon {
  type: 'line';
  a: Vec2;
  b: Vec2;
}
export interface SrcPolyline extends SrcCommon {
  type: 'polyline';
  vertices: SrcVertex[];
  closed: boolean;
  width?: number;
}
export interface SrcCircle extends SrcCommon {
  type: 'circle';
  center: Vec2;
  radius: number;
}
export interface SrcArc extends SrcCommon {
  type: 'arc';
  center: Vec2;
  radius: number;
  start: number;
  end: number;
}
export interface SrcEllipse extends SrcCommon {
  type: 'ellipse';
  center: Vec2;
  /** Major-axis end point relative to the centre. */
  majorAxis: Vec2;
  ratio: number;
  start: number;
  end: number;
}
export interface SrcSpline extends SrcCommon {
  type: 'spline';
  degree: number;
  knots: number[];
  controlPoints: Vec2[];
  weights?: number[];
  fitPoints: Vec2[];
  closed: boolean;
}
export interface SrcPoint extends SrcCommon {
  type: 'point';
  position: Vec2;
}
export interface SrcSolid extends SrcCommon {
  type: 'solid';
  /** DXF order (1,2,3,4) — drawn as 1-2-4-3. */
  corners: Vec2[];
}

export type SrcEdge =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'arc'; center: Vec2; radius: number; start: number; end: number; ccw: boolean }
  | { type: 'ellipse'; center: Vec2; majorAxis: Vec2; ratio: number; start: number; end: number; ccw: boolean }
  | { type: 'spline'; degree: number; knots: number[]; controlPoints: Vec2[]; weights?: number[]; fitPoints: Vec2[] };

export type SrcLoop = { kind: 'poly'; vertices: SrcVertex[]; closed: boolean } | { kind: 'edges'; edges: SrcEdge[] };

export interface SrcHatch extends SrcCommon {
  type: 'hatch';
  solid: boolean;
  pattern: string;
  loops: SrcLoop[];
}

export interface SrcText extends SrcCommon {
  type: 'text';
  raw: string;
  style: string;
  isMText: boolean;
  position: Vec2;
  height: number;
  rotation: number;
  hAlign: HAlign;
  vAlign: VAlign;
}

export interface SrcInsert extends SrcCommon {
  type: 'insert';
  block: string;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  cols: number;
  rows: number;
  colSpacing: number;
  rowSpacing: number;
}

export interface SrcTableCell {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  raw: string;
  style: string;
}

export interface SrcTable extends SrcCommon {
  type: 'table';
  /** Insertion point = top-left corner. */
  origin: Vec2;
  /** Horizontal direction (unit vector). */
  direction: Vec2;
  rowHeights: number[];
  colWidths: number[];
  cells: SrcTableCell[];
  /** Anonymous *T block holding the table graphics (fallback). */
  block?: string;
  defaultStyle: string;
}

export interface SrcUnsupported extends SrcCommon {
  type: 'unsupported';
  name: string;
}

export type SrcEntity =
  | SrcLine
  | SrcPolyline
  | SrcCircle
  | SrcArc
  | SrcEllipse
  | SrcSpline
  | SrcPoint
  | SrcSolid
  | SrcHatch
  | SrcText
  | SrcInsert
  | SrcTable
  | SrcUnsupported;

export interface SrcBlock {
  name: string;
  base: Vec2;
  entities: SrcEntity[];
}

export interface SrcLayer {
  name: string;
  color: SrcColor;
  visible: boolean;
}

export interface SrcDocument {
  units: string;
  /** $DWGCODEPAGE, e.g. 'ANSI_1258'. */
  codepage?: string;
  /**
   * Text strings (SrcText.raw, table cells) are byte strings — one char per raw 8-bit byte —
   * to be decoded by the text module with `codepage` (pre-R2007 files).
   */
  legacyBytes?: boolean;
  layers: SrcLayer[];
  /** STYLE table: name → font file (may be empty). */
  styles: Map<string, string>;
  blocks: Map<string, SrcBlock>;
  /** Model-space entities only. */
  entities: SrcEntity[];
  warnings: string[];
}

/** $INSUNITS → unit name. */
export function insunitsToName(code: number | undefined): string {
  switch (code) {
    case 1:
      return 'in';
    case 2:
      return 'ft';
    case 3:
      return 'mi';
    case 4:
      return 'mm';
    case 5:
      return 'cm';
    case 6:
      return 'm';
    case 7:
      return 'km';
    case 8:
      return 'microinch';
    case 9:
      return 'mil';
    case 10:
      return 'yd';
    case 14:
      return 'dm';
    default:
      return 'unitless';
  }
}

const H_FROM_TEXT: HAlign[] = ['left', 'center', 'right'];
const V_FROM_TEXT: VAlign[] = ['baseline', 'bottom', 'middle', 'top'];

/**
 * TEXT/ATTRIB justification → anchor point and alignment.
 * halign: 0 left, 1 center, 2 right, 3 aligned, 4 middle, 5 fit; valign: 0 baseline, 1 bottom, 2 middle, 3 top.
 */
export function textAnchor(
  start: Vec2,
  end: Vec2 | undefined,
  halign: number,
  valign: number,
  rotation: number,
): { position: Vec2; hAlign: HAlign; vAlign: VAlign; rotation: number } {
  const h = halign | 0;
  const v = valign | 0;
  if ((h === 0 && v === 0) || !end) return { position: start, hAlign: 'left', vAlign: 'baseline', rotation };
  if (h === 3 || h === 5) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const rot = Math.hypot(dx, dy) > 1e-12 ? Math.atan2(dy, dx) : rotation;
    return { position: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], hAlign: 'center', vAlign: 'baseline', rotation: rot };
  }
  if (h === 4) return { position: end, hAlign: 'center', vAlign: 'middle', rotation };
  return { position: end, hAlign: H_FROM_TEXT[h] ?? 'left', vAlign: V_FROM_TEXT[v] ?? 'baseline', rotation };
}

/** MTEXT attachment point 1..9 → alignment. */
export function mtextAlign(attachment: number): { hAlign: HAlign; vAlign: VAlign } {
  const a = attachment >= 1 && attachment <= 9 ? attachment : 1;
  const row = Math.floor((a - 1) / 3);
  const col = (a - 1) % 3;
  return { hAlign: H_FROM_TEXT[col], vAlign: (['top', 'middle', 'bottom'] as VAlign[])[row] };
}
