import { describe, expect, it } from 'vitest';
import { entityWithPaths, gripKey, gripsOfShape, groupGrips, midpointsOf, movedPaths, objectOwner, parseGripKey, parseOwner, pathsWithout, shapeOfEntity, shapeOfSketch, sketchOwner } from '@/lib/cad/grips';
import { applyEdits } from '@/lib/cad/selection';
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';

const sq: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
const poly = (points: Vec2[], closed = false): CadEntity => ({ kind: 'polyline', layer: 'L', color: '#000000', points, closed });

describe('owners and keys', () => {
  it('round-trip', () => {
    expect(parseOwner(sketchOwner('k1'))).toEqual({ sketch: 'k1' });
    expect(parseOwner(objectOwner('f 1', 12))).toEqual({ fileId: 'f 1', index: 12 });
    const k = gripKey(objectOwner('f1', 3), 0, 2);
    expect(parseGripKey(k)).toEqual({ owner: objectOwner('f1', 3), r: 0, i: 2 });
    expect(parseGripKey('nonsense')).toBeNull();
  });
});

describe('grips of a shape', () => {
  it('a closed line repeating its first vertex has no grip on the repeat, and moves it together with the first', () => {
    const e = poly([...sq, sq[0]]);
    const s = shapeOfEntity('o', e)!;
    expect(s.closed).toBe(true);
    expect(gripsOfShape(s)).toHaveLength(4);
    const moved = movedPaths(s, new Set(['0:0']), [1, 2]);
    expect(moved[0][0]).toEqual([1, 2]);
    expect(moved[0][4]).toEqual([1, 2]); // the closing repeat followed
    expect(moved[0][1]).toEqual([4, 0]); // others untouched
    const out = entityWithPaths(e, moved) as Extract<CadEntity, { kind: 'polyline' }>;
    expect(out.points[0]).toEqual(out.points[out.points.length - 1]);
  });

  it('moves chosen vertices of an area, texts and points', () => {
    const area: CadEntity = { kind: 'polygon', layer: 'L', color: '#000000', rings: [sq], fillOpacity: 0.3 };
    const m = movedPaths(shapeOfEntity('o', area)!, new Set(['0:1', '0:2']), [0, 1]);
    expect(m[0]).toEqual([[0, 0], [4, 1], [4, 5], [0, 4]]);
    const text: CadEntity = { kind: 'text', layer: 'L', color: '#000000', text: 'x', position: [5, 5], height: 1, rotation: 0, hAlign: 'left', vAlign: 'baseline' };
    const t = entityWithPaths(text, movedPaths(shapeOfEntity('o', text)!, new Set(['0:0']), [2, 3])) as Extract<CadEntity, { kind: 'text' }>;
    expect(t.position).toEqual([7, 8]);
  });

  it('deleting vertices keeps the minimum', () => {
    const line = shapeOfEntity('o', poly([[0, 0], [1, 1], [2, 0]]))!;
    expect(pathsWithout(line, new Set(['0:1']))![0]).toEqual([[0, 0], [2, 0]]);
    expect(pathsWithout(line, new Set(['0:0', '0:1']))).toBeNull(); // would leave one vertex
    const closed = shapeOfEntity('o', poly([...sq, sq[0]]))!;
    expect(pathsWithout(closed, new Set(['0:2']))![0]).toEqual([[0, 0], [4, 0], [0, 4], [0, 0]]);
    expect(pathsWithout(closed, new Set(['0:1', '0:2']))).toBeNull();
    expect(pathsWithout(shapeOfEntity('o', { kind: 'point', layer: 'L', color: '#000000', position: [1, 1] })!, new Set(['0:0']))).toBeNull();
  });

  it('sketches', () => {
    const f = { id: 'k1', kind: 'polygon' as const, name: 'Vùng 1', points: sq, style: { color: '#e11d48' } };
    const s = shapeOfSketch(f);
    expect(s.owner).toBe(sketchOwner('k1'));
    expect(gripsOfShape(s)).toHaveLength(4);
    expect(s.min).toBe(3);
  });

  it('groups keys by owner; midpoints of edges', () => {
    const a = objectOwner('f', 1);
    const b = sketchOwner('k');
    const g = groupGrips([gripKey(a, 0, 1), gripKey(a, 0, 2), gripKey(b, 0, 0)]);
    expect([...g.get(a)!].sort()).toEqual(['0:1', '0:2']);
    expect([...g.get(b)!]).toEqual(['0:0']);
    expect(midpointsOf([sq], true)).toHaveLength(4);
    expect(midpointsOf([sq], false)).toHaveLength(3);
    expect(midpointsOf([[[0, 0], [2, 2]]], false)).toEqual([[1, 1]]);
  });

  it('edited objects replace the originals in the document', () => {
    const doc: CadDocument = { units: 'deg', crs: null, layers: [], entities: [poly([[0, 0], [1, 1]]), poly([[2, 2], [3, 3]])], bbox: [[0, 0], [3, 3]], warnings: [] };
    const repl = poly([[9, 9], [8, 8]]);
    expect(applyEdits(doc, new Map()).entities).toBe(doc.entities);
    const out = applyEdits(doc, new Map([[1, repl]]));
    expect(out.entities[1]).toBe(repl);
    expect(out.entities[0]).toBe(doc.entities[0]);
  });
});
