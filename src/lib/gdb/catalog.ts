// File Geodatabase catalog: which feature datasets / feature classes a .gdb holds, with fields, geometry type,
// spatial reference and row access. Input is a flat list of files (from a dropped folder or a .zip) — every
// directory that contains `a00000001.gdbtable` (GDB_SystemCatalog) is one geodatabase.
import { GdbFormatError, readTable, tableFileName, type GdbField, type GdbTable, type GdbValue } from './filegdb';
import type { GeomCode } from './tt16';

export interface GdbEntry {
  /** Path with `/` separators, relative to what the user picked (e.g. `HoSoGIS/HienTrang.gdb/a00000004.gdbtable`). */
  path: string;
  read: () => Promise<Uint8Array>;
}

export interface GdbSource {
  /** Directory name, e.g. `HienTrang.gdb`. */
  name: string;
  /** Full directory path. */
  dir: string;
  /** Parent directory path ('' at the root of the selection). */
  parent: string;
  /** Lower-cased file name → entry. */
  files: Map<string, GdbEntry>;
}

export interface GdbClass {
  name: string;
  /** Catalog path, e.g. `\ViTriRanhGioi\RanhGioiHanhChinh_L`. */
  path: string;
  /** Feature dataset name, null when the class sits at the root of the geodatabase. */
  dataset: string | null;
  alias: string;
  /** esriGeometryPolygon / esriGeometryPolyline / esriGeometryPoint… */
  shapeType: string;
  geom: GeomCode | null;
  /** Projected/geographic coordinate system name from the WKT (`VN_2000_Tra_Vinh_3deg`). */
  srName: string | null;
  /** Spatial reference WKT ('' when unknown). */
  wkt: string;
  /** Data extent [xmin, ymin, xmax, ymax] in the class's own coordinates (null when empty / unknown). */
  extent: [number, number, number, number] | null;
  fields: GdbField[];
  rowCount: number;
  rows: () => Generator<Record<string, GdbValue>>;
  /** Set when the class table itself could not be read (fields/rows unavailable). */
  error?: string;
}

export interface GdbTableItem {
  name: string;
  dataset: string | null;
}

export interface GdbCatalog {
  datasets: string[];
  /** Spatial reference WKT of each feature dataset (by name). */
  datasetWkts?: Record<string, string>;
  classes: GdbClass[];
  /** Plain tables (no geometry) — listed, not checked. */
  tables: GdbTableItem[];
}

const TYPE_FEATURE_DATASET = '{74737149-DCB5-4257-8904-B9724E32A530}';
const TYPE_FEATURE_CLASS = '{70737809-852C-4A03-9E22-2CECEA5B9BFA}';
const TYPE_TABLE = '{CD06BC3B-789D-4C51-AAFA-A467912B8965}';

const SYSTEM_CATALOG = 'a00000001.gdbtable';

/** Groups the picked files into geodatabases; also returns the other (non-gdb) file paths. */
export function collectGdbs(entries: GdbEntry[]): { gdbs: GdbSource[]; others: string[] } {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const dirs = new Set<string>();
  for (const e of entries) {
    const p = norm(e.path);
    if (p.toLowerCase().endsWith('/' + SYSTEM_CATALOG) || p.toLowerCase() === SYSTEM_CATALOG) dirs.add(dirOf(p));
  }
  const byDir = new Map<string, GdbSource>();
  for (const dir of dirs) {
    const name = dir.includes('/') ? dir.slice(dir.lastIndexOf('/') + 1) : dir;
    byDir.set(dir, { name: name || '(gốc)', dir, parent: dirOf(dir), files: new Map() });
  }
  const others: string[] = [];
  for (const e of entries) {
    const p = norm(e.path);
    const src = byDir.get(dirOf(p));
    if (src) src.files.set(p.slice(p.lastIndexOf('/') + 1).toLowerCase(), { ...e, path: p });
    else if (![...dirs].some((d) => d && p.startsWith(d + '/'))) others.push(p);
  }
  const gdbs = [...byDir.values()].sort((a, b) => a.dir.localeCompare(b.dir));
  return { gdbs, others };
}

const GEOM: Record<string, GeomCode> = {
  esriGeometryPolygon: 'A',
  esriGeometryMultiPatch: 'A',
  esriGeometryEnvelope: 'A',
  esriGeometryPolyline: 'L',
  esriGeometryLine: 'L',
  esriGeometryPoint: 'P',
  esriGeometryMultipoint: 'P',
};

const xmlTag = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]) : '';
};
const decodeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

async function openTable(src: GdbSource, base: string): Promise<GdbTable | null> {
  const t = src.files.get(base + '.gdbtable');
  const x = src.files.get(base + '.gdbtablx');
  if (!t || !x) return null;
  const [tb, xb] = await Promise.all([t.read(), x.read()]);
  return readTable(tb, xb);
}

export async function readCatalog(src: GdbSource): Promise<GdbCatalog> {
  const system = await openTable(src, 'a00000001');
  if (!system) throw new GdbFormatError('Thiếu bảng hệ thống GDB_SystemCatalog');
  const tableIds = new Map<string, number>();
  for (const r of system.rows()) if (typeof r.Name === 'string') tableIds.set(r.Name.toLowerCase(), r.ID as number);

  const items = await openTable(src, tableFileName(tableIds.get('gdb_items') ?? 4));
  if (!items) throw new GdbFormatError('Thiếu bảng hệ thống GDB_Items (cần ArcGIS 10 trở lên)');

  const datasets: string[] = [];
  const datasetWkts: Record<string, string> = {};
  const classes: GdbClass[] = [];
  const tables: GdbTableItem[] = [];
  const splitPath = (path: string) => {
    const parts = path.split('\\').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  };

  for (const r of items.rows()) {
    const type = r.Type;
    const name = typeof r.Name === 'string' ? r.Name : '';
    const path = typeof r.Path === 'string' ? r.Path : '';
    const def = typeof r.Definition === 'string' ? r.Definition : '';
    if (type === TYPE_FEATURE_DATASET) {
      datasets.push(name);
      datasetWkts[name] = xmlTag(def, 'WKT');
    }
    else if (type === TYPE_TABLE) tables.push({ name, dataset: splitPath(path) });
    else if (type === TYPE_FEATURE_CLASS) {
      const shapeType = xmlTag(def, 'ShapeType');
      const wkt = xmlTag(def, 'WKT');
      const ext = ['XMin', 'YMin', 'XMax', 'YMax'].map((t) => Number(xmlTag(def, t) || NaN));
      const extent = ext.every(Number.isFinite) && ext[2] >= ext[0] && ext[3] >= ext[1] ? (ext as [number, number, number, number]) : null;
      const srName = /^(?:PROJCS|GEOGCS)\["([^"]+)"/.exec(wkt)?.[1] ?? null;
      const cls: GdbClass = {
        name,
        path,
        dataset: splitPath(path),
        alias: xmlTag(def, 'AliasName'),
        shapeType,
        geom: GEOM[shapeType] ?? null,
        srName,
        wkt,
        extent,
        fields: [],
        rowCount: 0,
        rows: function* () {},
      };
      const id = tableIds.get(name.toLowerCase());
      try {
        const t = id !== undefined ? await openTable(src, tableFileName(id)) : null;
        if (!t) cls.error = 'Không tìm thấy bảng dữ liệu của lớp';
        else {
          cls.fields = t.fields;
          cls.rowCount = t.rowCount;
          cls.rows = () => t.rows();
        }
      } catch (e) {
        cls.error = e instanceof Error ? e.message : String(e);
      }
      classes.push(cls);
    }
  }
  return { datasets, datasetWkts, classes, tables };
}
