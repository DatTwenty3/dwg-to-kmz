import { describe, expect, it } from 'vitest';
import type { CrsOptions, Vec2 } from '@/lib/cad/types';
import {
  buildVn2000,
  createPointTransformer,
  formatArea,
  formatLength,
  geodesicArea,
  geodesicDistance,
  pathLength,
  planarMeasure,
} from '@/lib/geo';

// Reference values below were produced with the official GeographicLib (geographiclib-geodesic 2.x,
// Geodesic.WGS84.Inverse / PolygonArea) and, where noted, published test data.

const VN105: CrsOptions = { proj4: buildVn2000(105, 3), swapXY: false, unitScale: 1 };

/** 100 m x 100 m square in VN-2000 (KTT 105, 3 deg) near Ninh Kieu, as [lng, lat] CCW. */
function vnSquare(e0 = 580900, n0 = 1107400, size = 100, crs: CrsOptions = VN105): Vec2[] {
  const tr = createPointTransformer(crs);
  const corners: Vec2[] = [
    [e0, n0],
    [e0 + size, n0],
    [e0 + size, n0 + size],
    [e0, n0 + size],
  ];
  return corners.map((c) => {
    const p = tr(c[0], c[1]);
    if (!p) throw new Error('transform failed');
    return p;
  });
}

describe('geodesicDistance (Karney inverse, WGS84)', () => {
  it('matches published Flinders Peak - Buninyong (Geoscience Australia): 54 972.271 m', () => {
    const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;
    const a: Vec2 = [dms(144, 25, 29.5244), -dms(37, 57, 3.7203)];
    const b: Vec2 = [dms(143, 55, 35.3839), -dms(37, 39, 10.1561)];
    expect(geodesicDistance(a, b)).toBeCloseTo(54972.271, 3);
  });

  it('matches GeographicLib to < 1 micrometre on a set of vectors (incl. near-antipodal, pole, equator)', () => {
    const cases: [Vec2, Vec2, number][] = [
      [[105.8542, 21.0285], [106.6297, 10.8231], 1132372.468842355], // Hanoi - Ho Chi Minh City
      [[105.74, 10.013], [105.7409, 10.0139], 140.16296805],
      [[0, 0], [179.5, 0], 19980861.908890963], // equatorial, almost antipodal
      [[0, 0], [179.7, 0.5], 19944127.420750458], // near-antipodal: Newton + astroid start
      [[0, 0], [180, 0], 20003931.458625447], // exactly antipodal on the equator
      [[0, 90], [0, -90], 20003931.458625447], // pole to pole
      [[-73.8, 40.6], [-0.5, 51.6], 5551759.400318679], // JFK - London Heathrow
      [[174.81, -41.32], [-5.5, 40.96], 19959679.267353822], // Wellington - Spain, near antipodal
      [[105, 10], [105.000001, 10], 0.109639364],
      [[112, 16], [114, 8], 911351.633073699], // Hoang Sa -> Truong Sa area
      [[100, 20], [-80, -20], 20003931.458625447], // exactly antipodal off-equator
    ];
    for (const [a, b, expected] of cases) {
      const d = geodesicDistance(a, b);
      expect(Number.isFinite(d)).toBe(true);
      expect(Math.abs(d - expected)).toBeLessThan(1e-6);
      expect(Math.abs(geodesicDistance(b, a) - expected)).toBeLessThan(1e-6); // symmetric
    }
  });

  it('Hanoi - Ho Chi Minh City is consistent with an independent spherical haversine (R = 6371 km)', () => {
    const rad = Math.PI / 180;
    const [l1, p1, l2, p2] = [105.8542 * rad, 21.0285 * rad, 106.6297 * rad, 10.8231 * rad];
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
    const sphere = 2 * 6371000 * Math.asin(Math.sqrt(h));
    const d = geodesicDistance([105.8542, 21.0285], [106.6297, 10.8231]);
    expect(Math.abs(d - sphere) / sphere).toBeLessThan(0.005); // sphere vs ellipsoid: < 0.5 %
  });

  it('is 0 for identical points and never NaN/throws for odd input', () => {
    expect(geodesicDistance([105, 10], [105, 10])).toBe(0);
    expect(geodesicDistance([105, 10], [105 + 360, 10])).toBeCloseTo(0, 6);
    expect(geodesicDistance([NaN, 10], [105, 10])).toBe(0);
    expect(Number.isFinite(geodesicDistance([105, 95], [105, -95]))).toBe(true); // lat clamped
  });
});

describe('pathLength', () => {
  const pts: Vec2[] = [
    [105, 10],
    [105.01, 10],
    [105.01, 10.01],
  ];
  it('sums segments and closes the ring when asked', () => {
    const open = pathLength(pts);
    const a = geodesicDistance(pts[0], pts[1]);
    const b = geodesicDistance(pts[1], pts[2]);
    expect(open).toBeCloseTo(a + b, 9);
    expect(pathLength(pts, true)).toBeCloseTo(a + b + geodesicDistance(pts[2], pts[0]), 9);
  });
  it('degenerate inputs give 0', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([[105, 10]])).toBe(0);
    expect(pathLength([[105, 10]], true)).toBe(0);
  });
});

describe('geodesicArea (ellipsoidal polygon area)', () => {
  it('matches GeographicLib PolygonArea', () => {
    const cases: [Vec2[], number][] = [
      [[[105, 10], [105.01, 10], [105.01, 10.01], [105, 10.01]], 1212678.3238768578],
      [[[105, 21], [106, 21], [106, 20], [105, 20]], 11548563398.867828],
      [[[179.9, 10], [-179.9, 10], [-179.9, 11], [179.9, 11]], 2421639958.920307], // across the antimeridian
      [[[102, 8], [118, 8], [118, 24], [102, 24]], 3037559010409.2305], // whole Viet Nam envelope
    ];
    for (const [ring, expected] of cases) {
      expect(Math.abs(geodesicArea(ring) - expected)).toBeLessThan(1e-3);
    }
  });

  it('is independent of orientation, start vertex and open/closed ring', () => {
    const ring: Vec2[] = [[105, 10], [105.01, 10], [105.01, 10.01], [105, 10.01]];
    const a = geodesicArea(ring);
    expect(a).toBeGreaterThan(0);
    expect(geodesicArea([...ring].reverse())).toBeCloseTo(a, 6);
    expect(geodesicArea([ring[2], ring[3], ring[0], ring[1]])).toBeCloseTo(a, 6);
    expect(geodesicArea([...ring, ring[0]])).toBeCloseTo(a, 6);
  });

  it('degenerate inputs give 0', () => {
    expect(geodesicArea([])).toBe(0);
    expect(geodesicArea([[105, 10]])).toBe(0);
    expect(geodesicArea([[105, 10], [105.1, 10.1]])).toBe(0);
    expect(geodesicArea([[105, 10], [105.1, 10.1], [105, 10]])).toBe(0); // closed 2-point ring
    expect(geodesicArea([[105, 10], [105, 10.1], [105, 10.2]])).toBeLessThan(1e-3); // collinear along a meridian
  });

  it('a 100 m x 100 m VN-2000 grid square is ~10 000 m2 on the ground too', () => {
    const sq = vnSquare();
    const ground = geodesicArea(sq);
    // Grid scale at 82 km from the central meridian is k = 0.9999 * (1 + (x/R)^2 / 2) ~ 1.00000, so ground
    // area ~ grid area; the (1 - 0.9999) central factor is almost exactly cancelled here. Allow 0.05 %.
    expect(Math.abs(ground - 10000) / 10000).toBeLessThan(5e-4);
  });
});

describe('planarMeasure (drawing CRS)', () => {
  it('returns VN-2000 coordinates, exact perimeter and area of the 100 m square', () => {
    const m = planarMeasure(vnSquare(), VN105, true);
    expect(m).not.toBeNull();
    expect(m!.length).toBeCloseTo(400, 4);
    expect(m!.area).toBeCloseTo(10000, 3);
    expect(m!.points[0][0]).toBeCloseTo(580900, 3);
    expect(m!.points[0][1]).toBeCloseTo(1107400, 3);
    expect(m!.points[2][0]).toBeCloseTo(581000, 3);
    expect(m!.points[2][1]).toBeCloseTo(1107500, 3);
  });

  it('omits area when open or < 3 points; open length excludes the closing segment', () => {
    const sq = vnSquare();
    const open = planarMeasure(sq, VN105, false)!;
    expect(open.area).toBeUndefined();
    expect(open.length).toBeCloseTo(300, 4);
    expect(planarMeasure(sq.slice(0, 2), VN105, true)!.area).toBeUndefined();
    expect(planarMeasure([], VN105, true)!.length).toBe(0);
    expect(planarMeasure([sq[0]], VN105, false)!.length).toBe(0);
  });

  it('planar vs geodesic: differ only by the grid scale factor and distortion', () => {
    // 1 km east-west line, 82 km east of the 105 deg central meridian, ~10 deg N.
    const tr = createPointTransformer(VN105);
    const a = tr(580900, 1107400)!;
    const b = tr(581900, 1107400)!;
    const planar = planarMeasure([a, b], VN105, false)!.length; // 1000 m on the grid
    const ground = geodesicDistance(a, b);
    // k(x) = 0.9999 * (1 + (x/R)^2 / 2) with x = 81 km gives ~1.0000: ground ~ grid / k.
    expect(planar).toBeCloseTo(1000, 4);
    expect(Math.abs(ground / planar - 1)).toBeLessThan(3e-4);
    // Near the central meridian the scale is exactly the 0.9999 factor: ground = grid / 0.9999 (+ tiny).
    const c = tr(500000, 1107400)!;
    const d = tr(501000, 1107400)!;
    const gc = geodesicDistance(c, d);
    expect(gc / 1000).toBeCloseTo(1 / 0.9999, 5);
  });

  it('honours swapXY, unitScale (mm) and returns drawing units', () => {
    const crs: CrsOptions = { proj4: buildVn2000(105, 3), swapXY: true, unitScale: 0.001 };
    // drawing X = Northing (mm), Y = Easting (mm)
    const tr = createPointTransformer(crs);
    const pts = [
      [1107400000, 580900000],
      [1107400000 + 100000, 580900000],
      [1107400000 + 100000, 580900000 + 100000],
      [1107400000, 580900000 + 100000],
    ].map((p) => tr(p[0], p[1])!);
    const m = planarMeasure(pts, crs, true)!;
    expect(Math.abs(m.points[0][0] - 1107400000)).toBeLessThan(0.5); // mm, sub-mm round-trip
    expect(Math.abs(m.points[0][1] - 580900000)).toBeLessThan(0.5);
    expect(m.length).toBeCloseTo(400, 4); // metres
    expect(m.area).toBeCloseTo(10000, 3); // m2
  });

  it('is orientation independent', () => {
    const sq = vnSquare();
    expect(planarMeasure([...sq].reverse(), VN105, true)!.area).toBeCloseTo(10000, 3);
  });

  it('returns null when a vertex cannot be projected or the CRS is invalid', () => {
    expect(planarMeasure([[105, 10], [NaN, 10]], VN105, false)).toBeNull();
    expect(planarMeasure([[105, 10], [105.1, 10]], { proj4: 'not a crs', swapXY: false, unitScale: 1 }, false)).toBeNull();
  });
});

describe('formatLength', () => {
  it('uses metres with one decimal below 1 km and km with two decimals above', () => {
    expect(formatLength(125.4)).toBe('125,4 m');
    expect(formatLength(0)).toBe('0 m');
    expect(formatLength(0.04)).toBe('0,0 m');
    expect(formatLength(999.94)).toBe('999,9 m');
    expect(formatLength(999.96)).toBe('1,00 km');
    expect(formatLength(1000)).toBe('1,00 km');
    expect(formatLength(3270)).toBe('3,27 km');
    expect(formatLength(1234567)).toBe('1.234,57 km'); // dot thousands
  });
  it('is safe for bad input', () => {
    expect(formatLength(NaN)).toBe('0 m');
    expect(formatLength(-5)).toBe('0 m');
  });
});

describe('formatArea', () => {
  it('uses m2 < 1 ha-ish, ha with 4 decimals up to 1 km2, km2 beyond', () => {
    expect(formatArea(850.2)).toBe('850,2 m²');
    expect(formatArea(9999.94)).toBe('9.999,9 m²');
    expect(formatArea(9999.96)).toBe('1,0000 ha');
    expect(formatArea(10000)).toBe('1,0000 ha');
    expect(formatArea(12534)).toBe('1,2534 ha');
    expect(formatArea(999999)).toBe('99,9999 ha');
    expect(formatArea(1000000)).toBe('1,00 km²');
    expect(formatArea(3210000)).toBe('3,21 km²');
    expect(formatArea(3037559010409.2305)).toBe('3.037.559,01 km²');
  });
  it('is safe for bad input', () => {
    expect(formatArea(NaN)).toBe('0 m²');
    expect(formatArea(0)).toBe('0 m²');
  });
});
