// Raw DXF group-code entities → SrcEntity. DXF angles: degrees for ARC/TEXT/INSERT/hatch edges,
// radians (parameters) for ELLIPSE. MTEXT direction vector preferred over its rotation.
import type { Vec2 } from '../types';
import type { Vec3 } from '../normalize/matrix';
import {
  type SrcColor,
  type SrcEdge,
  type SrcEntity,
  type SrcLoop,
  type SrcTable,
  type SrcTableCell,
  type SrcText,
  type SrcVertex,
  mtextAlign,
  textAnchor,
} from '../normalize/source';
import { Cursor, type Group, type GroupValue, type RawEntity, firstValues, toNum } from './groups';

const DEG = Math.PI / 180;

type First = Map<number, GroupValue>;

const n = (f: First, code: number, d = 0) => toNum(f.get(code), d);
const s = (f: First, code: number, d = '') => {
  const v = f.get(code);
  return v === undefined ? d : String(v);
};
const pt = (f: First, code: number): Vec2 => [n(f, code), n(f, code + 10)];
const has = (f: First, code: number) => f.has(code);

function extrusion(f: First): Vec3 | undefined {
  if (!has(f, 210) && !has(f, 220) && !has(f, 230)) return undefined;
  const x = n(f, 210);
  const y = n(f, 220);
  const z = n(f, 230, 1);
  if (x === 0 && y === 0 && z >= 0) return undefined;
  return { x, y, z };
}

function color(f: First): SrcColor {
  const aci = Math.abs(n(f, 62, 256));
  if (has(f, 420)) return { aci: aci === 256 || aci === 0 ? 7 : aci, rgb: n(f, 420) & 0xffffff };
  return { aci };
}

export interface ConvertContext {
  /** Name normaliser for layers (legacy byte strings → Unicode). */
  layerName(raw: string): string;
  /** Count of entities skipped because they belong to paper space. */
  paperSpace: number;
}

/** Text split across chunk groups (MTEXT: 3; table cells: 2/3) followed by the final group 1. */
function joinedText(groups: Group[], from = 0, to = groups.length, chunkCodes: readonly number[] = [3]): string {
  let pre = '';
  let last = '';
  for (let i = from; i < to; i++) {
    const g = groups[i];
    if (chunkCodes.includes(g.code)) pre += String(g.value);
    else if (g.code === 1) last = String(g.value);
  }
  return pre + last;
}

function lwVertices(groups: Group[]): SrcVertex[] {
  const out: SrcVertex[] = [];
  let cur: SrcVertex | null = null;
  for (const g of groups) {
    if (g.code === 10) {
      cur = { x: toNum(g.value), y: 0, bulge: 0 };
      out.push(cur);
    } else if (cur && g.code === 20) cur.y = toNum(g.value);
    else if (cur && g.code === 42) cur.bulge = toNum(g.value);
  }
  return out;
}

function readEdge(c: Cursor): SrcEdge | null {
  const type = c.num(72, -1);
  switch (type) {
    case 1: {
      const a: Vec2 = [c.num(10), c.num(20)];
      const b: Vec2 = [c.num(11), c.num(21)];
      return { type: 'line', a, b };
    }
    case 2: {
      const center: Vec2 = [c.num(10), c.num(20)];
      const radius = c.num(40);
      const start = c.num(50) * DEG;
      const end = c.num(51) * DEG;
      const ccw = c.num(73, 1) !== 0;
      return { type: 'arc', center, radius, start, end, ccw };
    }
    case 3: {
      const center: Vec2 = [c.num(10), c.num(20)];
      const majorAxis: Vec2 = [c.num(11), c.num(21)];
      const ratio = c.num(40, 1);
      const start = c.num(50) * DEG;
      const end = c.num(51, 360) * DEG;
      const ccw = c.num(73, 1) !== 0;
      return { type: 'ellipse', center, majorAxis, ratio, start, end, ccw };
    }
    case 4: {
      const degree = c.num(94, 3);
      const rational = c.num(73) !== 0;
      c.take(74);
      const nk = c.num(95);
      const nc = c.num(96);
      const knots: number[] = [];
      for (let i = 0; i < nk; i++) knots.push(c.num(40));
      const controlPoints: Vec2[] = [];
      const weights: number[] = [];
      for (let i = 0; i < nc; i++) {
        controlPoints.push([c.num(10), c.num(20)]);
        const w = c.take(42);
        weights.push(w === undefined ? 1 : toNum(w, 1));
      }
      const fitPoints: Vec2[] = [];
      const nf = c.num(97);
      for (let i = 0; i < nf; i++) fitPoints.push([c.num(11), c.num(21)]);
      c.take(12);
      c.take(22);
      c.take(13);
      c.take(23);
      return { type: 'spline', degree, knots, controlPoints, weights: rational ? weights : undefined, fitPoints };
    }
    default:
      return null;
  }
}

/** Sequential HATCH boundary parsing (group codes repeat between sections, so order matters). */
export function parseHatchLoops(groups: Group[]): SrcLoop[] {
  const c = new Cursor(groups);
  if (!c.seek(91)) return [];
  const nLoops = c.num(91);
  const loops: SrcLoop[] = [];
  for (let li = 0; li < nLoops; li++) {
    if (!c.seek(92)) break;
    const flag = c.num(92);
    if (flag & 2) {
      const hasBulge = c.num(72) !== 0;
      const closed = c.num(73, 1) !== 0;
      const nv = c.num(93);
      const vertices: SrcVertex[] = [];
      for (let i = 0; i < nv; i++) {
        const x = c.num(10);
        const y = c.num(20);
        const b = hasBulge ? c.num(42) : toNum(c.take(42));
        vertices.push({ x, y, bulge: b });
      }
      void closed; // hatch boundaries are always closed
      loops.push({ kind: 'poly', vertices, closed: true });
    } else {
      const ne = c.num(93);
      const edges: SrcEdge[] = [];
      for (let i = 0; i < ne; i++) {
        if (!c.seek(72)) break;
        const e = readEdge(c);
        if (e) edges.push(e);
      }
      loops.push({ kind: 'edges', edges });
    }
    // Source boundary object references
    const ns = c.take(97);
    if (ns !== undefined) for (let i = 0; i < toNum(ns); i++) c.take(330);
  }
  return loops;
}

/** ACAD_TABLE (legacy per-cell groups 171…). */
export function parseTable(groups: Group[], common: { layer: string; color: SrcColor; handle?: string }): SrcTable {
  let i = 0;
  let block: string | undefined;
  let origin: Vec2 = [0, 0];
  let direction: Vec2 = [1, 0];
  let rows = 0;
  let cols = 0;
  const rowHeights: number[] = [];
  const colWidths: number[] = [];
  // Header part: until the first cell (171).
  for (; i < groups.length; i++) {
    const g = groups[i];
    if (g.code === 171) break;
    switch (g.code) {
      case 2:
        if (block === undefined) block = String(g.value);
        break;
      case 10:
        origin = [toNum(g.value), origin[1]];
        break;
      case 20:
        origin = [origin[0], toNum(g.value)];
        break;
      case 11:
        direction = [toNum(g.value), direction[1]];
        break;
      case 21:
        direction = [direction[0], toNum(g.value)];
        break;
      case 91:
        if (!rows) rows = toNum(g.value);
        break;
      case 92:
        if (!cols) cols = toNum(g.value);
        break;
      case 141:
        rowHeights.push(toNum(g.value));
        break;
      case 142:
        colWidths.push(toNum(g.value));
        break;
    }
  }
  // Cells: each starts at 171.
  interface RawCell {
    colSpan: number;
    rowSpan: number;
    merged: boolean;
    text: string;
    style: string;
  }
  const rawCells: RawCell[] = [];
  while (i < groups.length && groups[i].code === 171) {
    let j = i + 1;
    while (j < groups.length && groups[j].code !== 171) j++;
    const f = firstValues(groups.slice(i, j));
    let text = joinedText(groups, i, j, [2, 3]);
    if (!text) {
      // R2010+ content blocks
      const parts = groups.slice(i, j).filter((g) => g.code === 302).map((g) => String(g.value));
      text = parts.join('');
    }
    rawCells.push({
      colSpan: Math.max(1, n(f, 175, 1)),
      rowSpan: Math.max(1, n(f, 176, 1)),
      merged: n(f, 173) !== 0,
      text,
      style: s(f, 7, ''),
    });
    i = j;
  }
  const ok = rows > 0 && cols > 0 && rowHeights.length >= rows && colWidths.length >= cols && rawCells.length >= rows * cols;
  const cells: SrcTableCell[] = [];
  if (ok) {
    const covered = new Set<number>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (covered.has(idx)) continue;
        const rc = rawCells[idx];
        const colSpan = Math.min(rc.colSpan, cols - c);
        const rowSpan = Math.min(rc.rowSpan, rows - r);
        for (let rr = r; rr < r + rowSpan; rr++)
          for (let cc = c; cc < c + colSpan; cc++) if (rr !== r || cc !== c) covered.add(rr * cols + cc);
        cells.push({ r, c, rowSpan, colSpan, raw: rc.text, style: rc.style || 'Standard' });
      }
    }
  }
  return {
    ...common,
    type: 'table',
    origin,
    direction,
    rowHeights: ok ? rowHeights.slice(0, rows) : [],
    colWidths: ok ? colWidths.slice(0, cols) : [],
    cells,
    block,
    defaultStyle: 'Standard',
  };
}

function textEntity(groups: Group[], common: { layer: string; color: SrcColor; handle?: string }, vCode: number): SrcText | null {
  // ATTRIB/ATTDEF may embed an MTEXT after "101 Embedded Object" — ignore that tail.
  const cut = groups.findIndex((g) => g.code === 101);
  const gs = cut >= 0 ? groups.slice(0, cut) : groups;
  const f = firstValues(gs);
  const raw = s(f, 1);
  if (!raw) return null;
  const anchor = textAnchor(pt(f, 10), has(f, 11) ? pt(f, 11) : undefined, n(f, 72), n(f, vCode), n(f, 50) * DEG);
  return {
    ...common,
    type: 'text',
    extrusion: extrusion(f),
    raw,
    style: s(f, 7, 'Standard'),
    isMText: false,
    position: anchor.position,
    height: n(f, 40, 1),
    rotation: anchor.rotation,
    hAlign: anchor.hAlign,
    vAlign: anchor.vAlign,
  };
}

/**
 * Convert a container's raw entity list (ENTITIES section or one block).
 * Handles POLYLINE/VERTEX/SEQEND sequences and INSERT/ATTRIB/SEQEND.
 */
export function convertRawList(list: RawEntity[], ctx: ConvertContext, isModelSpace: boolean): SrcEntity[] {
  const out: SrcEntity[] = [];
  let lastInsertColor: SrcColor | null = null;
  for (let k = 0; k < list.length; k++) {
    const raw = list[k];
    const f = firstValues(raw.groups);
    if (isModelSpace && n(f, 67) === 1) {
      ctx.paperSpace++;
      // Skip trailing VERTEX/ATTRIB/SEQEND of a paper-space POLYLINE/INSERT.
      while (k + 1 < list.length && ['VERTEX', 'ATTRIB', 'SEQEND'].includes(list[k + 1].type)) k++;
      continue;
    }
    if (n(f, 60) === 1) continue; // invisible
    const handle = has(f, 5) ? s(f, 5) : undefined;
    const common = { layer: ctx.layerName(s(f, 8, '0')), color: color(f), handle };
    switch (raw.type) {
      case 'LINE':
        out.push({ ...common, type: 'line', a: pt(f, 10), b: pt(f, 11) });
        break;
      case 'LWPOLYLINE':
        out.push({
          ...common,
          type: 'polyline',
          extrusion: extrusion(f),
          vertices: lwVertices(raw.groups),
          closed: (n(f, 70) & 1) !== 0,
          width: n(f, 43) || undefined,
        });
        break;
      case 'POLYLINE': {
        const flag = n(f, 70);
        const verts: SrcVertex[] = [];
        while (k + 1 < list.length && list[k + 1].type === 'VERTEX') {
          k++;
          const vf = firstValues(list[k].groups);
          if (n(vf, 70) & 16) continue; // spline frame control point
          verts.push({ x: n(vf, 10), y: n(vf, 20), bulge: flag & 8 ? 0 : n(vf, 42) });
        }
        if (k + 1 < list.length && list[k + 1].type === 'SEQEND') k++;
        if (flag & (16 | 64)) {
          out.push({ ...common, type: 'unsupported', name: flag & 64 ? 'POLYFACE_MESH' : 'POLYGON_MESH' });
          break;
        }
        const sw = n(f, 40);
        out.push({
          ...common,
          type: 'polyline',
          extrusion: flag & 8 ? undefined : extrusion(f),
          vertices: verts,
          closed: (flag & 1) !== 0,
          width: sw && sw === n(f, 41) ? sw : undefined,
        });
        break;
      }
      case 'VERTEX':
      case 'SEQEND':
        break;
      case 'CIRCLE':
        out.push({ ...common, type: 'circle', extrusion: extrusion(f), center: pt(f, 10), radius: n(f, 40) });
        break;
      case 'ARC':
        out.push({
          ...common,
          type: 'arc',
          extrusion: extrusion(f),
          center: pt(f, 10),
          radius: n(f, 40),
          start: n(f, 50) * DEG,
          end: n(f, 51) * DEG,
        });
        break;
      case 'ELLIPSE': {
        const flip = n(f, 230, 1) < 0 ? -1 : 1;
        out.push({
          ...common,
          type: 'ellipse',
          center: pt(f, 10),
          majorAxis: pt(f, 11),
          ratio: n(f, 40, 1) * flip,
          start: n(f, 41, 0),
          end: n(f, 42, Math.PI * 2),
        });
        break;
      }
      case 'SPLINE': {
        const knots: number[] = [];
        const weights: number[] = [];
        const cps: Vec2[] = [];
        const fit: Vec2[] = [];
        for (const g of raw.groups) {
          if (g.code === 40) knots.push(toNum(g.value));
          else if (g.code === 41) weights.push(toNum(g.value));
          else if (g.code === 10) cps.push([toNum(g.value), 0]);
          else if (g.code === 20 && cps.length) cps[cps.length - 1][1] = toNum(g.value);
          else if (g.code === 11) fit.push([toNum(g.value), 0]);
          else if (g.code === 21 && fit.length) fit[fit.length - 1][1] = toNum(g.value);
        }
        out.push({
          ...common,
          type: 'spline',
          degree: n(f, 71, 3),
          knots,
          controlPoints: cps,
          weights: weights.length ? weights : undefined,
          fitPoints: fit,
          closed: (n(f, 70) & 1) !== 0,
        });
        break;
      }
      case 'POINT':
        out.push({ ...common, type: 'point', position: pt(f, 10) });
        break;
      case 'SOLID':
      case 'TRACE': {
        const corners = [pt(f, 10), pt(f, 11), pt(f, 12)];
        if (has(f, 13)) corners.push(pt(f, 13));
        out.push({ ...common, type: 'solid', extrusion: extrusion(f), corners });
        break;
      }
      case 'HATCH': {
        const solid = n(f, 70) === 1 || n(f, 450) === 1;
        out.push({ ...common, type: 'hatch', extrusion: extrusion(f), solid, pattern: s(f, 2), loops: parseHatchLoops(raw.groups) });
        break;
      }
      case 'TEXT': {
        const t = textEntity(raw.groups, common, 73);
        if (t) out.push(t);
        break;
      }
      case 'ATTRIB': {
        if (n(f, 70) & 1) break;
        const c = common.color.aci === 0 && common.color.rgb === undefined && lastInsertColor ? lastInsertColor : common.color;
        const t = textEntity(raw.groups, { ...common, color: c }, 74);
        if (t) out.push(t);
        break;
      }
      case 'ATTDEF': {
        const flags = n(f, 70);
        if (!isModelSpace && flags & 2 && !(flags & 1)) {
          const t = textEntity(raw.groups, common, 74);
          if (t) out.push(t);
        }
        break;
      }
      case 'MTEXT': {
        const raw1 = joinedText(raw.groups);
        if (!raw1) break;
        const dir: Vec2 = has(f, 11) ? pt(f, 11) : [0, 0];
        const rotation = Math.hypot(dir[0], dir[1]) > 1e-12 ? Math.atan2(dir[1], dir[0]) : n(f, 50) * DEG;
        const al = mtextAlign(n(f, 71, 1));
        out.push({
          ...common,
          type: 'text',
          raw: raw1,
          style: s(f, 7, 'Standard'),
          isMText: true,
          position: pt(f, 10),
          height: n(f, 40, 1),
          rotation,
          hAlign: al.hAlign,
          vAlign: al.vAlign,
        });
        break;
      }
      case 'INSERT': {
        lastInsertColor = common.color;
        out.push({
          ...common,
          type: 'insert',
          extrusion: extrusion(f),
          block: s(f, 2),
          position: pt(f, 10),
          scale: [n(f, 41, 1), n(f, 42, 1)],
          rotation: n(f, 50) * DEG,
          cols: Math.max(1, n(f, 70, 1)),
          rows: Math.max(1, n(f, 71, 1)),
          colSpacing: n(f, 44),
          rowSpacing: n(f, 45),
        });
        break;
      }
      case 'DIMENSION': {
        const name = s(f, 2);
        if (!name) {
          out.push({ ...common, type: 'unsupported', name: 'DIMENSION' });
          break;
        }
        out.push({ ...common, type: 'insert', block: name, position: [0, 0], scale: [1, 1], rotation: 0, cols: 1, rows: 1, colSpacing: 0, rowSpacing: 0 });
        break;
      }
      case 'ACAD_TABLE':
        out.push(parseTable(raw.groups, common));
        break;
      default:
        out.push({ ...common, type: 'unsupported', name: raw.type });
        break;
    }
  }
  return out;
}
