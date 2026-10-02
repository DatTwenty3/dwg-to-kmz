// CadDocument (WGS84 [lng, lat]) → CadDocument (drawing coordinates of a chosen CRS). Inverse of transformDocument.
import proj4 from 'proj4';
import type { CadDocument, CadEntity, CrsOptions, Vec2 } from '@/lib/cad/types';
import { WGS84_PROJ4, isGeographic } from './crs';
import { resolveCrsInput } from './epsg';
import { metresPerDegree } from './transform';

const DEG = Math.PI / 180;

export type InversePointTransformer = (lng: number, lat: number) => Vec2 | null;

/**
 * WGS84 → drawing point function. Exact inverse of createPointTransformer:
 * proj4 forward to the target CRS → − offset (metres) → swap X/Y → ÷ unitScale.
 */
export function createInversePointTransformer(crs: CrsOptions): InversePointTransformer {
  const resolved = resolveCrsInput(crs.proj4);
  if (!resolved.ok) throw new Error(resolved.error);
  const geographic = isGeographic(resolved.proj4);
  const conv = proj4(WGS84_PROJ4, resolved.proj4);
  const s = crs.unitScale || 1;
  const ox = crs.offset?.[0] ?? 0;
  const oy = crs.offset?.[1] ?? 0;
  const buf: [number, number] = [0, 0];

  return (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    let l = lng;
    let p = lat;
    if (geographic && (ox !== 0 || oy !== 0)) {
      const mpd = metresPerDegree(lat);
      l -= ox / mpd.lng;
      p -= oy / mpd.lat;
    }
    buf[0] = l;
    buf[1] = p;
    let r: number[];
    try {
      r = conv.forward(buf);
    } catch {
      return null;
    }
    let a = r[0];
    let b = r[1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (!geographic) {
      a -= ox;
      b -= oy;
    }
    if (crs.swapXY) {
      const t = a;
      a = b;
      b = t;
    }
    return [a / s, b / s];
  };
}

/**
 * WGS84 → map-convention coordinates of the drawing's projected CRS, as on Vietnamese maps and in survey
 * records: **X = Northing, Y = Easting**, in metres, true ground position (the drawing's own axis swap, unit
 * scale and fine-tune offset are ignored — those only describe how the CAD file stores coordinates).
 * Returns null for a geographic CRS (lat/lng has no X/Y).
 */
export function createSurveyPointTransformer(crs: CrsOptions): InversePointTransformer | null {
  const resolved = resolveCrsInput(crs.proj4);
  if (!resolved.ok || isGeographic(resolved.proj4)) return null;
  return createInversePointTransformer({ proj4: crs.proj4, swapXY: true, unitScale: 1 });
}

/** Drawing-space direction (degrees CCW from +X) of a ground direction `rotationDeg` (CCW from east) at `ll`. */
function drawingRotation(inv: InversePointTransformer, ll: Vec2, p0: Vec2, rotationDeg: number): number {
  const r = rotationDeg * DEG;
  const mpd = metresPerDegree(ll[1]);
  const p1 = inv(ll[0] + Math.cos(r) / mpd.lng, ll[1] + Math.sin(r) / mpd.lat); // ~1 m step on the ground
  if (!p1) return rotationDeg;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  if (dx === 0 && dy === 0) return rotationDeg;
  const deg = Math.atan2(dy, dx) / DEG;
  return ((deg % 360) + 360) % 360;
}

/** Returns a new document in the drawing coordinates of `crs` (crs = its proj4, units from unitScale). Input is not mutated. */
export function projectDocument(doc: CadDocument, crs: CrsOptions): CadDocument {
  const inv = createInversePointTransformer(crs);
  const resolved = resolveCrsInput(crs.proj4);
  const proj4Def = resolved.ok ? resolved.proj4 : crs.proj4;
  const geographic = isGeographic(proj4Def);
  const s = crs.unitScale || 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let failed = 0;
  let dropped = 0;

  const tp = (v: Vec2): Vec2 | null => {
    const p = inv(v[0], v[1]);
    if (!p) {
      failed++;
      return null;
    }
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    return p;
  };
  const tpList = (pts: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const v of pts) {
      const p = tp(v);
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
        if (e.width !== undefined) out.width = e.width / s;
        entities.push(out);
        break;
      }
      case 'polygon': {
        const rings = e.rings.map(tpList).filter((r) => r.length >= 3);
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
        entities.push({ ...e, position, height: e.height / s, rotation: drawingRotation(inv, e.position, position, e.rotation) });
        break;
      }
      case 'table': {
        const origin = tp(e.origin);
        if (!origin) {
          dropped++;
          break;
        }
        entities.push({
          ...e,
          origin,
          rotation: drawingRotation(inv, e.origin, origin, e.rotation),
          rowHeights: e.rowHeights.map((h) => h / s),
          colWidths: e.colWidths.map((w) => w / s),
          cells: e.cells.map((c) => ({ ...c, textHeight: c.textHeight === undefined ? undefined : c.textHeight / s })),
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

  const warnings = doc.warnings.slice();
  if (failed > 0) {
    warnings.push(
      `${failed.toLocaleString('vi-VN')} điểm không chuyển được sang hệ tọa độ đích` +
        (dropped > 0 ? `; bỏ ${dropped.toLocaleString('vi-VN')} đối tượng.` : '.'),
    );
  }
  const units = geographic ? 'deg' : s === 1 ? 'm' : s === 0.001 ? 'mm' : s === 0.01 ? 'cm' : 'm';
  return {
    ...doc,
    units,
    crs: proj4Def,
    layers: doc.layers.map((l) => ({ ...l })),
    entities,
    bbox:
      minX === Infinity
        ? [
            [0, 0],
            [0, 0],
          ]
        : [
            [minX, minY],
            [maxX, maxY],
          ],
    warnings,
  };
}
