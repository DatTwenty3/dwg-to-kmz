// Offline EPSG lookup for the coordinate systems used with Vietnamese drawings, plus a resolver that
// turns user input ("9209", "EPSG:9209", a proj4 string or WKT) into a proj4 definition.
//
// Source: definitions copied verbatim from https://epsg.io/<code>.proj4 (EPSG database 12.029),
// fetched 2026-10-01. The VN-2000 7-parameter +towgs84 is identical to VN2000_TOWGS84 in crs.ts.
// Codes 6956–6959 are EPSG's northing-first variants (false easting/northing swapped), kept as published.
import proj4 from 'proj4';
import { VN2000_TOWGS84 } from './crs';

export interface EpsgEntry {
  code: number;
  name: string;
  proj4: string;
}

const vnTm = (lon0: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=${VN2000_TOWGS84} +units=m +no_defs`;
const vnTmNorthFirst = (lon0: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9999 +x_0=0 +y_0=500000 +ellps=WGS84 +towgs84=${VN2000_TOWGS84} +units=m +no_defs`;

const TM3_LOCAL: [number, string, number][] = [
  [9205, '103-00', 103],
  [9206, '104-00', 104],
  [9207, '104-30', 104.5],
  [9208, '104-45', 104.75],
  [9209, '105-30', 105.5],
  [9210, '105-45', 105.75],
  [9211, '106-00', 106],
  [9212, '106-15', 106.25],
  [9213, '106-30', 106.5],
  [9214, '107-00', 107],
  [9215, '107-15', 107.25],
  [9216, '107-30', 107.5],
  [9217, '108-15', 108.25],
  [9218, '108-30', 108.5],
];

export const EPSG_TABLE: EpsgEntry[] = [
  { code: 4326, name: 'WGS 84 (kinh độ, vĩ độ)', proj4: '+proj=longlat +datum=WGS84 +no_defs' },
  { code: 4756, name: 'VN-2000 (kinh độ, vĩ độ)', proj4: `+proj=longlat +ellps=WGS84 +towgs84=${VN2000_TOWGS84} +no_defs` },
  { code: 3405, name: 'VN-2000 / UTM zone 48N', proj4: `+proj=utm +zone=48 +ellps=WGS84 +towgs84=${VN2000_TOWGS84} +units=m +no_defs` },
  { code: 3406, name: 'VN-2000 / UTM zone 49N', proj4: `+proj=utm +zone=49 +ellps=WGS84 +towgs84=${VN2000_TOWGS84} +units=m +no_defs` },
  { code: 32648, name: 'WGS 84 / UTM zone 48N', proj4: '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs' },
  { code: 32649, name: 'WGS 84 / UTM zone 49N', proj4: '+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs' },
  { code: 5896, name: 'VN-2000 / TM-3 zone 481 (KTT 102°)', proj4: vnTm(102) },
  { code: 5897, name: 'VN-2000 / TM-3 zone 482 (KTT 105°)', proj4: vnTm(105) },
  { code: 5898, name: 'VN-2000 / TM-3 zone 491 (KTT 108°)', proj4: vnTm(108) },
  { code: 5899, name: 'VN-2000 / TM-3 107-45', proj4: vnTm(107.75) },
  { code: 6956, name: 'VN-2000 / TM-3 zone 481 (Bắc trước, KTT 102°)', proj4: vnTmNorthFirst(102) },
  { code: 6957, name: 'VN-2000 / TM-3 zone 482 (Bắc trước, KTT 105°)', proj4: vnTmNorthFirst(105) },
  { code: 6958, name: 'VN-2000 / TM-3 zone 491 (Bắc trước, KTT 108°)', proj4: vnTmNorthFirst(108) },
  { code: 6959, name: 'VN-2000 / TM-3 Da Nang zone (Bắc trước, KTT 107°45\')', proj4: vnTmNorthFirst(107.75) },
  ...TM3_LOCAL.map(([code, label, lon0]) => ({ code, name: `VN-2000 / TM-3 ${label}`, proj4: vnTm(lon0) })),
];

const BY_CODE = new Map(EPSG_TABLE.map((e) => [e.code, e]));

export function getEpsg(code: number): EpsgEntry | undefined {
  return BY_CODE.get(code);
}

export type CrsInputResult =
  | { ok: true; proj4: string; label: string; epsg?: number }
  | { ok: false; error: string };

const EPSG_RE = /^\s*(?:epsg\s*[:\s]\s*)?(\d{4,5})\s*$/i;

/**
 * Accepts "9209", "EPSG:9209", "epsg 9209", a proj4 string ("+proj=…") or WKT (PROJCS/GEOGCS/PROJCRS…).
 * Always validates by building a proj4 converter so errors surface here, in Vietnamese, not in the worker.
 */
export function resolveCrsInput(input: string): CrsInputResult {
  const s = input.trim();
  if (!s) return { ok: false, error: 'Chưa nhập hệ tọa độ.' };

  const m = EPSG_RE.exec(s);
  if (m) {
    const code = Number(m[1]);
    const e = BY_CODE.get(code);
    if (!e) {
      return {
        ok: false,
        error: `Chưa hỗ trợ sẵn EPSG:${code}. Hãy dán chuỗi proj4 của mã này (lấy tại epsg.io/${code}.proj4) vào ô này.`,
      };
    }
    return { ok: true, proj4: e.proj4, label: `EPSG:${code} — ${e.name}`, epsg: code };
  }

  const isProj4 = s.startsWith('+');
  const isWkt = /^(PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS)\s*\[/i.test(s);
  if (!isProj4 && !isWkt) {
    return { ok: false, error: 'Không nhận ra hệ tọa độ. Nhập mã EPSG (vd. 9209), chuỗi proj4 (+proj=…) hoặc WKT.' };
  }
  try {
    proj4(s, 'WGS84');
  } catch (err) {
    return { ok: false, error: `Định nghĩa hệ tọa độ không hợp lệ: ${err instanceof Error ? err.message : String(err)}` };
  }
  const proj4Str = isProj4 ? s.replace(/\s+\+type=crs\b/, '') : s;
  const known = EPSG_TABLE.find((e) => e.proj4 === proj4Str);
  return { ok: true, proj4: proj4Str, label: known ? `EPSG:${known.code} — ${known.name}` : isWkt ? 'WKT tùy chỉnh' : 'proj4 tùy chỉnh', epsg: known?.code };
}

/** EPSG code for a proj4 definition built by this app (e.g. buildVn2000(105.5, 3) → 9209). */
export function epsgForProj4(def: string): number | undefined {
  return EPSG_TABLE.find((e) => e.proj4 === def.trim())?.code;
}
