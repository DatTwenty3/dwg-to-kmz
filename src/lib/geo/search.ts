// Parsing what people type into the map search box: lat/lng pairs (Google Maps style) or projected X/Y
// (VN-2000 / UTM, map convention X = Bắc, Y = Đông), written the Vietnamese or the international way.
import proj4 from 'proj4';
import { buildVn2000, WGS84_PROJ4 } from './crs';
import { FORMER_PROVINCES, type LngLatBox } from './provinces';

export type CoordinateQuery =
  | { kind: 'latlng'; lat: number; lng: number }
  /** Projected coordinates in metres: x = Northing (Bắc), y = Easting (Đông). */
  | { kind: 'xy'; x: number; y: number };

/** One number token: "10.0129", "10,0129", "1.107.400", "1.107.400,25", "1107400.25", optional sign / N S E W. */
function parseNumber(token: string): { value: number; hemi: string | null } | null {
  const m = /^([NSEWnsew])?\s*(.*?)\s*[°º]?\s*([NSEWnsew])?$/.exec(token.trim());
  if (!m || !m[2]) return null;
  const hemi = (m[1] ?? m[3] ?? '').toUpperCase() || null;
  const t = m[2];
  let s: string;
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) s = t.replace(/\./g, '').replace(',', '.'); // 1.107.400,25
  else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) && (t.split(',').length > 2 || t.includes('.'))) s = t.replace(/,/g, ''); // 1,107,400.25 / 580,900.5
  else if (/^[+-]?\d+,\d+$/.test(t)) s = t.replace(',', '.'); // 10,0129
  else if (/^[+-]?\d+(\.\d+)?$/.test(t)) s = t;
  else return null;
  let value = Number(s);
  if (!Number.isFinite(value)) return null;
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
  return { value, hemi };
}

/** Splits "a, b" / "a b" / "a; b" / "X: a  Y: b" into number tokens. */
function tokens(q: string): string[] {
  let s = q
    .trim()
    .replace(/\b[XxYy]\s*[:=]\s*/g, ' ') // "X: 1107400 Y: 580900"
    .replace(/(Bắc|Đông|Bac|Dong|N|E)\s*[:=]\s*/g, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/[°º]\s*/g, '°')
    .replace(/(\d°?)\s+([NSEWnsew])(?=[\s,;]|$)/g, '$1$2'); // "10.01° N" → one token
  // "10.0129,105.7402" (no space) → two tokens; "10,5 105,7" keeps decimal commas.
  if (/^[^\s;]+,[^\s;]+$/.test(s) && /\./.test(s)) s = s.replace(',', ' ');
  return s
    .replace(/,\s+/g, ' ')
    .split(/[\s;|]+/)
    .filter(Boolean);
}

const inLat = (v: number) => v >= -90 && v <= 90;
const inLng = (v: number) => v >= -180 && v <= 180;

export function parseCoordinateQuery(query: string): CoordinateQuery | null {
  const tk = tokens(query);
  if (tk.length !== 2) return null;
  const a = parseNumber(tk[0]);
  const b = parseNumber(tk[1]);
  if (!a || !b) return null;

  // Projected X/Y: both large.
  if (Math.abs(a.value) >= 1000 && Math.abs(b.value) >= 1000) {
    // In Vietnam Northings are ~950 000–2 600 000 and Eastings ~100 000–900 000: the larger one is X (Bắc),
    // whichever order it was typed in (CAD habit is E first, maps are N first).
    const [x, y] = a.value >= b.value ? [a.value, b.value] : [b.value, a.value];
    return { kind: 'xy', x, y };
  }

  // Lat/lng: hemisphere letters decide; else latitude first (Google Maps), swapped when obviously lng, lat.
  let lat = a.value;
  let lng = b.value;
  if (a.hemi === 'E' || a.hemi === 'W' || b.hemi === 'N' || b.hemi === 'S') [lat, lng] = [lng, lat];
  else if (!inLat(lat) && inLat(lng)) [lat, lng] = [lng, lat];
  else if (lat >= 100 && lat <= 112 && lng >= 7 && lng <= 25) [lat, lng] = [lng, lat]; // "105.74 10.01" (lng, lat in VN)
  if (!inLat(lat) || !inLng(lng)) return null;
  return { kind: 'latlng', lat, lng };
}

export interface Vn2000Guess {
  lng: number;
  lat: number;
  lon0: number;
  /** Former province whose KTT puts the point inside it. */
  province: string;
}

const inBox = (b: LngLatBox, lng: number, lat: number) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];

/**
 * VN-2000 X (Bắc) / Y (Đông) without a known central meridian: every province's KTT (3° zone) is tried and the
 * ones that land inside that same province are kept — the coordinate "belongs" there. Usually one KTT wins;
 * neighbours sharing a KTT are merged. Empty when no province fits (wrong numbers, or a 6° / UTM coordinate).
 */
export function locateVn2000(x: number, y: number): Vn2000Guess[] {
  const byLon0 = new Map<number, Vn2000Guess>();
  for (const p of FORMER_PROVINCES) {
    let ll: number[];
    try {
      ll = proj4(buildVn2000(p.lon0, 3), WGS84_PROJ4).forward([y, x]);
    } catch {
      continue;
    }
    const [lng, lat] = ll;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inBox(p.bbox, lng, lat)) continue;
    const prev = byLon0.get(p.lon0);
    if (prev) prev.province = `${prev.province}, ${p.name}`;
    else byLon0.set(p.lon0, { lng, lat, lon0: p.lon0, province: p.name });
  }
  return [...byLon0.values()];
}

export interface Vn2000At {
  /** VN-2000, 3° zone, the central meridian of the (former) province containing the point. */
  proj4: string;
  lon0: number;
  province: string;
}

/**
 * The VN-2000 systems a point's X/Y may be read in when no drawing tells us, best first. Uses the 63 former
 * provinces (TT 973): their boxes are tight, unlike the merged 2025 units whose boxes overlap widely, and most
 * existing surveys and drawings still use those KTTs. Boxes are rough rectangles, so near a border several
 * provinces match: ranked by how central the point is in each box, one entry per KTT (names joined).
 */
export function vn2000Candidates(lng: number, lat: number): Vn2000At[] {
  const hits: { p: (typeof FORMER_PROVINCES)[number]; d: number }[] = [];
  for (const p of FORMER_PROVINCES) {
    if (!inBox(p.bbox, lng, lat)) continue;
    const [w, s, e, n] = p.bbox;
    hits.push({ p, d: Math.max(Math.abs(lng - (w + e) / 2) / (e - w), Math.abs(lat - (s + n) / 2) / (n - s)) });
  }
  hits.sort((a, b) => a.d - b.d);
  const byLon0 = new Map<number, Vn2000At>();
  for (const { p } of hits) {
    const prev = byLon0.get(p.lon0);
    if (prev) prev.province = `${prev.province}, ${p.name}`;
    else byLon0.set(p.lon0, { proj4: buildVn2000(p.lon0, 3), lon0: p.lon0, province: p.name });
  }
  return [...byLon0.values()];
}

/** Best guess of `vn2000Candidates`; null outside Vietnam. */
export function vn2000At(lng: number, lat: number): Vn2000At | null {
  return vn2000Candidates(lng, lat)[0] ?? null;
}

/** A VN-2000 projection zone the user can pick for X/Y: a (former) province's KTT in the 3° zone, or a 6° zone. */
export interface Vn2000Zone {
  /** Stable key, stored in preferences: "p:<province>" or "6:<lon0>". */
  key: string;
  lon0: number;
  zone: 3 | 6;
  /** "Trà Vinh · KTT 105°30'" */
  label: string;
  /** Compact form for the search bar: "105°30'" / "6° 105°". */
  short: string;
}

const dm = (deg: number) => {
  const d = Math.floor(deg + 1e-9);
  const m = Math.round((deg - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}'`;
};

/** Every former province (3° zone, its TT 973 KTT), alphabetical, then the 6° zones used in Vietnam. */
export const VN2000_ZONES: Vn2000Zone[] = [
  ...[...FORMER_PROVINCES]
    .filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    .map((p) => ({ key: `p:${p.name}`, lon0: p.lon0, zone: 3 as const, label: `${p.name} · KTT ${dm(p.lon0)}`, short: dm(p.lon0) })),
  ...[105, 111].map((lon0) => ({
    key: `6:${lon0}`,
    lon0,
    zone: 6 as const,
    label: `Múi 6° · KTT ${lon0}°`,
    short: `6° ${lon0}°`,
  })),
];

export function zoneByKey(key: string | null | undefined): Vn2000Zone | null {
  return (key && VN2000_ZONES.find((z) => z.key === key)) || null;
}

/** Zone key of a guessed KTT (first province of the guess). */
export function zoneKeyOf(g: { lon0: number; province: string }): string {
  const first = g.province.split(', ')[0];
  return zoneByKey(`p:${first}`)?.key ?? VN2000_ZONES.find((z) => z.zone === 3 && z.lon0 === g.lon0)?.key ?? '';
}

export function zoneProj4(z: Vn2000Zone): string {
  return buildVn2000(z.lon0, z.zone);
}
