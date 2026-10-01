// Merge several WGS84 documents (open files + sketches) into one, for a combined export. Pure.
import type { CadDocument, CadEntity, CadLayer, Vec2 } from './types';

export interface MergePart {
  /** Prefix for this part's layer names (usually the file name without extension). */
  name: string;
  /** Document in WGS84 (`crs` set), styles already applied. */
  doc: CadDocument;
  /** Only these layers are taken; all layers when omitted. */
  visibleLayers?: ReadonlySet<string>;
}

/** Separator between part name and layer name: KML folder "ninh-kieu – Đất ở", DXF layer "ninh-kieu – Đất ở". */
export const MERGE_SEP = ' – ';

/**
 * One document holding every part. Layer names become `${part} – ${layer}` (deduplicated), so layers of
 * different files never collide and each keeps its own colour / style. Entities are re-pointed to the new
 * names; handles are prefixed with the part index so they stay unique.
 */
export function mergeDocuments(parts: readonly MergePart[]): CadDocument {
  const crs = parts.find((p) => p.doc.crs)?.doc.crs ?? null;
  const layers: CadLayer[] = [];
  const entities: CadEntity[] = [];
  const warnings: string[] = [];
  const used = new Set<string>();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  parts.forEach((part, pi) => {
    if (part.doc.crs !== crs) {
      warnings.push(`Bỏ qua "${part.name}": không cùng hệ tọa độ với các phần khác.`);
      return;
    }
    const rename = new Map<string, string>();
    for (const l of part.doc.layers) {
      if (part.visibleLayers && !part.visibleLayers.has(l.name)) continue;
      let name = `${part.name}${MERGE_SEP}${l.name}`;
      for (let n = 2; used.has(name); n++) name = `${part.name}${MERGE_SEP}${l.name} (${n})`;
      used.add(name);
      rename.set(l.name, name);
      layers.push({ ...l, name, visible: true });
    }
    for (const e of part.doc.entities) {
      const layer = rename.get(e.layer);
      if (!layer) continue;
      entities.push({ ...e, layer, handle: e.handle === undefined ? undefined : `${pi}:${e.handle}` } as CadEntity);
    }
    const [[a, b], [c, d]] = part.doc.bbox;
    if ([a, b, c, d].every(Number.isFinite) && !(a === 0 && b === 0 && c === 0 && d === 0)) {
      x0 = Math.min(x0, a);
      y0 = Math.min(y0, b);
      x1 = Math.max(x1, c);
      y1 = Math.max(y1, d);
    }
    for (const w of part.doc.warnings) warnings.push(`${part.name}: ${w}`);
  });

  const bbox: [Vec2, Vec2] =
    x0 === Infinity
      ? [
          [0, 0],
          [0, 0],
        ]
      : [
          [x0, y0],
          [x1, y1],
        ];
  return { units: parts[0]?.doc.units ?? 'deg', crs, layers, entities, bbox, warnings };
}
