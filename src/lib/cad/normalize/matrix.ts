// 2D affine matrices: x' = a·x + c·y + e ; y' = b·x + d·y + f  (column-vector convention).
import type { Vec2 } from '../types';

export type Mat2D = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function isIdentity(m: Mat2D): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** m · n (apply n first, then m). */
export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function translate(tx: number, ty: number): Mat2D {
  return [1, 0, 0, 1, tx, ty];
}

export function rotate(rad: number): Mat2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function scale(sx: number, sy: number): Mat2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function apply(m: Mat2D, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Linear part only (directions). */
export function applyLinear(m: Mat2D, v: Vec2): Vec2 {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

export function determinant(m: Mat2D): number {
  return m[0] * m[3] - m[1] * m[2];
}

export function applyAll(m: Mat2D, pts: Vec2[]): Vec2[] {
  if (isIdentity(m)) return pts.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) out[i] = apply(m, pts[i]);
  return out;
}

/**
 * OCS → WCS projected onto the XY plane, using AutoCAD's "arbitrary axis algorithm".
 * Returns identity for a missing / zero / +Z extrusion. (0,0,-1) yields a mirror x → -x.
 */
export function ocsMatrix(n: Vec3 | null | undefined): Mat2D {
  if (!n) return IDENTITY;
  const len = Math.hypot(n.x, n.y, n.z);
  if (!(len > 1e-12)) return IDENTITY;
  const nx = n.x / len;
  const ny = n.y / len;
  const nz = n.z / len;
  if (nx === 0 && ny === 0 && nz > 0) return IDENTITY;
  let ax: Vec3;
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) {
    // Wy × N
    ax = { x: nz, y: 0, z: -nx };
  } else {
    // Wz × N
    ax = { x: -ny, y: nx, z: 0 };
  }
  const al = Math.hypot(ax.x, ax.y, ax.z);
  ax = { x: ax.x / al, y: ax.y / al, z: ax.z / al };
  // Ay = N × Ax
  const ay: Vec3 = {
    x: ny * ax.z - nz * ax.y,
    y: nz * ax.x - nx * ax.z,
    z: nx * ax.y - ny * ax.x,
  };
  return [ax.x, ax.y, ay.x, ay.y, 0, 0];
}
