// Which TT16 database / feature dataset a drawing of a "lấy ý kiến" folder feeds, recognised from its title
// ("BẢN ĐỒ ĐỊNH HƯỚNG QUY HOẠCH CẤP ĐIỆN", "BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050") and its file name
// (QH07…, Xr_Nen…). Xrefs, location sketches and title blocks are recognised so they can be left out.
import { foldVietnamese } from '@/lib/geo/provinces';

export type RoleId =
  | 'ht-sdd'
  | 'ht-htkt'
  | 'ranh'
  | 'qh-sdd'
  | 'qh-ktcq'
  | 'qh-gt'
  | 'qh-dien'
  | 'qh-ttll'
  | 'qh-nuoc'
  | 'qh-tn'
  | 'qh-cbkt'
  | 'qh-mt'
  | 'nen'
  | 'moc'
  | 'vitri'
  | 'xref'
  | 'other';

/** The four databases of Thông tư 16. */
export type DbName = 'HienTrang' | 'QuyHoach' | 'NenDiaHinh' | 'MocGioi';

export interface DrawingRole {
  id: RoleId;
  label: string;
  /** TT16 database the drawing feeds (null = nothing by default). */
  db: DbName | null;
  /** Feature dataset suggested for layers that only say "a line on this map". */
  dataset: string | null;
}

export const ROLES: DrawingRole[] = [
  { id: 'ht-sdd', label: 'Hiện trạng sử dụng đất', db: 'HienTrang', dataset: 'HienTrangSuDungDat' },
  { id: 'ht-htkt', label: 'Hiện trạng hạ tầng kỹ thuật', db: 'HienTrang', dataset: 'HienTrangGiaoThong' },
  { id: 'ranh', label: 'Ranh giới', db: 'QuyHoach', dataset: 'ViTriRanhGioi' },
  { id: 'qh-sdd', label: 'Quy hoạch sử dụng đất', db: 'QuyHoach', dataset: 'QuyHoachSuDungDat' },
  { id: 'qh-ktcq', label: 'Phát triển không gian, kiến trúc cảnh quan', db: 'QuyHoach', dataset: 'QuyHoachKhongGianKienTrucCanhQuan' },
  { id: 'qh-gt', label: 'Quy hoạch giao thông', db: 'QuyHoach', dataset: 'QuyHoachGiaoThong' },
  { id: 'qh-dien', label: 'Quy hoạch cấp điện', db: 'QuyHoach', dataset: 'QuyHoachCapDien' },
  { id: 'qh-ttll', label: 'Quy hoạch thông tin liên lạc', db: 'QuyHoach', dataset: 'QuyHoachThongTinLienLac' },
  { id: 'qh-nuoc', label: 'Quy hoạch cấp nước', db: 'QuyHoach', dataset: 'QuyHoachCapNuoc' },
  { id: 'qh-tn', label: 'Quy hoạch thoát nước', db: 'QuyHoach', dataset: 'QuyHoachChuanBiKyThuat' },
  { id: 'qh-cbkt', label: 'Quy hoạch chuẩn bị kỹ thuật', db: 'QuyHoach', dataset: 'QuyHoachChuanBiKyThuat' },
  { id: 'qh-mt', label: 'Môi trường', db: 'QuyHoach', dataset: 'GiaiPhapBaoVeMoiTruong' },
  { id: 'nen', label: 'Nền địa hình (đường đồng mức, điểm độ cao)', db: 'NenDiaHinh', dataset: 'NenDiaHinh' },
  { id: 'moc', label: 'Mốc giới quy hoạch', db: 'MocGioi', dataset: 'MocGioiQuyHoach' },
  { id: 'vitri', label: 'Sơ đồ vị trí (không dùng)', db: null, dataset: null },
  { id: 'xref', label: 'Xref / nền tham chiếu (không dùng)', db: null, dataset: null },
  { id: 'other', label: 'Khác (không dùng)', db: null, dataset: null },
];

export const roleById = (id: RoleId) => ROLES.find((r) => r.id === id) ?? ROLES[ROLES.length - 1];

export interface RoleGuess {
  role: RoleId;
  /** Title found in the drawing ("BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050"), if any. */
  title: string | null;
  /** Target year of the map (2030, 2050), if the title says so. */
  year: number | null;
}

/** Ordered: the first rule matching the folded title (or file name) wins. */
const RULES: [RegExp, RoleId][] = [
  [/so do vi tri|lien he vung|vi tri .* trong/, 'vitri'],
  [/nen dia hinh|khao sat dia hinh|do dac dia hinh|ban do dia hinh|duong dong muc/, 'nen'],
  [/moc gioi|cam moc/, 'moc'],
  [/hien trang.*su dung dat|su dung dat.*hien trang|danh gia hien trang/, 'ht-sdd'],
  [/hien trang .*(ha tang|ky thuat|giao thong|cap dien|cap nuoc|thoat nuoc)|ha tang ky thuat hien trang/, 'ht-htkt'],
  [/hien trang|danh gia hien trang/, 'ht-sdd'],
  [/su dung dat/, 'qh-sdd'],
  [/ranh gioi|pham vi ranh/, 'ranh'],
  [/phat trien khong gian|to chuc khong gian|kien truc canh quan|co cau|dinh huong phat trien/, 'qh-ktcq'],
  [/giao thong/, 'qh-gt'],
  [/cap dien|chieu sang|nang luong/, 'qh-dien'],
  [/thong tin lien lac|vien thong|buu chinh/, 'qh-ttll'],
  [/cap nuoc/, 'qh-nuoc'],
  [/thoat nuoc|nuoc thai/, 'qh-tn'],
  [/chuan bi ky thuat|san nen|cao do nen/, 'qh-cbkt'],
  [/moi truong|chat thai ran|nghia trang/, 'qh-mt'],
];

/**
 * A title that [guessRole] reads back as this kind of map: written into a cleaned drawing whose own title is missing or
 * says something else, so the drawing keeps its kind when the web app opens it.
 */
export const CANONICAL_TITLE: Partial<Record<RoleId, string>> = {
  'ht-sdd': 'BẢN ĐỒ HIỆN TRẠNG SỬ DỤNG ĐẤT',
  'ht-htkt': 'BẢN ĐỒ HIỆN TRẠNG HẠ TẦNG KỸ THUẬT',
  ranh: 'BẢN ĐỒ RANH GIỚI',
  'qh-sdd': 'BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT',
  'qh-ktcq': 'BẢN ĐỒ ĐỊNH HƯỚNG PHÁT TRIỂN KHÔNG GIAN',
  'qh-gt': 'BẢN ĐỒ QUY HOẠCH GIAO THÔNG',
  'qh-dien': 'BẢN ĐỒ QUY HOẠCH CẤP ĐIỆN',
  'qh-ttll': 'BẢN ĐỒ QUY HOẠCH THÔNG TIN LIÊN LẠC',
  'qh-nuoc': 'BẢN ĐỒ QUY HOẠCH CẤP NƯỚC',
  'qh-tn': 'BẢN ĐỒ QUY HOẠCH THOÁT NƯỚC',
  'qh-cbkt': 'BẢN ĐỒ QUY HOẠCH CHUẨN BỊ KỸ THUẬT',
  'qh-mt': 'BẢN ĐỒ QUY HOẠCH MÔI TRƯỜNG',
  nen: 'BẢN ĐỒ NỀN ĐỊA HÌNH',
  moc: 'BẢN ĐỒ MỐC GIỚI QUY HOẠCH',
};

/** Title of a map: the text starting with "BẢN ĐỒ" / "SƠ ĐỒ" (the drawing number line is not a title). */
export function findTitle(texts: string[]): string | null {
  let best: string | null = null;
  for (const t of texts) {
    const one = t.replace(/\s+/g, ' ').trim();
    const f = foldVietnamese(one);
    if (!/^(ban do|so do)\b/.test(f) || one.length > 140) continue;
    // Prefer the longest title (the one with "ĐẾN NĂM 2050").
    if (!best || one.length > best.length) best = one;
  }
  return best;
}

export function guessRole(fileName: string, texts: string[]): RoleGuess {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.(dwg|dxf)$/i, '');
  const fname = foldVietnamese(base);
  const title = findTitle(texts);
  const year = (() => {
    const m = /nam (20\d\d)\b/.exec(foldVietnamese(title ?? '')) ?? /nam (20\d\d)\b/.exec(fname);
    return m ? Number(m[1]) : null;
  })();
  // Xref / frame files are named so by habit; their content has no title.
  if (/^(xr|xref)\b|^x ?r /.test(fname) || /^khung\b|khung ten|khung fix/.test(fname)) return { role: 'xref', title, year };
  for (const src of [title ? foldVietnamese(title) : null, fname]) {
    if (!src) continue;
    for (const [re, role] of RULES) if (re.test(src)) return { role, title, year };
  }
  return { role: 'other', title, year };
}
