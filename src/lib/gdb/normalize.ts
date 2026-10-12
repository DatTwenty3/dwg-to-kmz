// "Chuẩn hóa TT16": rebuild every uploaded geodatabase in the structure Thông tư 16/2025/TT-BXD asks for, keeping
// the geometries untouched. This module only PLANS the work (pure, testable): a list of ogr2ogr runs, one per
// output feature class, executed by GDAL (gdal3.js) in a worker — see src/workers/gdbNormalize.worker.ts.
//
// Decisions of the project owner:
//   - the 6 required TEXT fields with their exact lengths; every other attribute field is dropped ("trường dư");
//   - every required feature dataset AND every reference feature class is created (empty when there is no data);
//   - maThongTinQH / maHoSoQH are entered once for the whole submission; maDoiTuong = <maHoSoQH>-<class>-<OBJECTID>;
//   - tenDoiTuong / phanLoai / ghiChu are kept from the source (matched case-insensitively), else left empty.
import type { GdbCatalog, GdbClass } from './catalog';
import { CLASS_NAME_RE, DATASET_NAME_RE, NENDIAHINH_TEMPLATE, TT16_DATABASES, TT16_FIELDS, type GeomCode, type Tt16Database } from './tt16';

export interface NormalizeOptions {
  maHoSoQH: string;
  maThongTinQH: string;
  /** Also create the main databases that were not uploaded (structure only; NenDiaHinh from NENDIAHINH_TEMPLATE). */
  createMissingDatabases: boolean;
}

/** A source geodatabase to normalize. */
export interface NormalizeSource {
  /** Key the runner uses to find the opened GDAL dataset. */
  key: string;
  /** Folder name as uploaded, e.g. "HienTrang.gdb". */
  name: string;
  /** TT16 database it is (from the check), or null when unknown. */
  database: string | null;
  catalog: GdbCatalog;
}

export interface NormalizeStep {
  /** Output geodatabase (without .gdb), e.g. "HienTrang". */
  out: string;
  /** Source dataset key to run ogr2ogr on. */
  source: string;
  /** ogr2ogr arguments (without input / output). */
  args: string[];
  /** Short Vietnamese label for progress ("HienTrangSuDungDat / ChucNangSuDungDat_A"). */
  label: string;
  /** Number of features copied (0 = empty class created). */
  features: number;
}

export interface NormalizePlan {
  steps: NormalizeStep[];
  /** Output geodatabase names in order, e.g. ["HienTrang", "MocGioi", "NenDiaHinh", "QuyHoach"]. */
  outputs: string[];
  /** What changed, for the user and the report. */
  notes: string[];
}

const GEOM_NLT: Record<GeomCode, string> = { A: 'MULTIPOLYGON', L: 'MULTILINESTRING', P: 'POINT' };
const GEOM_OF_SHAPE: Record<string, GeomCode> = {
  esriGeometryPolygon: 'A',
  esriGeometryPolyline: 'L',
  esriGeometryPoint: 'P',
  esriGeometryMultipoint: 'P',
};

/** OGR SQL string literal. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** OGR SQL identifier (layer / field names). */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Vietnamese-free PascalCase name (keeps existing capitals), e.g. "cây xanh" → "CayXanh". */
export function pascalName(raw: string): string {
  const ascii = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
  const words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(out) ? out : `Lop${out}`;
}

/** A class name that follows <LopDuLieu>_<A|P|L>; fixes accents, spaces, capitals and the geometry suffix. */
export function fixClassName(name: string, geom: GeomCode | null): string {
  if (CLASS_NAME_RE.test(name) && (!geom || name.endsWith(`_${geom}`))) return name;
  const base = pascalName(name.replace(/_[APL]$/i, '')) || 'LopDuLieu';
  return `${base}_${geom ?? (name.match(/_([APL])$/i)?.[1]?.toUpperCase() as GeomCode | undefined) ?? 'A'}`;
}

export function fixDatasetName(name: string): string {
  return DATASET_NAME_RE.test(name) ? name : pascalName(name) || 'NhomDuLieu';
}

/** SELECT list giving exactly the 6 required fields (+ geometry) for a source class. */
function selectFor(cls: GdbClass, outName: string, o: NormalizeOptions): string {
  const byLower = new Map(cls.fields.map((f) => [f.name.toLowerCase(), f]));
  const keep = (name: string, length: number) => {
    const f = byLower.get(name.toLowerCase());
    return f && f.type === 'string' ? `CAST(${ident(f.name)} AS character(${length})) AS ${name}` : `CAST(NULL AS character(${length})) AS ${name}`;
  };
  const len = Object.fromEntries(TT16_FIELDS.map((f) => [f.name, f.length]));
  return [
    `CAST(${lit(o.maThongTinQH)} AS character(${len.maThongTinQH})) AS maThongTinQH`,
    `CAST(${lit(o.maHoSoQH)} AS character(${len.maHoSoQH})) AS maHoSoQH`,
    // FID = the source OBJECTID (kept with -preserve_fid).
    `CAST(CONCAT(${lit(`${o.maHoSoQH}-${outName}-`)}, CAST(FID AS character(12))) AS character(${len.maDoiTuong})) AS maDoiTuong`,
    keep('tenDoiTuong', len.tenDoiTuong),
    keep('phanLoai', len.phanLoai),
    keep('ghiChu', len.ghiChu),
  ].join(', ');
}

/** SELECT producing the 6 fields and no rows (schema of an empty class). */
const emptySelect = (from: string) =>
  `SELECT ${TT16_FIELDS.map((f) => `CAST(NULL AS character(${f.length})) AS ${f.name}`).join(', ')} FROM ${ident(from)} WHERE 1=0`;

const lco = (dataset: string | null, geom: GeomCode | null) => [
  ...(dataset ? ['-lco', `FEATURE_DATASET=${dataset}`] : []),
  ...(geom === 'A' || geom === 'L' ? ['-lco', 'CREATE_SHAPE_AREA_AND_LENGTH_FIELDS=YES'] : []),
];

/** The part of gdal3.js the plan needs (browser worker or Node). */
export interface OgrRunner<D> {
  ogr2ogr(dataset: D, options: string[], outputName: string): Promise<unknown>;
}

/**
 * Runs the plan. `datasets` maps NormalizeSource.key → opened GDAL dataset; `prefix` makes the output folder names
 * unique per run (the virtual file system keeps earlier outputs). Throws with the failing step's label.
 */
export async function executePlan<D>(
  gdal: OgrRunner<D>,
  datasets: Map<string, D>,
  plan: NormalizePlan,
  prefix: string,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<void> {
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    onProgress?.(i, plan.steps.length, s.label);
    const ds = datasets.get(s.source);
    if (!ds) throw new Error(`Không mở được nguồn của ${s.label}`);
    try {
      await gdal.ogr2ogr(ds, s.args, `${prefix}${s.out}`);
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : JSON.stringify(e);
      throw new Error(`Lỗi khi ghi ${s.out}.gdb — ${s.label}: ${msg}`);
    }
  }
  onProgress?.(plan.steps.length, plan.steps.length, '');
}

export function planNormalization(sources: NormalizeSource[], o: NormalizeOptions): NormalizePlan {
  const steps: NormalizeStep[] = [];
  const notes: string[] = [];
  const outputs: string[] = [];
  const started = new Set<string>();
  const push = (s: Omit<NormalizeStep, 'args'> & { args: string[] }) => {
    // The first run creates the output geodatabase, later runs add to it.
    const args = started.has(s.out) ? ['-update', ...s.args] : s.args;
    started.add(s.out);
    steps.push({ ...s, args: ['-f', 'OpenFileGDB', ...args] });
  };
  /** Any class of any source (empty classes take their schema & coordinate system from it). */
  const anyClass = (prefer: NormalizeSource | null) => {
    for (const s of [prefer, ...sources]) {
      const c = s?.catalog.classes.find((k) => !k.error && k.fields.some((f) => f.type === 'geometry'));
      if (s && c) return { source: s.key, name: c.name };
    }
    return null;
  };

  const outName = (db: string) => {
    let n = db;
    for (let k = 2; outputs.includes(n); k++) n = `${db}_${k}`;
    outputs.push(n);
    return n;
  };

  const emptyClass = (out: string, prefer: NormalizeSource | null, dataset: string, name: string) => {
    const from = anyClass(prefer);
    if (!from) return;
    const geom = name.slice(-1) as GeomCode;
    push({
      out,
      source: from.source,
      label: `${dataset} / ${name}`,
      features: 0,
      args: ['-sql', emptySelect(from.name), '-nln', name, '-nlt', GEOM_NLT[geom], ...lco(dataset, geom)],
    });
  };

  const copyClass = (out: string, src: NormalizeSource, cls: GdbClass, dataset: string | null, name: string) => {
    const geom = GEOM_OF_SHAPE[cls.shapeType] ?? null;
    push({
      out,
      source: src.key,
      label: `${dataset ? dataset + ' / ' : ''}${name}`,
      features: cls.rowCount,
      args: ['-preserve_fid', '-sql', `SELECT ${selectFor(cls, name, o)} FROM ${ident(cls.name)}`, '-nln', name, ...lco(dataset, geom)],
    });
  };

  const extraFieldCount = (cls: GdbClass) =>
    cls.fields.filter(
      (f) =>
        f.type !== 'objectid' &&
        f.type !== 'geometry' &&
        !TT16_FIELDS.some((r) => r.name.toLowerCase() === f.name.toLowerCase()) &&
        !['shape_length', 'shape_area'].includes(f.name.toLowerCase()),
    ).length;

  let created = 0;
  let renamed = 0;
  let droppedFields = 0;
  let moved = 0;

  const normalizeOne = (db: Tt16Database, src: NormalizeSource | null) => {
    const out = outName(db.name);
    const left = new Map((src?.catalog.classes ?? []).filter((c) => !c.error).map((c) => [c.name.toLowerCase(), c]));
    for (const ds of db.datasets) {
      for (const spec of ds.classes) {
        const cls = left.get(spec.name.toLowerCase());
        if (cls && src) {
          left.delete(spec.name.toLowerCase());
          if (cls.name !== spec.name) renamed++;
          if ((cls.dataset ?? '').toLowerCase() !== ds.name.toLowerCase()) moved++;
          droppedFields += extraFieldCount(cls);
          copyClass(out, src, cls, ds.name, spec.name);
        } else {
          created++;
          emptyClass(out, src, ds.name, spec.name);
        }
      }
    }
    // Classes outside the reference list: kept (TT16 allows new classes named by the rule), names fixed.
    for (const cls of left.values()) {
      if (!src) break;
      const geom = GEOM_OF_SHAPE[cls.shapeType] ?? null;
      const name = fixClassName(cls.name, geom);
      const tt = db.datasets.find((d) => d.name.toLowerCase() === (cls.dataset ?? '').toLowerCase());
      const dataset = tt ? tt.name : cls.dataset ? fixDatasetName(cls.dataset) : null;
      if (name !== cls.name) {
        renamed++;
        notes.push(`${out}: đổi tên lớp ${cls.name} → ${name}`);
      }
      if (!dataset) notes.push(`${out}: lớp ${name} nằm ngoài nhóm dữ liệu (giữ nguyên vị trí)`);
      droppedFields += extraFieldCount(cls);
      copyClass(out, src, cls, dataset, name);
    }
  };

  // NenDiaHinh has no reference list: keep its groups/classes (names fixed), normalise the fields only.
  const normalizeFree = (src: NormalizeSource, dbName: string) => {
    const out = outName(dbName);
    for (const cls of src.catalog.classes) {
      if (cls.error) continue;
      const geom = GEOM_OF_SHAPE[cls.shapeType] ?? null;
      const name = fixClassName(cls.name, geom);
      const dataset = cls.dataset ? fixDatasetName(cls.dataset) : null;
      if (name !== cls.name) {
        renamed++;
        notes.push(`${out}: đổi tên lớp ${cls.name} → ${name}`);
      }
      if (dataset && dataset !== cls.dataset) notes.push(`${out}: đổi tên nhóm ${cls.dataset} → ${dataset}`);
      droppedFields += extraFieldCount(cls);
      copyClass(out, src, cls, dataset, name);
    }
  };

  const done = new Set<string>();
  for (const src of sources) {
    const db = TT16_DATABASES.find((d) => d.name === src.database);
    if (db && db.datasets.length) normalizeOne(db, src);
    else normalizeFree(src, db?.name ?? fixDatasetName(src.name.replace(/\.gdb$/i, '')));
    if (db) done.add(db.name);
    if (!db) notes.push(`${src.name}: không xác định được loại CSDL — giữ cấu trúc hiện có, chỉ chuẩn hóa tên và trường`);
  }
  if (o.createMissingDatabases)
    for (const db of TT16_DATABASES) {
      if (done.has(db.name)) continue;
      if (db.datasets.length) {
        notes.push(`Tạo mới ${db.name}.gdb (chỉ có cấu trúc, chưa có dữ liệu)`);
        normalizeOne(db, null);
      } else if (db.name === 'NenDiaHinh') {
        // No list in the circular: the structure of the xã Hàm Giang NenDiaHinh.gdb (owner's choice).
        const classes = NENDIAHINH_TEMPLATE.reduce((t, ds) => t + ds.classes.length, 0);
        notes.push(`Tạo mới NenDiaHinh.gdb theo cấu trúc mẫu xã Hàm Giang (${NENDIAHINH_TEMPLATE.length} nhóm, ${classes} lớp, chưa có dữ liệu)`);
        normalizeOne({ ...db, datasets: NENDIAHINH_TEMPLATE }, null);
      }
    }

  notes.unshift(
    ...[
      `Gán maHoSoQH = ${o.maHoSoQH}, maThongTinQH = ${o.maThongTinQH}; tính lại maDoiTuong cho mọi đối tượng`,
      created ? `Tạo ${created} lớp rỗng theo danh mục Thông tư (đủ các nhóm dữ liệu bắt buộc)` : '',
      droppedFields ? `Xóa ${droppedFields} trường dư (ngoài 6 trường quy định)` : '',
      renamed ? `Sửa tên ${renamed} lớp theo đúng quy định` : '',
      moved ? `Chuyển ${moved} lớp về đúng nhóm dữ liệu` : '',
    ].filter(Boolean),
  );
  return { steps, outputs, notes };
}
