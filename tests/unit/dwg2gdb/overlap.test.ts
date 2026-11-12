// Overlapping areas of the same phanLoai are one region (two hatches of the same symbol drawn over each other).
import { describe, expect, it } from 'vitest';
import type { GisFeature } from '@/lib/dwg2gdb/features';
import { mergeOverlappingAreas, multiArea } from '@/lib/dwg2gdb/overlap';

const sq = (x: number, y: number, w: number, h = w): number[][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const feat = (rings: number[][][], phanLoai: string | null, extra: Partial<GisFeature> = {}): GisFeature => ({
  geometry: { type: 'MultiPolygon', coordinates: [rings] },
  tenDoiTuong: null,
  phanLoai,
  ghiChu: null,
  ...extra,
});
const area = (f: GisFeature) => (f.geometry.type === 'MultiPolygon' ? multiArea(f.geometry.coordinates) : 0);

describe('mergeOverlappingAreas', () => {
  it('two overlapping squares of the same phanLoai become one region covering both', () => {
    const r = mergeOverlappingAreas([feat([sq(0, 0, 10)], 'Đất ở'), feat([sq(5, 5, 10)], 'Đất ở')]);
    expect(r.features).toHaveLength(1);
    expect(r).toMatchObject({ absorbed: 1, groups: 1 });
    expect(area(r.features[0])).toBeCloseTo(100 + 100 - 25, 6);
  });

  it('a patch inside a bigger parcel of the same phanLoai disappears into it; a patch filling its hole closes the hole', () => {
    const inside = mergeOverlappingAreas([feat([sq(0, 0, 100)], 'Đất ở'), feat([sq(10, 10, 5)], 'Đất ở')]);
    expect(inside.features).toHaveLength(1);
    expect(area(inside.features[0])).toBeCloseTo(10000, 6);
    const holed = mergeOverlappingAreas([feat([sq(0, 0, 100), sq(40, 40, 20)], 'Đất ở'), feat([sq(30, 30, 40)], 'Đất ở')]);
    expect(holed.features).toHaveLength(1);
    expect(area(holed.features[0])).toBeCloseTo(10000, 6);
  });

  it('neighbours that only share an edge, other phanLoai and contradicting names stay separate', () => {
    expect(mergeOverlappingAreas([feat([sq(0, 0, 10)], 'Đất ở'), feat([sq(10, 0, 10)], 'Đất ở')]).features).toHaveLength(2);
    expect(mergeOverlappingAreas([feat([sq(0, 0, 10)], 'Đất ở'), feat([sq(5, 5, 10)], 'Đất công cộng')]).features).toHaveLength(2);
    const a = feat([sq(0, 0, 10)], 'Đất công cộng', { tenDoiTuong: 'TRƯỜNG A' });
    const b = feat([sq(5, 5, 10)], 'Đất công cộng', { tenDoiTuong: 'TRƯỜNG B' });
    expect(mergeOverlappingAreas([a, b]).features).toHaveLength(2);
    // …but a named region and an unnamed one over it are the same region and keep the name
    const c = feat([sq(5, 5, 10)], 'Đất công cộng');
    const r = mergeOverlappingAreas([a, c]);
    expect(r.features).toHaveLength(1);
    expect(r.features[0].tenDoiTuong).toBe('TRƯỜNG A');
  });

  it('a chain A–B–C is one region; the sources of every part stay (a region goes when any of them is taken out)', () => {
    const f = (x: number, ref: number) => feat([sq(x, 0, 10)], 'Đất ở', { refs: [[['d', ref]]] });
    const r = mergeOverlappingAreas([f(0, 1), f(8, 2), f(16, 3), f(100, 4)]);
    expect(r.features).toHaveLength(2);
    expect(r.features[0].refs).toEqual([[['d', 1], ['d', 2], ['d', 3]]]);
    expect(r.features[1].refs).toEqual([[['d', 4]]]);
  });

  it('leaves points and lines alone and keeps the order of the features', () => {
    const point: GisFeature = { geometry: { type: 'Point', coordinates: [1, 1] }, tenDoiTuong: null, phanLoai: 'Đất ở', ghiChu: null };
    const r = mergeOverlappingAreas([point, feat([sq(0, 0, 10)], 'Đất ở'), feat([sq(5, 5, 10)], 'Đất ở')]);
    expect(r.features.map((f) => f.geometry.type)).toEqual(['Point', 'MultiPolygon']);
  });

  it('is fast on many neighbours that touch but do not overlap', () => {
    const list: GisFeature[] = [];
    for (let i = 0; i < 20000; i++) list.push(feat([sq((i % 200) * 10, Math.floor(i / 200) * 10, 10)], 'Đất ở'));
    const t0 = Date.now();
    const r = mergeOverlappingAreas(list);
    expect(r.features).toHaveLength(20000);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});
