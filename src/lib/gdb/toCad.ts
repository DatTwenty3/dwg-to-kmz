// File Geodatabase(s) → CadDocument, so a .gdb is shown on the map like a KMZ: one layer per feature class,
// coordinates kept in the geodatabase's own coordinate system (`crs` = its proj4) and re-projected by the app.
// Features keep their attribute table (`attrs`) for the property popup.
import proj4 from 'proj4';
import { robustBBox } from '../cad/normalize/bbox';
import type { CadDocument, CadEntity, CadLayer, Vec2 } from '../cad/types';
import { buildVn2000 } from '../geo/crs';
import { resolveCrsInput } from '../geo/epsg';
import { collectGdbs, readCatalog, type GdbClass, type GdbEntry } from './catalog';
import { parseSr } from './check';
import { decodeShape, groupRings } from './shape';

/** Distinct, readable colours for the classes (cycled). */
const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#0d9488', '#ea580c', '#4f46e5'];

/** Label height for point names (metres): readable at street zoom without hiding the data. */
const LABEL_HEIGHT = 4;
/** Fields whose value names a point feature (first non-empty wins). */
const LABEL_FIELDS = ['tenDoiTuong', 'ten', 'name', 'soHieuDiem', 'doCao'];

/** proj4 definition of a WKT: VN-2000 rebuilt with the app's 7-parameter shift, anything else via resolveCrsInput. */
export function crsFromWkt(wkt: string): string | null {
  if (!wkt) return null;
  const sr = parseSr(wkt);
  if (sr?.vn2000 && sr.lon0 !== null && sr.zone) return buildVn2000(sr.lon0, sr.zone);
  const r = resolveCrsInput(wkt);
  return r.ok ? r.proj4 : null;
}

const SKIP_ATTRS = new Set(['shape', 'shape_length', 'shape_area']);

function attrsOf(row: Record<string, string | number | null>): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === '' || SKIP_ATTRS.has(k.toLowerCase())) continue;
    out.push([k, typeof v === 'number' && !Number.isInteger(v) ? String(Math.round(v * 1000) / 1000) : String(v).normalize('NFC')]);
  }
  return out;
}

const labelOf = (row: Record<string, string | number | null>) => {
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  for (const f of LABEL_FIELDS) {
    const v = lower.get(f.toLowerCase());
    if (v !== null && v !== undefined && String(v).trim()) return String(v).trim().normalize('NFC');
  }
  return null;
};

export interface GdbToCadOptions {
  onProgress?: (stage: string, percent: number) => void;
}

/** Every geodatabase found in the entries, merged into one document (layers "<gdb> · <class>" when several). */
export async function gdbToCad(entries: GdbEntry[], opts: GdbToCadOptions = {}): Promise<CadDocument> {
  const { gdbs } = collectGdbs(entries);
  if (!gdbs.length) throw new Error('Không tìm thấy geodatabase (.gdb) nào — hãy nén cả thư mục .gdb (hoặc thư mục HoSoGIS) vào file .zip.');

  const catalogs: { name: string; classes: GdbClass[] }[] = [];
  const warnings: string[] = [];
  for (const g of gdbs) {
    try {
      catalogs.push({ name: g.name.replace(/\.gdb$/i, ''), classes: (await readCatalog(g)).classes });
    } catch (e) {
      warnings.push(`Không đọc được ${g.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!catalogs.length) throw new Error(warnings.join(' '));
  // The document's coordinate system: the most common one among the classes.
  const count = new Map<string, number>();
  for (const c of catalogs.flatMap((x) => x.classes)) {
    const def = crsFromWkt(c.wkt);
    if (def) count.set(def, (count.get(def) ?? 0) + 1);
  }
  const target = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!target) throw new Error('Geodatabase không có hệ tọa độ đọc được — chưa hỗ trợ hiển thị lên bản đồ.');

  const layers: CadLayer[] = [];
  const entities: CadEntity[] = [];
  const total = catalogs.reduce((t, x) => t + x.classes.length, 0);
  let done = 0;
  let curves = false;
  // Areas first, points last, so points and labels are drawn on top.
  const order = { A: 0, L: 1, P: 2 } as const;
  for (const cat of catalogs) {
    const classes = [...cat.classes].sort((a, b) => (order[a.geom ?? 'A'] ?? 0) - (order[b.geom ?? 'A'] ?? 0));
    for (const cls of classes) {
      opts.onProgress?.(`Đọc ${cls.name}`, 10 + (80 * done++) / Math.max(1, total));
      const gField = cls.fields.find((f) => f.type === 'geometry');
      if (cls.error || !gField?.geom || !cls.features) {
        if (cls.error) warnings.push(`Bỏ qua lớp ${cls.name}: ${cls.error}`);
        continue;
      }
      const layer = catalogs.length > 1 ? `${cat.name} · ${cls.name}` : cls.name;
      const color = PALETTE[layers.length % PALETTE.length];
      layers.push({ name: layer, color, visible: true });
      const src = crsFromWkt(cls.wkt);
      const conv = src && src !== target ? proj4(src, target) : null;
      const pt = (p: [number, number]): Vec2 => (conv ? (conv.forward(p) as Vec2) : p);
      let bad = 0;
      for (const { row, shape } of cls.features()) {
        if (!shape) continue;
        let s;
        try {
          s = decodeShape(shape, gField.geom);
        } catch {
          bad++;
          continue;
        }
        if (!s) continue;
        if (s.curved) curves = true;
        const attrs = attrsOf(row);
        // ObjectIDs repeat across classes: the handle (used to highlight the picked feature) carries the layer.
        const handle = `${layer}#${row.OBJECTID ?? row.objectid ?? ''}`;
        if (s.type === 'point') {
          const label = labelOf(row);
          for (const p of s.points) {
            const position = pt(p);
            entities.push({ kind: 'point', layer, color, position, handle, attrs });
            if (label)
              entities.push({ kind: 'text', layer, color, text: label, position, height: LABEL_HEIGHT, rotation: 0, hAlign: 'left', vAlign: 'bottom', handle, attrs });
          }
        } else if (s.type === 'line') {
          for (const part of s.parts) if (part.length >= 2) entities.push({ kind: 'polyline', layer, color, points: part.map(pt), closed: false, handle, attrs });
        } else {
          for (const rings of groupRings(s.parts))
            entities.push({ kind: 'polygon', layer, color, fillOpacity: 0.35, rings: rings.map((r) => r.map(pt)), handle, attrs });
        }
      }
      if (bad) warnings.push(`Lớp ${cls.name}: bỏ qua ${bad} đối tượng có hình học không đọc được.`);
    }
  }
  if (curves) warnings.push('Một số đường cong (cung tròn, Bézier) được vẽ gần đúng bằng đoạn thẳng.');
  if (!entities.length) warnings.push('Geodatabase không có đối tượng nào có hình học.');
  opts.onProgress?.('Hoàn tất', 95);
  return { units: 'm', crs: target, layers, entities, bbox: robustBBox(entities), warnings };
}
