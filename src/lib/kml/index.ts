// KML / KMZ → CadDocument (WGS84). Pure TS: runs in Web Workers and Node (no DOMParser).
//
// Mapping (see CLAUDE.md / task notes):
// - layer      = name of the innermost named <Folder> (fallback: enclosing <Document> name, then "KML");
//                layer colour = colour of its first entity; layers are created in order of first entity.
// - LineString → polyline (width is NOT imported: KML width is in pixels, IR width in metres); a LineString
//   whose last point equals the first (>= 4 points) is a closed polyline (this is how our export writes them).
// - LinearRing (alone) → closed polyline; Polygon → polygon (outer + inner rings, closing point dropped).
//   PolyStyle `<fill>0</fill>` (or alpha 0) → the rings become closed polylines in the LineStyle colour.
// - Point with a visible name → text AND point (point only when the icon is not hidden by scale 0);
//   Point without name → point. Text height inverts our exporter: labelScale(h) = clamp(round1(sqrt(h/3)),0.5,2)
//   ⇒ h = 3 · scale² (scale 1 / missing → 3 m). hAlign 'left', vAlign 'middle', rotation 0.
//   Multi-line text is restored from a `<description>` made only of <br/> whose collapsed text equals the name.
// - Our own table export round-trips as polylines + texts; the "Bảng (HTML)" placemark is skipped.
// - Skipped with one warning per type: gx:Track / gx:MultiTrack, Model, GroundOverlay, ScreenOverlay,
//   PhotoOverlay, NetworkLink.
import JSZip from 'jszip';
import { robustBBox } from '@/lib/cad/normalize/bbox';
import type { CadDocument, CadEntity, CadLayer, Vec2 } from '@/lib/cad/types';
import { WGS84_PROJ4 } from '@/lib/geo/crs';
import { kmlColorToHex } from '@/lib/export/color';
import { child, childText, decodeEntities, parseXml, type XmlNode } from './xml';

/** Name of the table-description placemark written by our exporter (not a real label). */
const TABLE_HTML_NAME = 'Bảng (HTML)';
const DEFAULT_COLOR = '#ffffff';
const DEFAULT_TEXT_HEIGHT = 3;

interface Rgba {
  hex: string;
  alpha: number;
}

interface StyleInfo {
  lineColor?: Rgba;
  polyColor?: Rgba;
  polyFill?: boolean;
  iconColor?: Rgba;
  iconScale?: number;
  labelColor?: Rgba;
  labelScale?: number;
}

function parseColor(s: string): Rgba | undefined {
  const t = s.trim();
  if (!/^[0-9a-fA-F]{8}$/.test(t)) return undefined;
  return kmlColorToHex(t);
}

function parseNum(s: string): number | undefined {
  if (s === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

function parseStyleNode(node: XmlNode): StyleInfo {
  const st: StyleInfo = {};
  const line = child(node, 'LineStyle');
  if (line) st.lineColor = parseColor(childText(line, 'color'));
  const poly = child(node, 'PolyStyle');
  if (poly) {
    st.polyColor = parseColor(childText(poly, 'color'));
    const f = childText(poly, 'fill');
    if (f !== '') st.polyFill = f !== '0' && f.toLowerCase() !== 'false';
  }
  const icon = child(node, 'IconStyle');
  if (icon) {
    st.iconColor = parseColor(childText(icon, 'color'));
    st.iconScale = parseNum(childText(icon, 'scale'));
  }
  const label = child(node, 'LabelStyle');
  if (label) {
    st.labelColor = parseColor(childText(label, 'color'));
    st.labelScale = parseNum(childText(label, 'scale'));
  }
  return st;
}

function mergeStyle(base: StyleInfo, over: StyleInfo): StyleInfo {
  const out: StyleInfo = { ...base };
  for (const k of Object.keys(over) as (keyof StyleInfo)[]) {
    if (over[k] !== undefined) (out as Record<string, unknown>)[k] = over[k];
  }
  return out;
}

class StyleTable {
  private nodes = new Map<string, XmlNode>();
  private cache = new Map<string, StyleInfo>();

  constructor(root: XmlNode) {
    const stack: XmlNode[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      if ((n.name === 'Style' || n.name === 'StyleMap') && n.attrs?.id) this.nodes.set(n.attrs.id, n);
      for (const c of n.children) {
        // Placemark geometry never contains styles: skip big subtrees quickly.
        if (c.name !== 'Placemark') stack.push(c);
      }
    }
  }

  byUrl(url: string): StyleInfo {
    const h = url.indexOf('#');
    if (h < 0) return {};
    return this.byId(url.slice(h + 1), 0);
  }

  private byId(id: string, depth: number): StyleInfo {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const node = this.nodes.get(id);
    let st: StyleInfo = {};
    if (node && depth < 8) {
      if (node.name === 'Style') st = parseStyleNode(node);
      else {
        for (const pair of node.children) {
          if (pair.name !== 'Pair' || childText(pair, 'key') !== 'normal') continue;
          const inline = child(pair, 'Style');
          const url = childText(pair, 'styleUrl');
          st = inline ? parseStyleNode(inline) : url ? this.byId(url.slice(url.indexOf('#') + 1), depth + 1) : {};
        }
      }
    }
    this.cache.set(id, st);
    return st;
  }

  /** Style of a Placemark: its styleUrl, overridden by an inline <Style>. */
  forPlacemark(pm: XmlNode): StyleInfo {
    let st: StyleInfo = {};
    const url = childText(pm, 'styleUrl');
    if (url) st = this.byUrl(url);
    const inline = child(pm, 'Style');
    if (inline) st = mergeStyle(st, parseStyleNode(inline));
    else {
      const map = child(pm, 'StyleMap');
      if (map) {
        for (const pair of map.children) {
          if (pair.name === 'Pair' && childText(pair, 'key') === 'normal') {
            const s2 = child(pair, 'Style');
            const u2 = childText(pair, 'styleUrl');
            st = mergeStyle(st, s2 ? parseStyleNode(s2) : u2 ? this.byUrl(u2) : {});
          }
        }
      }
    }
    return st;
  }
}

// ---------------------------------------------------------------- coordinates

/** Parse a KML `<coordinates>` string → [lng, lat] list; `bad` counts malformed tuples. */
export function parseCoordinates(text: string): { points: Vec2[]; bad: number } {
  const points: Vec2[] = [];
  let bad = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && text.charCodeAt(i) <= 32) i++;
    if (i >= n) break;
    let j = i;
    while (j < n && text.charCodeAt(j) > 32) j++;
    const c1 = text.indexOf(',', i);
    if (c1 < 0 || c1 >= j) {
      bad++;
    } else {
      let c2 = text.indexOf(',', c1 + 1);
      if (c2 < 0 || c2 > j) c2 = j;
      const lng = parseFloat(text.slice(i, c1));
      const lat = parseFloat(text.slice(c1 + 1, c2));
      if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) points.push([lng, lat]);
      else bad++;
    }
    i = j;
  }
  return { points, bad };
}

function dropClosing(pts: Vec2[]): Vec2[] {
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return pts.slice(0, -1);
  }
  return pts;
}

// ---------------------------------------------------------------- description → multi-line text

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

function multilineFromDescription(desc: string, name: string): string | null {
  if (!/<br\s*\/?>/i.test(desc)) return null;
  const withBreaks = desc.replace(/<br\s*\/?>/gi, '\n');
  if (withBreaks.includes('<')) return null; // real HTML: not ours
  const text = decodeEntities(withBreaks).normalize('NFC').trim();
  return collapse(text) === collapse(name) ? text : null;
}

// ---------------------------------------------------------------- importer

const UNSUPPORTED_LABEL: Record<string, string> = {
  Track: 'gx:Track',
  MultiTrack: 'gx:MultiTrack',
  Model: 'Model (3D)',
  GroundOverlay: 'GroundOverlay (ảnh phủ)',
  ScreenOverlay: 'ScreenOverlay',
  PhotoOverlay: 'PhotoOverlay',
  NetworkLink: 'NetworkLink',
};

class Importer {
  entities: CadEntity[] = [];
  layers: CadLayer[] = [];
  private layerIndex = new Set<string>();
  private unsupported = new Map<string, number>();
  private badTuples = 0;
  private degenerate = 0;
  private styles: StyleTable;

  constructor(root: XmlNode) {
    this.styles = new StyleTable(root);
    this.walk(root, null, null);
  }

  private add(layer: string, e: CadEntity): void {
    if (!this.layerIndex.has(layer)) {
      this.layerIndex.add(layer);
      this.layers.push({ name: layer, color: e.color, visible: true });
    }
    this.entities.push(e);
  }

  private walk(node: XmlNode, folder: string | null, fallback: string | null): void {
    for (const c of node.children) {
      switch (c.name) {
        case 'Folder': {
          const name = childText(c, 'name').normalize('NFC');
          this.walk(c, name || folder, fallback);
          break;
        }
        case 'Document': {
          const name = childText(c, 'name').normalize('NFC');
          this.walk(c, folder, name || fallback);
          break;
        }
        case 'kml':
        case '#root':
          this.walk(c, folder, fallback);
          break;
        case 'Placemark':
          this.placemark(c, folder ?? fallback ?? 'KML');
          break;
        default:
          if (c.name === 'GroundOverlay' || c.name === 'ScreenOverlay' || c.name === 'PhotoOverlay' || c.name === 'NetworkLink') {
            this.unsupported.set(c.name, (this.unsupported.get(c.name) ?? 0) + 1);
          }
      }
    }
  }

  private placemark(pm: XmlNode, layer: string): void {
    const name = childText(pm, 'name').normalize('NFC');
    if (name === TABLE_HTML_NAME && /<table/i.test(childText(pm, 'description'))) return; // our own HTML table
    const style = this.styles.forPlacemark(pm);
    for (const g of pm.children) this.geometry(g, layer, name, style, pm);
  }

  private geometry(g: XmlNode, layer: string, name: string, style: StyleInfo, pm: XmlNode): void {
    switch (g.name) {
      case 'Point':
        return this.point(g, layer, name, style, pm);
      case 'LineString': {
        const pts = this.coords(g);
        if (pts.length < 2) return void this.degenerate++;
        // A LineString whose last point repeats the first (our export of closed polylines) is a closed polyline.
        const closed = pts.length >= 4 && dropClosing(pts).length < pts.length;
        this.add(layer, {
          kind: 'polyline',
          layer,
          color: (style.lineColor ?? style.polyColor)?.hex ?? DEFAULT_COLOR,
          points: closed ? dropClosing(pts) : pts,
          closed,
        });
        return;
      }
      case 'LinearRing': {
        const pts = dropClosing(this.coords(g));
        if (pts.length < 3) return void this.degenerate++;
        this.add(layer, { kind: 'polyline', layer, color: (style.lineColor ?? style.polyColor)?.hex ?? DEFAULT_COLOR, points: pts, closed: true });
        return;
      }
      case 'Polygon':
        return this.polygon(g, layer, style);
      case 'MultiGeometry':
        for (const c of g.children) this.geometry(c, layer, name, style, pm);
        return;
      case 'Track':
      case 'MultiTrack':
      case 'Model':
        this.unsupported.set(g.name, (this.unsupported.get(g.name) ?? 0) + 1);
        return;
      default:
        return;
    }
  }

  private coords(g: XmlNode): Vec2[] {
    const el = child(g, 'coordinates');
    if (!el) return [];
    const r = parseCoordinates(el.text);
    this.badTuples += r.bad;
    return r.points;
  }

  private point(g: XmlNode, layer: string, name: string, style: StyleInfo, pm: XmlNode): void {
    const pts = this.coords(g);
    if (pts.length === 0) return void this.degenerate++;
    const position = pts[0];
    const labelHidden = style.labelScale === 0;
    if (name !== '' && !labelHidden) {
      const scale = style.labelScale !== undefined && style.labelScale > 0 ? style.labelScale : 1;
      const desc = childText(pm, 'description');
      const text = (desc && multilineFromDescription(desc, name)) || name;
      this.add(layer, {
        kind: 'text',
        layer,
        color: (style.labelColor ?? style.iconColor)?.hex ?? DEFAULT_COLOR,
        text,
        position,
        height: DEFAULT_TEXT_HEIGHT * scale * scale,
        rotation: 0,
        hAlign: 'left',
        vAlign: 'middle',
      });
      if (style.iconScale === 0) return;
    }
    this.add(layer, { kind: 'point', layer, color: (style.iconColor ?? style.labelColor)?.hex ?? DEFAULT_COLOR, position });
  }

  private polygon(g: XmlNode, layer: string, style: StyleInfo): void {
    const rings: Vec2[][] = [];
    for (const b of g.children) {
      if (b.name !== 'outerBoundaryIs' && b.name !== 'innerBoundaryIs') continue;
      const lr = child(b, 'LinearRing');
      if (!lr) continue;
      const ring = dropClosing(this.coords(lr));
      if (ring.length >= 3) {
        if (b.name === 'outerBoundaryIs') rings.unshift(ring);
        else rings.push(ring);
      } else if (b.name === 'outerBoundaryIs') {
        this.degenerate++;
        return;
      }
    }
    if (rings.length === 0) return void this.degenerate++;
    const fillAlpha = style.polyColor?.alpha ?? 1;
    const fill = style.polyFill !== false && fillAlpha > 0;
    if (!fill) {
      const color = (style.lineColor ?? style.polyColor)?.hex ?? DEFAULT_COLOR;
      for (const r of rings) this.add(layer, { kind: 'polyline', layer, color, points: r, closed: true });
      return;
    }
    this.add(layer, {
      kind: 'polygon',
      layer,
      color: (style.polyColor ?? style.lineColor)?.hex ?? DEFAULT_COLOR,
      fillOpacity: fillAlpha,
      rings,
    });
  }

  warnings(): string[] {
    const w: string[] = [];
    for (const [type, n] of this.unsupported) {
      w.push(`Đã bỏ qua ${n} đối tượng ${UNSUPPORTED_LABEL[type] ?? type} (KML không được hỗ trợ).`);
    }
    if (this.badTuples > 0) w.push(`Đã bỏ qua ${this.badTuples} tọa độ KML không hợp lệ.`);
    if (this.degenerate > 0) w.push(`Đã bỏ qua ${this.degenerate} đối tượng KML thiếu hoặc sai hình học (quá ít điểm).`);
    return w;
  }
}

export function parseKmlString(kml: string): CadDocument {
  const root = parseXml(kml);
  const imp = new Importer(root);
  const warnings = imp.warnings();
  if (imp.entities.length === 0) warnings.push('Không tìm thấy đối tượng (Placemark) nào trong file KML.');
  return {
    units: 'deg',
    crs: WGS84_PROJ4,
    layers: imp.layers,
    entities: imp.entities,
    bbox: robustBBox(imp.entities),
    warnings,
  };
}

const utf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/** `.kmz` (zip: `doc.kml` or the first `*.kml`) or `.kml` text. */
export async function parseKmlFile(data: ArrayBuffer, fileName: string): Promise<CadDocument> {
  const u8 = new Uint8Array(data);
  const isZip = u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 3 || u8[2] === 5) && (u8[3] === 4 || u8[3] === 6);
  if (isZip || /\.kmz$/i.test(fileName)) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(data);
    } catch {
      throw new Error('File KMZ không hợp lệ (không giải nén được).');
    }
    const files = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name));
    const pick = files.find((f) => f.name.toLowerCase() === 'doc.kml') ?? files.find((f) => !f.name.includes('/')) ?? files[0];
    if (!pick) throw new Error('File KMZ không chứa file .kml nào.');
    return parseKmlString(utf8(await pick.async('uint8array')));
  }
  return parseKmlString(utf8(u8));
}
