// Location sanity checks and CRS auto-detection.
import type { CadDocument, CrsOptions, Vec2 } from '@/lib/cad/types';
import {
  CANDIDATE_LON0,
  UTM48N_PROJ4,
  UTM49N_PROJ4,
  WGS84_PROJ4,
  buildVn2000,
  formatDegMin,
  unitScaleFor,
} from './crs';
import { FORMER_PROVINCES, boxContains, getProvince, type LngLatBox, type Province } from './provinces';
import { createPointTransformer } from './transform';

/** Vietnam envelope incl. Hoàng Sa / Trường Sa: [minLng, minLat, maxLng, maxLat]. */
export const VN_ENVELOPE: LngLatBox = [102, 6, 117.5, 23.5];
/** Mainland + near-shore islands only. */
export const VN_MAINLAND: LngLatBox = [102.1, 8.3, 109.5, 23.4];

export interface CrsCandidate {
  label: string;
  crs: CrsOptions;
  /** WGS84 centre of the drawing under this candidate. */
  center: Vec2;
  /** Higher is better; candidates are returned sorted descending. */
  score: number;
  /** Why it was scored this way (Vietnamese). */
  reason: string;
}

export function isInVietnam(lng: number, lat: number): boolean {
  return boxContains(VN_ENVELOPE, lng, lat);
}

export interface LocationCheck {
  ok: boolean;
  /** Vietnamese message for the "Kiểm tra vị trí" button. */
  message: string;
}

/** Check a transformed (WGS84) document: its bbox must lie inside Vietnam. */
export function checkLocation(doc: CadDocument, provinceId?: string): LocationCheck {
  const [[x0, y0], [x1, y1]] = doc.bbox;
  if (![x0, y0, x1, y1].every(Number.isFinite) || (x0 === 0 && y0 === 0 && x1 === 0 && y1 === 0)) {
    return { ok: false, message: 'Không xác định được phạm vi bản vẽ sau khi chuyển tọa độ.' };
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const allIn = isInVietnam(x0, y0) && isInVietnam(x1, y1);
  if (!allIn) {
    return {
      ok: false,
      message:
        `Bản vẽ nằm ngoài Việt Nam (tâm ≈ ${cy.toFixed(4)}°N, ${cx.toFixed(4)}°E). ` +
        'Có thể sai hệ tọa độ: thử đổi X/Y, đổi đơn vị (mm/m) hoặc kinh tuyến trục khác.',
    };
  }
  const p = provinceId ? getProvince(provinceId) : undefined;
  if (p && !boxContains(p.bbox, cx, cy)) {
    return {
      ok: false,
      message: `Bản vẽ nằm trong Việt Nam nhưng ngoài phạm vi ${p.name} — kiểm tra lại kinh tuyến trục.`,
    };
  }
  return { ok: true, message: `Vị trí hợp lý (tâm ≈ ${cy.toFixed(4)}°N, ${cx.toFixed(4)}°E).` };
}

// ---- Auto-detection ------------------------------------------------------------------------

/** Representative drawing-space centre: robust bbox centre, else median of a vertex sample. */
export function drawingCenter(doc: CadDocument): Vec2 | null {
  const [[x0, y0], [x1, y1]] = doc.bbox;
  if ([x0, y0, x1, y1].every(Number.isFinite) && (x1 > x0 || y1 > y0)) return [(x0 + x1) / 2, (y0 + y1) / 2];
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (v: Vec2) => {
    if (Number.isFinite(v[0]) && Number.isFinite(v[1])) {
      xs.push(v[0]);
      ys.push(v[1]);
    }
  };
  const stride = Math.max(1, Math.floor(doc.entities.length / 5000));
  for (let i = 0; i < doc.entities.length; i += stride) {
    const e = doc.entities[i];
    if (e.kind === 'polyline') e.points.forEach(push);
    else if (e.kind === 'polygon') e.rings.forEach((r) => r.forEach(push));
    else if (e.kind === 'table') push(e.origin);
    else push(e.position);
  }
  if (xs.length === 0) return null;
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(xs), med(ys)];
}

interface RawCandidate {
  label: string;
  crs: CrsOptions;
  kind: 'vn3' | 'vn6' | 'utm' | 'wgs84';
  lon0?: number;
}

function unitLabel(scale: number): string {
  if (scale === 1) return 'm';
  if (scale === 0.001) return 'mm';
  if (scale === 0.01) return 'cm';
  return `×${scale}`;
}

function sameLon(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** Try central meridians / zones / swapXY / units and rank them. */
export function suggestCrs(doc: CadDocument, provinceId?: string): CrsCandidate[] {
  const c = drawingCenter(doc);
  if (!c) return [];
  const province: Province | undefined = provinceId ? getProvince(provinceId) : undefined;

  const declared = unitScaleFor(doc.units);
  const scales = [...new Set([declared ?? 1, 1, 0.001])];
  const lon0s = [...new Set([...(province?.lon0Candidates ?? []), ...CANDIDATE_LON0])];

  const raws: RawCandidate[] = [];
  for (const unitScale of scales) {
    for (const swapXY of [false, true]) {
      const suffix = (swapXY ? ' · đổi X/Y' : '') + (unitScale !== 1 ? ` · đơn vị ${unitLabel(unitScale)}` : '');
      // Projected coordinates must look like TM eastings/northings, else skip early.
      const e = (swapXY ? c[1] : c[0]) * unitScale;
      const n = (swapXY ? c[0] : c[1]) * unitScale;
      const plausibleTM = e > 0 && e < 1_000_000 && n > 0 && n < 3_000_000;
      if (plausibleTM) {
        for (const lon0 of lon0s) {
          for (const zone of [3, 6] as const) {
            raws.push({
              label: `VN-2000 KTT ${formatDegMin(lon0)} múi ${zone}°${suffix}`,
              crs: { proj4: buildVn2000(lon0, zone), swapXY, unitScale },
              kind: zone === 3 ? 'vn3' : 'vn6',
              lon0,
            });
          }
        }
        raws.push({ label: `UTM 48N (WGS84)${suffix}`, crs: { proj4: UTM48N_PROJ4, swapXY, unitScale }, kind: 'utm' });
        raws.push({ label: `UTM 49N (WGS84)${suffix}`, crs: { proj4: UTM49N_PROJ4, swapXY, unitScale }, kind: 'utm' });
      }
    }
  }
  // Coordinates already in degrees?
  for (const swapXY of [false, true]) {
    const lng = swapXY ? c[1] : c[0];
    const lat = swapXY ? c[0] : c[1];
    if (Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      raws.push({
        label: `WGS84 (kinh độ/vĩ độ)${swapXY ? ' · đổi X/Y' : ''}`,
        crs: { proj4: WGS84_PROJ4, swapXY, unitScale: 1 },
        kind: 'wgs84',
      });
    }
  }

  const out: CrsCandidate[] = [];
  for (const raw of raws) {
    const center = createPointTransformer(raw.crs)(c[0], c[1]);
    if (!center) continue;
    const [lng, lat] = center;
    let score = 0;
    const why: string[] = [];

    if (isInVietnam(lng, lat)) {
      score += 50;
      if (boxContains(VN_MAINLAND, lng, lat)) score += 5;
      why.push('nằm trong Việt Nam');
    } else {
      // Penalise by distance (degrees) to the envelope.
      const dx = Math.max(VN_ENVELOPE[0] - lng, 0, lng - VN_ENVELOPE[2]);
      const dy = Math.max(VN_ENVELOPE[1] - lat, 0, lat - VN_ENVELOPE[3]);
      score -= Math.min(100, Math.hypot(dx, dy) * 5);
      why.push('nằm ngoài Việt Nam');
    }

    const isVn = raw.kind === 'vn3' || raw.kind === 'vn6';
    if (province) {
      const inProv = boxContains(province.bbox, lng, lat);
      if (inProv) {
        score += 30;
        why.push(`nằm trong ${province.name}`);
      } else {
        why.push(`ngoài ${province.name}`);
      }
      if (isVn && raw.lon0 !== undefined) {
        const lon0 = raw.lon0;
        const match = (province.formerUnits ?? []).find((f) => sameLon(f.lon0, lon0) && boxContains(f.bbox, lng, lat));
        const official = (province.lon0Candidates ?? [province.lon0]).some((l) => sameLon(l, lon0));
        if (match) {
          score += 20;
          why.push(`đúng KTT ${formatDegMin(lon0)} của ${match.name} và rơi vào ${match.name}`);
        } else if (official && inProv) {
          score += 12;
          why.push(`KTT chính thức ${formatDegMin(lon0)}`);
        } else if (official) {
          why.push(`KTT chính thức ${formatDegMin(lon0)} nhưng vị trí lệch ra ngoài tỉnh`);
        }
      }
    } else {
      const containing = FORMER_PROVINCES.filter((f) => boxContains(f.bbox, lng, lat));
      if (containing.length > 0) {
        score += 10;
        if (isVn && raw.lon0 !== undefined) {
          const lon0 = raw.lon0;
          const match = containing.find((f) => sameLon(f.lon0, lon0));
          if (match) {
            score += 20;
            why.push(`đúng KTT của ${match.name} (nơi bản vẽ rơi vào)`);
          } else {
            why.push(`rơi vào ${containing.map((f) => f.name).join('/')}`);
          }
        } else {
          why.push(`rơi vào ${containing.map((f) => f.name).join('/')}`);
        }
      }
    }

    // Conventions: cadastral VN-2000 3° first, then 6°, then UTM; degrees are unambiguous.
    if (raw.kind === 'vn3') score += 4;
    else if (raw.kind === 'vn6') score += 2;
    else if (raw.kind === 'utm') score += 1;
    else if (raw.kind === 'wgs84') score += 25;
    if (declared !== undefined && raw.crs.unitScale === declared) score += 2;
    if (!raw.crs.swapXY) score += 1;

    out.push({ label: raw.label, crs: raw.crs, center, score, reason: capitalise(why.join(', ')) + '.' });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 40);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
