// "Tìm trong bản vẽ": text entities, table cells and layer-less labels of the drawings on the map (WGS84
// documents), plus sketch names / labels. Accent-insensitive ("mam non" finds "MẦM NON").
import { foldVietnamese } from '@/lib/geo/provinces';
import type { SketchFeature } from './sketch';
import type { CadDocument, Vec2 } from './types';

export interface FoundItem {
  /** The matched text, as written. */
  text: string;
  /** Where it was found ("ninh-kieu.dwg · layer NKIEU-…" or "Nét vẽ"). */
  source: string;
  position: Vec2;
  /** For a sketch: its id (selecting the result selects the sketch). */
  sketchId?: string;
}

const MAX_RESULTS = 30;

function centroid(points: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

/**
 * Finds `query` in the given documents (must be WGS84) and sketches. Results are ranked: whole text equal >
 * starts with > contains; the same text at (almost) the same place is listed once.
 */
export function findText(
  query: string,
  docs: { name: string; doc: CadDocument }[],
  sketches: readonly SketchFeature[] = [],
): FoundItem[] {
  const q = foldVietnamese(query);
  if (q.length < 2) return [];
  const scored: { item: FoundItem; score: number }[] = [];
  const seen = new Set<string>();
  const add = (text: string, source: string, position: Vec2, sketchId?: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    const f = foldVietnamese(t);
    const i = f.indexOf(q);
    if (i < 0) return;
    const key = `${f}|${position[0].toFixed(4)}|${position[1].toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    scored.push({ item: { text: t, source, position, sketchId }, score: f === q ? 3 : i === 0 ? 2 : 1 });
  };

  for (const s of sketches) {
    if (s.points.length === 0) continue;
    const at = s.kind === 'point' ? s.points[0] : centroid(s.points);
    add(s.name, 'Nét vẽ', at, s.id);
    if (s.label) add(s.label, `Nhãn của “${s.name}”`, at, s.id);
  }
  for (const { name, doc } of docs) {
    for (const e of doc.entities) {
      if (e.kind === 'text') add(e.text, `${name} · ${e.layer}`, e.position);
      else if (e.kind === 'table') for (const c of e.cells) add(c.text, `${name} · bảng · ${e.layer}`, e.origin);
    }
    if (scored.length > 2000) break; // a huge drawing: enough candidates to rank
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.text.length - b.item.text.length)
    .slice(0, MAX_RESULTS)
    .map((s) => s.item);
}
