// Manual CRS form state <-> CrsOptions.
import type { CrsOptions } from '@/lib/cad/types';
import { buildUtm, buildVn2000, epsgForProj4, getEpsg, resolveCrsInput, WGS84_PROJ4 } from '@/lib/geo';

export type CrsMode = 'vn2000' | 'utm' | 'wgs84' | 'epsg' | 'proj4';

export interface CrsForm {
  mode: CrsMode;
  lon0: number;
  zone: 3 | 6;
  utmZone: number;
  /** EPSG code chosen in 'epsg' mode (see EPSG_TABLE). */
  epsg: number;
  proj4: string;
  swapXY: boolean;
  unitScale: number;
  offsetE: number;
  offsetN: number;
}

export const DEFAULT_FORM: CrsForm = {
  mode: 'vn2000',
  lon0: 105,
  zone: 3,
  utmZone: 48,
  epsg: 9209,
  proj4: '',
  swapXY: false,
  unitScale: 1,
  offsetE: 0,
  offsetN: 0,
};

export function formFromCrs(crs: CrsOptions): CrsForm {
  const f: CrsForm = {
    ...DEFAULT_FORM,
    proj4: crs.proj4,
    swapXY: crs.swapXY,
    unitScale: crs.unitScale,
    offsetE: crs.offset?.[0] ?? 0,
    offsetN: crs.offset?.[1] ?? 0,
  };
  const p = crs.proj4;
  const utm = /\+proj=utm\b.*?\+zone=(\d+)/.exec(p);
  if (/\+proj=(longlat|latlong)\b/.test(p)) f.mode = 'wgs84';
  else if (utm) {
    f.mode = 'utm';
    f.utmZone = Number(utm[1]);
  } else if (/\+proj=tmerc\b/.test(p) && /\+x_0=500000\b/.test(p) && p.includes('+towgs84=-191.9')) {
    f.mode = 'vn2000';
    f.lon0 = Number(/\+lon_0=([-\d.]+)/.exec(p)?.[1] ?? 105);
    f.zone = /\+k=0\.9996\b/.test(p) ? 6 : 3;
  } else if (epsgForProj4(p)) {
    f.mode = 'epsg';
    f.epsg = epsgForProj4(p)!;
  } else f.mode = 'proj4';
  return f;
}

export function crsFromForm(f: CrsForm): CrsOptions {
  let proj4: string;
  switch (f.mode) {
    case 'vn2000':
      proj4 = buildVn2000(f.lon0, f.zone);
      break;
    case 'utm':
      proj4 = buildUtm(f.utmZone);
      break;
    case 'wgs84':
      proj4 = WGS84_PROJ4;
      break;
    case 'epsg':
      proj4 = getEpsg(f.epsg)?.proj4 ?? '';
      break;
    default: {
      // Accepts EPSG codes ("9209", "EPSG:9209"), proj4 strings and WKT; invalid input → '' (Apply disabled).
      const r = resolveCrsInput(f.proj4);
      proj4 = r.ok ? r.proj4 : '';
    }
  }
  const offset: [number, number] | undefined =
    f.offsetE || f.offsetN ? [Number(f.offsetE) || 0, Number(f.offsetN) || 0] : undefined;
  return { proj4, swapXY: f.swapXY, unitScale: f.mode === 'wgs84' ? 1 : f.unitScale, offset };
}

/** Same projection/axes/units (ignoring the fine offset). */
export function sameBaseCrs(a: CrsOptions | null, b: CrsOptions | null): boolean {
  return !!a && !!b && a.proj4 === b.proj4 && a.swapXY === b.swapXY && a.unitScale === b.unitScale;
}
