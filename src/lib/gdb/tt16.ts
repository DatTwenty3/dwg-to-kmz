// Thông tư 16/2025/TT-BXD (30/6/2025), Phụ lục II — cơ sở dữ liệu số địa lý (HoSoGIS) của đồ án quy hoạch.
//   Phần 1 mục 3: HoSoGIS gồm HienTrang.*, QuyHoach.*, NenDiaHinh.*, MocGioi.* (*.gdb, *.gpkg…) + <Tên ĐAQH>.**
//                 (** = *.aprx, *.ppkx, *.mxd, *.mpk, *.qgz…).
//   Phần 1 mục 6b: tên nhóm (Feature Dataset) = tiếng Việt không dấu, viết liền, hoa chữ cái đầu mỗi từ;
//                 tên lớp (Feature Class) = <Lớp dữ liệu>_<A|P|L> (A vùng, P điểm, L đường).
//   Phần 2: các nhóm dữ liệu chuyên đề của từng CSDL (bắt buộc: 14 hiện trạng, 14 quy hoạch, 1 mốc giới).
//   Phần 3: danh sách lớp dữ liệu — "nội dung tham khảo" (đồ án chỉ có các lớp liên quan; lớp phát sinh
//           được tạo mới theo nguyên tắc đặt tên).
//   Phần 3 (4): trường thuộc tính tối thiểu của mọi lớp.
// Tên trong bảng của Thông tư có vài chỗ không đúng chính quy viết hoa (`ThietkeDoThi`, `CongtrinhCapNuocPCCC_P`,
// `DanhGiaHienTrangDatXaydung` khi xuống dòng) — so khớp không phân biệt hoa/thường, khác chữ hoa chỉ là lưu ý.

export type GeomCode = 'A' | 'P' | 'L';

export interface Tt16Class {
  name: string;
  alias: string;
}

export interface Tt16Dataset {
  name: string;
  /** Chuyên đề (tên đầy đủ). */
  title: string;
  classes: Tt16Class[];
}

export interface Tt16Database {
  /** Tên file không đuôi: HienTrang, QuyHoach, NenDiaHinh, MocGioi. */
  name: string;
  title: string;
  /** Rỗng với NenDiaHinh (theo CSDL nền của ngành Nông nghiệp & Môi trường, chỉ kiểm tra nguyên tắc). */
  datasets: Tt16Dataset[];
}

export interface Tt16Field {
  name: string;
  alias: string;
  length: number;
  /** Bắt buộc có giá trị (mã hồ sơ, mã thông tin quy hoạch). */
  valueRequired: boolean;
}

const c = (name: string, alias: string): Tt16Class => ({ name, alias });
const d = (name: string, title: string, classes: Tt16Class[]): Tt16Dataset => ({ name, title, classes });

const VI_TRI_RANH_GIOI = (): Tt16Dataset =>
  d('ViTriRanhGioi', 'Vị trí ranh giới', [
    c('TenDonViHanhChinh_P', 'Tên đơn vị hành chính'),
    c('RanhGioiHanhChinh_L', 'Ranh giới hành chính'),
    c('RanhGioiQuyHoach_A', 'Ranh giới quy hoạch'),
  ]);

const GIAO_THONG_COMMON = [
  c('CongTrinhGiaoThong_P', 'Công trình giao thông dạng điểm'),
  c('CongTrinhGiaoThong_L', 'Công trình giao thông dạng đường'),
  c('CongTrinhGiaoThong_A', 'Công trình giao thông dạng vùng'),
  c('MangLuoiGiaoThongDuongBo_L', 'Mạng lưới giao thông đường bộ dạng đường (tim đường)'),
  c('MangLuoiGiaoThongDuongBo_A', 'Mạng lưới giao thông đường bộ dạng vùng'),
  c('MangLuoiGiaoThongDuongSat_L', 'Mạng lưới giao thông đường sắt'),
  c('MangLuoiGiaoThongDuongThuy_L', 'Mạng lưới giao thông đường thủy'),
  c('MangLuoiGiaoThongDuongKhong_L', 'Mạng lưới giao thông đường không'),
  c('MangLuoiTuyenBus_L', 'Mạng lưới tuyến Bus'),
  c('BoViaDaiPhanCach_L', 'Bó vỉa và dải phân cách'),
  c('HuongDi_L', 'Hướng đi'),
  c('MatCatNgang_L', 'Mặt cắt ngang'),
];

const CHI_GIOI = [
  c('ChiGioiXayDung_L', 'Chỉ giới xây dựng'),
  c('ChiGioiDuongDo_L', 'Chỉ giới đường đỏ'),
  c('HanhLangAnToan_L', 'Hành lang an toàn'),
];

const CBKT_CONG_TRINH = [
  c('CongTrinhCBKT_P', 'Công trình chuẩn bị kỹ thuật dạng điểm'),
  c('CongTrinhCBKT_L', 'Công trình chuẩn bị kỹ thuật dạng đường'),
  c('CongTrinhCBKT_A', 'Công trình chuẩn bị kỹ thuật dạng vùng'),
  c('MangLuoiThoatNuocMua_L', 'Mạng lưới thoát nước mưa'),
  c('CaoDoCongTNM_P', 'Cao độ cống thoát nước mưa'),
  c('HuongThoatNuocMua_L', 'Hướng thoát nước mưa'),
  c('MatNuoc_A', 'Mặt nước'),
  c('PhanLuuThoatNuocMua_L', 'Phân lưu thoát nước mưa'),
  c('PhanVungLuuVuc_A', 'Phân vùng lưu vực'),
];

const TNT_CONG_TRINH = [
  c('CongTrinhTNTvaVSMT_P', 'Công trình thoát nước thải và vệ sinh môi trường dạng điểm'),
  c('CongTrinhTNTvaVSMT_L', 'Công trình thoát nước thải và vệ sinh môi trường dạng đường'),
  c('CongTrinhTNTvaVSMT_A', 'Công trình thoát nước thải và vệ sinh môi trường dạng vùng'),
];

const TNT_MANG_LUOI = [
  c('CaoDoCongThoatTNT_P', 'Cao độ cống thoát nước thải'),
  c('MangLuoiThoatNuocThai_L', 'Mạng lưới thoát nước thải'),
  c('HuongThoatNuocThai_L', 'Hướng thoát nước thải'),
  c('PhanLuuThoatNuocThai_L', 'Phân lưu thoát nước'),
];

const CAP_NUOC = [
  c('MangLuoiCapNuoc_L', 'Mạng lưới cấp nước'),
  c('DiemDauNoi_P', 'Điểm đấu nối'),
  c('PhanVungCapNuoc_A', 'Phân vùng cấp nước'),
  c('CongTrinhCapNuocPCCC_P', 'Công trình cấp nước PCCC dạng điểm'),
  c('CongTrinhCapNuocPCCC_A', 'Công trình cấp nước PCCC dạng vùng'),
];

const CAP_DIEN = [
  c('MangLuoiPhanPhoiDien_L', 'Mạng lưới phân phối điện'),
  c('MangLuoiChieuSang_L', 'Mạng lưới chiếu sáng'),
  c('CongTrinhCapDien_P', 'Công trình cấp điện dạng điểm'),
  c('CongTrinhCapDien_A', 'Công trình cấp điện dạng vùng'),
  c('CongTrinhChieuSang_P', 'Công trình chiếu sáng'),
  c('PhanVungCapDien_A', 'Phân vùng cấp điện'),
];

const THONG_TIN = [
  c('MangLuoiCapThongTin_L', 'Mạng lưới cáp thông tin'),
  c('CongTrinhThongTin_P', 'Công trình thông tin dạng điểm'),
  c('CongTrinhThongTin_A', 'Công trình thông tin dạng vùng'),
  c('PhanVungPhucVu_A', 'Phân vùng phục vụ'),
];

const NGAM = [
  c('CongTrinhNgam_A', 'Công trình ngầm dạng vùng'),
  c('CongTrinhNgam_L', 'Công trình ngầm dạng đường'),
  c('CongTrinhNgam_P', 'Công trình ngầm dạng điểm'),
];

const NANG_LUONG = [
  c('MangLuoiNangLuong_L', 'Mạng lưới năng lượng'),
  c('CongTrinhNangLuong_P', 'Công trình năng lượng dạng điểm'),
  c('CongTrinhNangLuong_A', 'Công trình năng lượng dạng vùng'),
];

export const TT16_DATABASES: Tt16Database[] = [
  {
    name: 'HienTrang',
    title: 'Cơ sở dữ liệu hiện trạng',
    datasets: [
      VI_TRI_RANH_GIOI(),
      d('HienTrangSuDungDat', 'Hiện trạng sử dụng đất', [
        c('ChucNangCongTrinh_P', 'Chức năng công trình'),
        c('ChucNangSuDungDat_A', 'Chức năng sử dụng đất'),
        c('PhanVungSDDkhac_A', 'Phân vùng sử dụng đất khác'),
      ]),
      d('HienTrangKhongGianKienTrucCanhQuan', 'Hiện trạng không gian kiến trúc cảnh quan', [
        c('CongTrinh_A', 'Hiện trạng công trình dạng vùng'),
        c('CongTrinh_L', 'Hiện trạng công trình dạng đường'),
      ]),
      d('DanhGiaHienTrangDatXayDung', 'Đánh giá hiện trạng đất xây dựng', [
        c('DuAnLienQuan_A', 'Dự án liên quan'),
        c('PhanVungDanhGia_A', 'Phân vùng đánh giá'),
      ]),
      d('HienTrangGiaoThong', 'Hiện trạng giao thông', GIAO_THONG_COMMON),
      d('HienTrangCGDD_CGXDHanhLangHTKT', 'Hiện trạng chỉ giới đường đỏ, chỉ giới xây dựng, hành lang hạ tầng kỹ thuật', CHI_GIOI),
      d('HienTrangChuanBiKyThuat', 'Hiện trạng chuẩn bị kỹ thuật', [c('CaoDoNen_P', 'Cao độ nền'), ...CBKT_CONG_TRINH]),
      d('HienTrangThoatNuocThaiVSMT', 'Hiện trạng thoát nước thải và vệ sinh môi trường', [...TNT_MANG_LUOI, ...TNT_CONG_TRINH]),
      d('HienTrangCapNuoc', 'Hiện trạng cấp nước', CAP_NUOC),
      d('HienTrangCapDien', 'Hiện trạng cấp điện', CAP_DIEN),
      d('HienTrangThongTinLienLac', 'Hiện trạng thông tin liên lạc', THONG_TIN),
      d('DanhGiaHienTrangMoiTruong', 'Đánh giá hiện trạng môi trường', [
        c('DanhGiaMoiTruong_P', 'Đánh giá môi trường dạng điểm'),
        c('DanhGiaMoiTruong_L', 'Đánh giá môi trường dạng đường'),
        c('DanhGiaMoiTruong_A', 'Đánh giá môi trường dạng vùng'),
        c('DiemQuanTrac_P', 'Điểm quan trắc'),
      ]),
      d('HienTrangCongTrinhNgam', 'Hiện trạng công trình ngầm', NGAM),
      d('HienTrangNangLuong', 'Hiện trạng năng lượng', NANG_LUONG),
    ],
  },
  {
    name: 'QuyHoach',
    title: 'Cơ sở dữ liệu quy hoạch',
    datasets: [
      VI_TRI_RANH_GIOI(),
      d('QuyHoachSuDungDat', 'Quy hoạch sử dụng đất', [
        c('ChucNangCongTrinh_P', 'Chức năng công trình'),
        c('ChucNangSuDungDat_A', 'Chức năng sử dụng đất'),
        c('PhanOQuyHoach_A', 'Phân ô quy hoạch'),
        c('PhanKhuQuyHoach_A', 'Phân khu quy hoạch'),
        c('PhanVungSDDkhac_A', 'Phân vùng sử dụng đất khác'),
      ]),
      d('ThietKeDoThi', 'Thiết kế đô thị', [
        c('DiemNhanChinh_P', 'Điểm nhấn chính'),
        c('TuyenTKDT_L', 'Tuyến thiết kế đô thị'),
        c('KhuVucPhoiCanh_A', 'Khu vực dựng phối cảnh'),
      ]),
      d('QuyHoachKhongGianKienTrucCanhQuan', 'Quy hoạch không gian kiến trúc cảnh quan', [
        c('CongTrinh_A', 'Quy hoạch công trình dạng vùng'),
        c('CongTrinh_L', 'Quy hoạch công trình dạng đường'),
        c('KhongGianKTCQ_A', 'Không gian kiến trúc cảnh quan dạng vùng'),
        c('KhongGianKTCQ_L', 'Không gian kiến trúc cảnh quan dạng đường'),
        c('CayXanh_P', 'Cây xanh dạng điểm'),
      ]),
      d('QuyHoachGiaoThong', 'Quy hoạch giao thông', [
        ...GIAO_THONG_COMMON,
        c('DiemToaDoTimDuongChuyenHuongTimDuong_P', 'Điểm tọa độ tim đường, điểm chuyển hướng tim đường'),
        c('BanKinhBoViaBanKinhTimDuong_P', 'Bán kính bó vỉa, bán kính tim đường'),
      ]),
      d('QuyHoachCGDD_CGXDHanhLangHTKT', 'Quy hoạch chỉ giới đường đỏ, chỉ giới xây dựng, hành lang hạ tầng kỹ thuật', CHI_GIOI),
      d('QuyHoachChuanBiKyThuat', 'Quy hoạch chuẩn bị kỹ thuật', [
        c('CaoDoNen_P', 'Cao độ nền'),
        c('DongMucThietKe_L', 'Đồng mức thiết kế'),
        c('ThongTinSanNen_P', 'Thông tin san nền dạng điểm'),
        c('PhanVungSanNen_A', 'Phân vùng san nền'),
        ...CBKT_CONG_TRINH,
      ]),
      d('QuyHoachThoatNuocThaiVSMT', 'Quy hoạch thoát nước thải và vệ sinh môi trường', [
        ...TNT_MANG_LUOI,
        c('NutTinhToanTNT_P', 'Nút tính toán thoát nước thải'),
        ...TNT_CONG_TRINH,
      ]),
      d('QuyHoachCapNuoc', 'Quy hoạch cấp nước', CAP_NUOC),
      d('QuyHoachCapDien', 'Quy hoạch cấp điện', CAP_DIEN),
      d('QuyHoachThongTinLienLac', 'Quy hoạch thông tin liên lạc', THONG_TIN),
      d('GiaiPhapBaoVeMoiTruong', 'Giải pháp bảo vệ môi trường', [
        c('GiaiPhapBaoVeMoiTruong_P', 'Giải pháp bảo vệ môi trường dạng điểm'),
        c('GiaiPhapBaoVeMoiTruong_L', 'Giải pháp bảo vệ môi trường dạng đường'),
        c('GiaiPhapBaoVeMoiTruong_A', 'Giải pháp bảo vệ môi trường dạng vùng'),
        c('DiemQuanTrac_P', 'Điểm quan trắc'),
      ]),
      d('QuyHoachCongTrinhNgam', 'Quy hoạch công trình ngầm', NGAM),
      d('QuyHoachNangLuong', 'Quy hoạch năng lượng', NANG_LUONG),
    ],
  },
  { name: 'NenDiaHinh', title: 'Cơ sở dữ liệu nền địa hình', datasets: [] },
  {
    name: 'MocGioi',
    title: 'Cơ sở dữ liệu mốc giới quy hoạch',
    datasets: [
      d('MocGioiQuyHoach', 'Mốc giới quy hoạch', [
        c('MocGioiQuyHoach_P', 'Điểm mốc giới quy hoạch'),
        c('MocGioiQuyHoach_L', 'Tuyến mốc giới quy hoạch'),
        c('MocGioiQuyHoach_A', 'Vùng mốc giới quy hoạch'),
      ]),
    ],
  },
];

/** Phần 3 (4): trường thuộc tính tối thiểu (kiểu TEXT). */
export const TT16_FIELDS: Tt16Field[] = [
  { name: 'maThongTinQH', alias: 'Mã thông tin quy hoạch', length: 15, valueRequired: true },
  { name: 'maHoSoQH', alias: 'Mã hồ sơ quy hoạch', length: 15, valueRequired: true },
  { name: 'maDoiTuong', alias: 'Mã đối tượng', length: 100, valueRequired: false },
  { name: 'tenDoiTuong', alias: 'Tên đối tượng', length: 100, valueRequired: false },
  { name: 'phanLoai', alias: 'Phân loại', length: 250, valueRequired: false },
  { name: 'ghiChu', alias: 'Ghi chú', length: 250, valueRequired: false },
];

/** Tệp tổng hợp <Tên ĐAQH>.** trong HoSoGIS. */
export const TT16_PROJECT_EXT = ['aprx', 'ppkx', 'mxd', 'mpk', 'qgz'];

/** Mã ĐVHC cấp tỉnh của 34 tỉnh/thành từ 01/7/2025 (Nghị quyết 202/2025/QH15), dùng cho <Mã ĐVHC> của maHoSoQH. */
export const PROVINCE_CODES: Record<string, string> = {
  '01': 'Hà Nội',
  '04': 'Cao Bằng',
  '08': 'Tuyên Quang',
  '11': 'Điện Biên',
  '12': 'Lai Châu',
  '14': 'Sơn La',
  '15': 'Lào Cai',
  '19': 'Thái Nguyên',
  '20': 'Lạng Sơn',
  '22': 'Quảng Ninh',
  '24': 'Bắc Ninh',
  '25': 'Phú Thọ',
  '31': 'Hải Phòng',
  '33': 'Hưng Yên',
  '37': 'Ninh Bình',
  '38': 'Thanh Hóa',
  '40': 'Nghệ An',
  '42': 'Hà Tĩnh',
  '44': 'Quảng Trị',
  '46': 'Huế',
  '48': 'Đà Nẵng',
  '51': 'Quảng Ngãi',
  '52': 'Gia Lai',
  '56': 'Khánh Hòa',
  '66': 'Đắk Lắk',
  '68': 'Lâm Đồng',
  '75': 'Đồng Nai',
  '79': 'TP. Hồ Chí Minh',
  '80': 'Tây Ninh',
  '82': 'Đồng Tháp',
  '86': 'Vĩnh Long',
  '91': 'An Giang',
  '92': 'Cần Thơ',
  '96': 'Cà Mau',
};

/** Nhóm dữ liệu: tiếng Việt không dấu, viết liền, hoa chữ đầu mỗi từ (cho phép `_` như `HienTrangCGDD_CGXDHanhLangHTKT`). */
export const DATASET_NAME_RE = /^[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)*$/;
/** Lớp dữ liệu: <Lớp dữ liệu>_<A|P|L>. */
export const CLASS_NAME_RE = /^[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)*_[APL]$/;

export interface MaHoSoParts {
  province: string;
  provinceName: string | null;
  kind: 'QHC' | 'QPK' | 'QCT';
  overall: string;
  local: string;
  seq: string;
}

/** <Mã ĐVHC 2 số><QHC|QPK|QCT><x 1 số><xx 2 số><xxxx 4 số>, vd. 04QHC0010001. Null nếu sai mẫu. */
export function parseMaHoSo(v: string): MaHoSoParts | null {
  const m = /^(\d{2})(QHC|QPK|QCT)(\d)(\d{2})(\d{4})$/.exec(v.trim());
  if (!m) return null;
  return {
    province: m[1],
    provinceName: PROVINCE_CODES[m[1]] ?? null,
    kind: m[2] as MaHoSoParts['kind'],
    overall: m[3],
    local: m[4],
    seq: m[5],
  };
}

export interface MaThongTinParts {
  province: string;
  provinceName: string | null;
  /** Năm trình phê duyệt (20xx). */
  year: number;
  /** 1 chung · 2 phân khu · 3 chi tiết · 4 chi tiết rút gọn. */
  level: string;
  /** 1 đô thị · 2 nông thôn · 3 khu chức năng… */
  kind: string;
  /** 0 lập lần đầu · 1 điều chỉnh tổng thể · 2 điều chỉnh cục bộ. */
  adjust: string;
  serial: string;
}

const QH_LEVEL: Record<string, string> = { '1': 'QH chung', '2': 'QH phân khu', '3': 'QH chi tiết', '4': 'QH chi tiết rút gọn' };
const QH_KIND: Record<string, string> = { '1': 'đô thị', '2': 'nông thôn', '3': 'khu chức năng', '4': 'loại 4', '5': 'loại 5' };
const QH_ADJUST: Record<string, string> = { '0': 'lập lần đầu', '1': 'điều chỉnh tổng thể', '2': 'điều chỉnh cục bộ' };

/**
 * maThongTinQH — mã số thông tin về quy hoạch (Nghị định 111/2024/NĐ-CP, hướng dẫn tại Điều 4 Thông tư 24/2025/TT-BXD):
 * 12 chữ số <mã tỉnh 2><năm trình duyệt 2><cấp độ 1: 1–4><loại QH 1: 1–5><điều chỉnh 1: 0–2><5 số ngẫu nhiên>,
 * vd. 012511012345. Null nếu sai mẫu.
 */
export function parseMaThongTin(v: string): MaThongTinParts | null {
  const m = /^(\d{2})(\d{2})([1-4])([1-5])([0-2])(\d{5})$/.exec(v.trim());
  if (!m) return null;
  return { province: m[1], provinceName: PROVINCE_CODES[m[1]] ?? null, year: 2000 + Number(m[2]), level: m[3], kind: m[4], adjust: m[5], serial: m[6] };
}

/** "Hà Nội · 2025 · QH chung đô thị · lập lần đầu". */
export const describeMaThongTin = (p: MaThongTinParts) =>
  `${p.provinceName ?? `mã tỉnh ${p.province}`} · ${p.year} · ${QH_LEVEL[p.level]} ${QH_KIND[p.kind]} · ${QH_ADJUST[p.adjust]}`;
