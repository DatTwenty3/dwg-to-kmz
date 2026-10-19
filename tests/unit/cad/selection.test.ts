import { describe, expect, it } from 'vitest';
import { sweepIndexes } from '@/lib/cad/sweep';
import { applyRemoved, changeSelection, EMPTY_SELECTION, entityToSketch, objectHandle, parseHandle, selectionCount, selectionOverlay, sketchHandle } from '@/lib/cad/selection';
import { sketchToDocument } from '@/lib/cad/sketch';
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';

const line = (pts: Vec2[], closed = false): CadEntity => ({ kind: 'polyline', layer: 'L', color: '#112233', points: pts, closed });
const square = (x: number, y: number, s: number): Vec2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const doc = (entities: CadEntity[]): CadDocument => ({ units: 'deg', crs: null, layers: [{ name: 'L', color: '#112233', visible: true }], entities, bbox: [[0, 0], [10, 10]], warnings: [] });

describe('sweepIndexes', () => {
  const ents: CadEntity[] = [
    line([[1, 1], [2, 2]]), // 0: inside the box
    line([[1, 1], [9, 9]]), // 1: crosses the box edge
    { kind: 'point', layer: 'L', color: '#000000', position: [20, 20] }, // 2: far away
    { kind: 'polygon', layer: 'L', color: '#000000', rings: [square(0, 0, 10)], fillOpacity: 0.3 }, // 3: contains the box
  ];
  const box = square(0.5, 0.5, 3);
  it('window selects what is wholly inside', () => {
    expect(sweepIndexes(ents, box, false)).toEqual([0]);
  });
  it('crossing also selects what touches, and areas around the box', () => {
    expect(sweepIndexes(ents, box, true)).toEqual([0, 1, 3]);
  });
  it('accept leaves objects out', () => {
    expect(sweepIndexes(ents, box, true, (_e, i) => i !== 1)).toEqual([0, 3]);
  });
});

describe('selection', () => {
  it('toggles, adds and removes items', () => {
    let s = changeSelection(EMPTY_SELECTION, { sketches: ['a'], files: new Map([['f', [1, 2]]]) }, true);
    expect(selectionCount(s)).toEqual({ sketches: 1, objects: 2, total: 3 });
    s = changeSelection(s, { files: new Map([['f', [2, 3]]]) }); // flips: 2 off, 3 on
    expect([...s.files.get('f')!].sort()).toEqual([1, 3]);
    s = changeSelection(s, { sketches: ['a'], files: new Map([['f', [1, 3]]]) }, false);
    expect(selectionCount(s).total).toBe(0);
    expect(s.files.size).toBe(0);
  });

  it('removed objects leave the document', () => {
    const d = doc([line([[0, 0], [1, 1]]), line([[2, 2], [3, 3]]), line([[4, 4], [5, 5]])]);
    expect(applyRemoved(d, new Set()).entities).toBe(d.entities);
    expect(applyRemoved(d, new Set([1])).entities.map((e) => (e as { points: Vec2[] }).points[0][0])).toEqual([0, 4]);
  });

  it('highlight overlay carries a handle that says what was clicked', () => {
    const f = { id: 'k1', kind: 'point' as const, name: 'Điểm 1', points: [[105, 10] as Vec2], style: { color: '#e11d48' } };
    const sketches = sketchToDocument([f]);
    const files = new Map([['f1', doc([line([[0, 0], [1, 1]]), line([[2, 2], [3, 3]])])]]);
    const o = selectionOverlay({ sketches: new Set(['k1']), files: new Map([['f1', new Set([1])]]) }, files, sketches)!;
    expect(o.entities.map((e) => parseHandle(e.handle))).toEqual([{ fileId: 'f1', index: 1 }, { sketch: 'k1' }]);
    expect(o.entities.every((e) => e.color === '#f59e0b' && e.layer === '__selected')).toBe(true);
    expect(parseHandle(objectHandle('a b', 7))).toEqual({ fileId: 'a b', index: 7 });
    expect(parseHandle(sketchHandle('k9'))).toEqual({ sketch: 'k9' });
    expect(parseHandle('e12')).toBeNull();
    expect(selectionOverlay(EMPTY_SELECTION, files, sketches)).toBeNull();
  });
});

describe('entityToSketch', () => {
  it('open line → line, closed line / area → polygon without the repeated vertex, point → point', () => {
    expect(entityToSketch(line([[0, 0], [1, 1], [2, 0]]), [])).toMatchObject({ kind: 'line', name: 'Đường 1' });
    const ring = square(0, 0, 1);
    const closedByEnd = entityToSketch(line([...ring, ring[0]]), ['Vùng 1']);
    expect(closedByEnd).toMatchObject({ kind: 'polygon', name: 'Vùng 2' });
    expect(closedByEnd!.points).toHaveLength(4);
    const poly = entityToSketch({ kind: 'polygon', layer: 'L', color: '#336699', rings: [[...ring, ring[0]]], fillOpacity: 0.4 }, []);
    expect(poly).toMatchObject({ kind: 'polygon', style: { color: '#336699', fillOpacity: 0.4 } });
    expect(poly!.points).toHaveLength(4);
    expect(entityToSketch({ kind: 'point', layer: 'L', color: '#000000', position: [5, 6] }, [])).toMatchObject({ kind: 'point', points: [[5, 6]] });
  });
  it('texts cannot be reshaped', () => {
    expect(entityToSketch({ kind: 'text', layer: 'L', color: '#000000', text: 'x', position: [0, 0], height: 1, rotation: 0, hAlign: 'left', vAlign: 'baseline' }, [])).toBeNull();
  });
});
