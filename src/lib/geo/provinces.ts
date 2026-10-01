// VN-2000 central meridians (kinh tuyến trục, KTT) per province.
//
// Sources:
// - Thông tư 973/2001/TT-TCĐC (20/06/2001, Tổng cục Địa chính), Phụ lục – Bảng 4 "Kinh tuyến trục
//   cho từng tỉnh, thành phố trực thuộc Trung ương" (61 units at the time), e.g.
//   https://caselaw.vn/van-ban-phap-luat/272487-thong-tu-so-973-2001-tt-tcdc-ngay-20-06-2001-huong-dan-ap-dung-he-quy-chieu-va-he-toa-do-quoc-gia-vn-2000
//   Provinces created later (Điện Biên, Đắk Nông, Hậu Giang – 2004) take the KTT of the province
//   they were split from (Lai Châu 103°00', Đắk Lắk 108°30', Cần Thơ 105°00'), as listed in later
//   tables (Thông tư 25/2014/TT-BTNMT, Phụ lục 02).
// - After the 2025 merger (63 → 34 units, effective 01/07/2025): Thông tư 24/2025/TT-BNNMT, Phụ lục
//   (replaces Phụ lục B of QCVN 80:2024/BTNMT) – KTT of the provincial administrative map, see
//   https://tracdiahoangphat.com/kinh-tuyen-truc-cac-tinh/ and
//   https://thuvienphapluat.vn/chinh-sach-phap-luat-moi/vn/ho-tro-phap-luat/chinh-sach-moi/88124/bang-kinh-tuyen-truc-cua-ban-do-hanh-chinh-cap-tinh-cua-34-tinh-thanh-moi-theo-thong-tu-24-2025
//
// IMPORTANT: existing drawings (cadastral, planning) were made with the KTT of the *former*
// province (TT 973). For a merged unit the official KTT is therefore ambiguous: `lon0` is the
// TT 24/2025 value, `lon0Candidates` lists it plus every former province's TT 973 KTT.
//
// Bounding boxes: rough, hand-made from the provinces' published extreme coordinates (Wikipedia
// "Tọa độ địa lý" / GADM outlines), padded by ~0.02–0.05°. Mainland + near-shore islands only
// (Hoàng Sa / Trường Sa are NOT included in Đà Nẵng / Khánh Hòa bboxes). They overlap a bit and
// are only good for "is this roughly the right province" checks. Merged units = union of their
// former provinces.

/** [minLng, minLat, maxLng, maxLat] */
export type LngLatBox = [number, number, number, number];

export interface FormerProvince {
  /** Name before the 2025 merger. */
  name: string;
  /** KTT per TT 973/2001 (decimal degrees). */
  lon0: number;
  bbox: LngLatBox;
}

export interface Province {
  id: string;
  /** Current name, Vietnamese with diacritics. */
  name: string;
  /** Former names (before mergers) for search. */
  aliases: string[];
  /** Official VN-2000 central meridian, decimal degrees (TT 24/2025 for current units). */
  lon0: number;
  /** Rough bounding box [minLng, minLat, maxLng, maxLat] used for sanity checks. */
  bbox: [number, number, number, number];
  /** Former provinces merged into this unit (itself included), with their TT 973 KTT and bbox. */
  formerUnits?: FormerProvince[];
  /** All plausible official KTTs: `lon0` first, then former provinces' KTTs (deduplicated). */
  lon0Candidates?: number[];
}

// ---- Former provinces (63 units + Hà Tây) --------------------------------------------------

const F = (name: string, lon0: number, bbox: LngLatBox): FormerProvince => ({ name, lon0, bbox });

const HA_NOI = F('Hà Nội', 105, [105.28, 20.53, 106.03, 21.40]);
const HA_TAY = F('Hà Tây', 105, [105.28, 20.53, 106.0, 21.25]);
const HA_GIANG = F('Hà Giang', 105.5, [104.3, 22.1, 105.6, 23.4]);
const CAO_BANG = F('Cao Bằng', 105.75, [105.25, 22.3, 106.85, 23.15]);
const BAC_KAN = F('Bắc Kạn', 106.5, [105.4, 21.8, 106.3, 22.75]);
const TUYEN_QUANG = F('Tuyên Quang', 106, [104.85, 21.45, 105.7, 22.7]);
const LAO_CAI = F('Lào Cai', 104.75, [103.5, 21.85, 104.65, 22.87]);
const DIEN_BIEN = F('Điện Biên', 103, [102.1, 20.85, 103.65, 22.57]);
const LAI_CHAU = F('Lai Châu', 103, [102.3, 21.65, 104.0, 22.85]);
const SON_LA = F('Sơn La', 104, [103.2, 20.55, 105.05, 22.05]);
const YEN_BAI = F('Yên Bái', 104.75, [103.9, 21.3, 105.1, 22.3]);
const HOA_BINH = F('Hòa Bình', 106, [104.8, 20.3, 105.9, 21.15]);
const THAI_NGUYEN = F('Thái Nguyên', 106.5, [105.45, 21.3, 106.25, 22.05]);
const LANG_SON = F('Lạng Sơn', 107.25, [106.1, 21.3, 107.4, 22.5]);
const QUANG_NINH = F('Quảng Ninh', 107.75, [106.4, 20.7, 108.1, 21.7]);
const BAC_GIANG = F('Bắc Giang', 107, [105.85, 21.1, 107.05, 21.65]);
const PHU_THO = F('Phú Thọ', 104.75, [104.8, 20.9, 105.45, 21.75]);
const VINH_PHUC = F('Vĩnh Phúc', 105, [105.3, 21.05, 105.8, 21.6]);
const BAC_NINH = F('Bắc Ninh', 105.5, [105.9, 20.95, 106.32, 21.28]);
const HAI_DUONG = F('Hải Dương', 105.5, [106.0, 20.65, 106.62, 21.25]);
const HAI_PHONG = F('Hải Phòng', 105.75, [106.35, 20.1, 107.8, 21.05]);
const HUNG_YEN = F('Hưng Yên', 105.5, [105.88, 20.6, 106.28, 21.03]);
const THAI_BINH = F('Thái Bình', 105.5, [106.0, 20.25, 106.65, 20.75]);
const HA_NAM = F('Hà Nam', 105, [105.75, 20.33, 106.18, 20.7]);
const NAM_DINH = F('Nam Định', 105.5, [105.9, 19.88, 106.55, 20.55]);
const NINH_BINH = F('Ninh Bình', 105, [105.52, 19.93, 106.17, 20.47]);
const THANH_HOA = F('Thanh Hóa', 105, [104.35, 19.27, 106.1, 20.7]);
const NGHE_AN = F('Nghệ An', 104.75, [103.85, 18.55, 105.85, 20.0]);
const HA_TINH = F('Hà Tĩnh', 105.5, [105.1, 17.88, 106.52, 18.8]);
const QUANG_BINH = F('Quảng Bình', 106, [105.6, 16.9, 107.0, 18.1]);
const QUANG_TRI = F('Quảng Trị', 106.25, [106.5, 16.3, 107.4, 17.2]);
const HUE = F('Thừa Thiên Huế', 107, [107.0, 15.98, 108.22, 16.78]);
const DA_NANG = F('Đà Nẵng', 107.75, [107.8, 15.9, 108.35, 16.22]);
const QUANG_NAM = F('Quảng Nam', 107.75, [107.2, 14.95, 108.75, 16.08]);
const QUANG_NGAI = F('Quảng Ngãi', 108, [108.1, 14.52, 109.2, 15.42]);
const KON_TUM = F('Kon Tum', 107.5, [107.33, 13.9, 108.55, 15.42]);
const GIA_LAI = F('Gia Lai', 108.5, [107.45, 12.97, 108.9, 14.62]);
const BINH_DINH = F('Bình Định', 108.25, [108.58, 13.47, 109.38, 14.72]);
const PHU_YEN = F('Phú Yên', 108.5, [108.67, 12.7, 109.47, 13.7]);
const DAK_LAK = F('Đắk Lắk', 108.5, [107.48, 12.15, 108.98, 13.42]);
const DAK_NONG = F('Đắk Nông', 108.5, [107.2, 11.75, 108.12, 12.82]);
const KHANH_HOA = F('Khánh Hòa', 108.25, [108.67, 11.8, 109.47, 12.87]);
const NINH_THUAN = F('Ninh Thuận', 108.25, [108.55, 11.3, 109.25, 12.17]);
const LAM_DONG = F('Lâm Đồng', 107.75, [107.25, 11.2, 108.75, 12.38]);
const BINH_THUAN = F('Bình Thuận', 108.5, [107.38, 10.45, 108.98, 11.58]);
const BINH_PHUOC = F('Bình Phước', 106.25, [106.4, 11.3, 107.47, 12.3]);
const TAY_NINH = F('Tây Ninh', 105.5, [105.8, 10.95, 106.47, 11.78]);
const BINH_DUONG = F('Bình Dương', 105.75, [106.33, 10.85, 106.97, 11.5]);
const DONG_NAI = F('Đồng Nai', 107.75, [106.75, 10.52, 107.58, 11.58]);
const BR_VT = F('Bà Rịa - Vũng Tàu', 107.75, [106.5, 8.5, 107.62, 10.8]);
const HCM = F('TP. Hồ Chí Minh', 105.75, [106.35, 10.35, 107.03, 11.17]);
const LONG_AN = F('Long An', 105.75, [105.5, 10.38, 106.8, 11.05]);
const TIEN_GIANG = F('Tiền Giang', 105.75, [105.82, 10.2, 106.82, 10.6]);
const BEN_TRE = F('Bến Tre', 105.75, [105.95, 9.8, 106.83, 10.35]);
const TRA_VINH = F('Trà Vinh', 105.5, [105.95, 9.52, 106.62, 10.08]);
const VINH_LONG = F('Vĩnh Long', 105.5, [105.68, 9.88, 106.3, 10.33]);
const DONG_THAP = F('Đồng Tháp', 105, [105.18, 10.05, 105.95, 10.98]);
const AN_GIANG = F('An Giang', 104.75, [104.77, 10.18, 105.58, 10.98]);
const KIEN_GIANG = F('Kiên Giang', 104.5, [103.4, 9.2, 105.55, 10.55]);
const CAN_THO = F('Cần Thơ', 105, [105.22, 9.92, 105.85, 10.33]);
const HAU_GIANG = F('Hậu Giang', 105, [105.3, 9.6, 105.9, 10.03]);
const SOC_TRANG = F('Sóc Trăng', 105.5, [105.55, 9.2, 106.3, 9.95]);
const BAC_LIEU = F('Bạc Liêu', 105, [105.2, 9.0, 105.88, 9.65]);
const CA_MAU = F('Cà Mau', 104.5, [104.67, 8.38, 105.42, 9.57]);

// ---- Current units (34, from 01/07/2025) -----------------------------------------------------

function unionBox(boxes: LngLatBox[]): LngLatBox {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

function P(id: string, name: string, lon0: number, formerUnits: FormerProvince[], extraAliases: string[] = []): Province {
  const aliases = [...new Set([...formerUnits.map((f) => f.name).filter((n) => n !== name), ...extraAliases])];
  const lon0Candidates = [...new Set([lon0, ...formerUnits.map((f) => f.lon0)])];
  return { id, name, aliases, lon0, bbox: unionBox(formerUnits.map((f) => f.bbox)), formerUnits, lon0Candidates };
}

export const PROVINCES: Province[] = [
  // Unchanged units
  P('ha-noi', 'TP. Hà Nội', 105, [HA_NOI, HA_TAY], ['Hà Nội', 'Hanoi']),
  P('hue', 'TP. Huế', 107, [HUE], ['Thừa Thiên Huế', 'Huế']),
  // TT 24/2025 gives 104°45' for Lai Châu; TT 973 gave 103°00' (kept as candidate).
  P('lai-chau', 'Lai Châu', 104.75, [LAI_CHAU]),
  P('dien-bien', 'Điện Biên', 103, [DIEN_BIEN]),
  P('son-la', 'Sơn La', 104, [SON_LA]),
  P('lang-son', 'Lạng Sơn', 107.25, [LANG_SON]),
  P('quang-ninh', 'Quảng Ninh', 107.75, [QUANG_NINH]),
  P('thanh-hoa', 'Thanh Hóa', 105, [THANH_HOA], ['Thanh Hoá']),
  P('nghe-an', 'Nghệ An', 104.75, [NGHE_AN]),
  P('ha-tinh', 'Hà Tĩnh', 105.5, [HA_TINH]),
  P('cao-bang', 'Cao Bằng', 105.75, [CAO_BANG]),
  // Merged units
  P('tuyen-quang', 'Tuyên Quang', 106, [TUYEN_QUANG, HA_GIANG]),
  P('lao-cai', 'Lào Cai', 104.75, [LAO_CAI, YEN_BAI]),
  P('thai-nguyen', 'Thái Nguyên', 106.5, [THAI_NGUYEN, BAC_KAN]),
  P('phu-tho', 'Phú Thọ', 104.75, [PHU_THO, VINH_PHUC, HOA_BINH], ['Hoà Bình']),
  P('bac-ninh', 'Bắc Ninh', 107, [BAC_NINH, BAC_GIANG]),
  P('hung-yen', 'Hưng Yên', 105.5, [HUNG_YEN, THAI_BINH]),
  P('hai-phong', 'TP. Hải Phòng', 105.75, [HAI_PHONG, HAI_DUONG], ['Hải Phòng']),
  P('ninh-binh', 'Ninh Bình', 105, [NINH_BINH, HA_NAM, NAM_DINH]),
  P('quang-tri', 'Quảng Trị', 106, [QUANG_TRI, QUANG_BINH]),
  P('da-nang', 'TP. Đà Nẵng', 107.75, [DA_NANG, QUANG_NAM], ['Đà Nẵng']),
  P('quang-ngai', 'Quảng Ngãi', 108, [QUANG_NGAI, KON_TUM]),
  P('gia-lai', 'Gia Lai', 108.25, [GIA_LAI, BINH_DINH]),
  P('khanh-hoa', 'Khánh Hòa', 108.25, [KHANH_HOA, NINH_THUAN], ['Khánh Hoà']),
  P('lam-dong', 'Lâm Đồng', 107.75, [LAM_DONG, DAK_NONG, BINH_THUAN]),
  P('dak-lak', 'Đắk Lắk', 108.5, [DAK_LAK, PHU_YEN], ['Đắc Lắc', 'Đăk Lăk']),
  P('ho-chi-minh', 'TP. Hồ Chí Minh', 105.75, [HCM, BINH_DUONG, BR_VT], ['Hồ Chí Minh', 'Sài Gòn', 'Vũng Tàu']),
  P('dong-nai', 'Đồng Nai', 107.75, [DONG_NAI, BINH_PHUOC]),
  P('tay-ninh', 'Tây Ninh', 105.75, [TAY_NINH, LONG_AN]),
  P('can-tho', 'TP. Cần Thơ', 105, [CAN_THO, SOC_TRANG, HAU_GIANG], ['Cần Thơ']),
  P('vinh-long', 'Vĩnh Long', 105.5, [VINH_LONG, BEN_TRE, TRA_VINH]),
  P('dong-thap', 'Đồng Tháp', 105, [DONG_THAP, TIEN_GIANG]),
  P('ca-mau', 'Cà Mau', 104.5, [CA_MAU, BAC_LIEU]),
  P('an-giang', 'An Giang', 104.75, [AN_GIANG, KIEN_GIANG]),
];

/** All former (pre-2025) provinces, flattened. */
export const FORMER_PROVINCES: FormerProvince[] = PROVINCES.flatMap((p) => p.formerUnits ?? []);

export function getProvince(id: string): Province | undefined {
  return PROVINCES.find((p) => p.id === id);
}

/** Lowercase, strip diacritics (đ → d), drop "tp."/"tỉnh"/"thành phố" prefixes. */
export function foldVietnamese(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/^(tp\.?|thanh pho|tinh)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Search by current or former name, diacritics-insensitive ("can tho", "Sóc Trăng", "hau giang"). */
export function searchProvinces(query: string): Province[] {
  const q = foldVietnamese(query);
  if (!q) return PROVINCES.slice();
  const scored: { p: Province; s: number }[] = [];
  for (const p of PROVINCES) {
    const names = [p.name, ...p.aliases].map(foldVietnamese);
    let s = 0;
    if (names[0] === q) s = 4;
    else if (names.slice(1).includes(q)) s = 3;
    else if (names.some((n) => n.startsWith(q))) s = 2;
    else if (names.some((n) => n.includes(q))) s = 1;
    if (s > 0) scored.push({ p, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.p);
}

export function boxContains(b: LngLatBox | [number, number, number, number], lng: number, lat: number): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}
