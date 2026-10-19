// "Bản vẽ tổng hợp" exported next to HoSoGIS: the CAD objects that went into the geodatabases, unchanged (same
// geometry, colours, hatch patterns, widths), regrouped on layers named after their TT16 class and phanLoai
// ("QH_ChucNangSuDungDat_A_Đất ở"), plus the texts inside the planning area ("QH_Chu_G-CHU"). Opened in
// ArcGIS Pro / QGIS, the Layer field gives the symbology and the texts become annotation — for the summary
// project (.aprx / .qgz) of the dossier. Coordinates stay in VN-2000 metres.
import type { CadDocument, CadEntity, CadLayer, Vec2 } from '@/lib/cad/types';
import { normalizeHex } from '@/lib/export/color';
import type { DrawingInput } from './features';
import { entityRowKey } from './inventory';
import { roleById, type RoleId } from './roles';
import { parseTarget, prettyLayer } from './suggest';
import type { MappingEntry } from './template';

const SHORT: Record<string, string> = { HienTrang: 'HT', QuyHoach: 'QH', MocGioi: 'MG' };

export interface SummaryOptions {
  boundary: Vec2[] | null;
  /** Texts inside the planning area (labels, names, elevations). */
  texts: boolean;
}

/** One key per drawn object, so the same object drawn in two maps / two copies of an xref is written once. */
function objectKey(layer: string, e: CadEntity): string {
  const r = (v: number) => Math.round(v * 100);
  const pts: Vec2[] =
    e.kind === 'polyline' ? e.points : e.kind === 'polygon' ? (e.rings[0] ?? []) : e.kind === 'table' ? [e.origin] : [e.position];
  const a = pts[0] ?? [0, 0];
  const b = pts[pts.length - 1] ?? a;
  return `${layer}|${e.kind}|${pts.length}|${r(a[0])},${r(a[1])}|${r(b[0])},${r(b[1])}${e.kind === 'text' ? `|${e.text}` : ''}`;
}

export function summaryDocument(drawings: (DrawingInput & { role: RoleId })[], mapping: Map<string, MappingEntry>, o: SummaryOptions): CadDocument {
  const layers = new Map<string, CadLayer>();
  const entities: CadEntity[] = [];
  const seen = new Set<string>();
  const put = (layer: string, e: CadEntity) => {
    const k = objectKey(layer, e);
    if (seen.has(k)) return;
    seen.add(k);
    if (!layers.has(layer)) layers.set(layer, { name: layer, color: normalizeHex(e.color), visible: true });
    entities.push({ ...e, layer });
  };

  let hasBoundary = false;
  for (const d of drawings) {
    const db = roleById(d.role).db;
    if (!db) continue;
    d.doc.entities.forEach((e, i) => {
      if (!d.inside[i]) return;
      const key = entityRowKey(d.id, e, d.color);
      if (!key) return;
      const m = mapping.get(key);
      const t = m?.target ? parseTarget(m.target) : null;
      if (t) {
        if (t.cls === 'RanhGioiQuyHoach_A') hasBoundary = true;
        put(`${SHORT[t.db] ?? t.db}_${t.cls}_${(m!.phanLoai.trim() || prettyLayer(e.layer)).slice(0, 120)}`, e);
      } else if (o.texts && e.kind === 'text') put(`${SHORT[db]}_Chu_${e.layer}`, e);
    });
  }
  if (o.boundary && !hasBoundary) put('QH_RanhGioiQuyHoach_A_Ranh giới lập quy hoạch', { kind: 'polyline', layer: '', color: '#ff0000', points: o.boundary, closed: true });

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of o.boundary ?? drawings.flatMap((d) => d.doc.bbox))
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
  return {
    units: 'm',
    crs: null,
    layers: [...layers.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    entities,
    bbox: [
      [x0, y0],
      [x1, y1],
    ],
    warnings: [],
  };
}
