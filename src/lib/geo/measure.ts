// Measurements on the map: geodesic (WGS84 ellipsoid) and planar in a drawing CRS (e.g. VN-2000).
//
// Geodesic part: TypeScript port of the inverse geodesic problem and the polygon-area
// accumulation of GeographicLib (Geodesic.js / PolygonArea.js, v2.x), MIT/X11 licence,
// Copyright (c) Charles Karney (2011-2022) <karney@alum.mit.edu>, https://geographiclib.sourceforge.io/
//   C. F. F. Karney, "Algorithms for geodesics", J. Geodesy 87, 43-55 (2013),
//   https://doi.org/10.1007/s00190-012-0578-z
// Series order 6 (nanometre accuracy on WGS84). Simplifications versus the original: no azimuth /
// reduced-length / scale outputs, no error-free accumulators (plain doubles are plenty for
// map-sized features), prolate (f < 0) branches dropped (WGS84 only). Antipodal and pole cases go
// through the original robust Newton + bracketing iteration, so nothing throws or returns NaN
// for finite input.
import type { CrsOptions, Vec2 } from '@/lib/cad/types';
import { createInversePointTransformer } from './project';

// ---------------------------------------------------------------------------------------------
// Geodesic core
// ---------------------------------------------------------------------------------------------

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;

const ORDER = 6;
const DEG = Math.PI / 180;
const TOL0 = Number.EPSILON;
const TOL1 = 200 * TOL0;
const TOL2 = Math.sqrt(TOL0);
const XTHRESH = 1000 * TOL2;
const TINY = Math.sqrt(Number.MIN_VALUE / Number.EPSILON);
const MAXIT1 = 20;
const MAXIT2 = MAXIT1 + 53 + 10;

const sq = (x: number): number => x * x;

function polyval(N: number, p: readonly number[], o: number, x: number): number {
  let y = N < 0 ? 0 : p[o++];
  while (--N >= 0) y = y * x + p[o++];
  return y;
}

/** Round tiny angles (|x| < 1/16 deg) so that e.g. 1e-20 deg is treated like 0 without losing the rest. */
function angRound(x: number): number {
  const z = 1 / 16;
  const y = Math.abs(x);
  const w = y < z ? z - (z - y) : y;
  return x < 0 ? -w : w;
}

/** sin/cos of an angle in degrees, exact for multiples of 90. */
function sincosd(x: number): { s: number; c: number } {
  let r = x % 360;
  const q = Math.round(r / 90);
  r -= 90 * q;
  r *= DEG;
  let s = Math.sin(r);
  let c = Math.cos(r);
  switch (((q % 4) + 4) % 4) {
    case 1: {
      const t = s;
      s = c;
      c = -t;
      break;
    }
    case 2:
      s = -s;
      c = -c;
      break;
    case 3: {
      const t = s;
      s = -c;
      c = t;
      break;
    }
    default:
  }
  return { s: s === 0 ? 0 * (x < 0 ? -1 : 1) : s, c: c === 0 ? 0 : c };
}

/** Longitude difference lon2 - lon1 in [-180, 180]; 180 (not -180) for east-going / meridional. */
function angDiff(lon1: number, lon2: number): number {
  const d0 = lon2 - lon1;
  let d = d0 % 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  if (d === -180 && d0 > 0) d = 180;
  return d;
}

function angNormalize(x: number): number {
  const y = x % 360;
  return y <= -180 ? y + 360 : y > 180 ? y - 360 : y;
}

function sinCosSeries(sinp: boolean, sinx: number, cosx: number, c: readonly number[]): number {
  let k = c.length;
  let n = k - (sinp ? 1 : 0);
  const ar = 2 * (cosx - sinx) * (cosx + sinx);
  let y0 = n & 1 ? c[--k] : 0;
  let y1 = 0;
  n = Math.floor(n / 2);
  while (n--) {
    y1 = ar * y0 - y1 + c[--k];
    y0 = ar * y1 - y0 + c[--k];
  }
  return sinp ? 2 * sinx * cosx * y0 : cosx * (y0 - y1);
}

function astroid(x: number, y: number): number {
  const p = sq(x);
  const q = sq(y);
  const r = (p + q - 1) / 6;
  if (q === 0 && r <= 0) return 0;
  const S = (p * q) / 4;
  const r2 = sq(r);
  const r3 = r * r2;
  const disc = S * (S + 2 * r3);
  let u = r;
  if (disc >= 0) {
    let T3 = S + r3;
    T3 += T3 < 0 ? -Math.sqrt(disc) : Math.sqrt(disc);
    const T = Math.cbrt(T3);
    u += T + (T !== 0 ? r2 / T : 0);
  } else {
    const ang = Math.atan2(Math.sqrt(-disc), -(S + r3));
    u += 2 * r * Math.cos(ang / 3);
  }
  const v = Math.sqrt(sq(u) + q);
  const uv = u < 0 ? q / (v - u) : u + v;
  const w = (uv - q) / (2 * v);
  return uv / (Math.sqrt(uv + sq(w)) + w);
}

const A1M1F_COEFF = [1, 4, 64, 0, 256];
const C1F_COEFF = [-1, 6, -16, 32, -9, 64, -128, 2048, 9, -16, 768, 3, -5, 512, -7, 1280, -7, 2048];
const A2M1F_COEFF = [-11, -28, -192, 0, 256];
const C2F_COEFF = [1, 2, 16, 32, 35, 64, 384, 2048, 15, 80, 768, 7, 35, 512, 63, 1280, 77, 2048];
const A3_COEFF = [-3, 128, -2, -3, 64, -1, -3, -1, 16, 3, -1, -2, 8, 1, -1, 2, 1, 1];
const C3_COEFF = [
  3, 128, 2, 5, 128, -1, 3, 3, 64, -1, 0, 1, 8, -1, 1, 4, 5, 256, 1, 3, 128, -3, -2, 3, 64, 1, -3, 2, 32, 7, 512, -10, 9,
  384, 5, -9, 5, 192, 7, 512, -14, 7, 512, 21, 2560,
];
const C4_COEFF = [
  97, 15015, 1088, 156, 45045, -224, -4784, 1573, 45045, -10656, 14144, -4576, -858, 45045, 64, 624, -4576, 6864, -3003,
  15015, 100, 208, 572, 3432, -12012, 30030, 45045, 1, 9009, -2944, 468, 135135, 5792, 1040, -1287, 135135, 5952, -11648,
  9152, -2574, 135135, -64, -624, 4576, -6864, 3003, 135135, 8, 10725, 1856, -936, 225225, -8448, 4992, -1144, 225225,
  -1440, 4160, -4576, 1716, 225225, -136, 63063, 1024, -208, 105105, 3584, -3328, 1144, 315315, -128, 135135, -2560,
  832, 405405, 128, 99099,
];

function a1m1f(eps: number): number {
  const p = Math.floor(ORDER / 2);
  const t = polyval(p, A1M1F_COEFF, 0, sq(eps)) / A1M1F_COEFF[p + 1];
  return (t + eps) / (1 - eps);
}
function a2m1f(eps: number): number {
  const p = Math.floor(ORDER / 2);
  const t = polyval(p, A2M1F_COEFF, 0, sq(eps)) / A2M1F_COEFF[p + 1];
  return (t - eps) / (1 + eps);
}
function fillCxf(eps: number, c: number[], coeff: readonly number[]): void {
  const eps2 = sq(eps);
  let d = eps;
  let o = 0;
  for (let l = 1; l <= ORDER; ++l) {
    const p = Math.floor((ORDER - l) / 2);
    c[l] = (d * polyval(p, coeff, o, eps2)) / coeff[o + p + 1];
    o += p + 2;
    d *= eps;
  }
}

// WGS84 constants and precomputed A3/C3/C4 coefficient tables (functions of n only).
const f1 = 1 - WGS84_F;
const e2 = WGS84_F * (2 - WGS84_F);
const ep2 = e2 / sq(f1);
const n3 = WGS84_F / (2 - WGS84_F);
const B = WGS84_A * f1;
/** Authalic radius squared. */
const C2 = (sq(WGS84_A) + (sq(B) * Math.atanh(Math.sqrt(e2))) / Math.sqrt(e2)) / 2;
const AREA0 = 4 * Math.PI * C2;
const ETOL2 = (0.1 * TOL2) / Math.sqrt((Math.max(0.001, Math.abs(WGS84_F)) * Math.min(1, 1 - WGS84_F / 2)) / 2);

const A3X: number[] = [];
const C3X: number[] = [];
const C4X: number[] = [];
(function initCoefficients() {
  let o = 0;
  for (let j = ORDER - 1; j >= 0; --j) {
    const p = Math.min(ORDER - j - 1, j);
    A3X.push(polyval(p, A3_COEFF, o, n3) / A3_COEFF[o + p + 1]);
    o += p + 2;
  }
  o = 0;
  for (let l = 1; l < ORDER; ++l) {
    for (let j = ORDER - 1; j >= l; --j) {
      const p = Math.min(ORDER - j - 1, j);
      C3X.push(polyval(p, C3_COEFF, o, n3) / C3_COEFF[o + p + 1]);
      o += p + 2;
    }
  }
  o = 0;
  for (let l = 0; l < ORDER; ++l) {
    for (let j = ORDER - 1; j >= l; --j) {
      const p = ORDER - j - 1;
      C4X.push(polyval(p, C4_COEFF, o, n3) / C4_COEFF[o + p + 1]);
      o += p + 2;
    }
  }
})();

const a3f = (eps: number): number => polyval(ORDER - 1, A3X, 0, eps);

function c3f(eps: number, c: number[]): void {
  let mult = 1;
  let o = 0;
  for (let l = 1; l < ORDER; ++l) {
    const p = ORDER - l - 1;
    mult *= eps;
    c[l] = mult * polyval(p, C3X, o, eps);
    o += p + 1;
  }
}

function c4f(eps: number, c: number[]): void {
  let mult = 1;
  let o = 0;
  for (let l = 0; l < ORDER; ++l) {
    const p = ORDER - l - 1;
    c[l] = mult * polyval(p, C4X, o, eps);
    o += p + 1;
    mult *= eps;
  }
}

/** s12b = distance / b and m12b = reduced length / b along the auxiliary sphere arc. */
function lengths(
  eps: number,
  sig12: number,
  ssig1: number,
  csig1: number,
  dn1: number,
  ssig2: number,
  csig2: number,
  dn2: number,
  C1a: number[],
  C2a: number[],
): { s12b: number; m12b: number } {
  let A1 = a1m1f(eps);
  fillCxf(eps, C1a, C1F_COEFF);
  let A2 = a2m1f(eps);
  fillCxf(eps, C2a, C2F_COEFF);
  const m0x = A1 - A2;
  A2 = 1 + A2;
  A1 = 1 + A1;
  const B1 = sinCosSeries(true, ssig2, csig2, C1a) - sinCosSeries(true, ssig1, csig1, C1a);
  const s12b = A1 * (sig12 + B1);
  const B2 = sinCosSeries(true, ssig2, csig2, C2a) - sinCosSeries(true, ssig1, csig1, C2a);
  const J12 = m0x * sig12 + (A1 * B1 - A2 * B2);
  const m12b = dn2 * (csig1 * ssig2) - dn1 * (ssig1 * csig2) - csig1 * csig2 * J12;
  return { s12b, m12b };
}

interface Start {
  sig12: number;
  salp1: number;
  calp1: number;
  salp2: number;
  calp2: number;
  dnm: number;
}

function inverseStart(
  sbet1: number,
  cbet1: number,
  sbet2: number,
  cbet2: number,
  lam12: number,
  slam12: number,
  clam12: number,
): Start {
  const out: Start = { sig12: -1, salp1: 0, calp1: 0, salp2: 0, calp2: 0, dnm: 0 };
  const sbet12 = sbet2 * cbet1 - cbet2 * sbet1;
  const cbet12 = cbet2 * cbet1 + sbet2 * sbet1;
  let sbet12a = sbet2 * cbet1;
  sbet12a += cbet2 * sbet1;

  const shortline = cbet12 >= 0 && sbet12 < 0.5 && cbet2 * lam12 < 0.5;
  let somg12: number;
  let comg12: number;
  if (shortline) {
    let sbetm2 = sq(sbet1 + sbet2);
    sbetm2 /= sbetm2 + sq(cbet1 + cbet2);
    out.dnm = Math.sqrt(1 + ep2 * sbetm2);
    const omg12 = lam12 / (f1 * out.dnm);
    somg12 = Math.sin(omg12);
    comg12 = Math.cos(omg12);
  } else {
    somg12 = slam12;
    comg12 = clam12;
  }

  out.salp1 = cbet2 * somg12;
  out.calp1 =
    comg12 >= 0
      ? sbet12 + (cbet2 * sbet1 * sq(somg12)) / (1 + comg12)
      : sbet12a - (cbet2 * sbet1 * sq(somg12)) / (1 - comg12);

  const ssig12 = Math.hypot(out.salp1, out.calp1);
  const csig12 = sbet1 * sbet2 + cbet1 * cbet2 * comg12;
  if (shortline && ssig12 < ETOL2) {
    out.salp2 = cbet1 * somg12;
    out.calp2 = sbet12 - cbet1 * sbet2 * (comg12 >= 0 ? sq(somg12) / (1 + comg12) : 1 - comg12);
    const t = Math.hypot(out.salp2, out.calp2);
    out.salp2 /= t;
    out.calp2 /= t;
    out.sig12 = Math.atan2(ssig12, csig12);
  } else if (Math.abs(n3) > 0.1 || csig12 >= 0 || ssig12 >= 6 * Math.abs(n3) * Math.PI * sq(cbet1)) {
    // zeroth-order spherical approximation is fine
  } else {
    // Near-antipodal: solve the astroid problem for the starting azimuth.
    const lam12x = Math.atan2(-slam12, -clam12);
    const k2 = sq(sbet1) * ep2;
    const eps = k2 / (2 * (1 + Math.sqrt(1 + k2)) + k2);
    const lamscale = WGS84_F * cbet1 * a3f(eps) * Math.PI;
    const betscale = lamscale * cbet1;
    const x = lam12x / lamscale;
    const y = sbet12a / betscale;
    if (y > -TOL1 && x > -1 - XTHRESH) {
      out.salp1 = Math.min(1, -x);
      out.calp1 = -Math.sqrt(1 - sq(out.salp1));
    } else {
      const k = astroid(x, y);
      const omg12a = lamscale * (-x * k) / (1 + k);
      somg12 = Math.sin(omg12a);
      comg12 = -Math.cos(omg12a);
      out.salp1 = cbet2 * somg12;
      out.calp1 = sbet12a - (cbet2 * sbet1 * sq(somg12)) / (1 - comg12);
    }
  }
  if (!(out.salp1 <= 0)) {
    const t = Math.hypot(out.salp1, out.calp1);
    out.salp1 /= t;
    out.calp1 /= t;
  } else {
    out.salp1 = 1;
    out.calp1 = 0;
  }
  return out;
}

interface Lam {
  lam12: number;
  salp2: number;
  calp2: number;
  sig12: number;
  ssig1: number;
  csig1: number;
  ssig2: number;
  csig2: number;
  eps: number;
  domg12: number;
  dlam12: number;
}

function lambda12(
  sbet1: number,
  cbet1: number,
  dn1: number,
  sbet2: number,
  cbet2: number,
  dn2: number,
  salp1: number,
  calp1In: number,
  slam120: number,
  clam120: number,
  diffp: boolean,
  C1a: number[],
  C2a: number[],
  C3a: number[],
): Lam {
  let calp1 = calp1In;
  if (sbet1 === 0 && calp1 === 0) calp1 = -TINY;
  const salp0 = salp1 * cbet1;
  const calp0 = Math.hypot(calp1, salp1 * sbet1);

  let ssig1 = sbet1;
  const somg1 = salp0 * sbet1;
  let csig1 = calp1 * cbet1;
  const comg1 = csig1;
  let t = Math.hypot(ssig1, csig1);
  ssig1 /= t;
  csig1 /= t;

  const salp2 = cbet2 !== cbet1 ? salp0 / cbet2 : salp1;
  const calp2 =
    cbet2 !== cbet1 || Math.abs(sbet2) !== -sbet1
      ? Math.sqrt(
          sq(calp1 * cbet1) + (cbet1 < -sbet1 ? (cbet2 - cbet1) * (cbet1 + cbet2) : (sbet1 - sbet2) * (sbet1 + sbet2)),
        ) / cbet2
      : Math.abs(calp1);
  let ssig2 = sbet2;
  const somg2 = salp0 * sbet2;
  let csig2 = calp2 * cbet2;
  const comg2 = csig2;
  t = Math.hypot(ssig2, csig2);
  ssig2 /= t;
  csig2 /= t;

  const sig12 = Math.atan2(Math.max(0, csig1 * ssig2 - ssig1 * csig2), csig1 * csig2 + ssig1 * ssig2);
  const somg12 = Math.max(0, comg1 * somg2 - somg1 * comg2);
  const comg12 = comg1 * comg2 + somg1 * somg2;
  const eta = Math.atan2(somg12 * clam120 - comg12 * slam120, comg12 * clam120 + somg12 * slam120);
  const k2 = sq(calp0) * ep2;
  const eps = k2 / (2 * (1 + Math.sqrt(1 + k2)) + k2);
  c3f(eps, C3a);
  const B312 = sinCosSeries(true, ssig2, csig2, C3a) - sinCosSeries(true, ssig1, csig1, C3a);
  const domg12 = -WGS84_F * a3f(eps) * salp0 * (sig12 + B312);
  const lam12 = eta + domg12;
  let dlam12 = 0;
  if (diffp) {
    if (calp2 === 0) dlam12 = (-2 * f1 * dn1) / sbet1;
    else {
      dlam12 = lengths(eps, sig12, ssig1, csig1, dn1, ssig2, csig2, dn2, C1a, C2a).m12b;
      dlam12 *= f1 / (calp2 * cbet2);
    }
  }
  return { lam12, salp2, calp2, sig12, ssig1, csig1, ssig2, csig2, eps, domg12, dlam12 };
}

interface InverseResult {
  /** Geodesic distance, metres. */
  s12: number;
  /** Area between the geodesic and the equator, m² (the polygon-area edge term). */
  S12: number;
}

/** Karney inverse problem on WGS84 (degrees in, metres / m² out). */
function geodInverse(lat1In: number, lon1: number, lat2In: number, lon2: number): InverseResult {
  let lat1 = angRound(Math.max(-90, Math.min(90, lat1In)));
  let lat2 = angRound(Math.max(-90, Math.min(90, lat2In)));
  let lon12 = angDiff(lon1, lon2);
  let lonsign = lon12 < 0 || Object.is(lon12, -0) ? -1 : 1;
  lon12 *= lonsign;
  const lam12 = lon12 * DEG;
  const sc = sincosd(lon12);
  const slam12 = sc.s;
  const clam12 = sc.c;
  const lon12s = 180 - lon12;

  const swapp = Math.abs(lat1) < Math.abs(lat2) ? -1 : 1;
  if (swapp < 0) {
    lonsign *= -1;
    [lat1, lat2] = [lat2, lat1];
  }
  const latsign = lat1 < 0 || Object.is(lat1, -0) ? 1 : -1; // copysign(1, -lat1)
  lat1 *= latsign;
  lat2 *= latsign;

  let t = sincosd(lat1);
  let sbet1 = f1 * t.s;
  let cbet1 = t.c;
  let h = Math.hypot(sbet1, cbet1);
  sbet1 /= h;
  cbet1 /= h;
  cbet1 = Math.max(TINY, cbet1);

  t = sincosd(lat2);
  let sbet2 = f1 * t.s;
  let cbet2 = t.c;
  h = Math.hypot(sbet2, cbet2);
  sbet2 /= h;
  cbet2 /= h;
  cbet2 = Math.max(TINY, cbet2);

  if (cbet1 < -sbet1) {
    if (cbet2 === cbet1) sbet2 = sbet2 < 0 ? -Math.abs(sbet1) : Math.abs(sbet1);
  } else if (Math.abs(sbet2) === -sbet1) cbet2 = cbet1;

  const dn1 = Math.sqrt(1 + ep2 * sq(sbet1));
  const dn2 = Math.sqrt(1 + ep2 * sq(sbet2));
  const C1a = new Array<number>(ORDER + 1).fill(0);
  const C2a = new Array<number>(ORDER + 1).fill(0);
  const C3a = new Array<number>(ORDER).fill(0);

  let s12x = 0;
  let sig12 = 0;
  let calp1 = 0;
  let salp1 = 0;
  let calp2 = 0;
  let salp2 = 0;
  let omg12 = 0;
  let somg12 = 2;
  let comg12 = 0;
  let meridian = lat1 === -90 || slam12 === 0;

  if (meridian) {
    calp1 = clam12;
    salp1 = slam12;
    calp2 = 1;
    salp2 = 0;
    const ssig1 = sbet1;
    const csig1 = calp1 * cbet1;
    const ssig2 = sbet2;
    const csig2 = calp2 * cbet2;
    sig12 = Math.atan2(Math.max(0, csig1 * ssig2 - ssig1 * csig2), csig1 * csig2 + ssig1 * ssig2);
    const L = lengths(n3, sig12, ssig1, csig1, dn1, ssig2, csig2, dn2, C1a, C2a);
    s12x = L.s12b;
    let m12x = L.m12b;
    if (sig12 < TOL2 || m12x >= 0) {
      if (sig12 < 3 * TINY || (sig12 < TOL0 && (s12x < 0 || m12x < 0))) sig12 = m12x = s12x = 0;
      s12x *= B;
    } else meridian = false;
  }

  let sbet1Eq = false;
  if (!meridian && sbet1 === 0 && lon12s >= WGS84_F * 180) {
    // along the equator
    sbet1Eq = true;
    calp1 = calp2 = 0;
    salp1 = salp2 = 1;
    s12x = WGS84_A * lam12;
    sig12 = omg12 = lam12 / f1;
  }

  if (!meridian && !sbet1Eq) {
    const st = inverseStart(sbet1, cbet1, sbet2, cbet2, lam12, slam12, clam12);
    sig12 = st.sig12;
    salp1 = st.salp1;
    calp1 = st.calp1;
    if (sig12 >= 0) {
      salp2 = st.salp2;
      calp2 = st.calp2;
      s12x = sig12 * B * st.dnm;
      omg12 = lam12 / (f1 * st.dnm);
    } else {
      let numit = 0;
      let salp1a = TINY;
      let calp1a = 1;
      let salp1b = TINY;
      let calp1b = -1;
      let tripn = false;
      let tripb = false;
      let lam: Lam;
      for (;; ++numit) {
        lam = lambda12(sbet1, cbet1, dn1, sbet2, cbet2, dn2, salp1, calp1, slam12, clam12, numit < MAXIT1, C1a, C2a, C3a);
        const v = lam.lam12;
        salp2 = lam.salp2;
        calp2 = lam.calp2;
        if (tripb || !(Math.abs(v) >= (tripn ? 8 : 1) * TOL0) || numit === MAXIT2) break;
        if (v > 0 && (numit < MAXIT1 || calp1 / salp1 > calp1b / salp1b)) {
          salp1b = salp1;
          calp1b = calp1;
        } else if (v < 0 && (numit < MAXIT1 || calp1 / salp1 < calp1a / salp1a)) {
          salp1a = salp1;
          calp1a = calp1;
        }
        if (numit < MAXIT1 && lam.dlam12 > 0) {
          const dalp1 = -v / lam.dlam12;
          if (Math.abs(dalp1) < Math.PI) {
            const sd = Math.sin(dalp1);
            const cd = Math.cos(dalp1);
            const nsalp1 = salp1 * cd + calp1 * sd;
            if (nsalp1 > 0) {
              calp1 = calp1 * cd - salp1 * sd;
              salp1 = nsalp1;
              const n = Math.hypot(salp1, calp1);
              salp1 /= n;
              calp1 /= n;
              tripn = Math.abs(v) <= 16 * TOL0;
              continue;
            }
          }
        }
        salp1 = (salp1a + salp1b) / 2;
        calp1 = (calp1a + calp1b) / 2;
        const n = Math.hypot(salp1, calp1);
        salp1 /= n;
        calp1 /= n;
        tripn = false;
        tripb = Math.abs(salp1a - salp1) + (calp1a - calp1) < TOL0 || Math.abs(salp1 - salp1b) + (calp1 - calp1b) < TOL0;
      }
      sig12 = lam.sig12;
      s12x = lengths(lam.eps, lam.sig12, lam.ssig1, lam.csig1, dn1, lam.ssig2, lam.csig2, dn2, C1a, C2a).s12b * B;
      const sd = Math.sin(lam.domg12);
      const cd = Math.cos(lam.domg12);
      somg12 = slam12 * cd - clam12 * sd;
      comg12 = clam12 * cd + slam12 * sd;
    }
  }

  const s12 = 0 + s12x;

  // Area term
  let S12: number;
  const salp0 = salp1 * cbet1;
  const calp0 = Math.hypot(calp1, salp1 * sbet1);
  if (calp0 !== 0 && salp0 !== 0) {
    let ssig1 = sbet1;
    let csig1 = calp1 * cbet1;
    let ssig2 = sbet2;
    let csig2 = calp2 * cbet2;
    const k2 = sq(calp0) * ep2;
    const eps = k2 / (2 * (1 + Math.sqrt(1 + k2)) + k2);
    const A4 = sq(WGS84_A) * calp0 * salp0 * e2;
    let n = Math.hypot(ssig1, csig1);
    ssig1 /= n;
    csig1 /= n;
    n = Math.hypot(ssig2, csig2);
    ssig2 /= n;
    csig2 /= n;
    const C4a = new Array<number>(ORDER).fill(0);
    c4f(eps, C4a);
    S12 = A4 * (sinCosSeries(false, ssig2, csig2, C4a) - sinCosSeries(false, ssig1, csig1, C4a));
  } else S12 = 0;

  if (!meridian && somg12 === 2) {
    somg12 = Math.sin(omg12);
    comg12 = Math.cos(omg12);
  }
  let alp12: number;
  if (!meridian && comg12 > -0.7071 && sbet2 - sbet1 < 1.75) {
    const domg12 = 1 + comg12;
    const dbet1 = 1 + cbet1;
    const dbet2 = 1 + cbet2;
    alp12 = 2 * Math.atan2(somg12 * (sbet1 * dbet2 + sbet2 * dbet1), domg12 * (sbet1 * sbet2 + dbet1 * dbet2));
  } else {
    let salp12 = salp2 * calp1 - calp2 * salp1;
    let calp12 = calp2 * calp1 + salp2 * salp1;
    if (salp12 === 0 && calp12 < 0) {
      salp12 = TINY * calp1;
      calp12 = -1;
    }
    alp12 = Math.atan2(salp12, calp12);
  }
  S12 += C2 * alp12;
  S12 *= swapp * lonsign * latsign;
  S12 += 0;
  return { s12, S12 };
}

/** PolygonArea "transit": +1 / -1 when the edge crosses the prime meridian eastward / westward. */
function transit(lon1In: number, lon2In: number): number {
  const lon12 = angDiff(lon1In, lon2In);
  const lon1 = angNormalize(lon1In);
  const lon2 = angNormalize(lon2In);
  return lon12 > 0 && ((lon1 < 0 && lon2 >= 0) || (lon1 > 0 && lon2 === 0))
    ? 1
    : lon12 < 0 && lon1 >= 0 && lon2 < 0
      ? -1
      : 0;
}

/** IEEE remainder x - y * round(x / y). */
function remainder(x: number, y: number): number {
  return x - y * Math.round(x / y);
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

const finite = (p: Vec2): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Geodesic distance in metres between two [lng, lat] points on the WGS84 ellipsoid (0 for non-finite input). */
export function geodesicDistance(a: Vec2, b: Vec2): number {
  if (!finite(a) || !finite(b)) return 0;
  return geodInverse(a[1], a[0], b[1], b[0]).s12;
}

/** Total geodesic length (m) of a polyline of [lng, lat] points; closes the ring when `closed`. */
export function pathLength(points: Vec2[], closed = false): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += geodesicDistance(points[i - 1], points[i]);
  if (closed && points.length > 2) sum += geodesicDistance(points[points.length - 1], points[0]);
  return sum;
}

/**
 * Absolute geodesic area (m²) of a ring of [lng, lat] points on the WGS84 ellipsoid (ring may be open or
 * closed; orientation irrelevant). Edges are geodesics; area is the exact ellipsoidal area (GeographicLib
 * PolygonArea, signed result folded into (-A/2, A/2] then abs). Fewer than 3 distinct vertices give 0.
 */
export function geodesicArea(ring: Vec2[]): number {
  let pts = ring.filter(finite);
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return 0;
  let sum = 0;
  let crossings = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += geodInverse(p[1], p[0], q[1], q[0]).S12;
    crossings += transit(p[0], q[0]);
  }
  let area = remainder(sum, AREA0);
  if (crossings & 1) area += (area < 0 ? 1 : -1) * (AREA0 / 2);
  if (area > AREA0 / 2) area -= AREA0;
  else if (area <= -AREA0 / 2) area += AREA0;
  return Math.abs(area);
}

export interface PlanarMeasure {
  /** Length in metres measured in the drawing CRS plane (closing segment included when closed). */
  length: number;
  /** Shoelace area in m² in the drawing CRS plane (only when closed and ≥ 3 points). */
  area?: number;
  /** Vertices in drawing coordinates (drawing units, e.g. VN-2000 metres). */
  points: Vec2[];
}

/**
 * Length / area as they would be measured in the drawing (e.g. on VN-2000 grid), from WGS84 vertices.
 * Vertices are projected with the inverse of the drawing transform, so X/Y order, unit scale and manual
 * offset match what the user reads in CAD. Length/area are converted to metres via `crs.unitScale`.
 * Returns null if any vertex cannot be projected (or the CRS is invalid).
 */
export function planarMeasure(points: Vec2[], crs: CrsOptions, closed: boolean): PlanarMeasure | null {
  let inv;
  try {
    inv = createInversePointTransformer(crs);
  } catch {
    return null;
  }
  const out: Vec2[] = [];
  for (const p of points) {
    const r = inv(p[0], p[1]);
    if (!r) return null;
    out.push(r);
  }
  const s = crs.unitScale || 1;
  let length = 0;
  for (let i = 1; i < out.length; i++) length += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
  if (closed && out.length > 2) {
    length += Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]);
  }
  length *= s;
  const result: PlanarMeasure = { length, points: out };
  if (closed && out.length >= 3) {
    let twice = 0;
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const q = out[(i + 1) % out.length];
      twice += p[0] * q[1] - q[0] * p[1];
    }
    result.area = (Math.abs(twice) / 2) * s * s;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Formatting (vi-VN: comma decimal, dot thousands; implemented by hand so it never depends on ICU data)
// ---------------------------------------------------------------------------------------------

function fmt(value: number, decimals: number): string {
  const [int, frac] = value.toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return frac ? `${grouped},${frac}` : grouped;
}

/**
 * Length: below 1000 m -> metres with 1 decimal ("125,4 m"); from 1000 m -> kilometres with 2 decimals
 * ("3,27 km"). The switch is decided on the rounded value, so 999,96 m shows "1,00 km", never "1.000,0 m".
 * Non-finite or negative input -> "0 m".
 */
export function formatLength(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '0 m';
  if (Math.round(m * 10) / 10 < 1000) return `${fmt(m, 1)} m`;
  return `${fmt(m / 1000, 2)} km`;
}

/**
 * Area: below 10 000 m² -> "850,2 m²" (1 decimal); from 10 000 m² up to 1 km² -> hectares with 4 decimals
 * ("1,2534 ha", cadastral precision of 1 m²); from 1 km² (100 ha) -> "3,21 km²" (2 decimals). Switches are
 * decided on the rounded value. Non-finite or negative input -> "0 m²".
 */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return '0 m²';
  if (Math.round(m2 * 10) / 10 < 10000) return `${fmt(m2, 1)} m²`;
  const ha = m2 / 10000;
  if (Math.round(ha * 1e4) / 1e4 < 100) return `${fmt(ha, 4)} ha`;
  return `${fmt(m2 / 1e6, 2)} km²`;
}
