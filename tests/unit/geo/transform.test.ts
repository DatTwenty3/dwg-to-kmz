import { describe, expect, it } from 'vitest';
import type { CadEntity, CrsOptions, PolylineEntity, TableEntity, TextEntity } from '@/lib/cad/types';
import { WGS84_PROJ4, buildVn2000, transformDocument } from '@/lib/geo';
import { NINH_KIEU, makeDoc, metres, sampleDoc } from './helpers';

const crs105: CrsOptions = { proj4: buildVn2000(105, 3), swapXY: false, unitScale: 1 };

function byKind<K extends CadEntity['kind']>(es: CadEntity[], kind: K): Extract<CadEntity, { kind: K }> {
  return es.find((e) => e.kind === kind) as Extract<CadEntity, { kind: K }>;
}

describe('transformDocument', () => {
  it('transforms every entity kind to [lng, lat] and sets crs/bbox', () => {
    const doc = sampleDoc();
    const out = transformDocument(doc, crs105);
    expect(out.crs).toBe(WGS84_PROJ4);
    expect(out.entities).toHaveLength(5);
    expect(out.warnings).toEqual(['cảnh báo gốc']);
    const all: [number, number][] = [];
    for (const e of out.entities) {
      if (e.kind === 'polyline') all.push(...e.points);
      else if (e.kind === 'polygon') e.rings.forEach((r) => all.push(...r));
      else if (e.kind === 'table') all.push(e.origin);
      else all.push(e.position);
    }
    for (const [lng, lat] of all) {
      expect(lng).toBeGreaterThan(105.7);
      expect(lng).toBeLessThan(105.8);
      expect(lat).toBeGreaterThan(9.98);
      expect(lat).toBeLessThan(10.05);
    }
    const [[x0, y0], [x1, y1]] = out.bbox;
    expect(x0).toBeLessThan(x1);
    expect(y0).toBeLessThan(y1);
    for (const [lng, lat] of all) {
      expect(lng).toBeGreaterThanOrEqual(x0);
      expect(lng).toBeLessThanOrEqual(x1);
      expect(lat).toBeGreaterThanOrEqual(y0);
      expect(lat).toBeLessThanOrEqual(y1);
    }
    // centre polyline vertex is the fixture point
    const pl = byKind(out.entities, 'polyline');
    expect(metres(pl.points[1], [105.73977, 10.01328])).toBeLessThan(1);
    // table cells kept
    expect(byKind(out.entities, 'table').cells[0].text).toBe('Ký hiệu');
  });

  it('does not mutate the input', () => {
    const doc = sampleDoc();
    const snapshot = JSON.stringify(doc);
    transformDocument(doc, crs105);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('scales sizes to metres and handles mm drawings', () => {
    const m = transformDocument(sampleDoc(), crs105);
    const mm = transformDocument(sampleDoc(NINH_KIEU, { scale: 1000, units: 'mm' }), { ...crs105, unitScale: 0.001 });
    const tm = byKind(m.entities, 'text');
    const tmm = byKind(mm.entities, 'text');
    expect(tmm.height).toBeCloseTo(3, 9);
    expect(metres(tm.position, tmm.position)).toBeLessThan(0.001);
    const tb = byKind(mm.entities, 'table');
    expect(tb.rowHeights).toEqual([8, 8].map((v) => expect.closeTo(v, 9)));
    expect(tb.colWidths[1]).toBeCloseTo(40, 9);
    expect((byKind(mm.entities, 'polyline') as PolylineEntity).width).toBeCloseTo(2, 9);
  });

  it('swapXY gives the same ground positions as an un-swapped drawing', () => {
    const a = transformDocument(sampleDoc(), crs105);
    const b = transformDocument(sampleDoc(NINH_KIEU, { swap: true }), { ...crs105, swapXY: true });
    const pa = byKind(a.entities, 'polyline').points;
    const pb = byKind(b.entities, 'polyline').points;
    pa.forEach((p, i) => expect(metres(p, pb[i])).toBeLessThan(0.001));
  });

  it('corrects text/table rotation by meridian convergence', () => {
    const out = transformDocument(sampleDoc(), crs105);
    const t = byKind(out.entities, 'text') as TextEntity;
    // γ ≈ Δλ·sinφ = 0.74°·sin(10.01°) ≈ 0.129°; grid east is turned clockwise east of the KTT.
    const conv = t.rotation > 180 ? t.rotation - 360 : t.rotation;
    expect(conv).toBeLessThan(-0.11);
    expect(conv).toBeGreaterThan(-0.15);
    const tb = byKind(out.entities, 'table') as TableEntity;
    expect(tb.rotation - 30).toBeCloseTo(conv, 2);
    // West of the KTT the correction flips sign.
    const west = transformDocument(sampleDoc([419097, 1107416]), crs105);
    const tw = byKind(west.entities, 'text');
    expect(tw.rotation).toBeGreaterThan(0.11);
    expect(tw.rotation).toBeLessThan(0.15);
  });

  it('applies the manual offset in metres', () => {
    const a = transformDocument(sampleDoc(), crs105);
    const b = transformDocument(sampleDoc(), { ...crs105, offset: [100, -50] });
    const pa = byKind(a.entities, 'point').position;
    const pb = byKind(b.entities, 'point').position;
    expect(metres(pa, pb)).toBeGreaterThan(111);
    expect(metres(pa, pb)).toBeLessThan(112.5);
    expect(pb[0]).toBeGreaterThan(pa[0]);
    expect(pb[1]).toBeLessThan(pa[1]);
  });

  it('WGS84 drawings pass through', () => {
    const doc = makeDoc([{ kind: 'point', layer: '0', color: '#fff', position: [105.74, 10.01] }], 'unitless');
    const out = transformDocument(doc, { proj4: WGS84_PROJ4, swapXY: false, unitScale: 1 });
    const p = byKind(out.entities, 'point').position;
    expect(p[0]).toBeCloseTo(105.74, 9);
    expect(p[1]).toBeCloseTo(10.01, 9);
  });

  it('drops unprojectable points with a Vietnamese warning', () => {
    const doc = makeDoc([
      { kind: 'point', layer: '0', color: '#fff', position: [Number.NaN, 1] },
      { kind: 'polyline', layer: '0', color: '#fff', closed: false, points: [NINH_KIEU, [Number.NaN, 0], [580910, 1107420]] },
    ]);
    const out = transformDocument(doc, crs105);
    expect(out.entities).toHaveLength(1);
    expect(byKind(out.entities, 'polyline').points).toHaveLength(2);
    expect(out.warnings.at(-1)).toMatch(/không chuyển được/);
  });

  it('handles 50k entities / 500k vertices quickly', () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 50_000; i++) {
      const x = NINH_KIEU[0] + (i % 300) * 10;
      const y = NINH_KIEU[1] + Math.floor(i / 300) * 10;
      const points: [number, number][] = [];
      for (let k = 0; k < 10; k++) points.push([x + k, y + k]);
      entities.push({ kind: 'polyline', layer: '0', color: '#fff', closed: false, points });
    }
    const doc = makeDoc(entities);
    const t0 = performance.now();
    const out = transformDocument(doc, crs105);
    const ms = performance.now() - t0;
    expect(out.entities).toHaveLength(50_000);
    // ~0.3 s on a laptop; generous bound for CI.
    expect(ms).toBeLessThan(5000);
  });
});
