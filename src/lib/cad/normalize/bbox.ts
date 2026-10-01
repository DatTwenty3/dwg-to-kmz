// Robust bounding box: ignores stray far-away points (bad header extents, paper-space leftovers…).
import type { CadEntity, Vec2 } from '../types';

class NumBuf {
  data = new Float64Array(1024);
  length = 0;
  push(v: number) {
    if (this.length === this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  sorted(): Float64Array {
    return this.data.slice(0, this.length).sort();
  }
}

/** Visit every coordinate of an entity. */
export function forEachPoint(e: CadEntity, fn: (x: number, y: number) => void): void {
  switch (e.kind) {
    case 'polyline':
      for (const p of e.points) fn(p[0], p[1]);
      break;
    case 'polygon':
      for (const r of e.rings) for (const p of r) fn(p[0], p[1]);
      break;
    case 'text':
    case 'point':
      fn(e.position[0], e.position[1]);
      break;
    case 'table':
      fn(e.origin[0], e.origin[1]);
      break;
  }
}

/**
 * Bounding box from the 1st–99th percentile of all coordinates (per axis), widened outward through
 * densely packed values; isolated far-away points (gap > 2 % of the span or beyond half the span)
 * are treated as outliers. Fewer than 1000 coordinates → plain min/max.
 */
export function robustBBox(entities: CadEntity[]): [Vec2, Vec2] {
  const xs = new NumBuf();
  const ys = new NumBuf();
  for (const e of entities) {
    forEachPoint(e, (x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        xs.push(x);
        ys.push(y);
      }
    });
  }
  if (xs.length === 0) return [[0, 0], [0, 0]];
  const sx = xs.sorted();
  const sy = ys.sorted();
  const range = (s: Float64Array): [number, number] => {
    const n = s.length;
    // Small drawings: no statistics, plain extent.
    if (n < 1000) return [s[0], s[n - 1]];
    const i1 = Math.floor((n - 1) * 0.01);
    const i99 = Math.ceil((n - 1) * 0.99);
    const p1 = s[i1];
    const p99 = s[i99];
    const span = p99 - p1;
    if (!(span > 0)) return [p1, p99];
    // Grow outward from the percentile range through densely packed values only: stop at the
    // first gap wider than 2 % of the span, and never go beyond a fence of half the span.
    const maxGap = span * 0.02;
    const fenceLo = p1 - span * 0.5;
    const fenceHi = p99 + span * 0.5;
    let lo = i1;
    while (lo > 0 && s[lo - 1] >= fenceLo && s[lo] - s[lo - 1] <= maxGap) lo--;
    let hi = i99;
    while (hi < n - 1 && s[hi + 1] <= fenceHi && s[hi + 1] - s[hi] <= maxGap) hi++;
    return [s[lo], s[hi]];
  };
  const [x0, x1] = range(sx);
  const [y0, y1] = range(sy);
  return [
    [x0, y0],
    [x1, y1],
  ];
}
