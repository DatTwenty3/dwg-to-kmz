// "Chuẩn hóa TT16": rebuild every uploaded geodatabase in the structure Thông tư 16/2025/TT-BXD asks for, keeping
// the geometries untouched. This module only PLANS the work (pure, testable): a list of ogr2ogr runs, one per
// output feature class, executed by GDAL (gdal3.js) in a worker — see src/workers/gdbNormalize.worker.ts.
//
// The frame is the data structure of the Bộ Xây dựng template (tt16Schema.ts, extracted from the template — the
// template files are not part of the app): every group and class of HienTrang / QuyHoach / MocGioi / NenDiaHinh is
// created from a schema GeoPackage (schemaGpkg.ts) with the template's fields in order, Vietnamese aliases, coded
// value domains and XY precision, then the uploaded features are appended. Decisions of the project owner:
//   - fields outside the template are dropped ("trường dư"); template fields are kept from the source
//     (matched case-insensitively), the rest left empty or derived (trangThaiQuyHoach, codes of maThongTinQH);
//   - every required feature dataset AND every template class is created (empty when there is no data);
//   - maThongTinQH / maHoSoQH are entered once for the whole submission; maDoiTuong = <maHoSoQH>-<class>-<OBJECTID>;
//   - the coordinate system is the one of the data (its KTT), named like the template ("VN-2000_TM-3_105-30").
import type { GdbCatalog, GdbClass } from './catalog';
import { parseSr } from './check';
import { schemaTable } from './schemaGpkg';
import { CLASS_NAME_RE, DATASET_NAME_RE, parseMaThongTin, TT16_DATABASES, TT16_FIELDS, type GeomCode, type Tt16Database } from './tt16';
import { TT16_SCHEMA, TT16_XY, tt16Wkt, type Tt16SchemaClass } from './tt16Schema';

const SYSTEM_FIELDS = new Set(['objectid', 'shape', 'shape_length', 'shape_area', 'globalid', 'fid', 'oid']);

export interface NormalizeOptions {
  maHoSoQH: string;
  maThongTinQH: string;
  /** Also create the databases that were not uploaded (template structure only). */
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
  /** Template geodatabases whose schema GeoPackage (buildSchemaGpkg) the runner opens as `schemaKey(db)`. */
  schemas: string[];
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

/** Spatial reference of an output geodatabase: the one of its biggest source class, renamed like the template. */
function outputWkt(classes: GdbClass[]): string | null {
  const best = classes.filter((c) => !c.error && c.wkt).sort((a, b) => b.rowCount - a.rowCount)[0];
  if (!best) return null;
  const sr = parseSr(best.wkt);
  return sr?.vn2000 && sr.lon0 !== null && sr.zone ? tt16Wkt(sr.lon0, sr.zone) : best.wkt;
}

/** Same projection parameters (only the name may differ). */
function sameSr(a: string, b: string): boolean {
  const x = parseSr(a);
  const y = parseSr(b);
  return !!x && !!y && x.vn2000 === y.vn2000 && x.lon0 === y.lon0 && x.zone === y.zone;
}

/** Template values that come from the codes entered once, not from the source. */
function codeValues(db: string, outName: string, o: NormalizeOptions): Record<string, string> {
  const p = parseMaThongTin(o.maThongTinQH);
  return {
    maThongTinQH: lit(o.maThongTinQH),
    maHoSoQH: lit(o.maHoSoQH),
    // FID = the source OBJECTID (kept with -preserve_fid).
    maDoiTuong: `CONCAT(${lit(`${o.maHoSoQH}-${outName}-`)}, CAST(FID AS character(12)))`,
    // From the digits of maThongTinQH (Điều 4 TT 24/2025/TT-BXD = the codes of the CapDoQuyHoach / LoaiQuyHoach /
    // LoaiDieuChinh domains of the template).
    ...(p && db === 'QuyHoach' ? { capDoQuyHoach: lit(p.level), loaiQuyHoach: lit(p.kind), loaiDieuChinh: lit(p.adjust) } : {}),
  };
}

/** Default of a template field the source does not have (null = left empty). */
function defaultValue(db: string, field: string, geom: GeomCode): string | null {
  if (field === 'trangThaiQuyHoach') return db === 'QuyHoach' ? lit('2') : db === 'HienTrang' ? lit('1') : null;
  if (field === 'dienTich' && geom === 'A') return 'OGR_GEOM_AREA';
  return null;
}

/** SELECT list mapping a source class onto the fields of its template class (matched case-insensitively). */
function templateSelect(spec: Tt16SchemaClass, cls: GdbClass, db: string, o: NormalizeOptions): string {
  const byLower = new Map(cls.fields.map((f) => [f.name.toLowerCase(), f]));
  const fixed = codeValues(db, spec.name, o);
  const cols: string[] = [];
  for (const f of spec.fields) {
    const src = byLower.get(f.name.toLowerCase());
    const value = fixed[f.name] ?? (src && src.type !== 'geometry' && src.type !== 'objectid' ? ident(src.name) : defaultValue(db, f.name, spec.geom));
    if (value === null) continue;
    cols.push(f.type === 'string' ? `CAST(${value} AS character(${f.length ?? 255})) AS ${f.name}` : `${value} AS ${f.name}`);
  }
  return cols.join(', ');
}

/** SELECT list giving the 6 required fields for a class outside the template. */
function minimalSelect(cls: GdbClass, outName: string, o: NormalizeOptions): string {
  const byLower = new Map(cls.fields.map((f) => [f.name.toLowerCase(), f]));
  const fixed = codeValues('', outName, o);
  return TT16_FIELDS.map((r) => {
    const src = byLower.get(r.name.toLowerCase());
    const value = fixed[r.name] ?? (src && src.type === 'string' ? ident(src.name) : 'NULL');
    return `CAST(${value} AS character(${r.length})) AS ${r.name}`;
  }).join(', ');
}

/** Layer creation options of every output class: group, alias, field names and XY precision of the template. */
const lco = (dataset: string | null, geom: GeomCode | null, alias?: string) => [
  ...(dataset ? ['-lco', `FEATURE_DATASET=${dataset}`] : []),
  ...(alias ? ['-lco', `LAYER_ALIAS=${alias}`] : []),
  ...['-lco', 'GEOMETRY_NAME=Shape', '-lco', 'FID=OBJECTID'],
  ...['-lco', `XYTOLERANCE=${TT16_XY.xyTolerance}`, '-lco', `XYSCALE=${TT16_XY.xyScale}`],
  ...['-lco', `XORIGIN=${TT16_XY.xOrigin}`, '-lco', `YORIGIN=${TT16_XY.yOrigin}`],
  ...(geom === 'A' || geom === 'L' ? ['-lco', 'CREATE_SHAPE_AREA_AND_LENGTH_FIELDS=YES'] : []),
];

/** Key of the schema GeoPackage of a template geodatabase (schemaGpkg.ts) among the opened datasets. */
export const schemaKey = (db: string) => `tt16schema${db}`;

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
  const schemas = new Set<string>();
  const started = new Set<string>();
  const push = (s: NormalizeStep) => {
    // The first run creates the output geodatabase, later runs add to it.
    const args = started.has(s.out) ? ['-update', ...s.args] : s.args;
    started.add(s.out);
    steps.push({ ...s, args: ['-f', 'OpenFileGDB', ...args] });
  };
  const outName = (db: string) => {
    let n = db;
    for (let k = 2; outputs.includes(n); k++) n = `${db}_${k}`;
    outputs.push(n);
    return n;
  };
  const allWkt = outputWkt(sources.flatMap((s) => s.catalog.classes));
  const reproject = (cls: GdbClass, wkt: string | null) => (wkt && cls.wkt && !sameSr(cls.wkt, wkt) ? ['-s_srs', cls.wkt, '-t_srs', wkt] : []);
  const extraFieldCount = (cls: GdbClass, keep: Set<string>) =>
    cls.fields.filter((f) => f.type !== 'objectid' && f.type !== 'geometry' && !SYSTEM_FIELDS.has(f.name.toLowerCase()) && !keep.has(f.name.toLowerCase())).length;
  const six = new Set(TT16_FIELDS.map((f) => f.name.toLowerCase()));

  let created = 0;
  let renamed = 0;
  let droppedFields = 0;
  let moved = 0;

  /** A class outside the template: kept with the 6 required fields (TT16 allows new classes named by the rule). */
  const copyExtra = (out: string, src: NormalizeSource, cls: GdbClass, dataset: string | null, name: string, wkt: string | null) => {
    const geom = GEOM_OF_SHAPE[cls.shapeType] ?? null;
    droppedFields += extraFieldCount(cls, six);
    push({
      out,
      source: src.key,
      label: `${dataset ? dataset + ' / ' : ''}${name}`,
      features: cls.rowCount,
      args: [
        '-preserve_fid',
        ...(wkt && cls.wkt && sameSr(cls.wkt, wkt) ? ['-a_srs', wkt] : []),
        '-sql',
        `SELECT ${minimalSelect(cls, name, o)} FROM ${ident(cls.name)}`,
        '-nln',
        name,
        ...lco(dataset, geom, cls.alias && cls.alias !== cls.name ? cls.alias : undefined),
      ],
    });
  };

  /** One output geodatabase on the template frame: every template class, uploaded data appended, extras kept. */
  const normalizeOne = (db: Tt16Database, src: NormalizeSource | null) => {
    const out = outName(db.name);
    const frame = TT16_SCHEMA.databases[db.name] ?? [];
    const wkt = (src && outputWkt(src.catalog.classes)) ?? allWkt;
    const left = new Map((src?.catalog.classes ?? []).filter((c) => !c.error).map((c) => [c.name.toLowerCase(), c]));
    schemas.add(db.name);
    for (const ds of frame)
      for (const spec of ds.classes) {
        // The class as in the template (fields, aliases, domains), from the schema GeoPackage…
        push({
          out,
          source: schemaKey(db.name),
          label: `${ds.name} / ${spec.name}`,
          features: 0,
          args: [...(wkt ? ['-a_srs', wkt] : []), '-nlt', GEOM_NLT[spec.geom], '-nln', spec.name, ...lco(ds.name, spec.geom, spec.alias), schemaTable(spec.name)],
        });
        const cls = left.get(spec.name.toLowerCase());
        if (!cls || !src) {
          created++;
          continue;
        }
        // …then the uploaded features appended into it.
        left.delete(spec.name.toLowerCase());
        if (cls.name !== spec.name) renamed++;
        if ((cls.dataset ?? '').toLowerCase() !== ds.name.toLowerCase()) moved++;
        droppedFields += extraFieldCount(cls, new Set(spec.fields.map((f) => f.name.toLowerCase())));
        if (!cls.rowCount) continue;
        push({
          out,
          source: src.key,
          label: `${ds.name} / ${spec.name}`,
          features: cls.rowCount,
          args: ['-append', '-preserve_fid', ...reproject(cls, wkt), '-sql', `SELECT ${templateSelect(spec, cls, db.name, o)} FROM ${ident(cls.name)}`, '-nln', spec.name],
        });
      }
    if (!src) return;
    // Classes outside the template: kept, names fixed, in their template group when the group exists.
    for (const cls of left.values()) {
      const geom = GEOM_OF_SHAPE[cls.shapeType] ?? null;
      const name = fixClassName(cls.name, geom);
      const tt = frame.find((d) => d.name.toLowerCase() === (cls.dataset ?? '').toLowerCase());
      const dataset = tt ? tt.name : cls.dataset ? fixDatasetName(cls.dataset) : null;
      if (name !== cls.name) {
        renamed++;
        notes.push(`${out}: đổi tên lớp ${cls.name} → ${name}`);
      }
      if (!dataset) notes.push(`${out}: lớp ${name} nằm ngoài nhóm dữ liệu (giữ nguyên vị trí)`);
      copyExtra(out, src, cls, dataset, name, wkt);
    }
  };

  // A geodatabase of unknown kind: its structure is kept, names and fields normalised.
  const normalizeFree = (src: NormalizeSource, dbName: string) => {
    const out = outName(dbName);
    const wkt = outputWkt(src.catalog.classes) ?? allWkt;
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
      copyExtra(out, src, cls, dataset, name, wkt);
    }
  };

  const done = new Set<string>();
  for (const src of sources) {
    const db = TT16_DATABASES.find((d) => d.name === src.database);
    if (db && TT16_SCHEMA.databases[db.name]) normalizeOne(db, src);
    else {
      normalizeFree(src, db?.name ?? fixDatasetName(src.name.replace(/\.gdb$/i, '')));
      notes.push(`${src.name}: không xác định được loại CSDL — giữ cấu trúc hiện có, chỉ chuẩn hóa tên và trường`);
    }
    if (db) done.add(db.name);
  }
  if (o.createMissingDatabases)
    for (const db of TT16_DATABASES) {
      const frame = TT16_SCHEMA.databases[db.name];
      if (done.has(db.name) || !frame) continue;
      const n = frame.reduce((t, d) => t + d.classes.length, 0);
      notes.push(`Tạo mới ${db.name}.gdb theo mẫu của Bộ Xây dựng (${frame.length} nhóm, ${n} lớp, chưa có dữ liệu)`);
      normalizeOne(db, null);
    }

  const srName = allWkt ? (/^PROJCS\["([^"]+)"/.exec(allWkt)?.[1] ?? null) : null;
  notes.unshift(
    ...[
      'Dựng theo cấu trúc dữ liệu mẫu của Bộ Xây dựng: đủ nhóm, lớp, trường thuộc tính, tên hiển thị (alias) và danh mục giá trị (domain)',
      `Gán maHoSoQH = ${o.maHoSoQH}, maThongTinQH = ${o.maThongTinQH}; tính lại maDoiTuong cho mọi đối tượng`,
      srName ? `Hệ tọa độ ${srName}` : '',
      created ? `Tạo ${created} lớp rỗng theo mẫu (đủ các nhóm dữ liệu bắt buộc)` : '',
      droppedFields ? `Xóa ${droppedFields} trường dư (ngoài các trường của mẫu)` : '',
      renamed ? `Sửa tên ${renamed} lớp theo đúng quy định` : '',
      moved ? `Chuyển ${moved} lớp về đúng nhóm dữ liệu` : '',
    ].filter(Boolean),
  );
  return { steps, outputs, notes, schemas: [...schemas] };
}
