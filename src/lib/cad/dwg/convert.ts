// DwgDatabase (libredwg-web) → SrcDocument. Angles from libredwg are radians.
import type {
  DwgArcEdge,
  DwgAttdefEntity,
  DwgAttribEntity,
  DwgBoundaryPath,
  DwgBoundaryPathEdge,
  DwgDatabase,
  DwgEllipseEdge,
  DwgEntity,
  DwgInsertEntity,
  DwgLineEdge,
  DwgSplineEdge,
  DwgTableEntity,
  DwgTextBase,
} from '@mlightcad/libredwg-web';
import type { Vec2 } from '../types';
import type { Vec3 } from '../normalize/matrix';
import {
  type SrcBlock,
  type SrcColor,
  type SrcDocument,
  type SrcEdge,
  type SrcEntity,
  type SrcLayer,
  type SrcLoop,
  type SrcTableCell,
  type SrcText,
  insunitsToName,
  mtextAlign,
  textAnchor,
} from '../normalize/source';

type AnyEnt = DwgEntity & Record<string, unknown>;
interface P2 {
  x: number;
  y: number;
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const v2 = (p: P2 | undefined | null): Vec2 => [num(p?.x), num(p?.y)];

/** OCS extrusion if it is not the default +Z (zero vectors are treated as default). */
function extrusionOf(e: { extrusionDirection?: Vec3 | null }): Vec3 | undefined {
  const n = e.extrusionDirection;
  if (!n) return undefined;
  const x = num(n.x);
  const y = num(n.y);
  const z = num(n.z);
  if (x === 0 && y === 0 && z >= 0) return undefined;
  if (x === 0 && y === 0 && z === 0) return undefined;
  return { x, y, z };
}

function colorOf(e: { colorIndex?: number; color?: number }): SrcColor {
  const aci = typeof e.colorIndex === 'number' ? Math.abs(e.colorIndex) : 256;
  const rgb = e.color;
  // libredwg sets `color` only for true colours; rgb 0 alongside a real ACI index is noise.
  if (typeof rgb === 'number' && !(rgb === 0 && aci >= 1 && aci <= 255)) return { aci, rgb };
  return { aci };
}

/** Dwg_Code_Page enum → $DWGCODEPAGE-style name. */
const CODEPAGE_NAMES: Record<number, string> = {
  0: 'UTF8',
  1: 'US_ASCII',
  2: 'ISO_8859_1',
  28: 'ANSI_1250',
  29: 'ANSI_1251',
  30: 'ANSI_1252',
  32: 'ANSI_1253',
  33: 'ANSI_1254',
  34: 'ANSI_1255',
  35: 'ANSI_1256',
  36: 'ANSI_1257',
  37: 'ANSI_874',
  38: 'ANSI_932',
  39: 'ANSI_936',
  40: 'ANSI_949',
  41: 'ANSI_950',
  42: 'ANSI_1361',
  43: 'UTF16',
  44: 'ANSI_1258',
};

export function codepageName(header: string | undefined, enumValue: number | undefined): string | undefined {
  if (header && header.trim()) return header.trim();
  if (enumValue === undefined) return undefined;
  return CODEPAGE_NAMES[enumValue];
}

/**
 * libredwg-web decodes pre-R2007 8-bit strings with TextDecoder(windows-125x). Build the inverse
 * map so the original bytes can be handed to the text module (TCVN3/VNI detection needs bytes).
 */
export function makeByteStringEncoder(encoding: string): ((s: string) => string) | null {
  let dec: TextDecoder;
  try {
    dec = new TextDecoder(encoding);
  } catch {
    return null;
  }
  const inv = new Map<string, number>();
  for (let b = 0; b < 256; b++) {
    const ch = dec.decode(new Uint8Array([b]));
    if (ch.length === 1 && !inv.has(ch)) inv.set(ch, b);
  }
  return (s: string) => {
    let out = '';
    for (const ch of s) {
      const b = inv.get(ch);
      if (b === undefined) return s; // not representable: keep the decoded string
      out += String.fromCharCode(b);
    }
    return out;
  };
}

class DwgConverter {
  constructor(private readonly encodeRaw: (s: string) => string = (s) => s) {}


  textFrom(base: DwgTextBase | undefined, common: { layer: string; color: SrcColor; handle?: string }): SrcText | null {
    if (!base || typeof base.text !== 'string' || base.text === '') return null;
    const anchor = textAnchor(
      v2(base.startPoint),
      base.endPoint ? v2(base.endPoint) : undefined,
      num(base.halign),
      num(base.valign),
      num(base.rotation),
    );
    return {
      ...common,
      type: 'text',
      extrusion: extrusionOf(base),
      raw: this.encodeRaw(base.text),
      style: base.styleName || 'Standard',
      isMText: false,
      position: anchor.position,
      height: num(base.textHeight, 1),
      rotation: anchor.rotation,
      hAlign: anchor.hAlign,
      vAlign: anchor.vAlign,
    };
  }

  edge(e: DwgBoundaryPathEdge): SrcEdge | null {
    switch (e.type) {
      case 1: {
        const l = e as DwgLineEdge;
        return { type: 'line', a: v2(l.start), b: v2(l.end) };
      }
      case 2: {
        const a = e as DwgArcEdge;
        return {
          type: 'arc',
          center: v2(a.center),
          radius: num(a.radius),
          start: num(a.startAngle),
          end: num(a.endAngle),
          ccw: a.isCCW === undefined ? true : !!a.isCCW,
        };
      }
      case 3: {
        const el = e as DwgEllipseEdge;
        return {
          type: 'ellipse',
          center: v2(el.center),
          majorAxis: v2(el.end),
          ratio: num(el.lengthOfMinorAxis, 1),
          start: num(el.startAngle),
          end: num(el.endAngle, Math.PI * 2),
          ccw: el.isCCW === undefined ? true : !!el.isCCW,
        };
      }
      case 4: {
        const s = e as DwgSplineEdge;
        const cps = (s.controlPoints ?? []) as (P2 & { weight?: number; w?: number })[];
        const weights = cps.map((c) => num(c.weight ?? c.w, 1));
        return {
          type: 'spline',
          degree: num(s.degree, 3),
          knots: s.knots ?? [],
          controlPoints: cps.map(v2),
          weights: weights.some((w) => w !== 1) ? weights : undefined,
          fitPoints: (s.fitDatum ?? []).map(v2),
        };
      }
      default:
        return null;
    }
  }

  loop(p: DwgBoundaryPath): SrcLoop | null {
    if ('vertices' in p && Array.isArray(p.vertices)) {
      return {
        kind: 'poly',
        vertices: p.vertices.map((v) => ({ x: num(v.x), y: num(v.y), bulge: num(v.bulge) })),
        closed: true,
      };
    }
    if ('edges' in p && Array.isArray(p.edges)) {
      const edges = p.edges.map((e) => this.edge(e)).filter((e): e is SrcEdge => e !== null);
      return { kind: 'edges', edges };
    }
    return null;
  }

  table(t: DwgTableEntity, common: { layer: string; color: SrcColor; handle?: string }, blockByHandle: Map<string, string>): SrcEntity {
    const rows = num(t.rowCount);
    const cols = num(t.columnCount);
    const rowHeights = (t.rowHeightArr ?? []).slice(0, rows);
    const colWidths = (t.columnWidthArr ?? []).slice(0, cols);
    const cells: SrcTableCell[] = [];
    const raw = t.cells ?? [];
    const covered = new Set<number>();
    if (rows > 0 && cols > 0 && raw.length >= rows * cols) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (covered.has(idx)) continue;
          const cell = raw[idx] as (typeof raw)[number] & { borderWidth?: number; borderHeight?: number };
          let colSpan = Math.max(1, Math.trunc(num(cell.borderWidth, 1)));
          let rowSpan = Math.max(1, Math.trunc(num(cell.borderHeight, 1)));
          if (colSpan === 1 && rowSpan === 1 && cell.mergedValue && cell.text) {
            // Spans not exposed: absorb following empty merged cells (heuristic).
            while (c + colSpan < cols) {
              const n = raw[r * cols + c + colSpan];
              if (!n?.mergedValue || n.text) break;
              colSpan++;
            }
            while (r + rowSpan < rows) {
              const n = raw[(r + rowSpan) * cols + c];
              if (!n?.mergedValue || n.text) break;
              rowSpan++;
            }
          }
          colSpan = Math.min(colSpan, cols - c);
          rowSpan = Math.min(rowSpan, rows - r);
          for (let rr = r; rr < r + rowSpan; rr++)
            for (let cc = c; cc < c + colSpan; cc++) if (rr !== r || cc !== c) covered.add(rr * cols + cc);
          cells.push({ r, c, rowSpan, colSpan, raw: this.encodeRaw(cell.text ?? ''), style: cell.textStyle || 'Standard' });
        }
      }
    }
    const dir = t.directionVector ? v2(t.directionVector) : ([1, 0] as Vec2);
    const ok = rows > 0 && cols > 0 && rowHeights.length === rows && colWidths.length === cols && raw.length >= rows * cols;
    return {
      ...common,
      type: 'table',
      origin: v2(t.startPoint),
      direction: dir,
      rowHeights: ok ? rowHeights : [],
      colWidths: ok ? colWidths : [],
      cells: ok ? cells : [],
      block: t.blockRecordHandle ? blockByHandle.get(t.blockRecordHandle) : undefined,
      defaultStyle: 'Standard',
    };
  }

  /** Convert an entity; may return several (INSERT + its ATTRIBs). */
  entity(raw: DwgEntity, out: SrcEntity[], blockByHandle: Map<string, string>, inBlock: boolean): void {
    const e = raw as AnyEnt;
    if (e.isVisible === false) return;
    const common = { layer: e.layer || '0', color: colorOf(e), handle: e.handle };
    switch (e.type) {
      case 'LINE': {
        const l = e as AnyEnt & { startPoint: P2; endPoint: P2 };
        out.push({ ...common, type: 'line', a: v2(l.startPoint), b: v2(l.endPoint) });
        return;
      }
      case 'LWPOLYLINE': {
        const l = e as AnyEnt & { flag: number; constantWidth?: number; vertices: { x: number; y: number; bulge: number }[]; extrusionDirection?: Vec3 };
        out.push({
          ...common,
          type: 'polyline',
          extrusion: extrusionOf(l),
          vertices: (l.vertices ?? []).map((v) => ({ x: num(v.x), y: num(v.y), bulge: num(v.bulge) })),
          // DWG LWPOLYLINE flag: 512 = closed (DXF uses bit 1).
          closed: (num(l.flag) & 512) !== 0,
          width: num(l.constantWidth) || undefined,
        });
        return;
      }
      case 'POLYLINE2D':
      case 'POLYLINE3D': {
        const pl = e as AnyEnt & {
          flag: number;
          startWidth?: number;
          endWidth?: number;
          vertices: { x: number; y: number; bulge?: number; flag?: number }[];
          extrusionDirection?: Vec3;
        };
        const flag = num(pl.flag);
        if (flag & (16 | 64)) {
          out.push({ ...common, type: 'unsupported', name: flag & 64 ? 'POLYFACE_MESH' : 'POLYGON_MESH' });
          return;
        }
        const verts = (pl.vertices ?? []).filter((v) => !(num(v.flag) & 16));
        const sw = num(pl.startWidth);
        out.push({
          ...common,
          type: 'polyline',
          extrusion: e.type === 'POLYLINE2D' ? extrusionOf(pl) : undefined,
          vertices: verts.map((v) => ({ x: num(v.x), y: num(v.y), bulge: e.type === 'POLYLINE2D' ? num(v.bulge) : 0 })),
          closed: (flag & 1) !== 0,
          width: sw && sw === num(pl.endWidth) ? sw : undefined,
        });
        return;
      }
      case 'CIRCLE': {
        const c = e as AnyEnt & { center: P2; radius: number; extrusionDirection?: Vec3 };
        out.push({ ...common, type: 'circle', extrusion: extrusionOf(c), center: v2(c.center), radius: num(c.radius) });
        return;
      }
      case 'ARC': {
        const a = e as AnyEnt & { center: P2; radius: number; startAngle: number; endAngle: number; extrusionDirection?: Vec3 };
        out.push({
          ...common,
          type: 'arc',
          extrusion: extrusionOf(a),
          center: v2(a.center),
          radius: num(a.radius),
          start: num(a.startAngle),
          end: num(a.endAngle),
        });
        return;
      }
      case 'ELLIPSE': {
        const el = e as AnyEnt & { center: P2; majorAxisEndPoint: P2; axisRatio: number; startAngle: number; endAngle: number; extrusionDirection?: Vec3 };
        const ext = el.extrusionDirection;
        // Ellipse is in WCS; a -Z normal reverses the minor-axis direction.
        const flip = ext && num(ext.z) < 0 ? -1 : 1;
        out.push({
          ...common,
          type: 'ellipse',
          center: v2(el.center),
          majorAxis: v2(el.majorAxisEndPoint),
          ratio: num(el.axisRatio, 1) * flip,
          start: num(el.startAngle),
          end: num(el.endAngle, Math.PI * 2),
        });
        return;
      }
      case 'SPLINE': {
        const s = e as AnyEnt & { flag: number; degree: number; knots: number[]; weights?: number[]; controlPoints: P2[]; fitPoints: P2[] };
        out.push({
          ...common,
          type: 'spline',
          degree: num(s.degree, 3),
          knots: s.knots ?? [],
          controlPoints: (s.controlPoints ?? []).map(v2),
          weights: s.weights && s.weights.length ? s.weights : undefined,
          fitPoints: (s.fitPoints ?? []).map(v2),
          closed: (num(s.flag) & 1) !== 0,
        });
        return;
      }
      case 'POINT': {
        const p = e as AnyEnt & { position: P2 };
        out.push({ ...common, type: 'point', position: v2(p.position) });
        return;
      }
      case 'SOLID':
      case 'TRACE': {
        const s = e as AnyEnt & { corner1: P2; corner2: P2; corner3: P2; corner4?: P2; extrusionDirection?: Vec3 };
        const corners = [v2(s.corner1), v2(s.corner2), v2(s.corner3)];
        if (s.corner4) corners.push(v2(s.corner4));
        out.push({ ...common, type: 'solid', extrusion: extrusionOf(s), corners });
        return;
      }
      case 'HATCH': {
        const h = e as AnyEnt & {
          solidFill: number;
          gradientFlag?: number;
          patternName: string;
          boundaryPaths: DwgBoundaryPath[];
          extrusionDirection?: Vec3;
        };
        const loops = (h.boundaryPaths ?? []).map((p) => this.loop(p)).filter((l): l is SrcLoop => l !== null);
        out.push({
          ...common,
          type: 'hatch',
          extrusion: extrusionOf(h),
          solid: num(h.solidFill) === 1 || num(h.gradientFlag) === 1,
          pattern: h.patternName || '',
          loops,
        });
        return;
      }
      case 'TEXT': {
        const t = this.textFrom(e as unknown as DwgTextBase, common);
        if (t) out.push(t);
        return;
      }
      case 'ATTDEF': {
        const a = e as unknown as DwgAttdefEntity;
        // Only constant attribute definitions are drawn (others are replaced by ATTRIBs on insert).
        if (inBlock && num(a.flags) & 2 && !(num(a.flags) & 1)) {
          const t = this.textFrom(a.text, common);
          if (t) out.push(t);
        }
        return;
      }
      case 'ATTRIB': {
        const a = e as unknown as DwgAttribEntity;
        if (num(a.flags) & 1) return;
        const t = this.textFrom(a.text, common);
        if (t) out.push(t);
        return;
      }
      case 'MTEXT': {
        const m = e as AnyEnt & {
          insertionPoint: P2;
          textHeight: number;
          attachmentPoint: number;
          text: string;
          styleName: string;
          direction?: P2;
          rotation?: number;
        };
        if (!m.text) return;
        const dir = m.direction ? v2(m.direction) : ([0, 0] as Vec2);
        const rotation = Math.hypot(dir[0], dir[1]) > 1e-12 ? Math.atan2(dir[1], dir[0]) : num(m.rotation);
        const al = mtextAlign(num(m.attachmentPoint, 1));
        out.push({
          ...common,
          type: 'text',
          raw: this.encodeRaw(m.text),
          style: m.styleName || 'Standard',
          isMText: true,
          position: v2(m.insertionPoint),
          height: num(m.textHeight, 1),
          rotation,
          hAlign: al.hAlign,
          vAlign: al.vAlign,
        });
        return;
      }
      case 'INSERT': {
        const ins = e as unknown as DwgInsertEntity & AnyEnt;
        out.push({
          ...common,
          type: 'insert',
          extrusion: extrusionOf(ins),
          block: ins.name,
          position: v2(ins.insertionPoint),
          scale: [num(ins.xScale, 1), num(ins.yScale, 1)],
          rotation: num(ins.rotation),
          cols: Math.max(1, num(ins.columnCount, 1)),
          rows: Math.max(1, num(ins.rowCount, 1)),
          colSpacing: num(ins.columnSpacing),
          rowSpacing: num(ins.rowSpacing),
        });
        // ATTRIBs live in the container's coordinates (not the block's).
        for (const a of ins.attribs ?? []) {
          if (a.isVisible === false || num(a.flags) & 1) continue;
          const ac = colorOf(a);
          const t = this.textFrom(a.text, {
            layer: a.layer || common.layer,
            color: ac.aci === 0 && ac.rgb === undefined ? common.color : ac,
            handle: a.handle || common.handle,
          });
          if (t) out.push(t);
        }
        return;
      }
      case 'DIMENSION': {
        const d = e as AnyEnt & { name?: string };
        if (!d.name) {
          out.push({ ...common, type: 'unsupported', name: 'DIMENSION' });
          return;
        }
        // The anonymous *D block already holds the dimension graphics in WCS.
        out.push({
          ...common,
          type: 'insert',
          block: d.name,
          position: [0, 0],
          scale: [1, 1],
          rotation: 0,
          cols: 1,
          rows: 1,
          colSpacing: 0,
          rowSpacing: 0,
        });
        return;
      }
      case 'ACAD_TABLE':
        out.push(this.table(e as unknown as DwgTableEntity, common, blockByHandle));
        return;
      default:
        out.push({ ...common, type: 'unsupported', name: e.type || 'UNKNOWN' });
        return;
    }
  }
}

const isModelSpace = (name: string) => /^\*model_space$/i.test(name);
const isPaperSpace = (name: string) => /^\*paper_space/i.test(name);

export interface DwgConvertMeta {
  errorCode: number;
  codepage: number | undefined;
  /** File version tag, e.g. 'AC1021'. */
  version?: string;
}

const LEGACY_SINGLE_BYTE: Record<string, string> = { ANSI_1252: 'windows-1252', ANSI_1258: 'windows-1258' };

export function dwgToSource(db: DwgDatabase, meta: DwgConvertMeta): SrcDocument {
  const warnings: string[] = [];
  if (meta.errorCode > 0) {
    warnings.push(`Thư viện đọc DWG báo mã lỗi ${meta.errorCode} (không nghiêm trọng) — một số đối tượng có thể bị thiếu.`);
  }
  const header = db.header as { INSUNITS?: number; DWGCODEPAGE?: string; ACADVER?: string };
  const codepage = codepageName(header.DWGCODEPAGE, meta.codepage);
  const version = meta.version || header.ACADVER || '';
  // Before R2007 (AC1021) DWG strings are 8-bit in $DWGCODEPAGE; from R2007 on they are UTF-16.
  const legacyEnc = version && version < 'AC1021' && codepage ? LEGACY_SINGLE_BYTE[codepage.toUpperCase()] : undefined;
  const encoder = legacyEnc ? makeByteStringEncoder(legacyEnc) : null;
  const conv = new DwgConverter(encoder ?? undefined);
  const records = db.tables?.BLOCK_RECORD?.entries ?? [];
  const blockByHandle = new Map<string, string>();
  for (const br of records) if (br.handle) blockByHandle.set(br.handle, br.name);

  // Blocks (everything except model/paper space)
  const blocks = new Map<string, SrcBlock>();
  for (const br of records) {
    if (!br.name || isModelSpace(br.name) || isPaperSpace(br.name)) continue;
    const ents: SrcEntity[] = [];
    for (const e of br.entities ?? []) conv.entity(e, ents, blockByHandle, true);
    blocks.set(br.name, { name: br.name, base: v2(br.basePoint), entities: ents });
  }

  // Model space: the *Model_Space block record's own entity list. db.entities mixes model and
  // paper space; fall back to filtering it by owner handle if the record is missing.
  const ms = records.find((r) => isModelSpace(r.name));
  let msEntities: DwgEntity[];
  if (ms && Array.isArray(ms.entities) && ms.entities.length > 0) {
    msEntities = ms.entities;
  } else if (ms) {
    msEntities = (db.entities ?? []).filter((e) => e.ownerBlockRecordSoftId === ms.handle);
  } else {
    msEntities = (db.entities ?? []).filter((e) => !e.isInPaperSpace);
  }
  const paperCount = records.filter((r) => isPaperSpace(r.name)).reduce((s, r) => s + (r.entities?.length ?? 0), 0);
  if (paperCount > 0) {
    warnings.push(`Đã bỏ qua ${paperCount} đối tượng ở Paper Space (layout/khung in) — chỉ hiển thị Model Space.`);
  }
  const entities: SrcEntity[] = [];
  for (const e of msEntities) conv.entity(e, entities, blockByHandle, false);

  // Layers
  const layers: SrcLayer[] = (db.tables?.LAYER?.entries ?? []).map((l) => {
    const aci = Math.abs(num(l.colorIndex, 7));
    const color: SrcColor = aci >= 1 && aci <= 255 ? { aci } : { aci: 256, rgb: num(l.color, 0xffffff) };
    return { name: l.name, color, visible: !l.off && !l.frozen && num(l.colorIndex, 7) >= 0 };
  });

  // Text styles → font hint
  const styles = new Map<string, string>();
  for (const s of db.tables?.STYLE?.entries ?? []) {
    styles.set(s.name, (s.font || s.extendedFont || s.bigFont || '').trim());
  }

  return {
    units: insunitsToName(header.INSUNITS),
    codepage,
    legacyBytes: encoder !== null,
    layers,
    styles,
    blocks,
    entities,
    warnings,
  };
}
