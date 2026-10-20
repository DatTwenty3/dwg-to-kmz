import { describe, expect, it } from 'vitest';
import { pickSnap, snapTargetsOf } from '@/lib/map';

describe('snapTargetsOf', () => {
  it('a path gives its vertices and the midpoints of its segments', () => {
    const t = snapTargetsOf({ path: [[0, 0], [2, 0], [2, 2]] });
    expect(t.filter((x) => !x.mid).map((x) => x.p)).toEqual([[0, 0], [2, 0], [2, 2]]);
    expect(t.filter((x) => x.mid).map((x) => x.p)).toEqual([[1, 0], [2, 1]]);
  });
  it('a polygon also has the closing edge', () => {
    const t = snapTargetsOf({ polygon: [[[0, 0], [4, 0], [4, 4], [0, 4]]] });
    expect(t.filter((x) => x.mid)).toHaveLength(4);
    expect(t.filter((x) => x.mid).map((x) => x.p)).toContainEqual([0, 2]);
  });
  it('a point is itself; anything else gives nothing', () => {
    expect(snapTargetsOf({ position: [3, 4] })).toEqual([{ p: [3, 4], mid: false }]);
    expect(snapTargetsOf(null)).toEqual([]);
    expect(snapTargetsOf({ foo: 1 })).toEqual([]);
  });
});

describe('pickSnap', () => {
  const overlay = (objects: { layer: string; object: unknown }[]) =>
    ({ pickMultipleObjects: () => objects.map((o) => ({ layer: { id: o.layer }, object: o.object })) }) as never;
  const project = (p: [number, number]): [number, number] => [p[0] * 10, p[1] * 10];

  it('takes the nearest target within the radius; a vertex beats a midpoint at about the same distance', () => {
    const o = overlay([{ layer: 'a', object: { path: [[0, 0], [2, 0]] } }]);
    expect(pickSnap(o, project, 0.3, 0.2, 8)).toEqual({ p: [0, 0], mid: false });
    expect(pickSnap(o, project, 10.4, 0.3, 8)).toEqual({ p: [1, 0], mid: true });
    expect(pickSnap(o, project, 50, 50, 8)).toBeNull();
  });
  it('skips layers and ignored positions', () => {
    const o = overlay([
      { layer: 'grip-points', object: { position: [0, 0] } },
      { layer: 'a', object: { position: [0.1, 0] } },
    ]);
    expect(pickSnap(o, project, 0, 0, 8, { skipLayer: (id) => id.startsWith('grip-') })).toEqual({ p: [0.1, 0], mid: false });
    expect(pickSnap(o, project, 0, 0, 8, { skipLayer: (id) => id.startsWith('grip-'), ignore: new Set(['0.1,0']) })).toBeNull();
    expect(pickSnap(null, project, 0, 0, 8)).toBeNull();
  });
});
