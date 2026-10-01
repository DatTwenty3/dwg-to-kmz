// SrcDocument → CadDocument: explode blocks (recursive affine), tessellate curves, resolve
// ByLayer/ByBlock colours, decode text through '@/lib/text', compute a robust bbox.
import type { CadDocument, CadEntity, CadLayer, HAlign, TableCell, TextEntity, VAlign, Vec2 } from '../types';
import { ACI_BYBLOCK, ACI_BYLAYER, DEFAULT_COLOR, aciToHex, rgbToHex } from './aci';
import { robustBBox } from './bbox';
import { loopToRing, nestRings } from './hatch';
import {
  IDENTITY,
  type Mat2D,
  apply,
  applyAll,
  applyLinear,
  determinant,
  isIdentity,
  multiply,
  ocsMatrix,
  rotate,
  scale,
  translate,
} from './matrix';
import type { SrcColor, SrcDocument, SrcEntity, SrcTable, SrcTableCell, SrcText } from './source';
import { arcPoints, ccwSweep, circlePoints, ellipsePoints, expandBulges, splinePoints } from './tessellate';
import { type PendingText, type TextDecoderApi, decodeAll, defaultTextDecoder } from './text';

/** Fill opacity for SOLID entities and solid-filled hatches. */
export const SOLID_FILL_OPACITY = 0.5;
/** Pattern hatches (CLAY, GRASS, …) are drawn as a lighter tint of their colour: in planning maps
 * they carry the land-use colours, so drawing only the boundary loses the map's meaning. */
export const PATTERN_FILL_OPACITY = 0.35;
/** Nested INSERT depth guard. */
const MAX_DEPTH = 32;

type ColorSpec = { k: 'layer' } | { k: 'block' } | { k: 'hex'; hex: string };

interface PBase {
  layer: string;
  color: ColorSpec;
}

/** Prototype entity in container-local coordinates; colour/layer resolution deferred. */
type PEntity = PBase &
  (
    | { kind: 'polyline'; points: Vec2[]; closed: boolean; width?: number }
    | { kind: 'polygon'; rings: Vec2[][]; fillOpacity: number; pattern?: string }
    | {
        kind: 'text';
        raw: string;
        style: string;
        isMText: boolean;
        position: Vec2;
        height: number;
        /** radians */
        rotation: number;
        hAlign: HAlign;
        vAlign: VAlign;
      }
    | {
        kind: 'table';
        origin: Vec2;
        /** radians */
        rotation: number;
        rowHeights: number[];
        colWidths: number[];
        cells: SrcTableCell[];
      }
    | { kind: 'point'; position: Vec2 }
    | { kind: 'note'; key: string }
  );

export interface BuildOptions {
  /** Injected for tests; defaults to '@/lib/text'. */
  textDecoder?: TextDecoderApi;
  onProgress?: (stage: string, percent: number) => void;
}

function colorSpec(c: SrcColor): ColorSpec {
  if (c.rgb !== undefined && c.rgb !== null && c.aci !== ACI_BYLAYER && c.aci !== ACI_BYBLOCK) {
    return { k: 'hex', hex: rgbToHex(c.rgb) };
  }
  if (c.aci === ACI_BYBLOCK) return { k: 'block' };
  if (c.aci === ACI_BYLAYER || !(c.aci >= 1 && c.aci <= 255)) return { k: 'layer' };
  return { k: 'hex', hex: aciToHex(c.aci) };
}

export function srcColorToHex(c: SrcColor): string {
  if (c.rgb !== undefined && c.rgb !== null) return rgbToHex(c.rgb);
  return aciToHex(c.aci);
}

function flipH(h: HAlign): HAlign {
  return h === 'left' ? 'right' : h === 'right' ? 'left' : h;
}
function flipV(v: VAlign): VAlign {
  return v === 'top' ? 'bottom' : v === 'middle' ? 'middle' : 'top';
}
function normRad(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}
function radToDeg(a: number): number {
  let d = (a * 180) / Math.PI;
  d %= 360;
  if (d < 0) d += 360;
  if (Math.abs(d) < 1e-9 || Math.abs(d - 360) < 1e-9) d = 0;
  return d;
}

/** Transform a prototype by M; `layer`/`color` substitute layer "0" and ByBlock (INSERT semantics). */
function transformProto(p: PEntity, m: Mat2D, insLayer?: string, insColor?: ColorSpec): PEntity {
  const layer = insLayer !== undefined && p.layer === '0' ? insLayer : p.layer;
  const color = insColor !== undefined && p.color.k === 'block' ? insColor : p.color;
  switch (p.kind) {
    case 'polyline': {
      const det = Math.sqrt(Math.abs(determinant(m)));
      return { ...p, layer, color, points: applyAll(m, p.points), width: p.width ? p.width * det : p.width };
    }
    case 'polygon':
      return { ...p, layer, color, rings: p.rings.map((r) => applyAll(m, r)) };
    case 'point':
      return { ...p, layer, color, position: apply(m, p.position) };
    case 'note':
      return { ...p, layer, color };
    case 'text': {
      const u = applyLinear(m, [Math.cos(p.rotation), Math.sin(p.rotation)]);
      const v = applyLinear(m, [-Math.sin(p.rotation), Math.cos(p.rotation)]);
      const det = u[0] * v[1] - u[1] * v[0];
      const height = p.height * Math.hypot(v[0], v[1]);
      let rotation = Math.atan2(u[1], u[0]);
      let hAlign = p.hAlign;
      let vAlign = p.vAlign;
      if (det < 0) {
        // Mirrored: keep the text readable. Either keep the x direction (flip vertical anchor)
        // or keep the y direction (flip horizontal anchor) — whichever is closer to upright.
        const rotA = normRad(rotation);
        const rotB = normRad(Math.atan2(v[1], v[0]) - Math.PI / 2);
        if (Math.abs(rotA) <= Math.abs(rotB)) {
          rotation = rotA;
          vAlign = flipV(vAlign);
        } else {
          rotation = rotB;
          hAlign = flipH(hAlign);
        }
      }
      return { ...p, layer, color, position: apply(m, p.position), height, rotation, hAlign, vAlign };
    }
    case 'table': {
      const u = applyLinear(m, [Math.cos(p.rotation), Math.sin(p.rotation)]);
      const s = Math.hypot(u[0], u[1]) || 1;
      return {
        ...p,
        layer,
        color,
        origin: apply(m, p.origin),
        rotation: Math.atan2(u[1], u[0]),
        rowHeights: p.rowHeights.map((h) => h * s),
        colWidths: p.colWidths.map((w) => w * s),
      };
    }
  }
}

class Builder {
  readonly protoCache = new Map<string, PEntity[]>();
  private readonly building = new Set<string>();
  readonly warnings: string[] = [];
  private cycleWarned = new Set<string>();
  private missingBlocks = new Set<string>();
  readonly tableFallbacks: string[] = [];

  constructor(private readonly src: SrcDocument) {}

  blockProtos(name: string, depth: number): PEntity[] | null {
    const cached = this.protoCache.get(name);
    if (cached) return cached;
    const block = this.src.blocks.get(name);
    if (!block) {
      this.missingBlocks.add(name);
      return null;
    }
    if (this.building.has(name) || depth > MAX_DEPTH) {
      if (!this.cycleWarned.has(name)) {
        this.cycleWarned.add(name);
        this.warnings.push(`Block "${name}" tham chiếu vòng hoặc lồng quá sâu — bỏ qua phần lặp.`);
      }
      return [];
    }
    this.building.add(name);
    const out: PEntity[] = [];
    for (const e of block.entities) this.convert(e, out, depth + 1);
    this.building.delete(name);
    this.protoCache.set(name, out);
    return out;
  }

  private pushInstance(protos: PEntity[], m: Mat2D, layer: string, color: ColorSpec, out: PEntity[]) {
    for (const p of protos) out.push(transformProto(p, m, layer, color));
  }

  /** Convert one source entity into prototypes in its container's coordinates. */
  convert(e: SrcEntity, out: PEntity[], depth: number): void {
    const layer = e.layer || '0';
    const color = colorSpec(e.color);
    const ocs = ocsMatrix(e.extrusion);
    const base = { layer, color };
    const emit = (p: PEntity) => out.push(isIdentity(ocs) ? p : transformProto(p, ocs));
    switch (e.type) {
      case 'line':
        emit({ ...base, kind: 'polyline', points: [e.a, e.b], closed: false });
        return;
      case 'polyline': {
        if (e.vertices.length === 0) return;
        if (e.vertices.length === 1) {
          emit({ ...base, kind: 'point', position: [e.vertices[0].x, e.vertices[0].y] });
          return;
        }
        const pts = expandBulges(e.vertices, e.closed);
        emit({ ...base, kind: 'polyline', points: pts, closed: e.closed, width: e.width || undefined });
        return;
      }
      case 'circle':
        if (!(e.radius > 0)) return;
        emit({ ...base, kind: 'polyline', points: circlePoints(e.center, e.radius), closed: true });
        return;
      case 'arc':
        if (!(e.radius > 0)) return;
        emit({ ...base, kind: 'polyline', points: arcPoints(e.center, e.radius, e.start, ccwSweep(e.start, e.end)), closed: false });
        return;
      case 'ellipse': {
        const full = Math.abs(ccwSweep(e.start, e.end) - 2 * Math.PI) < 1e-9;
        const pts = ellipsePoints(e.center, e.majorAxis, e.ratio, e.start, e.end, true);
        if (full) pts.pop();
        emit({ ...base, kind: 'polyline', points: pts, closed: full });
        return;
      }
      case 'spline': {
        const pts = splinePoints(e);
        if (pts.length < 2) return;
        emit({ ...base, kind: 'polyline', points: pts, closed: e.closed });
        return;
      }
      case 'point':
        emit({ ...base, kind: 'point', position: e.position });
        return;
      case 'solid': {
        const c = e.corners;
        if (c.length < 3) return;
        const ring: Vec2[] = c.length >= 4 && (c[3][0] !== c[2][0] || c[3][1] !== c[2][1]) ? [c[0], c[1], c[3], c[2]] : [c[0], c[1], c[2]];
        emit({ ...base, kind: 'polygon', rings: [ring], fillOpacity: SOLID_FILL_OPACITY });
        return;
      }
      case 'hatch': {
        const rings = e.loops.map(loopToRing).filter((r) => r.length >= 3);
        if (rings.length === 0) return;
        if (e.solid) {
          for (const poly of nestRings(rings)) emit({ ...base, kind: 'polygon', rings: poly, fillOpacity: SOLID_FILL_OPACITY });
        } else {
          const pattern = e.pattern || 'PATTERN';
          for (const poly of nestRings(rings)) emit({ ...base, kind: 'polygon', rings: poly, fillOpacity: PATTERN_FILL_OPACITY, pattern });
          out.push({ ...base, kind: 'note', key: 'pattern-hatch' });
        }
        return;
      }
      case 'text':
        if (!e.raw) return;
        emit(textProto(e, base));
        return;
      case 'insert': {
        const protos = this.blockProtos(e.block, depth);
        if (!protos) {
          out.push({ ...base, kind: 'note', key: 'missing-block' });
          return;
        }
        if (protos.length === 0) return;
        const blk = this.src.blocks.get(e.block)!;
        const cols = Math.max(1, Math.trunc(e.cols) || 1);
        const rows = Math.max(1, Math.trunc(e.rows) || 1);
        const sx = e.scale[0] || 1;
        const sy = e.scale[1] || 1;
        const head = multiply(ocs, multiply(translate(e.position[0], e.position[1]), rotate(e.rotation)));
        const tail = multiply(scale(sx, sy), translate(-blk.base[0], -blk.base[1]));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const offset = c === 0 && r === 0 ? IDENTITY : translate(c * e.colSpacing, r * e.rowSpacing);
            const m = multiply(head, multiply(offset, tail));
            this.pushInstance(protos, m, layer, color, out);
          }
        }
        return;
      }
      case 'table': {
        const t = tableProto(e, base);
        if (t) {
          emit(t);
          return;
        }
        // Fallback: draw the anonymous *T block (lines + mtext) so the table is not lost.
        const protos = e.block ? this.blockProtos(e.block, depth) : null;
        if (protos && protos.length > 0) {
          this.tableFallbacks.push(e.handle ?? e.block ?? '?');
          this.pushInstance(protos, ocs, layer, color, out);
        } else {
          out.push({ ...base, kind: 'note', key: 'table-lost' });
        }
        return;
      }
      case 'unsupported':
        out.push({ ...base, kind: 'note', key: `unsupported:${e.name}` });
        return;
    }
  }

  missingBlockNames(): string[] {
    return [...this.missingBlocks];
  }
}

function textProto(e: SrcText, base: PBase): PEntity {
  return {
    ...base,
    kind: 'text',
    raw: e.raw,
    style: e.style,
    isMText: e.isMText,
    position: e.position,
    height: e.height > 0 ? e.height : 1,
    rotation: e.rotation || 0,
    hAlign: e.hAlign,
    vAlign: e.vAlign,
  };
}

function tableProto(e: SrcTable, base: PBase): PEntity | null {
  const rows = e.rowHeights.length;
  const cols = e.colWidths.length;
  if (rows === 0 || cols === 0) return null;
  if (!e.rowHeights.every((h) => Number.isFinite(h) && h >= 0)) return null;
  if (!e.colWidths.every((w) => Number.isFinite(w) && w >= 0)) return null;
  const dirLen = Math.hypot(e.direction[0], e.direction[1]);
  const rotation = dirLen > 1e-12 ? Math.atan2(e.direction[1], e.direction[0]) : 0;
  return { ...base, kind: 'table', origin: e.origin, rotation, rowHeights: e.rowHeights, colWidths: e.colWidths, cells: e.cells };
}

const UNSUPPORTED_LABEL: Record<string, string> = {
  OLE2FRAME: 'đối tượng nhúng OLE',
  OLEFRAME: 'đối tượng nhúng OLE',
  WIPEOUT: 'vùng che (wipeout)',
  IMAGE: 'ảnh raster',
  VIEWPORT: 'khung nhìn (viewport)',
  MLINE: 'đường đa tuyến (mline)',
  MULTILEADER: 'đường dẫn chú thích (multileader)',
  MLEADER: 'đường dẫn chú thích (multileader)',
  LEADER: 'đường dẫn (leader)',
  REGION: 'vùng (region)',
  '3DSOLID': 'khối 3D',
  '3DFACE': 'mặt 3D',
  PROXY: 'đối tượng proxy',
  ACAD_PROXY_ENTITY: 'đối tượng proxy',
  RAY: 'tia (ray)',
  XLINE: 'đường vô hạn (xline)',
  TOLERANCE: 'dung sai (tolerance)',
  SHAPE: 'ký hiệu shape',
  ATTDEF: 'định nghĩa thuộc tính (attdef) ngoài block',
};

/** Build the final IR. Pure: no DOM, no I/O. */
export function buildDocument(src: SrcDocument, opts: BuildOptions = {}): CadDocument {
  const decoder = opts.textDecoder ?? defaultTextDecoder;
  const builder = new Builder(src);
  const warnings = [...src.warnings];

  // Layers
  const layerColor = new Map<string, string>();
  const layers: CadLayer[] = [];
  for (const l of src.layers) {
    if (layerColor.has(l.name)) continue;
    const hex = srcColorToHex(l.color);
    layerColor.set(l.name, hex);
    layers.push({ name: l.name, color: hex, visible: l.visible });
  }

  const entities: CadEntity[] = [];
  const pending: PendingText[] = [];
  const notes = new Map<string, number>();
  const total = src.entities.length || 1;
  const tmp: PEntity[] = [];
  let lastReport = 0;

  const resolveColor = (spec: ColorSpec, layer: string): string => {
    if (spec.k === 'hex') return spec.hex;
    if (spec.k === 'layer') return layerColor.get(layer) ?? DEFAULT_COLOR;
    return DEFAULT_COLOR; // ByBlock at top level → white (ACI 7)
  };

  for (let i = 0; i < src.entities.length; i++) {
    const se = src.entities[i];
    tmp.length = 0;
    builder.convert(se, tmp, 0);
    const handle = se.handle;
    for (const p of tmp) {
      if (p.kind === 'note') {
        notes.set(p.key, (notes.get(p.key) ?? 0) + 1);
        continue;
      }
      const layer = p.layer || '0';
      if (!layerColor.has(layer)) {
        layerColor.set(layer, DEFAULT_COLOR);
        layers.push({ name: layer, color: DEFAULT_COLOR, visible: true });
      }
      const color = resolveColor(p.color, layer);
      const common = handle ? { layer, color, handle } : { layer, color };
      switch (p.kind) {
        case 'polyline':
          if (p.points.length < 2) break;
          entities.push(p.width ? { ...common, kind: 'polyline', points: p.points, closed: p.closed, width: p.width } : { ...common, kind: 'polyline', points: p.points, closed: p.closed });
          break;
        case 'polygon':
          entities.push(p.pattern ? { ...common, kind: 'polygon', rings: p.rings, fillOpacity: p.fillOpacity, pattern: p.pattern } : { ...common, kind: 'polygon', rings: p.rings, fillOpacity: p.fillOpacity });
          break;
        case 'point':
          entities.push({ ...common, kind: 'point', position: p.position });
          break;
        case 'text': {
          const t: TextEntity = {
            ...common,
            kind: 'text',
            text: '',
            position: p.position,
            height: p.height,
            rotation: radToDeg(p.rotation),
            hAlign: p.hAlign,
            vAlign: p.vAlign,
          };
          entities.push(t);
          pending.push({ raw: p.raw, style: p.style, isMText: p.isMText, apply: (s) => (t.text = s) });
          break;
        }
        case 'table': {
          const cells: TableCell[] = p.cells.map((c) => ({ r: c.r, c: c.c, rowSpan: c.rowSpan, colSpan: c.colSpan, text: '' }));
          p.cells.forEach((c, k) => {
            if (c.raw) pending.push({ raw: c.raw, style: c.style, isMText: true, apply: (s) => (cells[k].text = s) });
          });
          entities.push({
            ...common,
            kind: 'table',
            origin: p.origin,
            rotation: radToDeg(p.rotation),
            rows: p.rowHeights.length,
            cols: p.colWidths.length,
            rowHeights: p.rowHeights,
            colWidths: p.colWidths,
            cells,
          });
          break;
        }
      }
    }
    if (opts.onProgress && i - lastReport > 2000) {
      lastReport = i;
      opts.onProgress('Chuyển đối tượng', Math.round((i / total) * 100));
    }
  }

  opts.onProgress?.('Giải mã chữ tiếng Việt', 100);
  decodeAll(pending, src.styles, src.codepage, decoder, warnings, src.legacyBytes === true);

  // Drop texts that decode to nothing visible.
  const finalEntities = entities.filter((e) => e.kind !== 'text' || e.text.trim() !== '');

  // Warnings
  warnings.push(...builder.warnings);
  const missing = builder.missingBlockNames();
  if (missing.length > 0) {
    warnings.push(`Không tìm thấy định nghĩa ${missing.length} block: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
  }
  if (builder.tableFallbacks.length > 0) {
    warnings.push(`${builder.tableFallbacks.length} bảng (ACAD_TABLE) không đọc được ô — đã vẽ lại từ block đồ họa *T (đường kẻ + chữ).`);
  }
  for (const [key, n] of [...notes.entries()].sort((a, b) => b[1] - a[1])) {
    if (key === 'pattern-hatch') warnings.push(`${n} hatch dạng mẫu (pattern) được tô màu nhạt theo màu của hatch, chưa vẽ đường mẫu chi tiết.`);
    else if (key === 'missing-block') warnings.push(`Bỏ qua ${n} INSERT tham chiếu block không tồn tại.`);
    else if (key === 'table-lost') warnings.push(`Bỏ qua ${n} bảng (ACAD_TABLE) không đọc được ô và không có block đồ họa.`);
    else if (key.startsWith('unsupported:')) {
      const name = key.slice('unsupported:'.length);
      const label = UNSUPPORTED_LABEL[name];
      warnings.push(`Bỏ qua ${n} đối tượng ${name}${label ? ` (${label})` : ''} — chưa hỗ trợ.`);
    }
  }

  return {
    units: src.units,
    crs: null,
    layers,
    entities: finalEntities,
    bbox: robustBBox(finalEntities),
    warnings,
  };
}
