// CadDocument (WGS84) → KML 2.2 string.
//
// Design notes (see report / CLAUDE.md "Các điểm khó" #6):
// - One <Folder> per CAD layer, shared <Style>s deduplicated by (kind, colour, width/fill/scale).
// - Text labels: Point Placemark + IconStyle scale 0 (icon hidden, label kept — Google Earth Pro/Web
//   behaviour). An explicit <Icon> (small placemark_circle) is still written so viewers that ignore
//   scale 0 (e.g. some third-party / My Maps importers) fall back to a tiny dot instead of the big
//   default yellow pushpin.
// - Label scale from text height h (metres): scale = clamp(round1(sqrt(h / 3)), 0.5, 2).
//   KML labels are screen-space (do not grow with zoom), so we only compress the CAD size range:
//   3 m text → 1.0 (default GE font), 0.75 m → 0.5, 12 m+ → 2.0.
// - Everything is pushed into string arrays and joined once (O(n)).
import type {
  CadDocument,
  CadEntity,
  PointEntity,
  PolygonEntity,
  PolylineEntity,
  TableEntity,
  TextEntity,
  Vec2,
} from '@/lib/cad/types';
import { hexToKmlColor } from './color';
import { cdata, escapeHtml, escapeXml } from './xml';

export interface ExportOptions {
  /** Document name shown in Google Earth. */
  name: string;
  /** Layers to include; undefined = all visible layers. */
  layers?: string[];
  textAsLabels: boolean;
  tableAsHtml: boolean;
}

export interface KmlBuildResult {
  kml: string;
  /** Number of Placemarks written. */
  placemarks: number;
  /** Entities dropped because of degenerate / non-finite geometry. */
  skipped: number;
}

export const LABEL_ICON_HREF = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png';

const round1 = (x: number): number => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** LabelStyle scale for a text height in metres (see header comment). */
export function labelScale(heightM: number): number {
  if (!(heightM > 0) || !Number.isFinite(heightM)) return 1;
  return clamp(round1(Math.sqrt(heightM / 3)), 0.5, 2);
}

/** LineStyle width (pixels) for a CAD constant width in metres: 1 + w, clamped 1..6, step 0.5. */
export function lineWidthPx(widthM: number | undefined): number {
  if (!widthM || !(widthM > 0) || !Number.isFinite(widthM)) return 1;
  return clamp(Math.round((1 + widthM) * 2) / 2, 1, 6);
}

/** Metres per degree of latitude / longitude at a given latitude (WGS84 series). */
export function metresPerDegree(latDeg: number): { lat: number; lng: number } {
  const phi = (latDeg * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi),
    lng: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

const isFiniteVec = (p: Vec2 | undefined): p is Vec2 =>
  !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]);

const coord = (p: Vec2): string => p[0].toFixed(8) + ',' + p[1].toFixed(8) + ',0';

function coordList(points: Vec2[], close: boolean): string | null {
  const out: string[] = [];
  for (const p of points) {
    if (!isFiniteVec(p)) return null;
    out.push(coord(p));
  }
  if (close && points.length > 0) {
    const a = points[0];
    const b = points[points.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push(out[0]);
  }
  return out.join(' ');
}

/** Single-line label text: newlines/tabs → single spaces. */
const oneLine = (s: string): string => s.replace(/\s*[\r\n\t]+\s*/g, ' ').trim();

/** Multi-line text → HTML with <br>. */
const htmlLines = (s: string): string => escapeHtml(s).replace(/\r\n|\r|\n/g, '<br/>');

// ---------------------------------------------------------------- styles

class StyleRegistry {
  private ids = new Map<string, string>();
  private xml: string[] = [];

  private get(key: string, body: () => string): string {
    let id = this.ids.get(key);
    if (id === undefined) {
      id = 's' + this.ids.size;
      this.ids.set(key, id);
      this.xml.push('<Style id="', id, '">', body(), '</Style>\n');
    }
    return id;
  }

  line(color: string, width: number | undefined): string {
    const c = hexToKmlColor(color);
    const w = lineWidthPx(width);
    return this.get(`L|${c}|${w}`, () => `<LineStyle><color>${c}</color><width>${w}</width></LineStyle>`);
  }

  poly(color: string, fillOpacity: number): string {
    const line = hexToKmlColor(color);
    const fill = hexToKmlColor(color, fillOpacity);
    const doFill = fill.slice(0, 2) !== '00' ? 1 : 0;
    return this.get(
      `P|${fill}|${doFill}`,
      () =>
        `<LineStyle><color>${line}</color><width>1</width></LineStyle>` +
        `<PolyStyle><color>${fill}</color><fill>${doFill}</fill><outline>1</outline></PolyStyle>`,
    );
  }

  label(color: string, scale: number): string {
    const c = hexToKmlColor(color);
    return this.get(
      `T|${c}|${scale}`,
      () =>
        `<IconStyle><scale>0</scale><Icon><href>${LABEL_ICON_HREF}</href></Icon></IconStyle>` +
        `<LabelStyle><color>${c}</color><scale>${scale}</scale></LabelStyle>`,
    );
  }

  point(color: string): string {
    const c = hexToKmlColor(color);
    return this.get(
      `D|${c}`,
      () =>
        `<IconStyle><color>${c}</color><scale>0.5</scale><Icon><href>${LABEL_ICON_HREF}</href></Icon></IconStyle>` +
        `<LabelStyle><scale>0</scale></LabelStyle>`,
    );
  }

  toXml(): string {
    return this.xml.join('');
  }
}

// ---------------------------------------------------------------- writer

const CLAMP = '<altitudeMode>clampToGround</altitudeMode>';

class Writer {
  out: string[] = [];
  placemarks = 0;
  skipped = 0;
  constructor(
    readonly styles: StyleRegistry,
    readonly opts: ExportOptions,
  ) {}

  private pointPlacemark(styleId: string, p: Vec2, name: string | null, descHtml: string | null): void {
    const o = this.out;
    o.push('<Placemark>');
    if (name !== null) o.push('<name>', escapeXml(name), '</name>');
    if (descHtml !== null) o.push('<description>', cdata(descHtml), '</description>');
    o.push('<styleUrl>#', styleId, '</styleUrl><Point>', CLAMP, '<coordinates>', coord(p), '</coordinates></Point></Placemark>\n');
    this.placemarks++;
  }

  polyline(e: PolylineEntity): void {
    const closed = e.closed && e.points.length >= 3;
    const cs = e.points.length >= 2 ? coordList(e.points, closed) : null;
    if (cs === null) {
      this.skipped++;
      return;
    }
    this.out.push(
      '<Placemark><styleUrl>#', this.styles.line(e.color, e.width), '</styleUrl><LineString><tessellate>1</tessellate>',
      CLAMP, '<coordinates>', cs, '</coordinates></LineString></Placemark>\n',
    );
    this.placemarks++;
  }

  polygon(e: PolygonEntity): void {
    const rings: string[] = [];
    for (const ring of e.rings) {
      if (ring.length < 3) {
        if (rings.length === 0) break; // degenerate outer ring → drop whole polygon
        continue;
      }
      const cs = coordList(ring, true);
      if (cs === null) {
        rings.length = 0;
        break;
      }
      rings.push(cs);
    }
    if (rings.length === 0) {
      this.skipped++;
      return;
    }
    const o = this.out;
    o.push('<Placemark><styleUrl>#', this.styles.poly(e.color, e.fillOpacity), '</styleUrl><Polygon><tessellate>1</tessellate>', CLAMP);
    o.push('<outerBoundaryIs><LinearRing><coordinates>', rings[0], '</coordinates></LinearRing></outerBoundaryIs>');
    for (let i = 1; i < rings.length; i++) {
      o.push('<innerBoundaryIs><LinearRing><coordinates>', rings[i], '</coordinates></LinearRing></innerBoundaryIs>');
    }
    o.push('</Polygon></Placemark>\n');
    this.placemarks++;
  }

  point(e: PointEntity): void {
    if (!isFiniteVec(e.position)) {
      this.skipped++;
      return;
    }
    this.pointPlacemark(this.styles.point(e.color), e.position, null, null);
  }

  text(e: TextEntity): void {
    const name = oneLine(e.text);
    if (!name || !isFiniteVec(e.position)) {
      this.skipped++;
      return;
    }
    // Full text (with line breaks) only when it differs from the one-line name, to keep files small.
    const desc = /[\r\n]/.test(e.text) ? htmlLines(e.text.trim()) : null;
    this.pointPlacemark(this.styles.label(e.color, labelScale(e.height)), e.position, name, desc);
  }

  table(e: TableEntity): void {
    const g = tableGeometry(e);
    if (!g) {
      this.skipped++;
      return;
    }
    const o = this.out;
    o.push('<Folder><name>', escapeXml(tableName(e)), '</name>\n');

    // Grid lines: one Placemark, MultiGeometry of merged straight runs.
    if (g.lines.length > 0) {
      o.push('<Placemark><name>Đường kẻ bảng</name><styleUrl>#', this.styles.line(e.color, 0), '</styleUrl><MultiGeometry>');
      for (const [a, b] of g.lines) {
        o.push('<LineString><tessellate>1</tessellate>', CLAMP, '<coordinates>', coord(a), ' ', coord(b), '</coordinates></LineString>');
      }
      o.push('</MultiGeometry></Placemark>\n');
      this.placemarks++;
    }

    // One label per (anchor) cell at its centre.
    for (const cell of g.cells) {
      const name = oneLine(cell.text);
      if (!name) continue;
      const desc = /[\r\n]/.test(cell.text) ? htmlLines(cell.text.trim()) : null;
      this.pointPlacemark(this.styles.label(e.color, labelScale(cell.textHeight)), cell.centre, name, desc);
    }

    if (this.opts.tableAsHtml) {
      this.pointPlacemark(this.styles.point(e.color), g.anchor, 'Bảng (HTML)', tableHtml(e, g));
    }
    o.push('</Folder>\n');
  }

  entity(e: CadEntity): void {
    switch (e.kind) {
      case 'polyline':
        return this.polyline(e);
      case 'polygon':
        return this.polygon(e);
      case 'point':
        return this.point(e);
      case 'text':
        if (this.opts.textAsLabels) this.text(e);
        return;
      case 'table':
        return this.table(e);
    }
  }
}

// ---------------------------------------------------------------- tables

interface PlacedCell {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  centre: Vec2;
  /** Text height (m): cell.textHeight when given, else 40 % of the first row height. */
  textHeight: number;
}

export interface TableGeometry {
  rows: number;
  cols: number;
  /** Anchor cells in row-major order, spans clamped to the grid, overlaps removed. */
  cells: PlacedCell[];
  /** owner[r*cols+c] = index into cells, or -1 for an empty grid position. */
  owner: Int32Array;
  lines: [Vec2, Vec2][];
  anchor: Vec2;
}

function tableName(e: TableEntity): string {
  return e.handle ? `Bảng ${e.handle}` : 'Bảng';
}

function positiveSizes(a: number[]): number[] | null {
  for (const v of a) if (!(v >= 0) || !Number.isFinite(v)) return null;
  return a;
}

/** Local table coordinates (x right, y down from the top-left origin) → output coordinates. */
export type TableMapper = (x: number, y: number) => Vec2;

/** Mapper for tables already in a metric plane (drawing coordinates): origin + rotation. */
export function planeMapper(e: TableEntity): TableMapper {
  const rot = ((Number.isFinite(e.rotation) ? e.rotation : 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return (x, y) => [e.origin[0] + x * cos + y * sin, e.origin[1] + x * sin - y * cos];
}

/**
 * Compute the geometry of a table (corners from origin/rowHeights/colWidths/rotation).
 * Default mapper = WGS84 degrees (table sizes in metres); pass `planeMapper(e)` for metric coordinates (DXF export).
 */
export function tableGeometry(e: TableEntity, mapper?: TableMapper): TableGeometry | null {
  if (!isFiniteVec(e.origin)) return null;
  const rh = positiveSizes(e.rowHeights.slice(0, Math.max(0, e.rows)));
  const cw = positiveSizes(e.colWidths.slice(0, Math.max(0, e.cols)));
  if (!rh || !cw || rh.length === 0 || cw.length === 0) return null;
  const rows = rh.length;
  const cols = cw.length;

  // Grid boundaries in metres: x to the right, y downward from the top-left origin.
  const xs = [0];
  for (const w of cw) xs.push(xs[xs.length - 1] + w);
  const ys = [0];
  for (const h of rh) ys.push(ys[ys.length - 1] + h);

  const m = metresPerDegree(e.origin[1]);
  const rot = ((Number.isFinite(e.rotation) ? e.rotation : 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  // Local (x right, y down) → east/north metres: u = (cos, sin), down = (sin, -cos).
  const toLngLat: TableMapper =
    mapper ??
    ((x, y) => {
      const east = x * cos + y * sin;
      const north = x * sin - y * cos;
      return [e.origin[0] + east / m.lng, e.origin[1] + north / m.lat];
    });

  // Anchor cells, spans clamped; later overlapping cells are dropped.
  const owner = new Int32Array(rows * cols).fill(-1);
  const sorted = e.cells
    .filter((c) => c.r >= 0 && c.c >= 0 && c.r < rows && c.c < cols)
    .slice()
    .sort((a, b) => a.r - b.r || a.c - b.c);
  const cells: PlacedCell[] = [];
  for (const c of sorted) {
    if (owner[c.r * cols + c.c] !== -1) continue;
    const r1 = Math.min(rows, c.r + Math.max(1, Math.floor(c.rowSpan) || 1));
    const c1 = Math.min(cols, c.c + Math.max(1, Math.floor(c.colSpan) || 1));
    let free = true;
    for (let r = c.r; r < r1 && free; r++) for (let k = c.c; k < c1; k++) if (owner[r * cols + k] !== -1) free = false;
    const rr1 = free ? r1 : c.r + 1;
    const cc1 = free ? c1 : c.c + 1;
    const idx = cells.length;
    for (let r = c.r; r < rr1; r++) for (let k = c.c; k < cc1; k++) owner[r * cols + k] = idx;
    cells.push({
      r: c.r,
      c: c.c,
      rowSpan: rr1 - c.r,
      colSpan: cc1 - c.c,
      text: c.text,
      centre: toLngLat((xs[c.c] + xs[cc1]) / 2, (ys[c.r] + ys[rr1]) / 2),
      textHeight: c.textHeight !== undefined && c.textHeight > 0 && Number.isFinite(c.textHeight) ? c.textHeight : 0.4 * rh[c.r],
    });
  }

  // Unit edges: a grid edge is drawn when the two sides belong to different owners
  // (empty positions are their own 1x1 cell; the table border is always drawn).
  const own = (r: number, c: number): number =>
    r < 0 || c < 0 || r >= rows || c >= cols ? -2 : owner[r * cols + c] === -1 ? -3 - (r * cols + c) : owner[r * cols + c];
  const lines: [Vec2, Vec2][] = [];
  // Horizontal boundaries y = ys[i], merged runs along columns.
  for (let i = 0; i <= rows; i++) {
    let start = -1;
    for (let j = 0; j <= cols; j++) {
      const on = j < cols && own(i - 1, j) !== own(i, j);
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        lines.push([toLngLat(xs[start], ys[i]), toLngLat(xs[j], ys[i])]);
        start = -1;
      }
    }
  }
  // Vertical boundaries x = xs[j], merged runs along rows.
  for (let j = 0; j <= cols; j++) {
    let start = -1;
    for (let i = 0; i <= rows; i++) {
      const on = i < rows && own(i, j - 1) !== own(i, j);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        lines.push([toLngLat(xs[j], ys[start]), toLngLat(xs[j], ys[i])]);
        start = -1;
      }
    }
  }

  return { rows, cols, cells, owner, lines, anchor: toLngLat(0, 0) };
}

/** HTML <table> with rowspan/colspan for merged cells. */
export function tableHtml(e: TableEntity, g: TableGeometry): string {
  const o: string[] = ['<table border="1" cellpadding="3" cellspacing="0" style="border-collapse:collapse">'];
  for (let r = 0; r < g.rows; r++) {
    o.push('<tr>');
    for (let c = 0; c < g.cols; c++) {
      const idx = g.owner[r * g.cols + c];
      if (idx === -1) {
        o.push('<td></td>');
        continue;
      }
      const cell = g.cells[idx];
      if (cell.r !== r || cell.c !== c) continue; // covered by a merge
      o.push('<td');
      if (cell.rowSpan > 1) o.push(' rowspan="', String(cell.rowSpan), '"');
      if (cell.colSpan > 1) o.push(' colspan="', String(cell.colSpan), '"');
      o.push('>', htmlLines(cell.text), '</td>');
    }
    o.push('</tr>');
  }
  o.push('</table>');
  void e;
  return o.join('');
}

// ---------------------------------------------------------------- document

/** Ordered list of layer names to export (doc.layers order, then layers only seen on entities). */
function selectLayers(doc: CadDocument, opts: ExportOptions): string[] {
  const known = new Map(doc.layers.map((l) => [l.name, l] as const));
  const order: string[] = doc.layers.map((l) => l.name);
  const seen = new Set(order);
  for (const e of doc.entities) {
    if (!seen.has(e.layer)) {
      seen.add(e.layer);
      order.push(e.layer);
    }
  }
  if (opts.layers) {
    const wanted = new Set(opts.layers);
    return order.filter((n) => wanted.has(n));
  }
  // Layers not declared in doc.layers are treated as visible.
  return order.filter((n) => known.get(n)?.visible ?? true);
}

export function buildKml(doc: CadDocument, opts: ExportOptions): KmlBuildResult {
  const layerNames = selectLayers(doc, opts);
  const index = new Map<string, number>();
  layerNames.forEach((n, i) => index.set(n, i));

  // Bucket entities per layer (stable order).
  const buckets: CadEntity[][] = layerNames.map(() => []);
  for (const e of doc.entities) {
    const i = index.get(e.layer);
    if (i !== undefined) buckets[i].push(e);
  }

  const styles = new StyleRegistry();
  const w = new Writer(styles, opts);
  for (let i = 0; i < layerNames.length; i++) {
    if (buckets[i].length === 0) continue;
    const before = w.out.length;
    w.out.push('<Folder><name>', escapeXml(layerNames[i]), '</name>\n');
    const mark = w.out.length;
    for (const e of buckets[i]) w.entity(e);
    if (w.out.length === mark) w.out.length = before; // nothing written → drop empty folder
    else w.out.push('</Folder>\n');
  }

  const kml = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n',
    '<name>', escapeXml(opts.name), '</name>\n<open>1</open>\n',
    styles.toXml(),
    w.out.join(''),
    '</Document>\n</kml>\n',
  ].join('');
  return { kml, placemarks: w.placemarks, skipped: w.skipped };
}

export function toKml(doc: CadDocument, opts: ExportOptions): string {
  return buildKml(doc, opts).kml;
}
