// "Quét khung" on the map of Bóc tách DWG: the objects of a drawing caught by the selection box (any polygon), to be
// left out of the export (stray hatches, legend leftovers…). Works on the previewed document (WGS84, the same
// coordinates as the swept polygon); objects are identified by their preview handle (inventory.previewHandle).
import { sweepIndexes } from '@/lib/cad/sweep';
import type { CadDocument, Vec2 } from '@/lib/cad/types';
import { previewIndex } from './inventory';

/** Indexes (preview handles) of the objects of `layers` caught by the sweep — see sweepIndexes for window / crossing. */
export function sweepSelect(doc: CadDocument, sweep: Vec2[], layers: Set<string>, touch: boolean): number[] {
  const out: number[] = [];
  for (const i of sweepIndexes(doc.entities, sweep, touch, (e) => previewIndex(e.handle) !== null && layers.has(e.layer))) out.push(previewIndex(doc.entities[i].handle)!);
  return out;
}
