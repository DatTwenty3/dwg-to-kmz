// Mapping templates ("mẫu ghép layer"): the user's decisions layer → TT16 class, saved and reused for the next
// project of the same office (offices keep their layer habits). A template is a small JSON file that can be
// shared between colleagues, so reading one treats it as untrusted input.
import { TT16_DATABASES } from '@/lib/gdb/tt16';
import { ROLES, type DbName, type RoleId } from './roles';
import { TT16_SCHEMA } from '@/lib/gdb/tt16Schema';
import type { LayerRow } from './inventory';
import { compactName, counterpartDatasets, parseTarget, targetPath, type GeomKind, type TargetPath } from './suggest';

export interface TargetOption {
  path: TargetPath;
  db: string;
  dataset: string;
  datasetTitle: string;
  cls: string;
  alias: string;
  geom: 'A' | 'L' | 'P';
}

/**
 * Every feature class data can be written to (HienTrang, QuyHoach, MocGioi, and NenDiaHinh, whose classes come from the
 * template of the Bộ Xây dựng: the rules of Thông tư 16 give it no groups).
 */
export const TARGETS: TargetOption[] = [
  ...TT16_DATABASES.filter((d) => d.datasets.length).flatMap((db) =>
    db.datasets.flatMap((ds) =>
      ds.classes.map((c) => ({
        path: targetPath(db.name, ds.name, c.name),
        db: db.name,
        dataset: ds.name,
        datasetTitle: ds.title,
        cls: c.name,
        alias: c.alias,
        geom: c.name.slice(-1) as 'A' | 'L' | 'P',
      })),
    ),
  ),
  ...(TT16_SCHEMA.databases.NenDiaHinh ?? []).flatMap((ds) =>
    ds.classes.map((c) => ({
      path: targetPath('NenDiaHinh', ds.name, c.name),
      db: 'NenDiaHinh',
      dataset: ds.name,
      datasetTitle: 'Nền địa hình',
      cls: c.name,
      alias: c.alias,
      geom: c.name.slice(-1) as 'A' | 'L' | 'P',
    })),
  ),
];
const TARGET_SET = new Map(TARGETS.map((t) => [t.path, t]));
export const targetOption = (p: TargetPath | null | undefined) => (p ? TARGET_SET.get(p) : undefined);

export type TargetDb = DbName;

/**
 * The user's choice for one CAD object ("Đổi lớp" in Biên tập): it goes to this class whatever its layer row says.
 * `phanLoai` null = keep the phanLoai of its row.
 */
export interface ReassignEntry {
  target: TargetPath;
  phanLoai: string | null;
}
/** Key of a CAD object in a reassignment map: `<drawing id>|<index of the entity>`. */
export const reassignKey = (drawing: string, index: number) => `${drawing}|${index}`;

/** The mapping that applies to one object: its own reassignment, else the entry of its layer row. */
export function entryFor(mapping: ReadonlyMap<string, MappingEntry>, reassign: ReadonlyMap<string, ReassignEntry> | undefined, drawing: string, index: number, rowKey: string): MappingEntry | undefined {
  const own = reassign?.get(reassignKey(drawing, index));
  if (!own) return mapping.get(rowKey);
  return { target: own.target, phanLoai: own.phanLoai ?? mapping.get(rowKey)?.phanLoai ?? '' };
}

/**
 * The class of another database that corresponds to `target`: the same class in the paired dataset
 * (QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L → HienTrangGiaoThong/MangLuoiGiaoThongDuongBo_L), else the same class
 * anywhere in that database. Boundaries (ViTriRanhGioi) belong to both and stay. undefined: the other database has no
 * such class (ChiGioiDuongDo_L has its own in each, PhanKhuQuyHoach_A only in QuyHoach).
 */
export function retarget(target: TargetPath, db: TargetDb): TargetPath | undefined {
  const t = parseTarget(target);
  if (!t) return undefined;
  if (t.db === db || t.dataset === 'ViTriRanhGioi') return target;
  for (const ds of counterpartDatasets(t.dataset, db)) {
    const path = targetPath(db, ds, t.cls);
    if (TARGET_SET.has(path)) return path;
  }
  return TARGETS.find((x) => x.db === db && x.cls === t.cls)?.path;
}

/** Which source geometry kinds can feed a class of this geometry (vùng → điểm = điểm trong vùng, …). */
export function kindFits(kind: GeomKind, geom: 'A' | 'L' | 'P'): boolean {
  if (kind === 'T') return geom === 'P';
  if (kind === 'P') return geom === 'P';
  return true;
}

export interface MappingEntry {
  target: TargetPath | null;
  phanLoai: string;
}

export interface TemplateRule extends MappingEntry {
  role: RoleId;
  /** Folded layer name (compactName). */
  layer: string;
  kind: GeomKind;
  /** '#rrggbb' of the colour group of a hatch row (colour classification): the rule is for that colour only. */
  color?: string;
}

export interface MappingTemplate {
  format: 'ledat-gis-layer-map';
  version: 1;
  name: string;
  updated: string;
  rules: TemplateRule[];
}

export const emptyTemplate = (name = 'Mẫu ghép layer'): MappingTemplate => ({ format: 'ledat-gis-layer-map', version: 1, name, updated: new Date().toISOString(), rules: [] });

const ruleKey = (role: RoleId, layer: string, kind: GeomKind, color = '') => `${role}|${layer}|${kind}|${color}`;
const HEX = /^#[0-9a-f]{6}$/;

/** Lookup helper built once per template. */
export function templateLookup(t: MappingTemplate | null) {
  const exact = new Map<string, TemplateRule>();
  const byLayer = new Map<string, TemplateRule>();
  for (const r of t?.rules ?? []) {
    exact.set(ruleKey(r.role, r.layer, r.kind, r.color), r);
    const db = ROLES.find((x) => x.id === r.role)?.db;
    byLayer.set(`${db}|${r.layer}|${r.kind}|${r.color ?? ''}`, r);
  }
  /** `color` = colour group of the row: only rules saved for that colour match; without it only colourless rules. */
  return (role: RoleId, layer: string, kind: GeomKind, color?: string): MappingEntry | null => {
    const c = compactName(layer);
    const col = color?.toLowerCase() ?? '';
    const hit = exact.get(ruleKey(role, c, kind, col));
    if (hit) return { target: hit.target, phanLoai: hit.phanLoai };
    // Same layer on another map of the same database (e.g. QH05 → QH06): only when the class fits this map's
    // database, so a land-use rule of the planning map does not leak into the existing-state one.
    const db = ROLES.find((x) => x.id === role)?.db;
    const other = db ? byLayer.get(`${db}|${c}|${kind}|${col}`) : undefined;
    return other ? { target: other.target, phanLoai: other.phanLoai } : null;
  };
}

/** The template with these decisions added (same role × layer × kind replaced). */
export function mergeTemplate(t: MappingTemplate, decisions: TemplateRule[]): MappingTemplate {
  const map = new Map(t.rules.map((r) => [ruleKey(r.role, r.layer, r.kind, r.color), r]));
  for (const d of decisions) map.set(ruleKey(d.role, d.layer, d.kind, d.color), d);
  return { ...t, updated: new Date().toISOString(), rules: [...map.values()] };
}

const ROLE_IDS = new Set(ROLES.map((r) => r.id));
const KINDS = new Set(['A', 'L', 'P', 'T']);

export class TemplateError extends Error {}

/** Parses a template file; unknown rules are dropped, a file that is not a template throws a TemplateError. */
export function readTemplate(json: unknown): MappingTemplate {
  const o = json as Partial<MappingTemplate> | null;
  if (!o || typeof o !== 'object' || o.format !== 'ledat-gis-layer-map') throw new TemplateError('File không phải mẫu ghép layer của LEDAT-GIS.');
  if (o.version !== 1) throw new TemplateError('Mẫu ghép layer được tạo bởi phiên bản mới hơn — hãy tải lại trang.');
  const rules: TemplateRule[] = [];
  for (const r of Array.isArray(o.rules) ? o.rules.slice(0, 20_000) : []) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Partial<TemplateRule>;
    if (!ROLE_IDS.has(x.role as RoleId) || typeof x.layer !== 'string' || !KINDS.has(x.kind as string)) continue;
    const target = x.target === null ? null : typeof x.target === 'string' && TARGET_SET.has(x.target) ? x.target : undefined;
    if (target === undefined) continue;
    const opt = targetOption(target);
    if (opt && !kindFits(x.kind as GeomKind, opt.geom)) continue;
    rules.push({
      role: x.role as RoleId,
      layer: compactName(x.layer).slice(0, 200),
      kind: x.kind as GeomKind,
      ...(typeof x.color === 'string' && HEX.test(x.color.toLowerCase()) ? { color: x.color.toLowerCase() } : {}),
      target,
      phanLoai: typeof x.phanLoai === 'string' ? x.phanLoai.normalize('NFC').slice(0, 250) : '',
    });
  }
  return {
    format: 'ledat-gis-layer-map',
    version: 1,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 100) : 'Mẫu ghép layer',
    updated: typeof o.updated === 'string' ? o.updated.slice(0, 40) : new Date().toISOString(),
    rules,
  };
}


/**
 * What happens to a mapping-table row written to a class of another geometry ("Đường → vùng"), and what is lost —
 * null when the geometry is kept. Mirrors buildFeatures.
 */
export function conversionNote(
  r: Pick<LayerRow, 'kind' | 'count' | 'closed' | 'chained' | 'openLeft'>,
  geom: 'A' | 'L' | 'P',
): { text: string; warn: string | null } | null {
  if (r.kind === geom) return null;
  if (r.kind === 'L' && geom === 'A') {
    const areas = r.closed + r.chained;
    return {
      text: `Đường khép kín → vùng: ${areas.toLocaleString('vi-VN')} vùng${r.chained ? ` (${r.chained.toLocaleString('vi-VN')} vùng nối từ các đoạn hở)` : ''}`,
      warn: !areas
        ? 'Không có đường khép kín — không tạo được vùng nào; chọn lớp dạng đường (_L)'
        : r.openLeft
          ? `${r.openLeft.toLocaleString('vi-VN')} đường hở không khép kín được — bị bỏ`
          : null,
    };
  }
  if (r.kind === 'A' && geom === 'L') return { text: 'Vùng tô → đường viền', warn: null };
  if (r.kind === 'A' && geom === 'P') return { text: 'Vùng tô → điểm bên trong vùng', warn: null };
  if (r.kind === 'L' && geom === 'P') return { text: 'Đường → điểm (giữa đường, hoặc trong vòng khép kín)', warn: null };
  if (r.kind === 'T' && geom === 'P') return { text: 'Chữ → điểm, nội dung chữ thành tenDoiTuong', warn: null };
  return { text: 'Không chuyển được kiểu hình này', warn: 'Kiểu hình không phù hợp — layer sẽ bị bỏ qua' };
}

/** Features a row gives its class (before duplicates are removed). */
export const rowFeatureCount = (r: Pick<LayerRow, 'kind' | 'count' | 'closed' | 'chained'>, geom: 'A' | 'L' | 'P') =>
  r.kind === 'L' && geom === 'A' ? r.closed + r.chained : r.count;
