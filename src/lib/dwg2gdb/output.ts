// What "Biên tập" shows: the features that will be written to one geodatabase (the same buildFeatures as the
// export: conversions, chained outlines, duplicates removed), as a CadDocument in drawing coordinates (VN-2000
// metres) — one layer per feature class, coloured by phanLoai like the QGIS project. Each feature is one handle:
// `e<k>` (previewHandle) when it can be removed (it comes from CAD objects, refs[k]), `x<k>` when the app added it
// (the detected planning boundary, the plan's own administrative unit).
import type { CadDocument, CadEntity, CadLayer, Vec2 } from '@/lib/cad/types';
import type { ClassData, SourceRef } from './features';
import { previewHandle } from './inventory';

export interface OutputView {
  doc: CadDocument;
  /** Per feature (index k of handle e<k>): its source alternatives (GisFeature.refs). */
  refs: SourceRef[][][];
}

/** Layer name of a class on the edit map: "<Feature dataset> / <Feature class>". */
export const outputLayerName = (c: Pick<ClassData, 'dataset' | 'cls'>) => `${c.dataset} / ${c.cls}`;

/** Feature counts per geodatabase (for the view switcher). */
export function outputDatabases(classes: ClassData[]): { db: string; count: number }[] {
  const by = new Map<string, number>();
  for (const c of classes) by.set(c.db, (by.get(c.db) ?? 0) + c.features.length);
  const order = ['QuyHoach', 'HienTrang', 'MocGioi', 'NenDiaHinh'];
  return [...by].map(([db, count]) => ({ db, count })).sort((a, b) => order.indexOf(a.db) - order.indexOf(b.db));
}

export function outputView(classes: ClassData[], db: string): OutputView {
  const entities: CadEntity[] = [];
  const layers: CadLayer[] = [];
  const refs: SourceRef[][][] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const v = (p: number[]): Vec2 => {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
    return [p[0], p[1]];
  };
  // Areas first, then lines, then points: drawn in that order.
  const rank = { A: 0, L: 1, P: 2 } as const;
  for (const c of classes.filter((x) => x.db === db).sort((a, b) => rank[a.geom] - rank[b.geom])) {
    const layer = outputLayerName(c);
    const colorOf = new Map(c.styles.map((s) => [s.phanLoai, s.color]));
    const fallback = c.styles[0]?.color ?? '#2563eb';
    layers.push({ name: layer, color: fallback, visible: true });
    for (const f of c.features) {
      const k = refs.length;
      refs.push(f.refs ?? []);
      const handle = f.refs?.length ? previewHandle(k) : `x${k}`;
      const color = colorOf.get(f.phanLoai) ?? fallback;
      const g = f.geometry;
      if (g.type === 'MultiPolygon')
        for (const poly of g.coordinates) entities.push({ kind: 'polygon', layer, color, fillOpacity: 0.45, rings: poly.map((r) => r.map(v)), handle });
      else if (g.type === 'MultiLineString')
        for (const line of g.coordinates) entities.push({ kind: 'polyline', layer, color, points: line.map(v), closed: false, handle });
      else entities.push({ kind: 'point', layer, color, position: v(g.coordinates), handle });
    }
  }
  const bbox: [Vec2, Vec2] = Number.isFinite(minX)
    ? [
        [minX, minY],
        [maxX, maxY],
      ]
    : [
        [0, 0],
        [0, 0],
      ];
  return { doc: { units: 'm', crs: null, layers, entities, bbox, warnings: [] }, refs };
}

/** A feature is written when one of its alternatives keeps all its objects (nothing left out). */
export function featureKept(alternatives: SourceRef[][], excluded: Map<string, Set<number>>): boolean {
  if (!alternatives.length) return true;
  return alternatives.some((alt) => alt.every(([d, i]) => !excluded.get(d)?.has(i)));
}
