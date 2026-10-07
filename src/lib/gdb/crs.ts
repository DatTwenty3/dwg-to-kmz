// Is the coordinate system of a geodatabase right for where the data actually is? No user input needed:
//   1. the data extent (from the feature-class definitions) is read in the file's own VN-2000 zone;
//   2. like `locateVn2000`, every former province's KTT (TT 973, 3° zone) is tried on the extent centre and the
//      ones that land inside that same province are the KTTs the data can legitimately use;
//   3. the file's KTT must be one of them; the province code of maHoSoQH / maThongTinQH must contain that place.
// A wrong KTT moves the data sideways (~55 km per 30'), so the right KTT is the one that puts the data back
// inside its own province.
import proj4 from 'proj4';
import { buildVn2000, formatDegMin, WGS84_PROJ4 } from '../geo/crs';
import { foldVietnamese, PROVINCES, type Province } from '../geo/provinces';
import { locateVn2000, vn2000Candidates } from '../geo/search';
import type { SrInfo } from './check';
import { PROVINCE_CODES } from './tt16';

export type Extent = [number, number, number, number];

export interface CrsCheck {
  status: 'ok' | 'warn' | 'error';
  /** One-line verdict shown next to the coordinate system. */
  text: string;
  /** Longer explanation (tooltip / report). */
  detail?: string;
  /** Extent centre in WGS84 with the file's own coordinate system (null when it cannot be computed). */
  center: { lng: number; lat: number } | null;
  /** Former province(s) containing the data. */
  place: string | null;
  /** KTTs that fit the location (3° zone). */
  expectedLon0: number[];
}

/** Union of extents, ignoring empty / invalid ones. */
export function unionExtent(list: (Extent | null | undefined)[]): Extent | null {
  let out: Extent | null = null;
  for (const e of list) {
    if (!e || !e.every(Number.isFinite) || e[2] < e[0] || e[3] < e[1]) continue;
    out = out ? [Math.min(out[0], e[0]), Math.min(out[1], e[1]), Math.max(out[2], e[2]), Math.max(out[3], e[3])] : [...e];
  }
  return out;
}

/** Current (2025) province for a 2-digit administrative code. */
export function provinceForCode(code: string): Province | null {
  const name = PROVINCE_CODES[code];
  if (!name) return null;
  const f = foldVietnamese(name);
  return PROVINCES.find((p) => foldVietnamese(p.name).includes(f) || p.aliases.some((a) => foldVietnamese(a) === f)) ?? null;
}

const ktt = (lon0: number) => formatDegMin(lon0);

/**
 * `extent` is in the file's projected coordinates (Easting = X min/max, Northing = Y min/max, as in Esri XML).
 * `provinceCode` = the 2-digit code from maHoSoQH / maThongTinQH when valid.
 */
export function assessCrs(sr: SrInfo | null, extent: Extent | null, provinceCode?: string | null): CrsCheck {
  const none = { center: null, place: null, expectedLon0: [] as number[] };
  if (!sr) return { status: 'warn', text: 'Chưa xác định hệ tọa độ', ...none };
  if (!sr.vn2000) return { status: 'error', text: `"${sr.name}" không phải VN-2000`, ...none };
  if (sr.lon0 === null || !sr.zone) return { status: 'warn', text: 'Không đọc được kinh tuyến trục / múi chiếu', ...none };
  if (!extent) return { status: 'warn', text: 'Chưa có dữ liệu để đối chiếu vị trí', ...none };

  const east = (extent[0] + extent[2]) / 2;
  const north = (extent[1] + extent[3]) / 2;
  let center: { lng: number; lat: number } | null = null;
  try {
    const [lng, lat] = proj4(buildVn2000(sr.lon0, sr.zone), WGS84_PROJ4).forward([east, north]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) center = { lng, lat };
  } catch {
    /* invalid numbers */
  }
  // KTTs whose 3° zone puts the data inside the province using that KTT.
  const fits = sr.zone === 3 ? locateVn2000(north, east) : [];
  const expectedLon0 = fits.map((f) => f.lon0);
  const here = center ? vn2000Candidates(center.lng, center.lat) : [];
  const place = here.length ? here.map((h) => h.province).join(', ') : null;
  const code = provinceCode ? provinceForCode(provinceCode) : null;
  const fold = (n: string) => foldVietnamese(n);
  const inProvince = (names: string, p: Province) => {
    const former = (p.formerUnits ?? []).map((u) => fold(u.name));
    return names.split(', ').some((n) => former.includes(fold(n)));
  };
  const out = (status: CrsCheck['status'], text: string): CrsCheck => ({ status, text, center, place, expectedLon0 });
  const list = (fs: typeof fits) => fs.map((f) => `${ktt(f.lon0)} (${f.province})`).join(' hoặc ');

  if (sr.zone === 6) return out('warn', `Múi 6° — hồ sơ quy hoạch thường dùng múi 3° của tỉnh${place ? ` (${place})` : ''}`);

  // Province known (from the planning codes or chosen by the user): only its former provinces' KTTs count.
  if (code) {
    const own = fits.filter((f) => inProvince(f.province, code));
    if (own.some((f) => f.lon0 === sr.lon0)) return out('ok', `Đúng KTT ${ktt(sr.lon0)} của ${own.find((f) => f.lon0 === sr.lon0)!.province} (${code.name})`);
    if (own.length) return out('error', `KTT ${ktt(sr.lon0)} sai — đồ án thuộc ${code.name}, dữ liệu phải dùng KTT ${list(own)}`);
    return out(
      'error',
      `Dữ liệu không nằm trong ${code.name} (mã tỉnh ${provinceCode})${place ? ` — với KTT ${ktt(sr.lon0)} dữ liệu rơi vào ${place}` : ''}`,
    );
  }

  // Province unknown: the location alone narrows the KTT down, but neighbouring provinces with different KTTs
  // can both "fit" (a wrong KTT shifts the data into the neighbour) — then it cannot be decided automatically.
  if (!place && !fits.length) return out('error', `Với KTT ${ktt(sr.lon0)} dữ liệu nằm ngoài Việt Nam`);
  if (!fits.some((f) => f.lon0 === sr.lon0))
    return out('error', `KTT ${ktt(sr.lon0)} không khớp vị trí dữ liệu${fits.length ? ` — KTT phù hợp: ${list(fits)}` : ''}`);
  const others = fits.filter((f) => f.lon0 !== sr.lon0);
  const mine = fits.find((f) => f.lon0 === sr.lon0)!;
  if (!others.length) return out('ok', `Đúng KTT ${ktt(sr.lon0)} của ${mine.province}`);
  return {
    ...out('warn', `KTT ${ktt(sr.lon0)} khớp ${mine.province}, nhưng KTT khác cũng khớp vị trí — chọn tỉnh của đồ án để kết luận`),
    detail: `Đúng nếu đồ án ở ${mine.province}. Nếu đồ án ở ${others.map((f) => `${f.province} thì phải là ${ktt(f.lon0)}`).join('; ')}.`,
  };
}

/** 2-digit code of a current (2025) province. */
export function codeForProvince(p: Province): string | null {
  const f = foldVietnamese(p.name);
  return Object.entries(PROVINCE_CODES).find(([, name]) => f.includes(foldVietnamese(name)))?.[0] ?? null;
}

export interface ProvinceSuggestion {
  code: string;
  source: 'maHoSoQH' | 'maThongTinQH' | 'location';
}

/**
 * Province to pre-select when asking the user: the planning codes first, else the province containing the data
 * (read with the file's own KTT — only a hint, the user confirms).
 */
export function suggestProvince(gdbs: { province: { code: string; source: string } | null; crs: CrsCheck | null }[]): ProvinceSuggestion | null {
  for (const g of gdbs)
    if (g.province && g.province.source !== 'user') return { code: g.province.code, source: g.province.source as 'maHoSoQH' | 'maThongTinQH' };
  for (const g of gdbs) {
    const first = g.crs?.place?.split(', ')[0];
    if (!first) continue;
    const p = PROVINCES.find((x) => (x.formerUnits ?? []).some((u) => foldVietnamese(u.name) === foldVietnamese(first)));
    const code = p ? codeForProvince(p) : null;
    if (code) return { code, source: 'location' };
  }
  return null;
}
