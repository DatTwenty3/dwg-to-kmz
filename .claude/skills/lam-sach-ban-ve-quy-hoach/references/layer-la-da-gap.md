# Layer tên lạ đã gặp — nó là gì, quyết định thế nào

Rút từ các hồ sơ thật (xã Long Hiệp, Đôn Châu, **Lưu Nghiệp Anh**, Vĩnh Long). Tên layer của mỗi văn phòng một kiểu; **tên chỉ là gợi ý, hình vẽ mới nói thật**. Cột "Cách biết" là cách đã dùng để chắc chắn — luôn **phóng to xem** (`references/so-sanh-voi-ban-goc.md`) thay vì đoán theo tên. Một quyết định ghi vào `quyet-dinh.json` (`references/quyet-dinh.md`); ví dụ trọn bộ: `vi-du-quyet-dinh-luu-nghiep-anh.json`.

## Quy tắc mặc định đã sai (đã gặp)
| Layer | Quy tắc đoán | Thực chất | Cách biết | Quyết định |
|---|---|---|---|---|
| `MO_MA` (3.612 nét đỏ khép kín) | viền thửa `BV_Vienthua` / `XEM_` | **mồ mả** (hình vòm nhỏ có gạch chân) | phóng to: ký hiệu nhỏ rải rác, không tạo thành thửa | `NEN_Diahinh_Moma` |
| `KS-GHICHU` (5.395 chữ trắng) | rác khảo sát → bỏ | **nhãn loại đất từng khoanh** ("CÂY DỪA", "RUỘNG LÚA", "AO"…) + tên đường/cầu/công trình | quét chữ (`CMP_MODE=scan`): nội dung là loại cây/đất | giữ → `BV_Chu_Chucnang` (⚠). Đây là thông tin phân loại duy nhất của bản đồ hiện trạng khảo sát |
| `DUONG_DIEN` | viền thửa (hiện trạng sdd) / ✔ đường dây (hạ tầng) | **cột điện + hướng đường dây** (vòng tròn có mũi tên hai bên) | phóng to | `HTKT_CD_Duongday` (⚠ chưa rõ cấp điện áp) ở mọi bản đồ |
| `CAODO` (1.584 chữ số "2,59") | `BV_Chu_Chucnang` | **cao độ điểm đo** — nền địa hình | số thập phân rải theo điểm `DIEM` | `NEN_Diahinh_Caodo` |
| `SONG_HO` | viền thửa | mép bờ sông/kênh (đường dọc kênh) | tổng quan: chạy theo kênh, sông Hậu | `NEN_Diahinh_Songho` |
| `ranh_thuc_vat` | viền thửa / tuyến thoát nước mưa | ranh thực vật khảo sát | tên + ltype `RANH` | `NEN_Diahinh_Ranhthucvat` |
| `MUONG AO` | viền thửa (sdd) / **tuyến thoát nước mưa** (hạ tầng) | **bờ ao, mương** (đa giác nhỏ, nhãn "AO") | phóng to | sdd: để mặc định; hạ tầng: `NEN_Diahinh_Muongao` — không phải mạng thoát nước |
| `KH` | viền thửa + vùng lúa / nhà | mảnh nhỏ rời rạc | tổng quan: chấm lẻ tẻ khắp xã | `NEN_Diahinh_Kh` (⚠) |
| `Level 10/35/44` (DGN) | viền thửa | đoạn nét ngắn (1–5 m) rải rác | tổng quan: vạch lẻ | bỏ |
| `K.WS-Pipe` | `XEM_` | vài ký hiệu lạc, không có tuyến ống | tổng quan: chấm nhỏ | bỏ |
| `tram bien ap` (QH cấp điện) | bỏ "nét viền ký hiệu" | **trạm biến áp vẽ bằng nét** (tam giác), không có điểm/hatch | ảnh: tam giác đỏ dọc đường dây | `HTKT_CD_Trambienap` |
| `tt` (ltype `DDXDM22kv`) | `HTKT_CD_Duongday` ⚠ | đường dây trung thế **22 kV** xây mới (tên kiểu nét nói cấp điện áp) | tên LTYPE | `HTKT_CD_Duongday22kV` (giữ kiểu nét) |
| `-0-gt-cau` | `XEM_` | **cầu** lớn (hai nét song song có vạch ngang, Cầu Đại Ngãi) | ảnh | `HTKT_GT_Cau` |
| `CAU BE TONG` (bản đồ hiện trạng sdd) | `XEM_` | cầu bê tông | tên + nét ngắn | `HTKT_GT_Cau` (chỉ nét) |
| `TRU PHAT SONG` | `BV_Chu_Chucnang` | chữ "trụ phát sóng" | quét chữ | `HTKT_TTLL_Ghichu` |
| `kh UBND` (bản đồ giao thông / định hướng) | `XEM_` | vùng UBND — đã có ở bản đồ sdd | nội dung lặp | bỏ ở bản đồ hạ tầng/định hướng; giữ ở sdd (→ `DAT_KXD_Dichvucongcong`) |
| `BV_Rg_Lapquyhoach` | `BV_Vienthua` / `XEM_` / hoặc bỏ | **ranh lập quy hoạch** (rộng 5 m, kiểu nét chấm tròn) | tên đúng chuẩn | **giữ nét gốc** → `BV_Rg_lapquyhoach` (xem mục "Ranh") |

## Layer đã đúng mặc định nhưng dễ nghi
| Layer | Là gì | Ghi chú |
|---|---|---|
| `KYHIEU` (24.489 = 12.764 hatch + 12.524 nét), `PLAN-NOTE` (8.754) | **ký hiệu cây khảo sát** (cây dừa, cây lúa) | bỏ — đúng. Đã phóng to để chắc |
| `ky hieu cac cong trinh chuc nang` | **mũi tên + vòng tròn hướng tuyến** ("ĐI XÃ …") ở đầu đường, ngay ngoài ranh | giữ → `KYHIEU_Congtrinh` (⚠), đừng bỏ vì "ngoài ranh" |
| `KH-mc` (345 nét hồng rộng 8 m) | **ký hiệu mặt cắt** trên bản đồ giao thông | bỏ — đúng |
| `HT_Nuoc mua_Ho ga` (21.050) | hố ga thoát nước mưa (hatch + nét viền) | giữ hatch → `CongTrinhCBKT_P`; nét viền ký hiệu bỏ |
| `Defpoints` cạnh `HT_Nuoc THAI_Ho ga` | điểm trùng với hố ga nước thải | bỏ — đúng |
| `HT_DAT_*`, `QHDD_DAT_*`, `NTM-*`, `DAT_XD_ONT` | vùng đất (tiền tố hiện trạng / quy hoạch / nông thôn mới) | tin màu ACI; trên bản đồ **giao thông/hạ tầng/định hướng** chúng là nền lặp → bỏ (đất lấy từ bản đồ sdd) |
| `HTKT_GT_Duong hien trang mo rong` | đường (rộng 4–40 m, nét DASHED đen–trắng) | giữ nguyên độ rộng + kiểu nét |
| `HKTK - he duong` | chỉ giới / hè đường (nét mảnh xanh hai bên) | → `HTKT_GT_Heduong` |
| `D-QuocLo` (một nửa nằm ngoài ranh) | quốc lộ | giữ cả đoạn ngoài ranh sát ranh (≤ 10 % khung ranh) |

## Vùng tô dễ hiểu nhầm
- **Một hatch phủ cả xã** (`DAT_Tronglua`, 1 vùng 5.000+ ha, màu 3 xanh lá) trên bản đồ hiện trạng khảo sát: là **nền màu**, không phải ranh đất lúa thật. Loại đất thật nằm ở nhãn trên từng khoanh. Giữ (⚠) nhưng nói rõ cho người dùng; web app sẽ ra một vùng lúa to bằng cả xã cho tới khi họ tự đổi trong bảng ghép.
- **Bản đồ hiện trạng khảo sát chưa chuyển được thành vùng đất từng khoanh** (nhãn nằm trong viền thửa, công cụ chưa gán nhãn → vùng). Ghi vào "những gì chưa làm được" khi bàn giao.
- **Bản đồ giao thông/hạ tầng/định hướng** bỏ vùng đất + kênh sông (xanh dương) vì đã có ở bản đồ sdd — ảnh xem trước sẽ *trắng hơn bản gốc*. Đó là chủ ý; nói với người dùng và hỏi nếu họ muốn giữ làm nền.

## Ranh (đã sai một lần — đọc kỹ)
1. Bản gốc: **một polyline hở ~1.000 điểm**, rộng 5 m, kiểu nét `QH_Ranh giới lập quy hoạch` (đường liền + chấm tròn đỏ lớn — ký tự `l` của Wingdings), tỷ lệ nét 50, thường hở vài chục–trăm mét do người vẽ. Cạnh đó thường có một đoạn 2 điểm là **mẫu trong chú giải** (nằm ngoài ranh).
2. **Đừng `drop` layer ranh.** Làm vậy công cụ vẽ lại một ranh đơn giản (mảnh, không chấm) và người dùng thấy "mất ký hiệu ranh". Dùng `keep` → `BV_Rg_lapquyhoach` để giữ nguyên nét.
3. Ranh hở < 2 % chiều dài được **khép lại** (để web app nhận là vùng `RanhGioiQuyHoach_A`); bề rộng, kiểu nét, tỷ lệ nét giữ nguyên. Nếu để hở, web app báo `BV_Rg_lapquyhoach` là layer chưa nhận ra ở một số bản đồ.
4. Bản đồ không có ranh riêng (cấp điện, nước, TTLL… chỉ có mẫu chú giải) thì công cụ vẽ ranh chung với **cùng nét** (rộng 5, kiểu chấm tròn, tỷ lệ 50).
5. Ảnh xem trước (`previewSvg`) vẽ chấm tròn như AutoCAD. DXF ghi LTYPE phức hợp (chữ `●` Arial thay `l` Wingdings, đã bù cỡ và độ dời); AutoCAD mở/lưu DWG giữ nguyên định nghĩa — đã đối chiếu từng phần tử.
