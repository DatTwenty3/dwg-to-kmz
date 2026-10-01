// Curve → polyline tessellation (pure functions, drawing/local coordinates).
import type { Vec2 } from '../types';

const TWO_PI = Math.PI * 2;
/** Max angular step so that chord error ≈ 0.1 % of the radius: r(1 - cos(α/2)) = 0.001 r. */
const STEP_FOR_CHORD_ERROR = 2 * Math.acos(1 - 0.001);
/** Segments for a full circle are capped to this (CLAUDE.md: max 64). */
const MAX_SEGMENTS_FULL = 64;
const MIN_SEGMENTS_FULL = 8;

/** Number of segments for an arc sweeping `sweep` radians. */
export function arcSegmentCount(sweep: number): number {
  const s = Math.abs(sweep);
  if (!(s > 0)) return 1;
  const byError = Math.ceil(s / STEP_FOR_CHORD_ERROR);
  const cap = Math.max(1, Math.ceil((MAX_SEGMENTS_FULL * s) / TWO_PI));
  const floor = Math.max(1, Math.ceil((MIN_SEGMENTS_FULL * s) / TWO_PI));
  return Math.max(floor, Math.min(byError, cap));
}

/** Normalise an angle into [0, 2π). */
export function normAngle(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** CCW sweep from start to end in (0, 2π]; equal angles mean a full turn. */
export function ccwSweep(start: number, end: number): number {
  let s = normAngle(end) - normAngle(start);
  if (s <= 1e-12) s += TWO_PI;
  return s;
}

/** Points of a circular arc from `start` sweeping `sweep` radians (negative = clockwise). Includes both ends. */
export function arcPoints(center: Vec2, radius: number, start: number, sweep: number): Vec2[] {
  const n = arcSegmentCount(sweep);
  const pts: Vec2[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n;
    pts[i] = [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)];
  }
  return pts;
}

/** Closed ring for a full circle (first point not repeated at the end). */
export function circlePoints(center: Vec2, radius: number): Vec2[] {
  const pts = arcPoints(center, radius, 0, TWO_PI);
  pts.pop();
  return pts;
}

/**
 * Ellipse points. `major` is the major-axis end point relative to `center`; `ratio` = minor/major;
 * parameters in radians; `ccw=false` walks the parameter clockwise (hatch edges).
 */
export function ellipsePoints(
  center: Vec2,
  major: Vec2,
  ratio: number,
  startParam: number,
  endParam: number,
  ccw = true,
): Vec2[] {
  const minor: Vec2 = [-major[1] * ratio, major[0] * ratio];
  const sweep = ccwSweep(startParam, endParam);
  // Clockwise hatch edges store negated parameters (same convention as arc edges).
  const start = ccw ? startParam : -startParam;
  const signed = ccw ? sweep : -sweep;
  const n = arcSegmentCount(signed);
  const pts: Vec2[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const t = start + (signed * i) / n;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts[i] = [center[0] + major[0] * c + minor[0] * s, center[1] + major[1] * c + minor[1] * s];
  }
  return pts;
}

/**
 * Arc between p1 and p2 for a polyline bulge (tan(θ/4), positive = CCW).
 * Returns intermediate points only (excludes p1 and p2).
 */
export function bulgePoints(p1: Vec2, p2: Vec2, bulge: number): Vec2[] {
  if (!bulge || !Number.isFinite(bulge)) return [];
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return [];
  const theta = 4 * Math.atan(bulge); // signed included angle
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
  // Centre: from midpoint, perpendicular distance d = r·cos(θ/2), on the left for CCW.
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  const h = (chord / 2) / Math.tan(theta / 2); // signed: >0 → centre to the left
  const cx = mx - (dy / chord) * h;
  const cy = my + (dx / chord) * h;
  const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const pts = arcPoints([cx, cy], Math.abs(radius), a1, theta);
  return pts.slice(1, pts.length - 1);
}

export interface BulgeVertex {
  x: number;
  y: number;
  bulge?: number;
}

/** Expand a (LW)POLYLINE vertex list with bulges into plain points. Closed: closing segment honours last bulge. */
export function expandBulges(vertices: BulgeVertex[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const p: Vec2 = [v.x, v.y];
    out.push(p);
    const last = i === n - 1;
    if (last && !closed) break;
    const w = vertices[last ? 0 : i + 1];
    if (v.bulge) {
      const mid = bulgePoints(p, [w.x, w.y], v.bulge);
      for (const q of mid) out.push(q);
    }
  }
  return out;
}

// ---- B-spline (De Boor), optionally rational ----

function findSpan(n: number, p: number, u: number, knots: number[]): number {
  // n = number of control points - 1
  if (u >= knots[n + 1]) return n;
  if (u <= knots[p]) return p;
  let low = p;
  let high = n + 1;
  let mid = (low + high) >> 1;
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid;
    else low = mid;
    mid = (low + high) >> 1;
  }
  return mid;
}

function deBoor(p: number, knots: number[], ctrl: [number, number, number][], u: number): Vec2 {
  const n = ctrl.length - 1;
  const k = findSpan(n, p, u, knots);
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const c = ctrl[j + k - p];
    d.push([c[0], c[1], c[2]]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const denom = knots[i + p - r + 1] - knots[i];
      const alpha = denom === 0 ? 0 : (u - knots[i]) / denom;
      d[j][0] = (1 - alpha) * d[j - 1][0] + alpha * d[j][0];
      d[j][1] = (1 - alpha) * d[j - 1][1] + alpha * d[j][1];
      d[j][2] = (1 - alpha) * d[j - 1][2] + alpha * d[j][2];
    }
  }
  const w = d[p][2] || 1;
  return [d[p][0] / w, d[p][1] / w];
}

export interface SplineInput {
  degree: number;
  knots: number[];
  controlPoints: Vec2[];
  weights?: number[];
  fitPoints?: Vec2[];
}

/** Tessellate a spline. Falls back to fit points or the control polygon if the knot vector is unusable. */
export function splinePoints(s: SplineInput): Vec2[] {
  const p = Math.max(1, Math.trunc(s.degree || 3));
  const cps = s.controlPoints;
  const n = cps.length;
  const knots = s.knots;
  if (n >= p + 1 && knots.length === n + p + 1) {
    const ctrl: [number, number, number][] = cps.map((c, i) => {
      const w = s.weights && s.weights.length === n && s.weights[i] > 0 ? s.weights[i] : 1;
      return [c[0] * w, c[1] * w, w];
    });
    const u0 = knots[p];
    const u1 = knots[n];
    if (u1 > u0) {
      const spans = Math.max(1, n - p);
      const samples = Math.min(512, Math.max(8, spans * 8));
      const out: Vec2[] = [];
      for (let i = 0; i <= samples; i++) {
        const u = i === samples ? u1 : u0 + ((u1 - u0) * i) / samples;
        out.push(deBoor(p, knots, ctrl, u));
      }
      return out;
    }
  }
  if (s.fitPoints && s.fitPoints.length >= 2) return s.fitPoints.map((q) => [q[0], q[1]] as Vec2);
  return cps.map((q) => [q[0], q[1]] as Vec2);
}
