// Mapping templates ("mẫu ghép layer"): the user's decisions layer → TT16 class, saved and reused for the next
// project of the same office (offices keep their layer habits). A template is a small JSON file that can be
// shared between colleagues, so reading one treats it as untrusted input.
import { TT16_DATABASES } from '@/lib/gdb/tt16';
import { ROLES, type RoleId } from './roles';
import type { LayerRow } from './inventory';
import { compactName, targetPath, type GeomKind, type TargetPath } from './suggest';

export interface TargetOption {
  path: TargetPath;
  db: string;
  dataset: string;
  datasetTitle: string;
  cls: string;
  alias: string;
  geom: 'A' | 'L' | 'P';
}

/** Every feature class data can be written to (HienTrang, QuyHoach, MocGioi). */
export const TARGETS: TargetOption[] = TT16_DATABASES.filter((d) => d.datasets.length).flatMap((db) =>
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
);
const TARGET_SET = new Map(TARGETS.map((t) => [t.path, t]));
export const targetOption = (p: TargetPath | null | undefined) => (p ? TARGET_SET.get(p) : undefined);

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
}

export interface MappingTemplate {
  format: 'ledat-gis-layer-map';
  version: 1;
  name: string;
  updated: string;
  rules: TemplateRule[];
}

export const emptyTemplate = (name = 'Mẫu ghép layer'): MappingTemplate => ({ format: 'ledat-gis-layer-map', version: 1, name, updated: new Date().toISOString(), rules: [] });

const ruleKey = (role: RoleId, layer: string, kind: GeomKind) => `${role}|${layer}|${kind}`;

/** Lookup helper built once per template. */
export function templateLookup(t: MappingTemplate | null) {
  const exact = new Map<string, TemplateRule>();
  const byLayer = new Map<string, TemplateRule>();
  for (const r of t?.rules ?? []) {
    exact.set(ruleKey(r.role, r.layer, r.kind), r);
    const db = ROLES.find((x) => x.id === r.role)?.db;
    byLayer.set(`${db}|${r.layer}|${r.kind}`, r);
  }
  return (role: RoleId, layer: string, kind: GeomKind): MappingEntry | null => {
    const c = compactName(layer);
    const hit = exact.get(ruleKey(role, c, kind));
    if (hit) return { target: hit.target, phanLoai: hit.phanLoai };
    // Same layer on another map of the same database (e.g. QH05 → QH06): only when the class fits this map's
    // database, so a land-use rule of the planning map does not leak into the existing-state one.
    const db = ROLES.find((x) => x.id === role)?.db;
    const other = db ? byLayer.get(`${db}|${c}|${kind}`) : undefined;
    return other ? { target: other.target, phanLoai: other.phanLoai } : null;
  };
}

/** The template with these decisions added (same role × layer × kind replaced). */
export function mergeTemplate(t: MappingTemplate, decisions: TemplateRule[]): MappingTemplate {
  const map = new Map(t.rules.map((r) => [ruleKey(r.role, r.layer, r.kind), r]));
  for (const d of decisions) map.set(ruleKey(d.role, d.layer, d.kind), d);
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
