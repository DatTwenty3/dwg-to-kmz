// Built-in suggestions "CAD layer → TT16 feature class" for planning drawings. Layer names of Vietnamese
// planning offices follow loose habits (DAT_XD_Khudancu, QHDD_DAT_NN_Tronglua, HTKT_CD_Tuyen 22 kV, GT-MCN…):
// the name is folded (no accents, lower case, no separators) and matched against ordered rules that depend on
// the map the layer comes from (its role) and on the geometry kind. Anything not recognised stays unmapped —
// the user decides in the mapping table, and a saved template (template.ts) wins over these rules.
import { foldVietnamese } from '@/lib/geo/provinces';
import { roleById, type RoleId } from './roles';
import { roadPhanLoai } from './roads';
import { TT16_SYMBOLS } from './tt16Symbols';

/** Geometry kinds of a layer row: vùng (hatch/solid), đường (polyline), điểm (point), chữ (text). */
export type GeomKind = 'A' | 'L' | 'P' | 'T';

/** "QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L" */
export type TargetPath = string;

export const targetPath = (db: string, dataset: string, cls: string): TargetPath => `${db}/${dataset}/${cls}`;
export function parseTarget(t: TargetPath): { db: string; dataset: string; cls: string } | null {
  const [db, dataset, cls] = t.split('/');
  return db && dataset && cls ? { db, dataset, cls } : null;
}

export interface Suggestion {
  target: TargetPath | null;
  phanLoai: string;
  /** Why (shown as a tooltip), e.g. "nền sử dụng đất — đã lấy từ bản đồ sử dụng đất". */
  reason: string;
  /** No rule applied: the user should decide (a layer left out on purpose has `unknown` false). */
  unknown?: boolean;
}

export interface LayerFacts {
  /** Closed polylines / all polylines of the row (L rows). */
  closedShare?: number;
  /** The same layer also has hatches (A row) in this drawing. */
  layerHasPolygons?: boolean;
  /** Share of texts that are numbers ("2,18", "+1.5") — elevations (T rows). */
  numericShare?: number;
}

type Theme = 'sdd' | 'ktcq' | 'tkdt' | 'gt' | 'cg' | 'cbkt' | 'tnt' | 'nuoc' | 'dien' | 'ttll' | 'mt' | 'ranh' | 'dh' | 'moc';

const DATASET: Record<Theme, [string, string]> = {
  sdd: ['HienTrangSuDungDat', 'QuyHoachSuDungDat'],
  ktcq: ['HienTrangKhongGianKienTrucCanhQuan', 'QuyHoachKhongGianKienTrucCanhQuan'],
  tkdt: ['HienTrangKhongGianKienTrucCanhQuan', 'ThietkeDoThi'],
  gt: ['HienTrangGiaoThong', 'QuyHoachGiaoThong'],
  cg: ['HienTrangCGDD_CGXDHanhLangHTKT', 'QuyHoachCGDD_CGXDHanhLangHTKT'],
  cbkt: ['HienTrangChuanBiKyThuat', 'QuyHoachChuanBiKyThuat'],
  tnt: ['HienTrangThoatNuocThaiVSMT', 'QuyHoachThoatNuocThaiVSMT'],
  nuoc: ['HienTrangCapNuoc', 'QuyHoachCapNuoc'],
  dien: ['HienTrangCapDien', 'QuyHoachCapDien'],
  ttll: ['HienTrangThongTinLienLac', 'QuyHoachThongTinLienLac'],
  mt: ['DanhGiaHienTrangMoiTruong', 'GiaiPhapBaoVeMoiTruong'],
  ranh: ['ViTriRanhGioi', 'ViTriRanhGioi'],
  // One database each: the dataset is the same whichever side is asked.
  dh: ['NenDiaHinh', 'NenDiaHinh'],
  moc: ['MocGioiQuyHoach', 'MocGioiQuyHoach'],
};

/** Datasets that pair with `dataset` in the other database (HienTrangGiaoThong ↔ QuyHoachGiaoThong), best first. */
export function counterpartDatasets(dataset: string, db: string): string[] {
  const out: string[] = [];
  if (db !== 'HienTrang' && db !== 'QuyHoach') return out;
  for (const pair of Object.values(DATASET)) if (pair.includes(dataset)) out.push(pair[db === 'HienTrang' ? 0 : 1]);
  return [...new Set(out)];
}

/** Folded layer name without separators: "HTKT_CD_Tuyen 22 kV" → "htktcdtuyen22kv". */
export const compactName = (s: string) => foldVietnamese(s).replace(/ /g, '');

/** Land use categories (QCVN 01:2021/BXD wording) recognised in layer names. Order matters. */
export const LAND_USE: [RegExp, string][] = [
  [/chuasudung/, 'Đất chưa sử dụng'],
  [/khudancu|dato\b|^dato|datodothi|olangxom|onongthon|onongthon|datonongthon|ontdato|taidinhcu|\bont\b|nhao|dat?o$/, 'Đất ở'],
  [/tronglua|ruonglua|datlua|lua$/, 'Đất trồng lúa'],
  [/cayhangnam|hangnam|trongtrotkhac/, 'Đất trồng cây hàng năm khác'],
  [/caylaunam|launam|vuon/, 'Đất trồng cây lâu năm'],
  [/thuysan|nuoitrong/, 'Đất nuôi trồng thủy sản'],
  [/rungphongho/, 'Đất rừng phòng hộ'],
  [/rungdacdung/, 'Đất rừng đặc dụng'],
  [/rungsanxuat|rung$/, 'Đất rừng sản xuất'],
  [/lammuoi|muoi$/, 'Đất làm muối'],
  [/nongnghiepkhac/, 'Đất nông nghiệp khác'],
  [/quocphong|anninh/, 'Đất quốc phòng, an ninh'],
  [/hanhchinh|truso|coquan/, 'Đất cơ quan, trụ sở'],
  [/giaoduc|mamnon|tieuhoc|trunghoc|truonghoc|thcs|thpt/, 'Đất giáo dục'],
  [/yte|tramyte|benhvien/, 'Đất y tế'],
  [/vanhoa|nhavanhoa/, 'Đất văn hóa'],
  [/cayxanhcachly|cachly/, 'Đất cây xanh cách ly'],
  [/tdtt|thethao|theduc/, 'Đất cây xanh, thể dục thể thao'],
  [/cayxanh|congvien|cx$/, 'Đất cây xanh sử dụng công cộng'],
  [/congcong|ctcc/, 'Đất công cộng'],
  [/tongiao|tinnguong|chua$|dinh$|nhatho/, 'Đất tôn giáo, tín ngưỡng'],
  [/ditich/, 'Đất di tích, danh thắng'],
  [/nghiatrang|nghiadia|nhatangle/, 'Đất nghĩa trang, nhà tang lễ'],
  [/chatthai|xulyrac|bairac|xuly/, 'Đất xử lý chất thải'],
  [/congnghiep|cumcn|khucn|ttcn|tieuthucong/, 'Đất công nghiệp, tiểu thủ công nghiệp'],
  [/khoangsan|vatlieu|vlxd/, 'Đất khoáng sản, vật liệu xây dựng'],
  [/phucvusanxuat|hatangsanxuat|hatangphucvu/, 'Đất hạ tầng phục vụ sản xuất'],
  [/dulich/, 'Đất du lịch'],
  [/thuongmai|dichvu|tmdv|cho$|datcho/, 'Đất thương mại, dịch vụ'],
  [/baitam/, 'Đất bãi tắm'],
  [/htkt|hatangkythuat|daumoi|hatang$/, 'Đất hạ tầng kỹ thuật'],
  [/matnuoc|songrach|song|rach|kenh|muong|ao$|aoho|thuyloi|ho$/, 'Đất sông, ngòi, kênh, rạch, suối, mặt nước'],
  [/giaothong|duongnhua|duongbetong|duong|bendo|baido/, 'Đất giao thông'],
  [/chucnangkhac|khac$/, 'Đất chức năng khác'],
];

/**
 * Labels only the TT16 colour table (tt16Symbols.ts) uses — no layer-name rule gives them, so layer suggestions are
 * unchanged. LAND_USE_M1 below turns them into ChucNangSuDungDatM1 values.
 */
export const COLOR_ONLY_LAND_USE = ['Đất hỗn hợp', 'Đất cây xanh sử dụng hạn chế', 'Đất cây xanh chuyên dụng', 'Đất sản xuất nông nghiệp'];
/** Every land use label a mapping row can carry (rules + colour table). */
export const LAND_USE_LABELS: ReadonlySet<string> = new Set([...LAND_USE.map(([, l]) => l), ...COLOR_ONLY_LAND_USE]);

/** Land use labels of suggest.ts (QCVN 01:2021) worded differently from the ChucNangSuDungDatM1 values. */
export const LAND_USE_M1: Record<string, string> = {
  'Đất bãi tắm': 'Đất xây dựng các chức năng khác',
  'Đất chức năng khác': 'Đất xây dựng các chức năng khác',
  'Đất du lịch': 'Đất xây dựng các chức năng khác',
  'Đất cây xanh cách ly': 'Đất cây xanh, thể dục thể thao',
  'Đất cây xanh sử dụng công cộng': 'Đất cây xanh, thể dục thể thao',
  'Đất giáo dục': 'Đất công cộng',
  'Đất y tế': 'Đất công cộng',
  'Đất văn hóa': 'Đất công cộng',
  'Đất thương mại, dịch vụ': 'Đất công cộng',
  'Đất cơ quan, trụ sở': 'Đất công cộng',
  'Đất công nghiệp, tiểu thủ công nghiệp': 'Đất công nghiệp, tiểu thủ công nghiệp và làng nghề',
  'Đất di tích, danh thắng': 'Đất tôn giáo, danh lam di tích, đình đền',
  'Đất tôn giáo, tín ngưỡng': 'Đất tôn giáo, danh lam di tích, đình đền',
  'Đất giao thông': 'Giao thông',
  'Đất hạ tầng kỹ thuật': 'Đất hạ tầng kỹ thuật khác',
  'Đất khoáng sản, vật liệu xây dựng': 'Đất khoáng sản và sản xuất vật liệu xây dựng',
  'Đất nghĩa trang, nhà tang lễ': 'Đất nghĩa trang, nghĩa địa',
  'Đất sông, ngòi, kênh, rạch, suối, mặt nước': 'Đất sông ngòi, kênh rạch, mặt nước chuyên dùng',
  'Đất trồng cây hàng năm khác': 'Đất trồng trọt khác',
  'Đất trồng cây lâu năm': 'Đất trồng trọt khác',
  'Đất xử lý chất thải': 'Đất xử lý chất thải rắn',
  // Only given by the TT16 colour table (tt16Symbols.ts).
  'Đất hỗn hợp': 'Hỗn hợp (Đơn vị ở và dịch vụ công cộng đô thị)',
  'Đất cây xanh sử dụng hạn chế': 'Cây xanh sử dụng hạn chế',
  'Đất cây xanh chuyên dụng': 'Cây xanh chuyên dụng',
  'Đất sản xuất nông nghiệp': 'Sản xuất nông nghiệp',
};

/** Two labels that end in the same ChucNangSuDungDatM1 value ("Đất giáo dục" / "Đất công cộng"): no real disagreement. */
export const sameLandUse = (a: string, b: string) => (LAND_USE_M1[a] ?? a) === (LAND_USE_M1[b] ?? b);

/**
 * Land use of a layer named as Thông tư 16 names its land-use layers (`DAT_<nhóm>_<Tên>`: DAT_NNK_Honuoc, DAT_KXD_Dancunongthon…,
 * with the office's prefix QHDD_ / QHDH_ / HT_ …): the name after the group is looked up in the table of Phụ lục I, so
 * the layer gets the land use of its symbol whatever its colour or the Mục in use. The names after the group never
 * point to two land uses.
 */
const TAIL_LAND_USE = new Map<string, string>();
const GROUP_TOKENS = new Set<string>();
for (const x of TT16_SYMBOLS) {
  const parts = x.layer?.split('_') ?? [];
  if (x.kind !== 'A' || !x.landUse || parts[0] !== 'DAT' || parts.length < 3) continue;
  GROUP_TOKENS.add(parts[1].toLowerCase());
  TAIL_LAND_USE.set(compactName(parts.slice(2).join('')), x.landUse);
}
const TT16_LAYER = new RegExp(`^(?:qhdd|qhdh|hkqh|qh|ht|hk|ntm)?dat(${[...GROUP_TOKENS].sort((a, b) => b.length - a.length).join('|')})(.+)$`);

export function tt16LandUse(compact: string): string | null {
  const m = TT16_LAYER.exec(compact);
  return (m && TAIL_LAND_USE.get(m[2])) || null;
}

/** Land use of a layer name: the Thông tư 16 layer names first, then the words of QCVN 01:2021. */
export const layerLandUse = (compact: string): string | null => tt16LandUse(compact) ?? landUseOf(compact);

export function landUseOf(compact: string): string | null {
  for (const [re, label] of LAND_USE) if (re.test(compact)) return label;
  return null;
}

/** Readable label from a layer name: "HTKT_CD_Tuyen 22 kV" → "Tuyến 22 kV"-ish fallback ("CD Tuyen 22 kV"). */
export function prettyLayer(name: string): string {
  return name
    .replace(/^(HTKT|QHDD|QHDH|HT|QH|HK-QH|NTM|BV|KH)[-_ ]+/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

const kv = (c: string) => /(\d{2,3})kv/.exec(c)?.[1] ?? (/(500|220|110|35|22)$/.exec(c)?.[1] || null);

/** Layers that never carry GIS data: annotation, dimensions, frames, legend, viewports. */
const NEVER =
  /^(0|1|2|3|defpoints|ve|vp|viewport|layer\d*|text\w*|dim\w*|kichthuoc|khung\w*|bv(khung|ten|chugiai|tenchugiai|khungten|khungbanve)\w*|\w*chugiai\w*|\w*ghichu\w*|\w*kyhieu\w*|gchu|hkqhgchu|\w*text|\w*dim|tenkenh\w*|ten\w*|\w*mattcat\w*|mcat|kh ?mc|mcduong|\w*tieude\w*|\w*hoagio\w*|\w*thuoc(tyle)?\w*|\w*tyle\w*|\w*logo\w*)$/;

const BOUNDARY_PLAN = /rglap|ranh\w*lap|lapquyhoach|ranhquyhoach|ranhqh|rgqh|ranhnghiencuu|phamvinghiencuu/;
const BOUNDARY_ADMIN = /rgcapcoso|ranhgioi(xa|huyen|tinh|hanhchinh)|ranh(xa|huyen|tinh|hanhchinh)|diagioi|rg(xa|huyen|tinh|hc)\b|ranhgioihuyen|ranhap|rgap/;
/** Land use colours repeated under infrastructure maps (already taken from the land use map). */
const LAND_USE_BACKGROUND = /^(qhdd|qhdh|ht|hkqh|ntm|hkqhntm)?dat|^ntm|^qhdd|^qhdh/;

/** Classes per kind for a theme, by keyword. Returns [class, phanLoai] or null. */
type Pick = { theme: Theme; cls: string; phanLoai: string } | null;

/** Contour lines, spot heights (NenDiaHinh) and boundary markers (MocGioi). */
function terrainOrMarker(c: string, kind: GeomKind, facts: LayerFacts, role: RoleId): Pick {
  if (/mocgioi|cammoc|mocranh/.test(c) || role === 'moc') {
    if (kind === 'T') return null;
    return { theme: 'moc', cls: kind === 'A' ? 'MocGioiQuyHoach_A' : kind === 'L' ? 'MocGioiQuyHoach_L' : 'MocGioiQuyHoach_P', phanLoai: 'Mốc giới quy hoạch' };
  }
  if (/dongmuc|contour|^dmuc|duongmuc/.test(c)) return kind === 'L' ? { theme: 'dh', cls: 'DuongDongMuc_L', phanLoai: 'Đường đồng mức' } : null;
  if (/diemdocao|diemcaodo|ddcao|^spot|spotheight/.test(c)) return kind === 'P' || kind === 'T' ? { theme: 'dh', cls: 'DiemDoCao_P', phanLoai: 'Điểm độ cao' } : null;
  return null;
}

function roads(c: string, kind: GeomKind, p: string): Pick {
  // "Đường điện / đường ống / đường dây …" are utility lines, not roads (they only share the word "đường").
  if (/duong(day)?dien|duongong|duongnuoc|duongcap|duongthoat|duongtruyen/.test(c)) return null;
  if (!/duong|giaothong|htktgt|^gt|gt$|quoclo|tinhlo|huyenlo|^ql|^dt|^dh|lo$|nhua|betong|cau$|^cau|caucong|ben|baido|tim|mepduong|bovia|leduong|hem|ngo|mcn|logioi|chigioi/.test(c)) return null;
  // "Hè đường": the thin lines on both sides of a road (the road reserve, drawn blue like the lộ giới lines of other
  // drawings), around the wide polyline that is the carriageway — the red lines, not the axis.
  if (/heduong/.test(c)) return kind === 'L' ? { theme: 'cg', cls: 'ChiGioiDuongDo_L', phanLoai: 'Chỉ giới đường đỏ' } : null;
  if (/logioi|chigioiduongdo|cgdd|duongdo/.test(c)) return kind === 'L' ? { theme: 'cg', cls: 'ChiGioiDuongDo_L', phanLoai: 'Chỉ giới đường đỏ' } : null;
  if (/chigioixaydung|cgxd/.test(c)) return kind === 'L' ? { theme: 'cg', cls: 'ChiGioiXayDung_L', phanLoai: 'Chỉ giới xây dựng' } : null;
  if (kind === 'A') {
    if (/ben|baido|cau|nut/.test(c)) return { theme: 'gt', cls: 'CongTrinhGiaoThong_A', phanLoai: p };
    return { theme: 'gt', cls: 'MangLuoiGiaoThongDuongBo_A', phanLoai: p };
  }
  if (kind === 'P') return /cau|cong|ben|tram|baido/.test(c) ? { theme: 'gt', cls: 'CongTrinhGiaoThong_P', phanLoai: p } : null;
  if (kind !== 'L') return null;
  const label = roadPhanLoai(c) ?? p;
  if (/mep|bovia|leduong|vihe|viahe|phancach|mcn/.test(c)) return { theme: 'gt', cls: 'BoViaDaiPhanCach_L', phanLoai: p };
  if (/huongdi/.test(c)) return { theme: 'gt', cls: 'HuongDi_L', phanLoai: p };
  if (/^cau|cau$|caucong|congtrinh/.test(c)) return { theme: 'gt', cls: 'CongTrinhGiaoThong_L', phanLoai: label };
  return { theme: 'gt', cls: 'MangLuoiGiaoThongDuongBo_L', phanLoai: label };
}

function power(c: string, kind: GeomKind): Pick {
  if (!/dien|kv|^ee|^e$|^e\d|cdtuyen|tuyen\d|trungthe|hathe|caothe|tba|bienap|tramdien|dientram|chieusang|denduong|^den/.test(c)) return null;
  const v = kv(c);
  if (/chieusang|denduong|^den/.test(c)) return kind === 'L' ? { theme: 'dien', cls: 'MangLuoiChieuSang_L', phanLoai: 'Chiếu sáng' } : kind === 'T' ? null : { theme: 'dien', cls: 'CongTrinhChieuSang_P', phanLoai: 'Đèn chiếu sáng' };
  if (/tba|bienap|tram/.test(c)) {
    if (kind === 'A' || kind === 'P') return { theme: 'dien', cls: 'CongTrinhCapDien_P', phanLoai: v ? `Trạm biến áp ${v} kV` : 'Trạm biến áp' };
    return null; // outline of the symbol
  }
  if (kind === 'L') return { theme: 'dien', cls: 'MangLuoiPhanPhoiDien_L', phanLoai: v ? `Đường dây ${v} kV` : /trungthe/.test(c) ? 'Đường dây trung thế' : /hathe/.test(c) ? 'Đường dây hạ thế' : 'Đường dây điện' };
  return null;
}

function water(c: string, kind: GeomKind, p: string): Pick {
  if (!/capnuoc|^cn|ongnuoc|ong(d|phi)?\d|tuyenong|nuocsach|nhamaynuoc|tramcapnuoc|tramnuoc|pccc|cuuhoa|hong|tru(cuu)?hoa|daunoi|thapnuoc|nuoc$/.test(c)) return null;
  if (/pccc|cuuhoa|truhoa|hongcuuhoa/.test(c)) return kind === 'L' ? null : { theme: 'nuoc', cls: 'CongtrinhCapNuocPCCC_P', phanLoai: 'Trụ cứu hỏa' };
  if (/daunoi/.test(c)) return kind === 'L' ? null : { theme: 'nuoc', cls: 'DiemDauNoi_P', phanLoai: 'Điểm đấu nối' };
  if (/nhamay|tram|thap|be$|xuly/.test(c)) return kind === 'A' ? { theme: 'nuoc', cls: 'CongtrinhCapNuocPCCC_A', phanLoai: 'Công trình cấp nước' } : kind === 'P' ? { theme: 'nuoc', cls: 'CongtrinhCapNuocPCCC_P', phanLoai: 'Công trình cấp nước' } : null;
  if (/phanvung/.test(c)) return kind === 'A' ? { theme: 'nuoc', cls: 'PhanVungCapNuoc_A', phanLoai: p } : null;
  return kind === 'L' ? { theme: 'nuoc', cls: 'MangLuoiCapNuoc_L', phanLoai: 'Đường ống cấp nước' } : null;
}

function drainage(c: string, kind: GeomKind, p: string, defaultMua: boolean): Pick {
  const thai = /nuocthai|tnt|^nt\b|xulynuocthai|htxl|tramxl|nhamayxl/.test(c);
  const mua = /nuocmua|tnm|mua$/.test(c);
  if (!thai && !mua && !/thoatnuoc|^tn|cong(thoat|tron|hop|d\d)|muong|ranh|luuvuc|phanluu|huongthoat|xuly|chatthai|rac|hoga/.test(c)) return null;
  if (/hoga|giengthu|gietthu|ganuoc/.test(c)) {
    if (kind === 'L' || kind === 'T') return null;
    return thai ? { theme: 'tnt', cls: 'CongTrinhTNTvaVSMT_P', phanLoai: 'Hố ga thoát nước thải' } : { theme: 'cbkt', cls: 'CongTrinhCBKT_P', phanLoai: 'Hố ga thoát nước mưa' };
  }
  if (/luuvuc/.test(c)) return kind === 'A' ? { theme: 'cbkt', cls: 'PhanVungLuuVuc_A', phanLoai: p } : null;
  if (/chatthai|rac|xulyrac/.test(c)) return kind === 'L' || kind === 'T' ? null : { theme: 'tnt', cls: kind === 'A' ? 'CongTrinhTNTvaVSMT_A' : 'CongTrinhTNTvaVSMT_P', phanLoai: 'Khu xử lý chất thải rắn' };
  if (/xuly|tram|nhamay|htxl/.test(c)) return kind === 'L' || kind === 'T' ? null : { theme: 'tnt', cls: kind === 'A' ? 'CongTrinhTNTvaVSMT_A' : 'CongTrinhTNTvaVSMT_P', phanLoai: 'Trạm xử lý nước thải' };
  if (kind !== 'L') return null;
  if (/huong/.test(c)) return thai ? { theme: 'tnt', cls: 'HuongThoatNuocThai_L', phanLoai: p } : { theme: 'cbkt', cls: 'HuongThoatNuocMua_L', phanLoai: p };
  if (/phanluu/.test(c)) return thai ? { theme: 'tnt', cls: 'PhanLuuThoatNuocThai_L', phanLoai: p } : { theme: 'cbkt', cls: 'PhanLuuThoatNuocMua_L', phanLoai: p };
  if (thai || (!mua && !defaultMua)) return { theme: 'tnt', cls: 'MangLuoiThoatNuocThai_L', phanLoai: 'Tuyến thoát nước thải' };
  return { theme: 'cbkt', cls: 'MangLuoiThoatNuocMua_L', phanLoai: 'Tuyến thoát nước mưa' };
}

function telecom(c: string, kind: GeomKind): Pick {
  if (!/ttll|thongtin|vienthong|capquang|cap(tt|thongtin)|bts|buudien|tongdai|tramthu|cotang|cot(tt|anten)|internet/.test(c)) return null;
  if (/bts|buudien|tongdai|tram|cot/.test(c)) return kind === 'L' || kind === 'T' ? null : { theme: 'ttll', cls: kind === 'A' ? 'CongTrinhThongTin_A' : 'CongTrinhThongTin_P', phanLoai: /bts|cot/.test(c) ? 'Trạm BTS' : /buudien/.test(c) ? 'Bưu điện' : 'Công trình thông tin' };
  return kind === 'L' ? { theme: 'ttll', cls: 'MangLuoiCapThongTin_L', phanLoai: 'Tuyến cáp thông tin' } : null;
}

function boundary(c: string, kind: GeomKind, facts: LayerFacts): Pick {
  if (BOUNDARY_PLAN.test(c)) {
    if (kind === 'A' || (kind === 'L' && (facts.closedShare ?? 0) > 0)) return { theme: 'ranh', cls: 'RanhGioiQuyHoach_A', phanLoai: 'Ranh giới lập quy hoạch' };
    return null;
  }
  if (BOUNDARY_ADMIN.test(c)) {
    if (kind === 'L' || kind === 'A') return { theme: 'ranh', cls: 'RanhGioiHanhChinh_L', phanLoai: /ap/.test(c) ? 'Ranh giới ấp' : /huyen/.test(c) ? 'Ranh giới huyện' : /tinh/.test(c) ? 'Ranh giới tỉnh' : 'Ranh giới xã' };
    if (kind === 'T') return { theme: 'ranh', cls: 'TenDonViHanhChinh_P', phanLoai: 'Tên đơn vị hành chính' };
  }
  return null;
}

const SDD_ROLES = new Set<RoleId>(['ht-sdd', 'qh-sdd']);

/**
 * Suggestion for one row (drawing role × layer × geometry kind). `target: null` = leave out
 * (with the reason), or "chưa nhận ra" when no rule applies.
 */
export function suggest(roleId: RoleId, layer: string, kind: GeomKind, facts: LayerFacts = {}): Suggestion {
  const role = roleById(roleId);
  const none = (reason: string): Suggestion => ({ target: null, phanLoai: '', reason });
  const unknown = (reason: string): Suggestion => ({ target: null, phanLoai: '', reason, unknown: true });
  if (!role.db) return none('Bản vẽ không dùng để tạo dữ liệu');
  const c = compactName(layer);
  const p = prettyLayer(layer);
  const hien = role.db === 'HienTrang';
  const at = (x: NonNullable<Pick>, why: string): Suggestion => {
    // Ranh giới is written to QuyHoach (and copied to HienTrang when it has none — see features.ts).
    const db = x.theme === 'ranh' ? 'QuyHoach' : x.theme === 'dh' ? 'NenDiaHinh' : x.theme === 'moc' ? 'MocGioi' : role.db!;
    return { target: targetPath(db, DATASET[x.theme][db === 'HienTrang' ? 0 : 1], x.cls), phanLoai: x.phanLoai, reason: why };
  };

  // Boundaries: kept only from the drawing whose role is "ranh" or from any map when it is the planning area
  // (one feature, de-duplicated when exporting).
  const b = boundary(c, kind, facts);
  if (b) return at(b, 'Tên layer là ranh giới');
  // On a terrain map the numbers are the spot heights, whatever their layer is called ("TEXT", "GHI CHU").
  if (role.id === 'nen' && kind === 'T' && (facts.numericShare ?? 0) >= 0.7) return at({ theme: 'dh', cls: 'DiemDoCao_P', phanLoai: 'Điểm độ cao' }, 'Số cao độ trên bản đồ địa hình');
  if (NEVER.test(c) || c === '') return none('Chữ, ký hiệu, khung, kích thước — không phải dữ liệu GIS');
  if (/tuongrao|hangrao/.test(c)) return none('Tường rào — không có lớp tương ứng');
  // Terrain and boundary markers have their own databases, whatever the map they are drawn on.
  const dm = terrainOrMarker(c, kind, facts, roleId);
  if (dm) return at(dm, dm.cls.startsWith('Moc') ? 'Mốc giới quy hoạch' : 'Nền địa hình');
  // The outline of a symbol that also has its point / hatch (a manhole, a transformer station): the point is the data.
  if (kind === 'L' && /hoga|giengthu|gietthu|dientram|tramdien|^tba|bienap/.test(c)) return none('Nét viền ký hiệu (hố ga, trạm điện…) — đối tượng lấy từ điểm / hatch');
  if (/^(nen)?giaithua$/.test(c)) return none('Nền giải thửa (địa chính) — không thuộc đồ án');
  if (/nenbetong|kebetong/.test(c)) return none('Sân / nền / kè bê tông (hình khép kín nhỏ) — không phải đường');

  if (kind === 'T') {
    if ((facts.numericShare ?? 0) >= 0.7 && /nen|caodo|cdtk|cdht|ks|khaosat|dodac|^\d|giaithua|hientrang|thietke/.test(c))
      return at({ theme: 'cbkt', cls: 'CaoDoNen_P', phanLoai: hien ? 'Cao độ hiện trạng' : 'Cao độ thiết kế' }, 'Chữ số cao độ');
    return none('Chữ — dùng làm tên đối tượng (tenDoiTuong) của vùng chứa nó');
  }

  if (SDD_ROLES.has(roleId)) {
    // Outlines of a land-use layer named as in Phụ lục I (QHDD_DAT_KXD_Dancunongthon…) with no hatch on it are the only
    // trace of those parcels: their pieces are chained into areas (the existing-state copies "HT_…" stay out).
    const outlineOnly = kind === 'L' && !facts.layerHasPolygons && !!tt16LandUse(c) && !/^ht/.test(c);
    if (kind === 'A' || outlineOnly || (kind === 'L' && !facts.layerHasPolygons && (facts.closedShare ?? 0) >= 0.8)) {
      if (/nha|bkc|kientruc|congtrinh|nhaxay/.test(c) && !/nhavanhoa|nhatho|nhatang/.test(c))
        return at({ theme: 'ktcq', cls: 'CongTrinh_A', phanLoai: /bkc/.test(c) ? 'Nhà bán kiên cố' : /kc|kiencuo/.test(c) ? 'Nhà kiên cố' : 'Nhà, công trình' }, 'Nhà / công trình');
      if (/phankhu/.test(c) && !hien) return at({ theme: 'sdd', cls: 'PhanKhuQuyHoach_A', phanLoai: p }, 'Phân khu');
      const lu = layerLandUse(c);
      if (lu) return at({ theme: 'sdd', cls: 'ChucNangSuDungDat_A', phanLoai: lu }, 'Loại đất nhận ra từ tên layer');
      if (/^(qhdd|qhdh|ht|hkqh)?dat|^ntm/.test(c)) return at({ theme: 'sdd', cls: 'ChucNangSuDungDat_A', phanLoai: p }, 'Layer đất (DAT_…)');
      return unknown('Chưa nhận ra loại đất — hãy chọn lớp');
    }
    if (kind === 'L') {
      const r = roads(c, kind, p);
      if (r && r.theme === 'cg') return at(r, 'Lộ giới / chỉ giới');
      if (r && /tim/.test(c)) return at(r, 'Tim đường');
      // A dossier whose only map is the land-use one (Đôn Châu) draws its roads and bridges on it as open lines
      // (HTKT_GT_Heduong, HTKT_GT_Duongkhuvuc, CAU…): those are the road network, not the outline of a parcel.
      if (r && (r.cls === 'MangLuoiGiaoThongDuongBo_L' || r.cls === 'CongTrinhGiaoThong_L') && !tt16LandUse(c) && !facts.layerHasPolygons && (facts.closedShare ?? 0) < 0.5)
        return at(r, 'Đường / cầu vẽ bằng nét hở trên bản đồ sử dụng đất');
      return none('Đường viền thửa/lô — vùng đã lấy từ hatch');
    }
    return none('Điểm khảo sát / ký hiệu');
  }

  if (LAND_USE_BACKGROUND.test(c)) return none('Nền sử dụng đất — đã lấy từ bản đồ sử dụng đất');

  const tries: ((c: string, k: GeomKind, p: string) => Pick)[] =
    roleId === 'qh-gt'
      ? [roads]
      : roleId === 'qh-dien'
        ? [power]
        : roleId === 'qh-nuoc'
          ? [water]
          : roleId === 'qh-tn'
            ? [(cc, k, pp) => drainage(cc, k, pp, true)]
            : roleId === 'qh-ttll'
              ? [telecom]
              : roleId === 'ht-htkt'
                ? [power, water, (cc, k, pp) => drainage(cc, k, pp, true), telecom, roads]
                : [];
  if (roleId === 'ht-htkt' && /^nha|bkc|congtrinh/.test(c) && !/nhavanhoa|nhatho|nhatang/.test(c)) {
    if (kind === 'A' || (kind === 'L' && (facts.closedShare ?? 0) >= 0.5)) return at({ theme: 'ktcq', cls: 'CongTrinh_A', phanLoai: /bkc/.test(c) ? 'Nhà bán kiên cố' : /kc/.test(c) ? 'Nhà kiên cố' : /tam|^nhat$/.test(c) ? 'Nhà tạm' : 'Nhà, công trình' }, 'Nhà / công trình');
    return none('Ký hiệu / chữ của nhà');
  }
  for (const t of tries) {
    const r = t(c, kind, p);
    if (r) return at(r, 'Tên layer khớp chuyên đề của bản vẽ');
  }
  if (roleId === 'qh-ktcq') {
    if (/diemnhan|cuango|bieu ?tuong/.test(c) && kind !== 'L') return at({ theme: 'tkdt', cls: 'DiemNhanChinh_P', phanLoai: p }, 'Điểm nhấn');
    if (/truc|tuyen|canhquan|khonggian|huongphattrien/.test(c)) {
      if (kind === 'L') return at({ theme: 'ktcq', cls: 'KhongGianKTCQ_L', phanLoai: p }, 'Trục / tuyến không gian');
      if (kind === 'A') return at({ theme: 'ktcq', cls: 'KhongGianKTCQ_A', phanLoai: p }, 'Vùng không gian');
    }
    if (/vung|khuvuc|phankhu/.test(c) && kind === 'A') return at({ theme: 'ktcq', cls: 'KhongGianKTCQ_A', phanLoai: p }, 'Vùng không gian');
  }
  if (roleId === 'qh-cbkt' && kind === 'A' && /sannen|phanvung/.test(c)) return at({ theme: 'cbkt', cls: 'PhanVungSanNen_A', phanLoai: p }, 'San nền');
  if (roleId === 'qh-mt') {
    if (/quantrac/.test(c) && kind !== 'L') return at({ theme: 'mt', cls: 'DiemQuanTrac_P', phanLoai: p }, 'Điểm quan trắc');
  }
  if ((kind === 'A' || kind === 'L') && layerLandUse(c)) return none('Nền sử dụng đất — đã lấy từ bản đồ sử dụng đất');
  if (/sodo|ghepmanh|luoito?a?do|^level/.test(c)) return none('Sơ đồ ghép mảnh / lưới — không phải dữ liệu GIS');
  return unknown('Chưa nhận ra — hãy chọn lớp nếu layer có dữ liệu');
}
