import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { WGS84_PROJ4 } from '@/lib/geo';
import {
  buildMeasureLayers,
  centroidOf,
  createFileLayerCache,
  fileIdOfLayerId,
  fileLayerPrefix,
  FILE_TAG_COLORS,
  moveById,
  nearestSnap,
  nextTagColor,
  orderFileLayers,
  segmentsOf,
  shownBounds,
  snapCandidatesOf,
  unionBounds,
  type FileRender,
} from '@/lib/map';

function makeDoc(lng: number, lat: number): CadDocument {
  const e: CadEntity[] = [
    { kind: 'polyline', layer: 'A', color: '#ff0000', points: [[lng, lat], [lng + 0.001, lat]], closed: false },
    { kind: 'text', layer: 'A', color: '#ffffff', text: 'Đường Nguyễn Văn Cừ', position: [lng, lat], height: 2, rotation: 0, hAlign: 'left', vAlign: 'baseline' },
  ];
  return {
    units: 'm',
    crs: WGS84_PROJ4,
    layers: [{ name: 'A', color: '#ffffff', visible: true }],
    entities: e,
    bbox: [[lng, lat], [lng + 0.001, lat + 0.001]],
    warnings: [],
  };
}

const VISIBLE = new Set(['A']);
const render = (id: string, doc: CadDocument | null, over: Partial<FileRender> = {}): FileRender => ({
  id,
  doc,
  visibleLayers: VISIBLE,
  opacity: 1,
  shown: true,
  ...over,
});

describe('multi-file layer ids', () => {
  it('prefixes and parses file ids', () => {
    expect(fileLayerPrefix('f3')).toBe('f3:');
    expect(fileIdOfLayerId('f3:cad-paths')).toBe('f3');
    expect(fileIdOfLayerId('f12:cad-polygons-fill')).toBe('f12');
    expect(fileIdOfLayerId('cad-paths')).toBeNull();
    expect(fileIdOfLayerId(undefined)).toBeNull();
  });

  it('buildLayers per file uses unique ids and the opacity prop', () => {
    const cache = createFileLayerCache();
    const a = cache.get(render('f1', makeDoc(105.7, 10)), { showText: true });
    const b = cache.get(render('f2', makeDoc(105.7, 10), { opacity: 0.4 }), { showText: true });
    const ids = [...a, ...b].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.every((l) => l.id.startsWith('f1:'))).toBe(true);
    expect(b.every((l) => l.id.startsWith('f2:'))).toBe(true);
    expect(b.every((l) => l.props.opacity === 0.4)).toBe(true);
    expect(a.every((l) => l.props.opacity === 1)).toBe(true);
  });

  it('memoises per file: changing one file does not rebuild the others', () => {
    const cache = createFileLayerCache();
    const d1 = makeDoc(105.7, 10);
    const d2 = makeDoc(105.8, 10);
    const shared = { showText: true };
    const a1 = cache.get(render('f1', d1), shared);
    const b1 = cache.get(render('f2', d2), shared);
    const a2 = cache.get(render('f1', d1), shared);
    const b2 = cache.get(render('f2', d2, { opacity: 0.5 }), shared);
    expect(a2).toBe(a1);
    expect(b2).not.toBe(b1);
    expect(cache.get(render('f2', d2, { shown: false }), shared)).toEqual([]);
  });

  it('draws the top of the list last (on top)', () => {
    const cache = createFileLayerCache();
    const files = [render('top', makeDoc(105.7, 10)), render('mid', makeDoc(105.7, 10)), render('bottom', makeDoc(105.7, 10))];
    const order = orderFileLayers(files, (f) => cache.get(f, { showText: false })).map((l) => fileIdOfLayerId(l.id));
    expect(order[0]).toBe('bottom');
    expect(order[order.length - 1]).toBe('top');
    expect(order.indexOf('mid')).toBeGreaterThan(order.indexOf('bottom'));
    expect(order.lastIndexOf('mid')).toBeLessThan(order.indexOf('top'));
  });
});

describe('file list helpers', () => {
  it('moveById swaps neighbours and clamps at the ends', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moveById(list, 'b', -1).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(moveById(list, 'b', 1).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(moveById(list, 'a', -1)).toBe(list);
    expect(moveById(list, 'c', 1)).toBe(list);
    expect(moveById(list, 'zzz', 1)).toBe(list);
  });

  it('nextTagColor picks an unused colour then cycles', () => {
    expect(nextTagColor([])).toBe(FILE_TAG_COLORS[0]);
    expect(nextTagColor([FILE_TAG_COLORS[0]])).toBe(FILE_TAG_COLORS[1]);
    expect(FILE_TAG_COLORS).toContain(nextTagColor([...FILE_TAG_COLORS]));
  });

  it('unions bounds and ignores hidden / empty files', () => {
    expect(unionBounds([null, undefined])).toBeNull();
    expect(unionBounds([[[1, 2], [3, 4]], [[0, 3], [2, 9]]])).toEqual([[0, 2], [3, 9]]);
    const d1 = makeDoc(105.7, 10);
    const d2 = makeDoc(105.9, 10.2);
    const b = shownBounds([
      { doc: d1, shown: true },
      { doc: d2, shown: false },
      { doc: null, shown: true },
    ]);
    expect(b![0]).toEqual([105.7, 10]);
    expect(b![1][0]).toBeCloseTo(105.701, 9);
    expect(b![1][1]).toBeCloseTo(10.001, 9);
  });
});

describe('measurement helpers', () => {
  it('snaps to the nearest candidate inside the radius only', () => {
    const project = (p: [number, number]): [number, number] => [p[0] * 100, p[1] * 100];
    const cands: [number, number][] = [[1, 1], [1.05, 1], [3, 3]];
    expect(nearestSnap(cands, [104, 100], project, 8)).toEqual([1.05, 1]);
    expect(nearestSnap(cands, [150, 150], project, 8)).toBeNull();
    expect(nearestSnap([], [0, 0], project)).toBeNull();
  });

  it('extracts snap candidates from picked items', () => {
    expect(snapCandidatesOf({ path: [[1, 2], [3, 4]] })).toEqual([[1, 2], [3, 4]]);
    expect(snapCandidatesOf({ polygon: [[[0, 0], [1, 0], [1, 1]]] })).toHaveLength(3);
    expect(snapCandidatesOf({ position: [5, 6] })).toEqual([[5, 6]]);
    expect(snapCandidatesOf(null)).toEqual([]);
    expect(snapCandidatesOf({ other: 1 })).toEqual([]);
  });

  it('segmentsOf closes rings and centroidOf averages', () => {
    const pts: [number, number][] = [[0, 0], [2, 0], [2, 2]];
    expect(segmentsOf(pts, false)).toHaveLength(2);
    expect(segmentsOf(pts, true)).toHaveLength(3);
    expect(segmentsOf(pts, false)[0].mid).toEqual([1, 0]);
    expect(centroidOf(pts)).toEqual([4 / 3, 2 / 3]);
  });

  it('builds measure layers for a draft and finished measurements', () => {
    const layers = buildMeasureLayers({
      finished: [{ id: 1, kind: 'area', points: [[105.7, 10], [105.701, 10], [105.701, 10.001]] }],
      draft: { kind: 'distance', points: [[105.7, 10]], cursor: [105.702, 10.002] },
    });
    const ids = layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['measure:fill', 'measure:casing', 'measure:line', 'measure:dots', 'measure:labels']));
    expect(buildMeasureLayers({ finished: [], draft: null })).toEqual([]);
  });
});
