// proj4 definitions for VN-2000 (TM, 3°/6° zones), UTM and WGS84.

/**
 * VN-2000 → WGS84 7-parameter set (TT 973/2001), written for proj4's `+towgs84`
 * (Position Vector convention). This is the string used by the Vietnamese GIS community and it
 * matches independent VN-2000 converters to < 1 mm (see tests). Note: EPSG:6960 publishes the same
 * numbers labelled "Coordinate Frame"; read that way the result differs by ~0.5 m.
 */
export const VN2000_TOWGS84 =
  '-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278';

export const WGS84_PROJ4 = '+proj=longlat +datum=WGS84 +no_defs';
export const UTM48N_PROJ4 = '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs';
export const UTM49N_PROJ4 = '+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs';

/** VN-2000 Transverse Mercator. zone 3 → k=0.9999 (cadastral), zone 6 → k=0.9996. */
export function buildVn2000(lon0: number, zone: 3 | 6): string {
  if (!Number.isFinite(lon0)) throw new Error(`Kinh tuyến trục không hợp lệ: ${lon0}`);
  const k = zone === 6 ? '0.9996' : '0.9999';
  return (
    `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=${k} +x_0=500000 +y_0=0 +ellps=WGS84 ` +
    `+towgs84=${VN2000_TOWGS84} +units=m +no_defs`
  );
}

/** WGS84 UTM north zone (48 → EPSG:32648, 49 → EPSG:32649). */
export function buildUtm(zone: number): string {
  return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
}

/** True if the proj4 definition is geographic (degrees), e.g. WGS84 lon/lat. */
export function isGeographic(def: string): boolean {
  return /\+proj=(longlat|latlong|lonlat|latlon)\b/.test(def) || /^\s*(EPSG:4326|WGS84)\s*$/i.test(def);
}

/** Central meridians tried by auto-detection: every 0.25° from 102° to 108.5° (covers all VN KTTs). */
export const CANDIDATE_LON0: number[] = Array.from({ length: 27 }, (_, i) => 102 + i * 0.25);

/** 105.75 → "105°45'" */
export function formatDegMin(deg: number): string {
  const d = Math.floor(deg + 1e-9);
  const m = Math.round((deg - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}'`;
}

/** Metres per drawing unit for a $INSUNITS-like unit string; undefined if unknown/unitless. */
export function unitScaleFor(units: string | undefined): number | undefined {
  switch ((units ?? '').toLowerCase()) {
    case 'm':
    case 'meter':
    case 'meters':
    case 'metre':
      return 1;
    case 'mm':
      return 0.001;
    case 'cm':
      return 0.01;
    case 'dm':
      return 0.1;
    case 'km':
      return 1000;
    default:
      return undefined;
  }
}
