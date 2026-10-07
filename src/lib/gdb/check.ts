// Checks geodatabases against Thông tư 16/2025/TT-BXD (see tt16.ts). Output is plain data (worker → UI).
import type { GdbClass, GdbCatalog, GdbSource } from './catalog';
import { assessCrs, unionExtent, type CrsCheck } from './crs';
import {
  CLASS_NAME_RE,
  DATASET_NAME_RE,
  parseMaHoSo,
  parseMaThongTin,
  TT16_DATABASES,
  TT16_FIELDS,
  TT16_PROJECT_EXT,
  type GeomCode,
  type Tt16Database,
} from './tt16';

export type Level = 'error' | 'warn' | 'info';
export interface Issue {
  level: Level;
  text: string;
}

/**
 * ok      — có, đúng
 * warn    — có, cần xem lại (khác chữ hoa, sai nhóm, độ dài khác…)
 * error   — có nhưng sai (sai tên, sai kiểu hình học, thiếu trường…)
 * missing — bắt buộc mà không có
 * absent  — lớp tham khảo chưa có (không bắt buộc)
 * extra   — bổ sung ngoài danh mục, đúng nguyên tắc đặt tên
 */
export type Status = 'ok' | 'warn' | 'error' | 'missing' | 'absent' | 'extra';

export interface FieldReport {
  name: string;
  alias: string;
  status: Status;
  /** Tên/kiểu/độ dài thực tế. */
  actual: { name: string; type: string; length: number } | null;
  /** Số đối tượng có giá trị / tổng số. */
  filled: number | null;
  issues: Issue[];
}

export interface ClassReport {
  name: string;
  alias: string;
  status: Status;
  /** Có trong danh mục tham khảo của Thông tư (false = lớp bổ sung). */
  inReference: boolean;
  /** Tên thực tế (khi khác chữ hoa) hoặc tên lớp bổ sung. */
  actualName: string | null;
  /** Nhóm thực tế chứa lớp (null = ngoài nhóm). */
  actualDataset: string | null;
  expectedGeom: GeomCode | null;
  actualGeom: GeomCode | null;
  rowCount: number | null;
  srName: string | null;
  sr: SrInfo | null;
  fields: FieldReport[];
  /** Trường dư: ngoài 6 trường thuộc tính tối thiểu (trừ OBJECTID, Shape, Shape_Length/Area). */
  extraFields: string[];
  /** Vài trăm dòng đầu để xem bảng thuộc tính. */
  sample: Sample | null;
  issues: Issue[];
}

export interface SampleColumn {
  name: string;
  type: string;
  length: number;
}
export interface Sample {
  columns: SampleColumn[];
  rows: (string | number | null)[][];
  /** Tổng số đối tượng (rows chỉ là phần đầu). */
  total: number;
}

export interface SrInfo {
  name: string;
  vn2000: boolean;
  /** Kinh tuyến trục (độ) với lưới TM. */
  lon0: number | null;
  /** 3 (k=0.9999) hoặc 6 (k=0.9996) — null khi không xác định. */
  zone: 3 | 6 | null;
}

const SAMPLE_ROWS = 300;

/** Name / central meridian / zone width of a WKT. */
export function parseSr(wkt: string | null | undefined): SrInfo | null {
  if (!wkt) return null;
  const name = /^(?:PROJCS|GEOGCS)\["([^"]+)"/.exec(wkt)?.[1] ?? '';
  const param = (p: string) => {
    const m = new RegExp(`PARAMETER\\["${p}",\\s*([-\\d.eE]+)\\]`, 'i').exec(wkt);
    return m ? Number(m[1]) : null;
  };
  const lon0 = /^PROJCS/.test(wkt) ? param('Central_Meridian') : null;
  const k = param('Scale_Factor');
  const zone = k === null ? null : Math.abs(k - 0.9999) < 1e-6 ? 3 : Math.abs(k - 0.9996) < 1e-6 ? 6 : null;
  return { name, vn2000: /vn[_-]?2000|vietnam[_ ]?2000/i.test(wkt), lon0, zone };
}

/** Why a cell value breaks Thông tư 16 (null = fine). `ma` = maHoSoQH of the same row. */
export function cellProblem(field: string, value: unknown, ctx: { oid: unknown; ma: string; className: string }): string | null {
  const f = field.toLowerCase();
  const v = value === null || value === undefined ? '' : String(value).trim();
  if (f === 'mahosoqh') return !v ? 'Chưa nhập' : parseMaHoSo(v) ? null : 'Sai mẫu mã hồ sơ';
  if (f === 'mathongtinqh') return !v ? 'Chưa nhập' : parseMaThongTin(v) ? null : 'Sai mẫu mã thông tin quy hoạch (12 chữ số)';
  if (f === 'madoituong') {
    if (!v) return null;
    const m = /^(.*)-(.+)-0*(\d+)$/.exec(v);
    if (!m || m[2].toLowerCase() !== ctx.className.toLowerCase() || Number(m[3]) !== Number(ctx.oid))
      return `Không theo mẫu <maHoSoQH>-${ctx.className}-<ObjectID>`;
    if (!parseMaHoSo(m[1])) return 'Phần mã hồ sơ sai mẫu (maHoSoQH sai nên maDoiTuong không đúng)';
    if (ctx.ma && m[1] !== ctx.ma) return 'Phần mã hồ sơ khác maHoSoQH của đối tượng';
  }
  return null;
}

export interface DatasetReport {
  name: string;
  title: string;
  status: Status;
  /** Nhóm có trong Phụ lục II, Phần 2 (false = nhóm bổ sung). */
  inReference: boolean;
  actualName: string | null;
  /** Hệ tọa độ của Feature Dataset (null = không có / chưa xác định). */
  sr: SrInfo | null;
  /** Hệ tọa độ có đúng với vị trí dữ liệu không (null = nhóm chưa có). */
  crs: CrsCheck | null;
  classes: ClassReport[];
  issues: Issue[];
}

export interface Counts {
  datasets: { expected: number; present: number };
  classes: { reference: number; present: number; extra: number };
  errors: number;
  warnings: number;
}

export interface GdbReport {
  fileName: string;
  dir: string;
  /** CSDL đối chiếu (HienTrang…) — theo tên, hoặc đoán theo nội dung khi tên sai. */
  database: string | null;
  databaseTitle: string | null;
  nameStatus: Status;
  datasets: DatasetReport[];
  /** Lớp nằm ngoài mọi nhóm dữ liệu. */
  rootClasses: ClassReport[];
  issues: Issue[];
  counts: Counts;
  /** Giá trị maHoSoQH gặp được → số đối tượng. */
  maHoSo: [string, number][];
  /** Giá trị maThongTinQH gặp được → số đối tượng. */
  maThongTin: [string, number][];
  srNames: string[];
  /** Hệ tọa độ chung của geodatabase, đối chiếu với vị trí dữ liệu. */
  crs: CrsCheck | null;
  /** Tỉnh dùng để đối chiếu KTT: từ mã hồ sơ / mã thông tin, hoặc người dùng chọn; null = chưa biết. */
  province: { code: string; source: 'maHoSoQH' | 'maThongTinQH' | 'user' } | null;
}

export interface SubmissionReport {
  gdbs: GdbReport[];
  /** CSDL chính chưa có trong lần tải lên. */
  missingDatabases: { name: string; title: string }[];
  /** Thư mục HoSoGIS (khi tải cả thư mục) — tên + tệp tổng hợp. */
  folder: { name: string; nameOk: boolean; projectFiles: string[] } | null;
  issues: Issue[];
  maHoSo: [string, number][];
  maThongTin: [string, number][];
}

/** Spellings printed in the circular itself that break the capitalisation rule — accepted without a note. */
const TT_LITERAL = new Set(['thietkedothi', 'congtrinhcapnuocpccc_p', 'congtrinhcapnuocpccc_a', 'danhgiahientrangdatxaydung']);
const literalOk = (actual: string, expected: string) =>
  actual === expected || (TT_LITERAL.has(expected.toLowerCase()) && actual.toLowerCase() === expected.toLowerCase());

const SYSTEM_FIELDS = new Set(['objectid', 'shape', 'shape_length', 'shape_area', 'globalid', 'fid', 'oid', 'st_area(shape)', 'st_length(shape)']);

const GEOM_LABEL: Record<GeomCode, string> = { A: 'vùng', P: 'điểm', L: 'đường' };

const hasDiacritics = (s: string) => /[^\x00-\x7f]/.test(s);

function nameRuleIssues(name: string, kind: 'dataset' | 'class'): Issue[] {
  const out: Issue[] = [];
  if (hasDiacritics(name)) out.push({ level: 'error', text: 'Tên có dấu/ký tự ngoài ASCII — phải viết tiếng Việt không dấu' });
  if (/\s/.test(name)) out.push({ level: 'error', text: 'Tên có khoảng trắng — các từ phải viết liền' });
  if (kind === 'class' && !/_[APL]$/.test(name)) out.push({ level: 'error', text: 'Thiếu hậu tố kiểu dữ liệu _A (vùng), _P (điểm) hoặc _L (đường)' });
  const re = kind === 'class' ? CLASS_NAME_RE : DATASET_NAME_RE;
  if (!out.length && !re.test(name)) out.push({ level: 'error', text: 'Mỗi từ phải viết hoa chữ cái đầu, viết liền (vd. HienTrangSuDungDat)' });
  return out;
}

/** A group shows the worst state of its classes (a correctly named group with broken classes is not "ok"). */
function withChildren(own: Status, classes: ClassReport[]): Status {
  if (own === 'missing' || own === 'error') return own;
  if (classes.some((c) => c.status === 'error' || c.status === 'missing')) return 'error';
  if (own === 'ok' && classes.some((c) => c.status === 'warn')) return 'warn';
  return own;
}


interface ValueStats {
  maHoSo: Map<string, number>;
  maThongTin: Map<string, number>;
}

/** Field + value checks for one class. */
function checkClass(cls: GdbClass, stats: ValueStats): { fields: FieldReport[]; extraFields: string[]; issues: Issue[]; sample: Sample | null } {
  const issues: Issue[] = [];
  if (cls.error) {
    issues.push({ level: 'error', text: `Không đọc được bảng: ${cls.error}` });
    return { fields: [], extraFields: [], issues, sample: null };
  }
  const columns: SampleColumn[] = cls.fields.map((f) => ({ name: f.name, type: f.type, length: f.length }));
  const sampleRows: (string | number | null)[][] = [];
  const geomLabel = cls.geom === 'A' ? 'Polygon' : cls.geom === 'L' ? 'Polyline' : cls.geom === 'P' ? 'Point' : cls.shapeType.replace('esriGeometry', '');
  const byLower = new Map(cls.fields.map((f) => [f.name.toLowerCase(), f]));
  const wanted = TT16_FIELDS.map((f) => ({ spec: f, field: byLower.get(f.name.toLowerCase()) ?? null }));

  // One pass over the rows for every value check.
  const filled = new Map<string, number>();
  let badMaHoSo = 0;
  let badMaHoSoSample = '';
  let badMaDoiTuong = 0;
  let badMaThongTin = 0;
  let badMaThongTinSample = '';
  let badMaDoiTuongSample = '';
  let total = 0;
  const fMaHoSo = wanted[1].field;
  const fMaDoiTuong = wanted[2].field;
  for (const row of cls.rows()) {
    total++;
    if (sampleRows.length < SAMPLE_ROWS)
      sampleRows.push(
        cls.fields.map((f) => {
          if (f.type === 'geometry') return geomLabel;
          const v = row[f.name];
          return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : (v ?? null);
        }),
      );
    for (const w of wanted) {
      if (!w.field) continue;
      const v = row[w.field.name];
      if (v !== null && v !== undefined && String(v).trim() !== '') filled.set(w.spec.name, (filled.get(w.spec.name) ?? 0) + 1);
    }
    const ma = fMaHoSo ? String(row[fMaHoSo.name] ?? '').trim() : '';
    if (fMaHoSo && ma) {
      stats.maHoSo.set(ma, (stats.maHoSo.get(ma) ?? 0) + 1);
      if (!parseMaHoSo(ma)) {
        badMaHoSo++;
        badMaHoSoSample ||= ma;
      }
    }
    const fMaThongTin = wanted[0].field;
    const mtt = fMaThongTin ? String(row[fMaThongTin.name] ?? '').trim() : '';
    if (mtt) {
      stats.maThongTin.set(mtt, (stats.maThongTin.get(mtt) ?? 0) + 1);
      if (!parseMaThongTin(mtt)) {
        badMaThongTin++;
        badMaThongTinSample ||= mtt;
      }
    }
    if (fMaDoiTuong) {
      const v = row[fMaDoiTuong.name];
      const problem = cellProblem('maDoiTuong', v, { oid: Object.values(row)[0], ma, className: cls.name });
      if (problem) {
        badMaDoiTuong++;
        badMaDoiTuongSample ||= `"${String(v)}" (${problem})`;
      }
    }
  }

  const fields: FieldReport[] = wanted.map(({ spec, field }) => {
    const fi: Issue[] = [];
    if (!field) {
      return { name: spec.name, alias: spec.alias, status: 'missing', actual: null, filled: null, issues: [{ level: 'error', text: 'Thiếu trường bắt buộc' }] };
    }
    if (field.name !== spec.name) fi.push({ level: 'warn', text: `Tên trường "${field.name}" khác chữ hoa/thường — đúng là "${spec.name}"` });
    if (field.type !== 'string') fi.push({ level: 'error', text: `Kiểu dữ liệu ${field.type} — phải là TEXT (String)` });
    else if (field.length < spec.length) fi.push({ level: 'error', text: `Độ dài ${field.length} — quy định ${spec.length} ký tự` });
    else if (field.length > spec.length) fi.push({ level: 'warn', text: `Độ dài ${field.length} — quy định ${spec.length} ký tự` });
    const n = filled.get(spec.name) ?? 0;
    if (spec.valueRequired && total > 0 && n < total) fi.push({ level: 'error', text: `${(total - n).toLocaleString('vi-VN')}/${total.toLocaleString('vi-VN')} đối tượng chưa nhập giá trị` });
    if (spec.name === 'maThongTinQH' && badMaThongTin)
      fi.push({
        level: 'error',
        text: `${badMaThongTin.toLocaleString('vi-VN')} giá trị sai mẫu 12 chữ số <mã tỉnh 2><năm 2><cấp độ 1–4><loại QH 1–5><điều chỉnh 0–2><5 số> (NĐ 111/2024, TT 24/2025/TT-BXD; vd. 012511012345), như "${badMaThongTinSample}"`,
      });
    if (spec.name === 'maHoSoQH' && badMaHoSo)
      fi.push({
        level: 'error',
        text: `${badMaHoSo.toLocaleString('vi-VN')} giá trị sai mẫu <Mã tỉnh 2 số><QHC|QPK|QCT><x><xx><xxxx> (vd. 04QHC0010001), như "${badMaHoSoSample}"`,
      });
    if (spec.name === 'maDoiTuong' && badMaDoiTuong)
      fi.push({
        level: 'error',
        text: `${badMaDoiTuong.toLocaleString('vi-VN')} giá trị sai — mẫu <maHoSoQH hợp lệ>-${cls.name}-<ObjectID>, như ${badMaDoiTuongSample}`,
      });
    const worst = fi.some((i) => i.level === 'error') ? 'error' : fi.some((i) => i.level === 'warn') ? 'warn' : 'ok';
    return {
      name: spec.name,
      alias: spec.alias,
      status: worst,
      actual: { name: field.name, type: field.type, length: field.length },
      filled: n,
      issues: fi,
    };
  });

  const required = new Set(TT16_FIELDS.map((f) => f.name.toLowerCase()));
  const extraFields = cls.fields
    .filter((f) => f.type !== 'objectid' && f.type !== 'geometry' && !required.has(f.name.toLowerCase()) && !SYSTEM_FIELDS.has(f.name.toLowerCase()))
    .map((f) => f.name);
  if (cls.rowCount === 0) issues.push({ level: 'warn', text: 'Lớp rỗng (0 đối tượng)' });
  for (const f of extraFields) issues.push({ level: 'warn', text: `Thừa trường "${f}" — ngoài 6 trường thuộc tính quy định (trường dư)` });
  return { fields, extraFields, issues, sample: { columns, rows: sampleRows, total } };
}

function classReport(
  cls: GdbClass,
  stats: ValueStats,
  expected: { name: string; alias: string; dataset: string | null } | null,
): ClassReport {
  const r = checkClass(cls, stats);
  const issues = [...r.issues];
  const suffix = (/_([APL])$/.exec(cls.name)?.[1] as GeomCode | undefined) ?? null;
  let base: Status = 'ok';
  if (expected) {
    if (!literalOk(cls.name, expected.name)) issues.unshift({ level: 'warn', text: `Tên khác chữ hoa/thường — đúng là "${expected.name}"` });
    if (expected.dataset && cls.dataset?.toLowerCase() !== expected.dataset.toLowerCase())
      issues.unshift({
        level: 'warn',
        text: cls.dataset ? `Đang nằm trong nhóm "${cls.dataset}" — đúng ra thuộc nhóm "${expected.dataset}"` : `Nằm ngoài nhóm dữ liệu — đúng ra thuộc nhóm "${expected.dataset}"`,
      });
  } else {
    base = 'extra';
    const rule = nameRuleIssues(cls.name, 'class');
    if (rule.length) issues.unshift(...rule);
    else issues.unshift({ level: 'info', text: 'Lớp bổ sung ngoài danh mục tham khảo — tên đúng nguyên tắc' });
    if (!cls.dataset) issues.unshift({ level: 'warn', text: 'Nằm ngoài nhóm dữ liệu (Feature Dataset)' });
  }
  if (suffix && cls.geom && suffix !== cls.geom)
    issues.unshift({ level: 'error', text: `Hậu tố _${suffix} (${GEOM_LABEL[suffix]}) nhưng dữ liệu là ${GEOM_LABEL[cls.geom]}` });
  const status: Status = issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warn') ? (base === 'extra' ? 'extra' : 'warn') : base;
  const fieldsWorst = r.fields.some((f) => f.status === 'error' || f.status === 'missing') ? 'error' : r.fields.some((f) => f.status === 'warn') ? 'warn' : null;
  return {
    name: expected?.name ?? cls.name,
    alias: expected?.alias ?? cls.alias,
    inReference: !!expected,
    status: fieldsWorst === 'error' ? 'error' : fieldsWorst === 'warn' && status === 'ok' ? 'warn' : status,
    actualName: expected && cls.name !== expected.name ? cls.name : expected ? null : cls.name,
    actualDataset: cls.dataset,
    expectedGeom: (/_([APL])$/.exec(expected?.name ?? cls.name)?.[1] as GeomCode | undefined) ?? null,
    actualGeom: cls.geom,
    rowCount: cls.error ? null : cls.rowCount,
    srName: cls.srName,
    sr: parseSr(cls.wkt),
    fields: r.fields,
    extraFields: r.extraFields,
    sample: r.sample,
    issues,
  };
}

/** The database a geodatabase is meant to be: by file name, else by matching dataset names. */
function pickDatabase(fileName: string, cat: GdbCatalog): { db: Tt16Database | null; byName: 'exact' | 'case' | 'none' } {
  const base = fileName.replace(/\.gdb$/i, '');
  const exact = TT16_DATABASES.find((d) => d.name === base);
  if (exact && /\.gdb$/.test(fileName)) return { db: exact, byName: 'exact' };
  const ci = TT16_DATABASES.find((d) => d.name.toLowerCase() === base.toLowerCase());
  if (ci) return { db: ci, byName: 'case' };
  const have = new Set(cat.datasets.map((s) => s.toLowerCase()));
  let best: Tt16Database | null = null;
  let bestScore = 0;
  for (const d of TT16_DATABASES) {
    const score = d.datasets.filter((s) => have.has(s.name.toLowerCase())).length;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return { db: best, byName: 'none' };
}

export interface CheckOptions {
  /** 2-digit province code chosen by the user — overrides the one read from maHoSoQH / maThongTinQH. */
  provinceCode?: string | null;
}

export function checkGdb(src: Pick<GdbSource, 'name' | 'dir'>, cat: GdbCatalog, opts: CheckOptions = {}): GdbReport {
  const issues: Issue[] = [];
  const stats: ValueStats = { maHoSo: new Map(), maThongTin: new Map() };
  const { db, byName } = pickDatabase(src.name, cat);
  const names = TT16_DATABASES.map((d) => d.name + '.gdb').join(', ');
  let nameStatus: Status = 'ok';
  if (byName === 'case') {
    nameStatus = 'warn';
    issues.push({ level: 'warn', text: `Tên "${src.name}" khác chữ hoa/thường hoặc đuôi — đúng là "${db!.name}.gdb"` });
  } else if (byName === 'none') {
    nameStatus = 'error';
    issues.push({
      level: 'error',
      text: `Tên "${src.name}" không đúng — phải là một trong: ${names}.${db ? ` Đã đối chiếu theo nội dung như ${db.name}.gdb.` : ''}`,
    });
  }

  const classesLeft = new Map(cat.classes.map((c) => [c.name.toLowerCase(), c]));
  const datasetsLeft = new Map(cat.datasets.map((d) => [d.toLowerCase(), d]));
  const datasets: DatasetReport[] = [];
  // A reference class misplaced in another group is reported under its own group, not as an extra.
  const referenceNames = new Set((db?.datasets ?? []).flatMap((d) => d.classes.map((c) => c.name.toLowerCase())));

  for (const ds of db?.datasets ?? []) {
    const actual = datasetsLeft.get(ds.name.toLowerCase()) ?? null;
    if (actual) datasetsLeft.delete(ds.name.toLowerCase());
    const dIssues: Issue[] = [];
    let status: Status = actual ? 'ok' : 'missing';
    if (!actual) dIssues.push({ level: 'error', text: 'Thiếu nhóm dữ liệu chuyên đề (bắt buộc theo Phụ lục II, Phần 2)' });
    else if (!literalOk(actual, ds.name)) {
      status = 'warn';
      dIssues.push({ level: 'warn', text: `Tên khác chữ hoa/thường — đúng là "${ds.name}"` });
    }
    const classes: ClassReport[] = ds.classes.map((spec) => {
      const cls = classesLeft.get(spec.name.toLowerCase());
      if (!cls)
        return {
          name: spec.name,
          alias: spec.alias,
          status: 'absent',
          inReference: true,
          actualName: null,
          actualDataset: null,
          expectedGeom: (/_([APL])$/.exec(spec.name)?.[1] as GeomCode) ?? null,
          actualGeom: null,
          rowCount: null,
          srName: null,
          sr: null,
          fields: [],
          extraFields: [],
          sample: null,
          issues: [],
        };
      classesLeft.delete(spec.name.toLowerCase());
      return classReport(cls, stats, { ...spec, dataset: ds.name });
    });
    // Extra classes the user put inside this dataset.
    for (const cls of [...classesLeft.values()]) {
      if (actual && cls.dataset?.toLowerCase() === actual.toLowerCase() && !referenceNames.has(cls.name.toLowerCase())) {
        classesLeft.delete(cls.name.toLowerCase());
        classes.push(classReport(cls, stats, null));
      }
    }
    if (actual && !classes.some((c) => c.status !== 'absent')) {
      dIssues.push({ level: 'warn', text: 'Nhóm chưa có lớp dữ liệu nào' });
      if (status === 'ok') status = 'warn';
    }
    status = withChildren(status, classes);
    datasets.push({ name: ds.name, title: ds.title, status, inReference: true, actualName: actual, sr: actual ? parseSr(cat.datasetWkts?.[actual]) : null, crs: null, classes, issues: dIssues });
  }

  // Datasets outside the list (all of them for NenDiaHinh / unknown databases).
  for (const actual of datasetsLeft.values()) {
    const rule = nameRuleIssues(actual, 'dataset');
    const classes = [...classesLeft.values()].filter((c) => c.dataset?.toLowerCase() === actual.toLowerCase());
    for (const c of classes) classesLeft.delete(c.name.toLowerCase());
    const dIssues: Issue[] = rule.length
      ? rule
      : [{ level: 'info', text: db?.datasets.length ? 'Nhóm bổ sung ngoài danh mục — tên đúng nguyên tắc' : 'Tên đúng nguyên tắc đặt tên nhóm dữ liệu' }];
    const reports = classes.map((c) => classReport(c, stats, null));
    datasets.push({
      name: actual,
      title: '',
      status: rule.length ? 'error' : withChildren('extra', reports),
      inReference: false,
      actualName: actual,
      sr: parseSr(cat.datasetWkts?.[actual]),
      crs: null,
      classes: reports,
      issues: dIssues,
    });
  }

  const rootClasses = [...classesLeft.values()].map((c) => classReport(c, stats, null));

  // ---- Coordinate system vs. where the data actually is (no province choice needed) ----
  const validCode = (vals: Map<string, number>, parse: (v: string) => { province: string } | null) =>
    [...vals.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => parse(v)?.province).find(Boolean) ?? null;
  const fromHoSo = validCode(stats.maHoSo, parseMaHoSo);
  const fromThongTin = fromHoSo ? null : validCode(stats.maThongTin, parseMaThongTin);
  const province: GdbReport['province'] = opts.provinceCode
    ? { code: opts.provinceCode, source: 'user' }
    : fromHoSo
      ? { code: fromHoSo, source: 'maHoSoQH' }
      : fromThongTin
        ? { code: fromThongTin, source: 'maThongTinQH' }
        : null;
  const provinceCode = province?.code ?? null;
  const sameSr = (a: SrInfo | null, b: SrInfo | null) => !!a && !!b && a.lon0 === b.lon0 && a.zone === b.zone && a.vn2000 === b.vn2000;
  const crsIssue = (c: CrsCheck): Issue | null =>
    c.status === 'ok' ? null : { level: c.status === 'error' ? 'error' : 'warn', text: `Hệ tọa độ: ${c.text}` };
  for (const d of datasets) {
    if (!d.actualName) {
      d.crs = null;
      continue;
    }
    const members = cat.classes.filter((c) => c.dataset?.toLowerCase() === d.actualName!.toLowerCase());
    const sr = d.sr ?? parseSr(members.find((m) => m.wkt)?.wkt);
    d.crs = assessCrs(sr, unionExtent(members.map((m) => m.extent)), provinceCode);
    const issue = crsIssue(d.crs);
    if (issue) {
      d.issues.unshift(issue);
      if (issue.level === 'error' && d.status !== 'missing') d.status = 'error';
      else if (d.status === 'ok') d.status = 'warn';
    }
    // A class inside the group must use the group's coordinate system.
    for (const r of d.classes) {
      if (r.sr && sr && !sameSr(r.sr, sr)) {
        r.issues.unshift({ level: 'warn', text: 'Hệ tọa độ của lớp khác hệ tọa độ của nhóm dữ liệu' });
        if (r.status === 'ok') r.status = 'warn';
      }
    }
  }
  for (const r of rootClasses) {
    const src = cat.classes.find((c) => c.name.toLowerCase() === (r.actualName ?? r.name).toLowerCase());
    const issue = src ? crsIssue(assessCrs(r.sr, src.extent, provinceCode)) : null;
    if (issue) {
      r.issues.unshift(issue);
      if (issue.level === 'error') r.status = 'error';
    }
  }
  const srCount = new Map<string, { sr: SrInfo; n: number }>();
  for (const c of cat.classes) {
    const sr = parseSr(c.wkt);
    if (!sr) continue;
    const k = `${sr.name}|${sr.lon0}|${sr.zone}`;
    srCount.set(k, { sr, n: (srCount.get(k)?.n ?? 0) + 1 });
  }
  const mainSr = [...srCount.values()].sort((a, b) => b.n - a.n)[0]?.sr ?? null;
  const gdbCrs = cat.classes.length ? assessCrs(mainSr, unionExtent(cat.classes.map((c) => c.extent)), provinceCode) : null;

  const all = [...datasets.flatMap((d) => d.classes), ...rootClasses];
  const countIssues = (lvl: Level) =>
    issues.filter((i) => i.level === lvl).length +
    datasets.reduce((t, d) => t + d.issues.filter((i) => i.level === lvl).length, 0) +
    all.reduce((t, c) => t + c.issues.filter((i) => i.level === lvl).length + c.fields.reduce((u, f) => u + f.issues.filter((i) => i.level === lvl).length, 0), 0);

  if (cat.classes.length === 0) issues.push({ level: 'error', text: 'Geodatabase không có lớp dữ liệu (Feature Class) nào' });
  const srNames = [...new Set(cat.classes.map((c) => c.srName).filter((s): s is string => !!s))];
  if (srNames.length > 1) issues.push({ level: 'warn', text: `Các lớp dùng nhiều hệ tọa độ khác nhau: ${srNames.join(', ')}` });

  const referenceTotal = db?.datasets.reduce((t, d) => t + d.classes.length, 0) ?? 0;
  return {
    fileName: src.name,
    dir: src.dir,
    database: db?.name ?? null,
    databaseTitle: db?.title ?? null,
    nameStatus,
    datasets,
    rootClasses,
    issues,
    counts: {
      datasets: { expected: db?.datasets.length ?? 0, present: datasets.filter((d) => d.inReference && d.status !== 'missing').length },
      classes: {
        reference: referenceTotal,
        present: all.filter((c) => c.inReference && c.status !== 'absent').length,
        extra: all.filter((c) => !c.inReference).length,
      },
      errors: countIssues('error'),
      warnings: countIssues('warn'),
    },
    maHoSo: [...stats.maHoSo.entries()].sort((a, b) => b[1] - a[1]),
    maThongTin: [...stats.maThongTin.entries()].sort((a, b) => b[1] - a[1]),
    srNames,
    crs: gdbCrs,
    province,
  };
}

/** Whole submission: several geodatabases, possibly inside a HoSoGIS folder. */
export function checkSubmission(reports: GdbReport[], gdbs: Pick<GdbSource, 'parent'>[], others: string[]): SubmissionReport {
  const issues: Issue[] = [];
  const present = new Set(reports.map((r) => r.database).filter(Boolean));
  const missingDatabases = TT16_DATABASES.filter((d) => !present.has(d.name)).map((d) => ({ name: d.name, title: d.title }));
  const dup = TT16_DATABASES.filter((d) => reports.filter((r) => r.database === d.name).length > 1);
  for (const d of dup) issues.push({ level: 'warn', text: `Có nhiều geodatabase cùng là ${d.name} — kiểm tra lại có trùng hồ sơ không` });

  // A common parent folder = the user picked the whole HoSoGIS folder (or the CSDL_<tên> folder above it).
  const parents = [...new Set(gdbs.map((g) => g.parent))];
  let folder: SubmissionReport['folder'] = null;
  if (parents.length === 1 && parents[0]) {
    const p = parents[0];
    const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    const projectFiles = others
      .filter((o) => o.startsWith(p + '/') && !o.slice(p.length + 1).includes('/'))
      .map((o) => o.slice(p.length + 1))
      .filter((f) => TT16_PROJECT_EXT.includes(f.split('.').pop()?.toLowerCase() ?? ''));
    folder = { name, nameOk: name === 'HoSoGIS', projectFiles };
    if (!folder.nameOk) issues.push({ level: 'warn', text: `Thư mục chứa geodatabase tên "${name}" — theo Thông tư phải là "HoSoGIS"` });
    if (!projectFiles.length)
      issues.push({ level: 'error', text: `Thiếu tệp tổng hợp <Tên ĐAQH> (${TT16_PROJECT_EXT.map((e) => '*.' + e).join(', ')}) trong thư mục ${name}` });
    for (const m of missingDatabases) issues.push({ level: 'error', text: `Thiếu ${m.name}.gdb (${m.title})` });
  }

  const ma = new Map<string, number>();
  for (const r of reports) for (const [k, n] of r.maHoSo) ma.set(k, (ma.get(k) ?? 0) + n);
  const maHoSo = [...ma.entries()].sort((a, b) => b[1] - a[1]);
  if (maHoSo.length > 1)
    issues.push({
      level: 'warn',
      text: `maHoSoQH không thống nhất giữa các lớp: ${maHoSo
        .slice(0, 5)
        .map(([k, n]) => `"${k}" (${n.toLocaleString('vi-VN')})`)
        .join(', ')}${maHoSo.length > 5 ? '…' : ''}`,
    });
  const mt = new Map<string, number>();
  for (const r of reports) for (const [k, n] of r.maThongTin) mt.set(k, (mt.get(k) ?? 0) + n);
  const maThongTin = [...mt.entries()].sort((a, b) => b[1] - a[1]);
  if (maThongTin.length > 1)
    issues.push({
      level: 'warn',
      text: `maThongTinQH không thống nhất giữa các lớp: ${maThongTin
        .slice(0, 5)
        .map(([k, n]) => `"${k}" (${n.toLocaleString('vi-VN')})`)
        .join(', ')}${maThongTin.length > 5 ? '…' : ''}`,
    });
  // Both codes start with the province code — they must agree.
  const pHoSo = maHoSo.length === 1 ? parseMaHoSo(maHoSo[0][0]) : null;
  const pThongTin = maThongTin.length === 1 ? parseMaThongTin(maThongTin[0][0]) : null;
  if (pHoSo && pThongTin && pHoSo.province !== pThongTin.province)
    issues.push({ level: 'warn', text: `Mã tỉnh trong maHoSoQH (${pHoSo.province}) khác mã tỉnh trong maThongTinQH (${pThongTin.province})` });
  return { gdbs: reports, missingDatabases, folder, issues, maHoSo, maThongTin };
}
