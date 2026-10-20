// Selecting and removing what was added to the map: the user's own sketches (SketchFeature) and single
// objects of an opened DWG/DXF/KMZ file (indexes into the file's WGS84 document). Pure (no DOM).
import type { CadDocument, CadEntity } from './types';

export interface MapSelection {
  /** Ids of sketches (SketchFeature.id). */
  sketches: ReadonlySet<string>;
  /** Open file id → indexes of its objects in `doc.entities`. */
  files: ReadonlyMap<string, ReadonlySet<number>>;
}

export const EMPTY_SELECTION: MapSelection = { sketches: new Set(), files: new Map() };

export function selectionCount(sel: MapSelection): { sketches: number; objects: number; total: number } {
  let objects = 0;
  for (const set of sel.files.values()) objects += set.size;
  return { sketches: sel.sketches.size, objects, total: sel.sketches.size + objects };
}

/** The selection with these items added (`on`) or taken out (`on` false); `on` undefined flips each item. */
export function changeSelection(
  sel: MapSelection,
  items: { sketches?: readonly string[]; files?: ReadonlyMap<string, readonly number[]> },
  on?: boolean,
): MapSelection {
  const sketches = new Set(sel.sketches);
  for (const id of items.sketches ?? []) {
    if (on ?? !sketches.has(id)) sketches.add(id);
    else sketches.delete(id);
  }
  const files = new Map<string, Set<number>>([...sel.files].map(([k, v]) => [k, new Set(v)]));
  for (const [fileId, list] of items.files ?? []) {
    const set = files.get(fileId) ?? new Set<number>();
    for (const i of list) {
      if (on ?? !set.has(i)) set.add(i);
      else set.delete(i);
    }
    if (set.size) files.set(fileId, set);
    else files.delete(fileId);
  }
  return { sketches, files };
}

/** The document with some objects replaced (vertices moved): index in `doc.entities` → new object. */
export function applyEdits(doc: CadDocument, edited: ReadonlyMap<number, CadEntity>): CadDocument {
  if (!edited.size) return doc;
  return { ...doc, entities: doc.entities.map((e, i) => edited.get(i) ?? e) };
}

/** The document without the objects removed from it (same document when nothing was removed). */
export function applyRemoved(doc: CadDocument, removed: ReadonlySet<number>): CadDocument {
  if (!removed.size) return doc;
  return { ...doc, entities: doc.entities.filter((_, i) => !removed.has(i)) };
}

export const SELECTED_LAYER = '__selected';
const SEP = '\u0001';
/** Handle of a selected object on the highlight overlay: tells which object a click on it means. */
export const objectHandle = (fileId: string, index: number) => `o${SEP}${fileId}${SEP}${index}`;
export const sketchHandle = (id: string) => `s${SEP}${id}`;
export function parseHandle(h: string | undefined): { sketch: string } | { fileId: string; index: number } | null {
  if (!h) return null;
  const [t, a, b] = h.split(SEP);
  if (t === 's' && a) return { sketch: a };
  if (t === 'o' && a && b !== undefined && /^\d+$/.test(b)) return { fileId: a, index: Number(b) };
  return null;
}

const HIGHLIGHT = '#f59e0b';

/**
 * Amber copies of the selected objects on one layer, drawn over the map. `docs` = the documents as drawn (index =
 * position in the file's `doc.entities`), `sketchDoc` = the sketches' document (entities carry the sketch id).
 */
export function selectionOverlay(sel: MapSelection, docs: ReadonlyMap<string, CadDocument>, sketchDoc: CadDocument): CadDocument | null {
  const entities: CadEntity[] = [];
  const paint = (e: CadEntity, handle: string): CadEntity => (e.kind === 'polygon' ? { ...e, layer: SELECTED_LAYER, color: HIGHLIGHT, fillOpacity: 0.35, handle } : { ...e, layer: SELECTED_LAYER, color: HIGHLIGHT, handle });
  for (const [fileId, set] of sel.files) {
    const doc = docs.get(fileId);
    if (!doc) continue;
    for (const i of set) if (doc.entities[i]) entities.push(paint(doc.entities[i], objectHandle(fileId, i)));
  }
  if (sel.sketches.size) for (const e of sketchDoc.entities) if (e.handle && sel.sketches.has(e.handle)) entities.push(paint(e, sketchHandle(e.handle)));
  if (!entities.length) return null;
  return {
    units: 'deg',
    crs: sketchDoc.crs,
    layers: [{ name: SELECTED_LAYER, color: HIGHLIGHT, visible: true }],
    entities,
    bbox: sketchDoc.bbox,
    warnings: [],
  };
}
