import { describe, expect, it } from 'vitest';
import { checkLocation, suggestCrs, transformDocument } from '@/lib/geo';
import { NINH_KIEU, makeDoc, sampleDoc } from './helpers';

const lon0Of = (proj: string) => Number(/\+lon_0=([\d.]+)/.exec(proj)?.[1]);
const zoneOf = (proj: string) => (proj.includes('+k=0.9996') ? 6 : 3);

describe('suggestCrs', () => {
  it('fixture Cần Thơ: ranks KTT 105° (3° then 6°) first, not 105°45\'', () => {
    const cands = suggestCrs(sampleDoc(), 'can-tho');
    expect(cands.length).toBeGreaterThan(5);
    // sorted descending
    for (let i = 1; i < cands.length; i++) expect(cands[i - 1].score).toBeGreaterThanOrEqual(cands[i].score);
    const [first, second] = cands;
    expect(lon0Of(first.crs.proj4)).toBe(105);
    expect(zoneOf(first.crs.proj4)).toBe(3);
    expect(first.crs.swapXY).toBe(false);
    expect(first.crs.unitScale).toBe(1);
    expect(lon0Of(second.crs.proj4)).toBe(105);
    expect(zoneOf(second.crs.proj4)).toBe(6);
    expect(first.center[0]).toBeCloseTo(105.7398, 3);
    expect(first.center[1]).toBeCloseTo(10.0133, 3);
    expect(first.reason).toMatch(/Cần Thơ/);
    const k10575 = cands.findIndex((c) => c.crs.proj4.includes('+lon_0=105.75 '));
    expect(k10575 === -1 || k10575 > 5).toBe(true);
  });

  it('without a province, KTT 105° is still among the best', () => {
    const cands = suggestCrs(sampleDoc());
    const top = cands.slice(0, 4).map((c) => lon0Of(c.crs.proj4));
    expect(top).toContain(105);
    expect(cands[0].score).toBeGreaterThan(50);
  });

  it('detects swapped X/Y', () => {
    const [first] = suggestCrs(sampleDoc(NINH_KIEU, { swap: true }), 'can-tho');
    expect(first.crs.swapXY).toBe(true);
    expect(lon0Of(first.crs.proj4)).toBe(105);
    expect(first.label).toMatch(/đổi X\/Y/);
  });

  it('detects millimetre coordinates even when units say metres', () => {
    const [first] = suggestCrs(sampleDoc(NINH_KIEU, { scale: 1000, units: 'm' }), 'can-tho');
    expect(first.crs.unitScale).toBe(0.001);
    expect(lon0Of(first.crs.proj4)).toBe(105);
  });

  it('detects WGS84 lon/lat drawings', () => {
    const doc = makeDoc([
      { kind: 'point', layer: '0', color: '#fff', position: [105.73, 10.01] },
      { kind: 'point', layer: '0', color: '#fff', position: [105.75, 10.02] },
    ]);
    const [first] = suggestCrs(doc, 'can-tho');
    expect(first.label).toMatch(/WGS84/);
    expect(first.crs.swapXY).toBe(false);
  });

  it('Hà Nội drawing with KTT 105° is detected for ha-noi', () => {
    const [first] = suggestCrs(sampleDoc([585000, 2325000]), 'ha-noi');
    expect(lon0Of(first.crs.proj4)).toBe(105);
    expect(first.center[1]).toBeGreaterThan(20.9);
    expect(first.center[1]).toBeLessThan(21.1);
  });

  it('Đồng Nai drawing with KTT 107°45\' is detected for dong-nai', () => {
    const [first] = suggestCrs(sampleDoc([420000, 1210000]), 'dong-nai');
    expect(lon0Of(first.crs.proj4)).toBe(107.75);
  });

  it('returns [] for an empty document', () => {
    const doc = makeDoc([]);
    doc.bbox = [
      [0, 0],
      [0, 0],
    ];
    expect(suggestCrs(doc)).toEqual([]);
  });
});

describe('checkLocation', () => {
  it('accepts the fixture in Cần Thơ and rejects the wrong KTT', () => {
    const ok = transformDocument(sampleDoc(), suggestCrs(sampleDoc(), 'can-tho')[0].crs);
    expect(checkLocation(ok, 'can-tho').ok).toBe(true);
    const far = transformDocument(sampleDoc([580903, 2107416]), suggestCrs(sampleDoc(), 'can-tho')[0].crs);
    const r = checkLocation(far, 'can-tho');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Cần Thơ|ngoài/);
    const mm = transformDocument(sampleDoc(NINH_KIEU, { scale: 1000 }), suggestCrs(sampleDoc(), 'can-tho')[0].crs);
    expect(checkLocation(mm).ok).toBe(false);
  });
});
