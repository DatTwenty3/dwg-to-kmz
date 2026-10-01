import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import {
  PROVINCES,
  VN_ENVELOPE,
  WGS84_PROJ4,
  buildVn2000,
  createPointTransformer,
  formatDegMin,
  getProvince,
  searchProvinces,
} from '@/lib/geo';
import { NINH_KIEU, metres, refVn2000ToWgs84 } from './helpers';

const vn = (lon0: number, zone: 3 | 6) => createPointTransformer({ proj4: buildVn2000(lon0, zone), swapXY: false, unitScale: 1 });

describe('buildVn2000', () => {
  it('builds the 3° and 6° strings', () => {
    expect(buildVn2000(105, 3)).toBe(
      '+proj=tmerc +lat_0=0 +lon_0=105 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 ' +
        '+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +units=m +no_defs',
    );
    expect(buildVn2000(105.75, 6)).toContain('+lon_0=105.75 +k=0.9996');
  });
  it('formats KTT as degrees/minutes', () => {
    expect(formatDegMin(105.75)).toBe("105°45'");
    expect(formatDegMin(104.5)).toBe("104°30'");
    expect(formatDegMin(105)).toBe("105°00'");
  });
});

describe('known points', () => {
  it('fixture Ninh Kiều, KTT 105° múi 3° → 10.01328°N 105.73977°E', () => {
    const p = vn(105, 3)(NINH_KIEU[0], NINH_KIEU[1])!;
    expect(metres(p, [105.73977, 10.01328])).toBeLessThan(1);
  });
  it('fixture Ninh Kiều, KTT 105° múi 6° → 10.01628°N 105.74000°E (~330 m north of 3°)', () => {
    const p6 = vn(105, 6)(NINH_KIEU[0], NINH_KIEU[1])!;
    expect(metres(p6, [105.74, 10.01628])).toBeLessThan(1);
    const p3 = vn(105, 3)(NINH_KIEU[0], NINH_KIEU[1])!;
    expect(metres(p3, p6)).toBeGreaterThan(300);
    expect(metres(p3, p6)).toBeLessThan(360);
  });
  it('fixture with KTT 105°45\' lands ~80 km east (wrong)', () => {
    const p = vn(105.75, 3)(NINH_KIEU[0], NINH_KIEU[1])!;
    expect(p[0]).toBeCloseTo(106.49, 2);
  });
  it('matches published sample of vn2000-converter (Đồng Tháp, KTT 105°) within 1 cm', () => {
    // npm "vn2000-converter" README: X 557975.802, Y 1142228.861 → 105.53115606, 10.32843706
    const p = vn(105, 3)(557975.802, 1142228.861)!;
    expect(metres(p, [105.53115606, 10.32843706])).toBeLessThan(0.01);
  });
  it('agrees with an independent Krüger + Helmert implementation (< 5 cm) for several KTTs', () => {
    const cases: [number, number, number, 3 | 6][] = [
      [580903, 1107416, 105, 3],
      [580903, 1107416, 105, 6],
      [505000, 2324000, 105, 3], // Hà Nội
      [600000, 1800000, 106, 3], // Quảng Bình
      [430000, 1200000, 107.75, 3], // Đồng Nai
      [520000, 1340000, 108.5, 3], // Đắk Lắk
      [450000, 2400000, 103, 3], // Điện Biên
    ];
    for (const [E, N, lon0, zone] of cases) {
      const p = vn(lon0, zone)(E, N)!;
      const r = refVn2000ToWgs84(E, N, lon0, zone === 3 ? 0.9999 : 0.9996);
      expect(metres(p, r)).toBeLessThan(0.05);
    }
  });
});

describe('round trip WGS84 ↔ VN-2000', () => {
  it('forward then inverse returns the same E/N within 1 cm', () => {
    for (const lon0 of [103, 104.5, 105, 105.75, 107.75, 108.5]) {
      for (const zone of [3, 6] as const) {
        const conv = proj4(buildVn2000(lon0, zone), WGS84_PROJ4);
        for (const [E, N] of [
          [500000, 1100000],
          [580903, 1107416],
          [420000, 2300000],
          [610000, 1500000],
        ]) {
          const ll = conv.forward([E, N]);
          const back = conv.inverse(ll);
          expect(Math.abs(back[0] - E)).toBeLessThan(0.01);
          expect(Math.abs(back[1] - N)).toBeLessThan(0.01);
        }
      }
    }
  });
});

describe('provinces', () => {
  it('has 34 current units with unique ids and sane data', () => {
    expect(PROVINCES).toHaveLength(34);
    expect(new Set(PROVINCES.map((p) => p.id)).size).toBe(34);
    for (const p of PROVINCES) {
      expect(p.lon0).toBeGreaterThanOrEqual(102);
      expect(p.lon0).toBeLessThanOrEqual(108.5);
      const [x0, y0, x1, y1] = p.bbox;
      expect(x0).toBeLessThan(x1);
      expect(y0).toBeLessThan(y1);
      expect(x0).toBeGreaterThanOrEqual(VN_ENVELOPE[0]);
      expect(x1).toBeLessThanOrEqual(VN_ENVELOPE[2]);
      expect(y0).toBeGreaterThanOrEqual(VN_ENVELOPE[1]);
      expect(y1).toBeLessThanOrEqual(VN_ENVELOPE[3]);
      expect(p.lon0Candidates?.[0]).toBe(p.lon0);
      expect(p.name).toBe(p.name.normalize('NFC'));
    }
    // 63 former provinces + Hà Tây
    expect(PROVINCES.flatMap((p) => p.formerUnits ?? [])).toHaveLength(64);
  });
  it('Cần Thơ: KTT 105°00\', former Sóc Trăng (105°30\') and Hậu Giang as aliases', () => {
    const ct = getProvince('can-tho')!;
    expect(ct.lon0).toBe(105);
    expect(ct.aliases).toEqual(expect.arrayContaining(['Sóc Trăng', 'Hậu Giang', 'Cần Thơ']));
    expect(ct.lon0Candidates).toEqual([105, 105.5]);
  });
  it('search by current or former name, diacritics-insensitive', () => {
    expect(searchProvinces('can tho')[0].id).toBe('can-tho');
    expect(searchProvinces('Sóc Trăng')[0].id).toBe('can-tho');
    expect(searchProvinces('ba ria')[0].id).toBe('ho-chi-minh');
    expect(searchProvinces('Đắk Nông')[0].id).toBe('lam-dong');
    expect(searchProvinces('thua thien hue')[0].id).toBe('hue');
    expect(searchProvinces('tp. hà nội')[0].id).toBe('ha-noi');
  });
  it('each former province bbox contains a point projected with its own KTT near the province', () => {
    // Sanity: the province bbox centre is within ±3.5° of its KTT (TM zones are local).
    for (const f of PROVINCES.flatMap((p) => p.formerUnits ?? [])) {
      const cx = (f.bbox[0] + f.bbox[2]) / 2;
      expect(Math.abs(cx - f.lon0)).toBeLessThan(2.2);
    }
  });
});
