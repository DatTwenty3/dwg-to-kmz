// "Đối chiếu CAD ↔ GIS": which objects of the drawings inside the planning area did not reach the geodatabases, and why.
// The mechanical form of looking at the result by eye — every drawing gets the same check, whatever its layers are
// called: an object counts as in the GIS when a feature of a class has it among the CAD objects it was made from
// (duplicates drawn on several maps and the pieces of a chained outline included).
import type { CadEntity } from '@/lib/cad/types';
import type { ClassData, DrawingInput } from './features';
import { entityRowKey } from './inventory';
import { suggest, type GeomKind } from './suggest';
import { targetOption, type MappingEntry } from './template';
import type { RoleId } from './roles';

export interface CoverageGroup {
  layer: string;
  kind: 'L' | 'A' | 'P';
  /** Names of the drawings the objects come from (first few). */
  drawings: string[];
  count: number;
  /** Total length of the lines, metres (0 for areas / points). */
  length: number;
  why: string;
  /** Worth a look: the layer was left unmapped without a rule that says it is no data, or it could not be converted. */
  attention: boolean;
}

export interface CoverageReport {
  /** Geometry objects (lines, areas, points) inside the planning area. */
  total: number;
  /** Of those: in the GIS. */
  covered: number;
  /** Left out by a layer the rules know to be no data (frames, symbols, outlines of parcels…). */
  onPurpose: number;
  /** Left out and worth a look (unmapped layers, outlines that could not be closed…). */
  attention: number;
  groups: CoverageGroup[];
}

const KIND: Partial<Record<CadEntity['kind'], 'L' | 'A' | 'P'>> = { polyline: 'L', polygon: 'A', point: 'P' };

function lengthOf(e: CadEntity): number {
  if (e.kind !== 'polyline') return 0;
  let len = 0;
  for (let i = 1; i < e.points.length; i++) len += Math.hypot(e.points[i][0] - e.points[i - 1][0], e.points[i][1] - e.points[i - 1][1]);
  // A stray vertex far away (coordinates left at a huge value) is no length worth showing.
  return Number.isFinite(len) && len < 1e7 ? len : 0;
}

/** The same object drawn on another map: same kind, vertex count and ends (to the metre). */
function signature(e: CadEntity): string | null {
  const r = (v: number) => Math.round(v);
  if (e.kind === 'point') return `P|${r(e.position[0])}|${r(e.position[1])}`;
  if (e.kind === 'polyline' && e.points.length) {
    const a = e.points[0];
    const b = e.points[e.points.length - 1];
    return `L|${e.points.length}|${r(a[0])}|${r(a[1])}|${r(b[0])}|${r(b[1])}`;
  }
  if (e.kind === 'polygon' && e.rings[0]?.length) {
    const a = e.rings[0][0];
    return `A|${e.rings.length}|${e.rings[0].length}|${r(a[0])}|${r(a[1])}`;
  }
  return null;
}

export function coverageReport(
  drawings: (DrawingInput & { role: RoleId })[],
  mapping: Map<string, MappingEntry>,
  classes: ClassData[],
): CoverageReport {
  const used = new Set<string>();
  for (const c of classes) for (const f of c.features) for (const alt of f.refs ?? []) for (const [d, i] of alt) used.add(`${d}|${i}`);

  // An object left out on one map may be in the GIS through its copy on another (the same road on the land-use map and
  // on the traffic map): those are not missing.
  const inGis = new Set<string>();
  for (const d of drawings)
    d.doc.entities.forEach((e, i) => {
      const sig = used.has(`${d.id}|${i}`) ? signature(e) : null;
      if (sig) inGis.add(sig);
    });

  let total = 0;
  let covered = 0;
  let onPurpose = 0;
  let attentionCount = 0;
  const groups = new Map<string, CoverageGroup>();
  for (const d of drawings) {
    d.doc.entities.forEach((e, i) => {
      const kind = KIND[e.kind];
      if (!kind || !d.inside[i]) return;
      total++;
      const sig = signature(e);
      if (used.has(`${d.id}|${i}`) || (sig && inGis.has(sig))) {
        covered++;
        return;
      }
      const key = entityRowKey(d.id, e, d.color);
      const target = key ? mapping.get(key)?.target : null;
      let why: string;
      let attn: boolean;
      if (target) {
        const geom = targetOption(target)?.geom;
        why = geom === 'A' && kind === 'L' ? 'Đường hở không khép kín được thành vùng' : 'Không chuyển được sang lớp đã ghép';
        attn = true;
      } else {
        const s = suggest(d.role, e.layer, kind as GeomKind);
        // A layer the rules know to be no data (frames, notes, outlines of parcels whose area comes from the hatch…) is
        // left out on purpose; one nobody recognised needs a decision.
        attn = !!s.unknown || (!s.target && !s.reason);
        why = s.target || s.unknown || !s.reason ? 'Chưa ghép vào lớp dữ liệu' : s.reason;
      }
      if (attn) attentionCount++;
      else onPurpose++;
      const g = `${e.layer}|${kind}|${why}`;
      const cur = groups.get(g) ?? { layer: e.layer, kind, drawings: [], count: 0, length: 0, why, attention: attn };
      cur.count++;
      cur.length += lengthOf(e);
      const name = d.name.replace(/\.(dwg|dxf)$/i, '');
      if (cur.drawings.length < 3 && !cur.drawings.includes(name)) cur.drawings.push(name);
      groups.set(g, cur);
    });
  }
  const list = [...groups.values()].sort((a, b) => Number(b.attention) - Number(a.attention) || b.length - a.length || b.count - a.count);
  return { total, covered, onPurpose, attention: attentionCount, groups: list };
}
