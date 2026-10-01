import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';

/** Real fixture (Ninh Kiều, Cần Thơ) median vertex, VN-2000 metres. */
export const NINH_KIEU: Vec2 = [580903, 1107416];

export function makeDoc(entities: CadEntity[], units = 'm'): CadDocument {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (v: Vec2) => {
    x0 = Math.min(x0, v[0]);
    y0 = Math.min(y0, v[1]);
    x1 = Math.max(x1, v[0]);
    y1 = Math.max(y1, v[1]);
  };
  for (const e of entities) {
    if (e.kind === 'polyline') e.points.forEach(add);
    else if (e.kind === 'polygon') e.rings.forEach((r) => r.forEach(add));
    else if (e.kind === 'table') add(e.origin);
    else add(e.position);
  }
  return {
    units,
    crs: null,
    layers: [{ name: '0', color: '#ffffff', visible: true }],
    entities,
    bbox: [
      [x0, y0],
      [x1, y1],
    ],
    warnings: ['cảnh báo gốc'],
  };
}

/** A small drawing (~1 km) around `c`, every entity kind. */
export function sampleDoc(c: Vec2 = NINH_KIEU, opts: { swap?: boolean; scale?: number; units?: string } = {}): CadDocument {
  const s = opts.scale ?? 1;
  const v = (dx: number, dy: number): Vec2 => {
    const x = (c[0] + dx) * s;
    const y = (c[1] + dy) * s;
    return opts.swap ? [y, x] : [x, y];
  };
  const entities: CadEntity[] = [
    { kind: 'polyline', layer: '0', color: '#ff0000', closed: false, width: 2 * s, points: [v(-500, -500), v(0, 0), v(500, 500)] },
    { kind: 'polygon', layer: '0', color: '#00ff00', fillOpacity: 0.5, rings: [[v(0, 0), v(100, 0), v(100, 100), v(0, 100)]] },
    {
      kind: 'text',
      layer: '0',
      color: '#ffffff',
      text: 'ĐẤT TRƯỜNG MẦM NON',
      position: v(10, 20),
      height: 3 * s,
      rotation: 0,
      hAlign: 'left',
      vAlign: 'baseline',
    },
    {
      kind: 'table',
      layer: '0',
      color: '#ffffff',
      origin: v(-100, 200),
      rotation: 30,
      rows: 2,
      cols: 2,
      rowHeights: [8 * s, 8 * s],
      colWidths: [20 * s, 40 * s],
      cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: 'Ký hiệu' }],
    },
    { kind: 'point', layer: '0', color: '#ffffff', position: v(-200, -100) },
  ];
  return makeDoc(entities, opts.units ?? 'm');
}

/** Ground distance in metres between two [lng, lat] (equirectangular, fine for < 10 km). */
export function metres(a: Vec2, b: Vec2): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110574;
  return Math.hypot(dx, dy);
}

// ---- Independent reference implementation (no proj4) ----------------------------------------
// Krüger series inverse TM (Karney 2011, 3 terms) + 7-parameter Helmert (position vector)
// + iterative ECEF → geodetic. Used only to cross-check proj4.

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

export function refVn2000ToWgs84(E: number, N: number, lon0: number, k0: number): Vec2 {
  const n = F / (2 - F);
  const AA = (A / (1 + n)) * (1 + (n * n) / 4 + (n ** 4) / 64);
  const beta = [n / 2 - (2 * n * n) / 3 + (37 * n ** 3) / 96, (n * n) / 48 + (n ** 3) / 15, (17 * n ** 3) / 480];
  const delta = [2 * n - (2 * n * n) / 3 - 2 * n ** 3, (7 * n * n) / 3 - (8 * n ** 3) / 5, (56 * n ** 3) / 15];
  const xi = N / (k0 * AA);
  const eta = (E - 500000) / (k0 * AA);
  let xi1 = xi;
  let eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lam = (lon0 * Math.PI) / 180 + Math.atan(Math.sinh(eta1) / Math.cos(xi1));

  // geodetic → ECEF (h = 0)
  const sinP = Math.sin(phi);
  const Nr = A / Math.sqrt(1 - E2 * sinP * sinP);
  const X = Nr * Math.cos(phi) * Math.cos(lam);
  const Y = Nr * Math.cos(phi) * Math.sin(lam);
  const Z = Nr * (1 - E2) * sinP;

  // Helmert, position vector convention (as proj4 +towgs84)
  const sec = Math.PI / (180 * 3600);
  const [tx, ty, tz] = [-191.90441429, -39.30318279, -111.45032835];
  const [rx, ry, rz] = [-0.00928836 * sec, 0.01975479 * sec, -0.00427372 * sec];
  const m = 1 + 0.252906278e-6;
  const X2 = tx + m * (X - rz * Y + ry * Z);
  const Y2 = ty + m * (rz * X + Y - rx * Z);
  const Z2 = tz + m * (-ry * X + rx * Y + Z);

  // ECEF → geodetic
  const p = Math.hypot(X2, Y2);
  let lat = Math.atan2(Z2, p * (1 - E2));
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(lat);
    const Ni = A / Math.sqrt(1 - E2 * s * s);
    const h = p / Math.cos(lat) - Ni;
    lat = Math.atan2(Z2, p * (1 - (E2 * Ni) / (Ni + h)));
  }
  return [(Math.atan2(Y2, X2) * 180) / Math.PI, (lat * 180) / Math.PI];
}
