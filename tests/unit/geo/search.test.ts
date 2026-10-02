import { describe, expect, it } from 'vitest';
import { locateVn2000, parseCoordinateQuery, vn2000At, VN2000_ZONES, zoneByKey, zoneKeyOf, zoneProj4 } from '@/lib/geo/search';

describe('parseCoordinateQuery', () => {
  it.each([
    ['10.0129, 105.7402', 10.0129, 105.7402],
    ['10.0129,105.7402', 10.0129, 105.7402],
    ['10.0129 105.7402', 10.0129, 105.7402],
    ['10,0129 105,7402', 10.0129, 105.7402], // Vietnamese decimal comma
    ['10,0129; 105,7402', 10.0129, 105.7402],
    ['105.7402, 10.0129', 10.0129, 105.7402], // lng, lat typed by mistake
    ['10.0129N 105.7402E', 10.0129, 105.7402],
    ['105.7402E 10.0129N', 10.0129, 105.7402],
    ['10.0129° N, 105.7402° E', 10.0129, 105.7402],
  ])('lat/lng: %s', (q, lat, lng) => {
    expect(parseCoordinateQuery(q)).toEqual({ kind: 'latlng', lat, lng });
  });

  it.each([
    ['1107400 580900', 1107400, 580900],
    ['580900 1107400', 1107400, 580900], // CAD order (E, N): the larger is X = Bắc
    ['1.107.400,25 580.900,5', 1107400.25, 580900.5],
    ['1107400.25, 580900.5', 1107400.25, 580900.5],
    ['X: 1107400  Y: 580900', 1107400, 580900],
    ['X=1107400; Y=580900', 1107400, 580900],
    ['1,107,400.25 580,900.5', 1107400.25, 580900.5],
  ])('X/Y: %s', (q, x, y) => {
    expect(parseCoordinateQuery(q)).toEqual({ kind: 'xy', x, y });
  });

  it.each(['Ninh Kiều', 'đất trường mầm non', '10.01', '1 2 3', '200 300', '', '1107400 abc'])('not a coordinate: %s', (q) => {
    expect(parseCoordinateQuery(q)).toBeNull();
  });
});

describe('locateVn2000', () => {
  it('finds the KTT whose province contains the point (Ninh Kiều fixture: KTT 105°, Cần Thơ)', () => {
    const r = locateVn2000(1_107_400, 580_900);
    const hit = r.find((g) => g.lon0 === 105);
    expect(hit).toBeDefined();
    expect(hit!.province).toMatch(/Cần Thơ/);
    expect(hit!.lat).toBeCloseTo(10.013, 2);
    expect(hit!.lng).toBeCloseTo(105.74, 2);
  });

  it('finds nothing for coordinates outside Vietnam', () => {
    expect(locateVn2000(100, 100)).toEqual([]);
  });
});

describe('vn2000At (X/Y without a drawing: VN-2000 of the province under the point)', () => {
  it('Ninh Kiều → Cần Thơ, KTT 105°', () => {
    const r = vn2000At(105.74, 10.013);
    expect(r).toMatchObject({ lon0: 105 });
    expect(r!.province).toMatch(/Cần Thơ/);
    expect(r!.proj4).toContain('+lon_0=105 ');
  });

  it('is null outside Vietnam', () => {
    expect(vn2000At(2.35, 48.85)).toBeNull();
  });
});

describe('VN-2000 zones for the search bar', () => {
  it('lists every former province once (3°) plus the 6° zones, with stable keys', () => {
    const keys = VN2000_ZONES.map((z) => z.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(zoneByKey('p:Trà Vinh')).toMatchObject({ lon0: 105.5, zone: 3, short: "105°30'" });
    expect(zoneByKey('6:105')).toMatchObject({ lon0: 105, zone: 6 });
    expect(zoneByKey('p:Không có')).toBeNull();
    expect(zoneProj4(zoneByKey('6:105')!)).toContain('+k=0.9996');
  });

  it('maps a guess to the zone of its first province', () => {
    expect(zoneKeyOf({ lon0: 105.5, province: 'Vĩnh Long, Trà Vinh' })).toBe('p:Vĩnh Long');
  });
});
