// CadDocument (already in drawing coordinates, metres) → DXF string (AC1021 / R2007+, UTF-8 text).
//
// Notes
// - Library: @tarikjabiri/dxf. Its output is plain "\n"-joined group lines; the UI saves it as UTF-8.
// - Text: every TEXT/MTEXT uses the style `VN-ARIAL` bound to the TrueType font arial.ttf (SHX fonts such as
//   txt.shx cannot show Vietnamese).
// - Polygons → one HATCH with a polyline boundary path per ring (outer = External|Polyline, holes =
//   Polyline; hatch style "Normal" so holes stay holes). A pattern hatch read from DWG/DXF (`hatch`: its pattern
//   lines) is written with the same pattern; others as a solid fill, `fillOpacity` < 1 as transparency (440).
// - Colours: layer colour = nearest ACI (62) + true colour (420); an entity whose colour differs from its layer
//   gets its own 62 + 420, otherwise it stays ByLayer.
// - Layer style (CadLayer.style, set by the UI): `dash` → layer linetype (solid → Continuous, otherwise an LTYPE
//   DASHED / DOT / DASHDOT written only when used); `width` (screen px) → layer lineweight (group 370).
//   Patterns follow acad.lin (DASHED = dash,gap 2:1; DOT = 0-length dash; DASHDOT) but are expressed in metres of
//   the drawing (dash 2 m, gap 1 m, i.e. 2 mm / 1 mm at 1:1000) and multiplied by the unit factor of `opts.units`
//   (mm drawing → 2000), so $LTSCALE stays 1. px → lineweight: 1 px ≈ 0.25 mm (width*25 in 1/100 mm), snapped to
//   the nearest standard DXF lineweight. $LWDISPLAY=1 is only set when some exported layer has a width.
// - Values are rounded to 1e-6 so numbers never print in exponent notation.
// - TEXT is limited to 250 characters (DXF group 1 limit); MTEXT is split in 250-char chunks (groups 3 + 1).
import {
  DxfWriter,
  HatchBoundaryPaths,
  HatchPolylineBoundary,
  HatchPredefinedPatterns,
  LayerFlags,
  LWPolylineFlags,
  TextHorizontalAlignment,
  TextVerticalAlignment,
  TrueColor,
  Units,
  aciHex,
  pattern,
  point2d,
  point3d,
  type Dxfier,
  type DxfLayer,
  type MTextAttachmentPoint,
} from '@tarikjabiri/dxf';
import type { CadDocument, CadEntity, HAlign, LineTypeDef, PolygonEntity, TableEntity, TextEntity, VAlign, Vec2 } from '@/lib/cad/types';
import { arialDotElement } from '@/lib/cad/lineTypeDots';
import { normalizeHex } from './color';
import { planeMapper, tableGeometry } from './kml';

export interface DxfExportOptions {
  /** Layers to include; undefined = all visible layers. */
  layers?: string[];
  /** Drawing units for $INSUNITS ('m' default, 'mm', 'cm', 'km', 'in', 'ft', 'unitless'). */
  units?: string;
}

export const DXF_TEXT_STYLE = 'VN-ARIAL';
const DXF_FONT_FILE = 'arial.ttf';

const UNIT_CODES: Record<string, Units> = {
  unitless: Units.Unitless,
  in: Units.Inches,
  ft: Units.Feet,
  mm: Units.Millimeters,
  cm: Units.Centimeters,
  m: Units.Meters,
  km: Units.Kilometers,
};

// ---------------------------------------------------------------- helpers

/** Standard DXF lineweights, in 1/100 mm (group 370). */
export const DXF_LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
/** 1 screen px ≈ 0.25 mm of plotted line (25 hundredths of a millimetre). */
export const LINEWEIGHT_PER_PX = 25;

/** Nearest standard DXF lineweight (1/100 mm) for a width in screen px; undefined when not a positive number. */
export function pxToLineweight(px: number | undefined): number | undefined {
  if (px === undefined || !(px > 0) || !Number.isFinite(px)) return undefined;
  const target = px * LINEWEIGHT_PER_PX;
  let best = DXF_LINEWEIGHTS[1];
  for (const lw of DXF_LINEWEIGHTS) if (lw > 0 && Math.abs(lw - target) < Math.abs(best - target)) best = lw;
  return best;
}

/** Linetype definitions in metres: [name, description, pattern elements (dash >0, gap <0, dot 0)]. */
export const DXF_LINETYPES = {
  dashed: ['DASHED', 'Dashed __ __ __ __', [2, -1]],
  dotted: ['DOT', 'Dot . . . . . . .', [0, -1]],
  dashdot: ['DASHDOT', 'Dash dot __ . __ . __ .', [2, -1, 0, -1]],
} as const satisfies Record<string, readonly [string, string, readonly number[]]>;

const UNIT_PER_METRE: Record<string, number> = { mm: 1000, cm: 100, m: 1, km: 0.001, in: 39.37007874, ft: 3.280839895 };

const rnd = (x: number): number => {
  const v = Math.round(x * 1e6) / 1e6;
  return v === 0 ? 0 : v; // no "-0"
};
const finite = (p: Vec2 | undefined): p is Vec2 => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Characters not allowed in DXF layer names: < > / \ " : ; ? * | = ` and `,` (Vietnamese letters are kept). */
const BAD_LAYER_CHARS = /[<>/\\":;?*|=`,\u0000-\u001f\u007f]/g;

export function sanitizeLayerName(name: string): string {
  const s = name.normalize('NFC').replace(BAD_LAYER_CHARS, '_').trim().slice(0, 255);
  return s === '' ? '_' : s;
}

interface Rgb {
  aci: number;
  r: number;
  g: number;
  b: number;
}
let acPalette: Rgb[] | null = null;
function palette(): Rgb[] {
  if (!acPalette) {
    acPalette = [];
    for (let i = 1; i <= 255; i++) {
      if (i === 7) continue; // 7 = white/black, handled explicitly
      const h = aciHex(i);
      acPalette.push({ aci: i, r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) });
    }
  }
  return acPalette;
}

/** Nearest AutoCAD Color Index (1..255) for `#rrggbb`; pure white/black → 7. */
export function nearestAci(hex: string): number {
  const h = normalizeHex(hex);
  if (h === 'ffffff' || h === '000000') return 7;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  let best = 7;
  let bestD = Infinity;
  for (const p of palette()) {
    // "redmean" weighted distance, closer to perceived difference than plain RGB.
    const rm = (p.r + r) / 2;
    const dr = p.r - r;
    const dg = p.g - g;
    const db = p.b - b;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = p.aci;
    }
  }
  return best;
}

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const cleanText = (s: string): string => s.normalize('NFC').replace(/\r\n|\r/g, '\n').replace(CTRL, '');

/** Single-line TEXT value: line breaks → space, `\` and `%%` (AutoCAD control codes) escaped via \U+XXXX. */
function textValue(s: string): string {
  const one = cleanText(s).replace(/\s*\n\s*/g, ' ').trim();
  return one.replace(/\\/g, '\\U+005C').replace(/%(?=%)/g, '\\U+0025').slice(0, 250);
}

/** MTEXT value: `\` `{` `}` escaped, line breaks → `\P`. */
function mtextValue(s: string): string {
  return cleanText(s)
    .trim()
    .replace(/[\\{}]/g, (c) => '\\' + c)
    .replace(/%(?=%)/g, '\\U+0025')
    .replace(/\n/g, '\\P');
}

const H_TEXT: Record<HAlign, TextHorizontalAlignment> = {
  left: TextHorizontalAlignment.Left,
  center: TextHorizontalAlignment.Center,
  right: TextHorizontalAlignment.Right,
};
const V_TEXT: Record<VAlign, TextVerticalAlignment> = {
  baseline: TextVerticalAlignment.BaseLine,
  bottom: TextVerticalAlignment.Bottom,
  middle: TextVerticalAlignment.Middle,
  top: TextVerticalAlignment.Top,
};
function attachment(h: HAlign, v: VAlign): MTextAttachmentPoint {
  const row = v === 'top' ? 0 : v === 'middle' ? 1 : 2; // baseline/bottom → bottom row
  const col = h === 'left' ? 0 : h === 'center' ? 1 : 2;
  return (row * 3 + col + 1) as MTextAttachmentPoint;
}

type DxfierPatch = Record<string, (...a: never[]) => void>;

/**
 * Wrap `entity.dxfy` so `patch` can override methods of the Dxfier (instance-level) for the duration of
 * this one entity; the overrides are removed afterwards.
 */
function patchDxfy(entity: { dxfy(dx: Dxfier): void }, patch: (dx: Dxfier, o: DxfierPatch) => void): void {
  const orig = entity.dxfy.bind(entity);
  entity.dxfy = (dx: Dxfier) => {
    const o = dx as unknown as DxfierPatch;
    const before = new Set(Object.keys(o));
    patch(dx, o);
    try {
      orig(dx);
    } finally {
      for (const k of Object.keys(o)) if (!before.has(k)) delete o[k];
    }
  };
}

// ---------------------------------------------------------------- line types of the drawing

/** Characters AutoCAD does not take in a line type name. */
const BAD_LTYPE_CHARS = /[<>/\\":;?*|=`,\u0000-\u001f\u007f]/g;

/** A line type of the drawing written to the file; the text elements ("110kV" in the gaps) are added afterwards. */
interface WrittenLineType {
  name: string;
  def: LineTypeDef;
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STYLE_RECORD = /0\nSTYLE\n5\n([0-9A-F]+)\n330\n[0-9A-F]+\n100\nAcDbSymbolTableRecord\n100\nAcDbTextStyleTableRecord\n2\nVN-ARIAL\n/;

/**
 * Rewrites the records of the line types that carry text (the library writes dashes and gaps only): the elements of
 * a complex line type (DXF group 74 = 2: text embedded) with the text style, scale, rotation, offset and string, so
 * the 110kV / 22kV / 220kV lines keep their labels in the gaps as in the source drawing.
 */
function writeTextLineTypes(dxf: string, written: WrittenLineType[], unitScale: number): string {
  const style = STYLE_RECORD.exec(dxf)?.[1];
  if (!style) return dxf;
  let out = dxf;
  for (const { name, def } of written) {
    if (!def.elements.some((el) => el.text)) continue;
    const head = `0\\nLTYPE\\n5\\n[0-9A-F]+\\n330\\n[0-9A-F]+\\n100\\nAcDbSymbolTableRecord\\n100\\nAcDbLinetypeTableRecord\\n2\\n${escapeRe(name)}\\n70\\n0\\n3\\n[^\\n]*\\n72\\n65\\n73\\n`;
    const re = new RegExp(`(${head})\\d+\\n40\\n[^\\n]*\\n(?:49\\n[^\\n]*\\n74\\n0\\n)+`);
    const total = def.elements.reduce((t, el) => t + Math.abs(el.length), 0) * unitScale;
    const body = def.elements
      .map((e0) => {
        // "l" of a symbol font (Wingdings) is a dot: Arial has no such letter, so the black circle takes its place, sized
        // and shifted so that it stays where the Wingdings one stood (on the line).
        const el = arialDotElement(e0);
        const len = rnd(el.length * unitScale);
        if (!el.text) return `49\n${len}\n74\n0\n`;
        // A caret starts a control-character code in a DXF string ("^J"): a literal one is written "^ " (AutoCAD refuses a lone "^").
        const text = el.text.replace(/[\r\n]+/g, ' ').replace(/\^/g, '^ ');
        const off = el.offset ?? [0, 0];
        return `49\n${len}\n74\n${el.absolute ? 3 : 2}\n75\n0\n340\n${style}\n46\n${rnd((el.textScale ?? 1) * unitScale)}\n50\n${rnd(el.rotation ?? 0)}\n44\n${rnd(off[0] * unitScale)}\n45\n${rnd(off[1] * unitScale)}\n9\n${text}\n`;
      })
      .join('');
    out = out.replace(re, (_m, h: string) => `${h}${def.elements.length}\n40\n${rnd(total)}\n${body}`);
  }
  return out;
}

// ---------------------------------------------------------------- writer

export function toDxf(doc: CadDocument, opts: DxfExportOptions = {}): string {
  const w = new DxfWriter();
  w.setUnits(UNIT_CODES[opts.units ?? 'm'] ?? Units.Meters);
  w.setVariable('$PDMODE', { 70: 3 });
  w.setVariable('$PDSIZE', { 40: -2 });
  w.tables.addStyle(DXF_TEXT_STYLE).fontFileName = DXF_FONT_FILE;

  // ---- layers (doc.layers order, then layers only seen on entities) ----
  const layerHex = new Map<string, string>();
  const visible = new Map<string, boolean>();
  for (const l of doc.layers) {
    if (!layerHex.has(l.name)) {
      layerHex.set(l.name, normalizeHex(l.color));
      visible.set(l.name, l.visible);
    }
  }
  for (const e of doc.entities) {
    if (!layerHex.has(e.layer)) {
      layerHex.set(e.layer, normalizeHex(e.color));
      visible.set(e.layer, true);
    }
  }
  const styleOf = new Map<string, NonNullable<CadDocument['layers'][number]['style']>>();
  for (const l of doc.layers) if (l.style && !styleOf.has(l.name)) styleOf.set(l.name, l.style);
  const unitScale = UNIT_PER_METRE[opts.units ?? 'm'] ?? 1;
  let anyWeight = false;
  // Line types of the entities (doc.lineTypes), registered when first used; names taken by the layer styles are kept apart.
  const written = new Map<string, WrittenLineType>();
  const takenNames = new Set<string>(Object.values(DXF_LINETYPES).map((d) => d[0].toUpperCase()));
  const lineTypeOf = (e: CadEntity): { lineType: string; lineTypeScale?: number } | undefined => {
    if (e.kind !== 'polyline' || !e.lineType || /^(continuous|bylayer|byblock)$/i.test(e.lineType)) return undefined;
    const def = doc.lineTypes?.[e.lineType];
    if (!def || def.elements.length < 2 || !def.elements.some((el) => el.length !== 0)) return undefined;
    let w1 = written.get(e.lineType);
    if (!w1) {
      let name = e.lineType.normalize('NFC').replace(BAD_LTYPE_CHARS, '_').trim().slice(0, 100) || 'LT';
      while (takenNames.has(name.toUpperCase())) name += '_';
      takenNames.add(name.toUpperCase());
      w.tables.addLType(name, name, def.elements.map((el) => rnd(el.length * unitScale)));
      written.set(e.lineType, (w1 = { name, def }));
    }
    const scale = e.lineScale && Number.isFinite(e.lineScale) && e.lineScale > 0 ? rnd(e.lineScale) : undefined;
    return { lineType: w1.name, ...(scale && scale !== 1 ? { lineTypeScale: scale } : {}) };
  };
  const applyLayerStyle = (layer: DxfLayer, cadName: string): void => {
    const st = styleOf.get(cadName);
    if (!st) return;
    const dash = st.dash && st.dash !== 'solid' ? DXF_LINETYPES[st.dash] : undefined;
    if (dash) {
      w.tables.addLType(
        dash[0],
        dash[1],
        dash[2].map((v) => rnd(v * unitScale)),
      );
      layer.lineType = dash[0];
    }
    const lw = pxToLineweight(st.width);
    if (lw !== undefined) {
      anyWeight = true;
      patchDxfy(layer, (dx, ov) => {
        const push = dx.push.bind(dx);
        ov.push = (code: number, value: number | string) => push(code, code === 370 ? lw : value);
      });
    }
  };
  const wanted = opts.layers ? new Set(opts.layers) : null;
  const dxfName = new Map<string, string>(); // CAD layer → DXF layer (exported layers only)
  const used = new Set<string>(['0']);
  for (const [name, hex] of layerHex) {
    if (wanted ? !wanted.has(name) : !visible.get(name)) continue;
    let base = sanitizeLayerName(name);
    // AutoCAD rejects a Defpoints layer without plot flag 290=0 ("Invalid plot flag"): the library cannot write it, so rename.
    if (base.toLowerCase() === 'defpoints') base += '_';
    // The writer always creates layer "0": reuse it for the drawing's own "0" instead of renaming to "0_2".
    const zero = base === '0' && !dxfName.has(name) ? w.tables.layer('0') : undefined;
    if (zero) {
      dxfName.set(name, '0');
      zero.colorNumber = nearestAci(hex);
      zero.trueColor = TrueColor.fromHex(hex);
      applyLayerStyle(zero, name);
      continue;
    }
    let cand = base;
    for (let n = 2; used.has(cand.toLowerCase()); n++) cand = `${base.slice(0, 250)}_${n}`;
    used.add(cand.toLowerCase());
    dxfName.set(name, cand);
    const layer = w.addLayer(cand, nearestAci(hex), 'Continuous');
    layer.trueColor = TrueColor.fromHex(hex);
    // A layer the drawing keeps but hides (the cadastral base of a cleaned plan) is written frozen.
    if (visible.get(name) === false) layer.flags = LayerFlags.Frozen;
    applyLayerStyle(layer, name);
  }
  if (anyWeight) w.setVariable('$LWDISPLAY', { 290: 1 });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  const common = (
    e: { layer: string; color: string },
    layer: string,
  ): { layerName: string; colorNumber?: number; trueColor?: string } => {
    const hex = normalizeHex(e.color);
    if (hex === layerHex.get(e.layer)) return { layerName: layer };
    return { layerName: layer, colorNumber: nearestAci(hex), trueColor: String(TrueColor.fromHex(hex)) };
  };

  const addText = (
    layer: string,
    color: { layer: string; color: string },
    t: Pick<TextEntity, 'text' | 'position' | 'height' | 'rotation' | 'hAlign' | 'vAlign'>,
  ): void => {
    const body = cleanText(t.text).trim();
    if (!finite(t.position) || body === '') return;
    const height = Number.isFinite(t.height) && t.height > 0 ? rnd(t.height) || 1e-6 : 1;
    const rotation = Number.isFinite(t.rotation) && t.rotation !== 0 ? rnd(((t.rotation % 360) + 360) % 360) : undefined;
    const x = rnd(t.position[0]);
    const y = rnd(t.position[1]);
    grow(x, y);
    const o = common(color, layer);
    if (body.includes('\n')) {
      const m = w.addMText(point3d(x, y, 0), height, mtextValue(body), {
        ...o,
        rotation,
        attachmentPoint: attachment(t.hAlign, t.vAlign),
      });
      m.textStyle = DXF_TEXT_STYLE;
      patchDxfy(m, (dx, ov) => {
        ov.primaryText = (s: string) => {
          let rest = s;
          while (rest.length > 250) {
            let cut = 250;
            const esc = /\\+$/.exec(rest.slice(0, cut));
            if (esc && esc[0].length % 2 === 1) cut--; // do not split an escape pair
            dx.push(3, rest.slice(0, cut));
            rest = rest.slice(cut);
          }
          dx.push(1, rest);
        };
      });
    } else {
      const aligned = t.hAlign !== 'left' || t.vAlign !== 'baseline';
      const tx = w.addText(point3d(x, y, 0), height, textValue(body), {
        ...o,
        rotation,
        ...(aligned
          ? { horizontalAlignment: H_TEXT[t.hAlign], verticalAlignment: V_TEXT[t.vAlign], secondAlignmentPoint: point3d(x, y, 0) }
          : {}),
      });
      tx.textStyle = DXF_TEXT_STYLE;
    }
  };

  const addPolygon = (e: PolygonEntity, layer: string): void => {
    const loops: Vec2[][] = [];
    for (const ring of e.rings) {
      if (!ring.every(finite)) continue;
      const pts = ring.map((p): Vec2 => [rnd(p[0]), rnd(p[1])]);
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) {
        if (loops.length === 0) return; // outer ring unusable → drop the polygon
        continue;
      }
      loops.push(pts);
    }
    if (loops.length === 0) return;
    const paths = new HatchBoundaryPaths();
    let hx0 = Infinity;
    let hy0 = Infinity;
    let hx1 = -Infinity;
    let hy1 = -Infinity;
    for (const pts of loops) {
      paths.addPolylineBoundary(new HatchPolylineBoundary(pts.map(([x, y]) => ({ x, y }))));
      for (const [x, y] of pts) {
        grow(x, y);
        hx0 = Math.min(hx0, x);
        hx1 = Math.max(hx1, x);
        hy0 = Math.min(hy0, y);
        hy1 = Math.max(hy1, y);
      }
    }
    const hatch = w.addHatch(paths, pattern({ name: HatchPredefinedPatterns.SOLID }), common(e, layer));
    // The library reports a hatch bbox at (0,0), which would corrupt the viewport; give it the real one.
    hatch.boundingBox = () =>
      ({ tl: point3d(hx0, hy1, 0), tr: point3d(hx1, hy1, 0), bl: point3d(hx0, hy0, 0), br: point3d(hx1, hy0, 0) }) as ReturnType<
        typeof hatch.boundingBox
      >;
    // A pattern hatch read from DWG/DXF keeps its pattern lines; otherwise a solid fill (tint).
    const def = e.hatch && e.hatch.lines.length ? e.hatch : null;
    const alpha = def ? 255 : Math.round(Math.min(1, Math.max(0, e.fillOpacity)) * 255);
    patchDxfy(hatch, (dx, ov) => {
      const push = dx.push.bind(dx);
      const subclassMarker = dx.subclassMarker.bind(dx);
      let loopIdx = 0;
      ov.push = (code: number, value: number | string) => {
        if (def && code === 2) push(2, sanitizeLayerName(e.pattern || 'PATTERN').replace(/\s+/g, '_').slice(0, 31) || 'PATTERN');
        else if (def && code === 70) push(70, 0); // pattern fill
        else if (def && code === 76) {
          push(76, def.type === 0 || def.type === 2 ? def.type : 1);
          push(52, rnd(def.angle));
          push(41, rnd(def.scale) || 1);
          push(77, def.double ? 1 : 0);
          push(78, def.lines.length);
          for (const l of def.lines) {
            push(53, rnd(l.angle));
            push(43, rnd(l.base[0]));
            push(44, rnd(l.base[1]));
            push(45, rnd(l.offset[0]));
            push(46, rnd(l.offset[1]));
            push(79, l.dashes.length);
            for (const d of l.dashes) push(49, rnd(d));
          }
        } else if (code === 92) push(92, loopIdx++ === 0 ? 3 : 2); // outer: External|Polyline, holes: Polyline
        else if (code === 75) push(75, 0); // hatch style: Normal (even-odd, holes stay holes)
        else if (code === 47) return; // pixel size: AutoCAD rejects it ("expected group code 98") for solid fills
        else push(code, value);
      };
      ov.subclassMarker = (name: string) => {
        if (name === 'AcDbHatch' && alpha < 255) push(440, 0x02000000 | alpha); // transparency
        subclassMarker(name);
      };
    });
  };

  const addTable = (e: TableEntity, layer: string): void => {
    const g = tableGeometry(e, planeMapper(e));
    if (!g) return;
    const o = common(e, layer);
    for (const [a, c] of g.lines) {
      const pts = [a, c].map((p): Vec2 => [rnd(p[0]), rnd(p[1])]);
      for (const [x, y] of pts) grow(x, y);
      w.addLWPolyline(
        pts.map(([x, y]) => ({ point: point2d(x, y) })),
        o,
      );
    }
    for (const cell of g.cells) {
      addText(layer, e, {
        text: cell.text,
        position: cell.centre,
        height: cell.textHeight,
        rotation: e.rotation,
        hAlign: 'center',
        vAlign: 'middle',
      });
    }
  };

  for (const e of doc.entities as CadEntity[]) {
    const layer = dxfName.get(e.layer);
    if (layer === undefined) continue;
    switch (e.kind) {
      case 'polyline': {
        if (!e.points.every(finite)) break;
        const pts = e.points.map((p): Vec2 => [rnd(p[0]), rnd(p[1])]);
        const closed = e.closed && pts.length >= 3;
        if (closed && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        if (pts.length < 2) break;
        for (const [x, y] of pts) grow(x, y);
        w.addLWPolyline(
          pts.map(([x, y]) => ({ point: point2d(x, y) })),
          {
            ...common(e, layer),
            ...lineTypeOf(e),
            flags: closed ? LWPolylineFlags.Closed : LWPolylineFlags.None,
            ...(e.width && e.width > 0 && Number.isFinite(e.width) ? { constantWidth: rnd(e.width) } : {}),
          },
        );
        break;
      }
      case 'polygon':
        addPolygon(e, layer);
        break;
      case 'text':
        addText(layer, e, e);
        break;
      case 'point':
        if (!finite(e.position)) break;
        grow(rnd(e.position[0]), rnd(e.position[1]));
        w.addPoint(rnd(e.position[0]), rnd(e.position[1]), 0, common(e, layer));
        break;
      case 'table':
        addTable(e, layer);
        break;
    }
  }

  if (minX <= maxX) {
    w.setVariable('$EXTMIN', { 10: minX, 20: minY, 30: 0 });
    w.setVariable('$EXTMAX', { 10: maxX, 20: maxY, 30: 0 });
  }
  return writeTextLineTypes(w.stringify(), [...written.values()], unitScale);
}
