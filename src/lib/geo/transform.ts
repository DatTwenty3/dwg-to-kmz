// CadDocument (drawing coordinates) → CadDocument (WGS84 [lng, lat]).
import proj4 from 'proj4';
import type { CadDocument, CadEntity, CrsOptions, Vec2 } from '@/lib/cad/types';
import { WGS84_PROJ4, isGeographic } from './crs';
import { resolveCrsInput } from './epsg';

const DEG = Math.PI / 180;
// WGS84 ellipsoid
const A = 6378137;
const E2 = 0.00669437999014;

/** Metres per degree of longitude / latitude at `lat` (WGS84). */
export function metresPerDegree(lat: number): { lng: number; lat: number } {
  const s = Math.sin(lat * DEG);
  const w = Math.sqrt(1 - E2 * s * s);
  const n = A / w; // prime vertical radius
  const m = (A * (1 - E2)) / (w * w * w); // meridional radius
  return { lng: n * Math.cos(lat * DEG) * DEG, lat: m * DEG };
}

export type PointTransformer = (x: number, y: number) => Vec2 | null;

/**
 * Build a fast drawing → WGS84 point function (one proj4 converter, reused).
 * Pipeline: × unitScale → swap X/Y → + offset (metres) → proj4 inverse → [lng, lat].
 * Returns null for points that cannot be projected (NaN/∞ or out of range).
 */
export function createPointTransformer(crs: CrsOptions): PointTransformer {
  const s = crs.unitScale;
  const swap = crs.swapXY;
  const ox = crs.offset?.[0] ?? 0;
  const oy = crs.offset?.[1] ?? 0;
  // Accept EPSG codes ("9209", "EPSG:9209") and WKT as well as proj4 strings.
  const resolved = resolveCrsInput(crs.proj4);
  if (!resolved.ok) throw new Error(resolved.error);
  const geographic = isGeographic(resolved.proj4);
  const conv = proj4(resolved.proj4, WGS84_PROJ4);
  const buf: [number, number] = [0, 0];

  return (x, y) => {
    let a = x * s;
    let b = y * s;
    if (swap) {
      const t = a;
      a = b;
      b = t;
    }
    if (!geographic) {
      a += ox;
      b += oy;
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    buf[0] = a;
    buf[1] = b;
    let r: number[];
    try {
      r = conv.forward(buf);
    } catch {
      return null;
    }
    let lng = r[0];
    let lat = r[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lng < -540 || lng > 540) return null;
    if (geographic && (ox !== 0 || oy !== 0)) {
      const mpd = metresPerDegree(lat);
      lng += ox / mpd.lng;
      lat += oy / mpd.lat;
    }
    return [lng, lat];
  };
}

/**
 * Direction (degrees CCW from east) on the ground of a drawing direction `rotationDeg` at (x, y).
 * Accounts for meridian convergence, swapXY (mirror) and any projection distortion.
 */
function groundRotation(tf: PointTransformer, x: number, y: number, p0: Vec2, rotationDeg: number, step: number): number {
  const r = rotationDeg * DEG;
  const p1 = tf(x + Math.cos(r) * step, y + Math.sin(r) * step);
  if (!p1) return rotationDeg;
  const mpd = metresPerDegree(p0[1]);
  const dx = (p1[0] - p0[0]) * mpd.lng;
  const dy = (p1[1] - p0[1]) * mpd.lat;
  if (dx === 0 && dy === 0) return rotationDeg;
  const deg = Math.atan2(dy, dx) / DEG;
  return ((deg % 360) + 360) % 360;
}

/** Returns a new document whose coordinates are [lng, lat] WGS84 and crs = WGS84. Input is not mutated. */
export function transformDocument(doc: CadDocument, crs: CrsOptions): CadDocument {
  const tf = createPointTransformer(crs);
  const geographic = isGeographic(crs.proj4);
  const scale = crs.unitScale;
  // Small step (~1 m) in drawing units for rotation/convergence.
  const step = geographic ? 1e-5 : 1 / (scale || 1);

  // Robust output bbox: only vertices inside the input (robust) bbox, inflated by 5 %, count.
  const [[bx0, by0], [bx1, by1]] = doc.bbox;
  const hasBox = [bx0, by0, bx1, by1].every(Number.isFinite) && bx1 > bx0 && by1 > by0;
  const padX = (bx1 - bx0) * 0.05;
  const padY = (by1 - by0) * 0.05;
  const ix0 = bx0 - padX;
  const ix1 = bx1 + padX;
  const iy0 = by0 - padY;
  const iy1 = by1 + padY;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let aMinLng = Infinity;
  let aMinLat = Infinity;
  let aMaxLng = -Infinity;
  let aMaxLat = -Infinity;
  let failed = 0;
  let dropped = 0;

  const tp = (v: Vec2): Vec2 | null => {
    const x = v[0];
    const y = v[1];
    const p = tf(x, y);
    if (!p) {
      failed++;
      return null;
    }
    const lng = p[0];
    const lat = p[1];
    if (lng < aMinLng) aMinLng = lng;
    if (lng > aMaxLng) aMaxLng = lng;
    if (lat < aMinLat) aMinLat = lat;
    if (lat > aMaxLat) aMaxLat = lat;
    if (!hasBox || (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1)) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return p;
  };

  const tpList = (pts: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = tp(pts[i]);
      if (p) out.push(p);
    }
    return out;
  };

  const entities: CadEntity[] = [];
  for (const e of doc.entities) {
    switch (e.kind) {
      case 'polyline': {
        const points = tpList(e.points);
        if (points.length < 2) {
          dropped++;
          break;
        }
        const out = { ...e, points };
        if (e.width !== undefined) out.width = e.width * scale;
        entities.push(out);
        break;
      }
      case 'polygon': {
        const rings: Vec2[][] = [];
        for (const ring of e.rings) {
          const r = tpList(ring);
          if (r.length >= 3) rings.push(r);
        }
        if (rings.length === 0) {
          dropped++;
          break;
        }
        entities.push({ ...e, rings });
        break;
      }
      case 'text': {
        const position = tp(e.position);
        if (!position) {
          dropped++;
          break;
        }
        const rotation = groundRotation(tf, e.position[0], e.position[1], position, e.rotation, step);
        entities.push({ ...e, position, height: e.height * scale, rotation });
        break;
      }
      case 'table': {
        const origin = tp(e.origin);
        if (!origin) {
          dropped++;
          break;
        }
        const rotation = groundRotation(tf, e.origin[0], e.origin[1], origin, e.rotation, step);
        entities.push({
          ...e,
          origin,
          rotation,
          rowHeights: e.rowHeights.map((h) => h * scale),
          colWidths: e.colWidths.map((w) => w * scale),
          cells: e.cells.map((c) => ({ ...c })),
        });
        break;
      }
      case 'point': {
        const position = tp(e.position);
        if (!position) {
          dropped++;
          break;
        }
        entities.push({ ...e, position });
        break;
      }
    }
  }

  if (minLng === Infinity) {
    // No inlier vertex: fall back to every transformed vertex.
    minLng = aMinLng;
    minLat = aMinLat;
    maxLng = aMaxLng;
    maxLat = aMaxLat;
  }
  const bbox: [Vec2, Vec2] =
    minLng === Infinity
      ? [
          [0, 0],
          [0, 0],
        ]
      : [
          [minLng, minLat],
          [maxLng, maxLat],
        ];

  const warnings = doc.warnings.slice();
  if (failed > 0) {
    warnings.push(
      `${failed.toLocaleString('vi-VN')} điểm không chuyển được sang WGS84 với hệ tọa độ đã chọn` +
        (dropped > 0 ? `; bỏ ${dropped.toLocaleString('vi-VN')} đối tượng.` : '.'),
    );
  }

  return {
    ...doc,
    crs: WGS84_PROJ4,
    layers: doc.layers.map((l) => ({ ...l })),
    entities,
    bbox,
    warnings,
  };
}
