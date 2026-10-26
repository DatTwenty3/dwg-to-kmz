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

## Thêm từ hồ sơ Long Hiệp (hạ tầng hiện trạng khảo sát, 1,4 triệu đối tượng)
Bản đồ hiện trạng hạ tầng của Long Hiệp nằm trong **xref khảo sát** (`xref KSHT XA LONG HIEP…dwg`: 1.368.496 nét ký hiệu cây + nhà + đường + điện…). Trong `quyet-dinh.json`, layer của nó ghi `"drawing": "xref KSHT"`. Mẫu trọn bộ: `vi-du-quyet-dinh-long-hiep.json`.

| Layer | Quy tắc đoán | Thực chất | Cách biết | Quyết định |
|---|---|---|---|---|
| `KS_MO_XAY_TUONG_DAI` (568 nét) | rác khảo sát → bỏ | **mộ xây** (cụm hình chữ nhật nhỏ có dấu `+`, rải ở nghĩa địa) | phóng to quanh layer (`CMP_MODE=zoom`) | `NEN_Diahinh_Moma` (⚠) |
| `TUONG_RAO_RANH` (1.466) | "tường rào — không có lớp" → bỏ | tường/hàng rào (ltype `TUONG`, `RANH`, `FENCELINE2`) | tên + kiểu nét | `NEN_Diahinh_Tuongrao` — nền đo đạc, đừng bỏ |
| `GA_CONG_THOATNUOC` (31 nét + 2 chữ) | `HTKT_CN_Ongcapnuoc` (vì có "cong") | **cống thoát nước** (Cống Trà Sất, cống Rạch Bần) | chữ trong layer | nét → `HTKT_TN_Tuyen_Nuocmua` (⚠), chữ → `HTKT_TN_Ghichu` |
| `MUONG_AO` (1.251 nét, hạ tầng) | `HTKT_TN_Tuyen_Nuocmua` | **bờ ao/mương** (đa giác nhỏ nhãn "AO") | phóng to | hạ tầng: `NEN_Diahinh_Muongao`; bản đồ sdd: để mặc định (viền thửa + `DAT_NNK_Songsuoi`) |
| `RANHGIOI KHAO SAT` (ltype `RANHKHAOSAT`, rộng 3) | `HTKT_TN_Tuyen_Nuocmua` | ranh khảo sát | tên | `NEN_Diahinh_Ranhkhaosat` |
| `NEN_BETONG`, `KE_BETONG` | bỏ ("sân/nền/kè bê tông, không phải đường") | chi tiết đo đạc (sân, kè) | hình khép kín nhỏ | `NEN_Diahinh_Nenbetong` / `Kebetong` — giữ làm nền thay vì bỏ |
| `TRU PHAT SONG` (91 nét + 13 chữ) | `BV_Chu_Chucnang` (chữ), nét bị bỏ như nền sdd | ký hiệu **trụ phát sóng** | chữ "trụ phát sóng" | nét → `HTKT_TTLL_Congtrinh` (⚠), chữ → `HTKT_TTLL_Ghichu` |
| `KS_GHICHU` (10.019 chữ; **ở bản đồ hạ tầng cũng vậy**) | rác → bỏ | nhãn từng khoanh ("RUỘNG LÚA" 4.502, "AO", "HOA MÀU", "CÂY TẠP"…) **và tên đường/cầu** ("HL25 (ĐƯỜNG NHỰA)", "ĐH36", "ĐƯỜNG BÊ TÔNG BA TRẠCH") | `CMP_MODE=scan` | giữ chữ → `BV_Chu_Chucnang` (⚠): bản đồ sdd cần nhãn, web app cần tên đường để đặt `tenDuong` |
| `E` (QH cấp điện, ltype `DDXDM22kv`) | `HTKT_CD_Duongday` (không rõ cấp) | đường dây 22 kV xây mới | tên LTYPE | `HTKT_CD_Duongday22kV` |
| `QHDD_DAT_XD_Chucnangkhac` (nét rộng 15 m, ltype `( Hidden )`) | đường (nét rộng ≥ 8 m trên layer đất) | **viền chấm của vùng đất vẽ đậm**, không phải đường | ltype `Hidden`, đi quanh vùng | quy tắc đã sửa: nét rộng kiểu `Hidden` trên layer đất là `BV_Vienthua` |
| **`QH_Ranh giới huyện`** (ltype `QH_Ranh giới lập quy hoạch`, rộng 5) | `BV_Rg_capcoso` ⚠ | một ranh **khác** ranh lập quy hoạch của bản đồ (971 đỉnh 6.641 ha ≠ 873 đỉnh 6.516 ha) dù cùng kiểu nét | tính diện tích hai vòng (xem dưới) | giữ nét gốc làm `BV_Rg_capcoso`; **đừng** `keep` nó về `BV_Rg_lapquyhoach` — bản hạ tầng sẽ có ranh sai và không được tạo ranh chuẩn |

### Cách xác định "đây có phải ranh lập quy hoạch không"
Layer ranh đặt tên sai hoặc hai layer cùng kiểu nét ranh: tính **số đỉnh và diện tích** từng vòng (shoelace) rồi so với ranh web app nhận ra (`BAO_CAO.md`, "Ranh nhận ra: … ha"). Vòng trùng diện tích (± vài %) mới là ranh lập quy hoạch; vòng khác diện tích là ranh khác — giữ nét gốc, đặt đúng loại. Bản đồ nào cũng phải có đúng một ranh lập quy hoạch trong bản sạch (nếu bản đồ không có thì công cụ tự vẽ với nét chuẩn).

### Bản đồ hiện trạng khảo sát khổng lồ
- Hàng triệu nét ký hiệu cây (`KYHIEU`, `PLAN-NOTE`) → bỏ, công cụ chạy vẫn mất ~2 phút; ảnh `*_so-sanh.png` tự lược nét ngắn (giữ mọi hatch và chữ).
- Phần lớn đối tượng giữ lại là nền (`NEN_*`: bờ đất, nhà bán kiên cố/nhà tạm là `KTCQ_*`) — đừng lo con số lớn.

## Chữ, ký hiệu mất ở bản sạch (Long Hiệp, 10/2026 — người dùng so ảnh gốc/sạch và thấy thiếu)
| Thấy trong ảnh | Nguyên nhân | Đã sửa thế nào (`cleanCad.ts`) | Cách kiểm |
|---|---|---|---|
| Mất tên **"CAO TỐC TRÀ VINH - HỒNG NGỰ"** | chữ nằm ngoài ranh; công cụ chỉ giữ ngoại lệ cho biển số tuyến | chữ có dạng tên đường (`Đường…`, `Cao tốc`, `Quốc lộ`, `Tỉnh lộ`, `Hương lộ`, `ĐT.`, `QL.`) nằm **dọc** một tuyến đường đã giữ (song song ≤ 30°, cách ≤ 4 × cao chữ + nửa bề rộng nét, tối thiểu 25 m) và trong khung ranh nới 10 % → `HTKT_GT_Tenduong`. Nhãn đứng một mình ("HƯỚNG ĐI XÃ NHỊ TRƯỜNG") vẫn bỏ — theo quyết định của chủ dự án | cổng đếm `chữ tên đường` |
| Mất nhãn **"QL60" / "QL54"** cao 60 m trên layer `0` | layer `0` là rác; nhãn lại là tên quốc lộ | `HIGHWAY_LABEL` (`QL|ĐT|ĐH|HL|TL` + 1–3 số) cao ≥ 20 m coi như biển số tuyến → `HTKT_GT_Kyhieutuyen` (Lưu Nghiệp Anh) | cổng đếm tên đường |
| **Trạm biến áp** (QH cấp điện) chỉ còn tam giác nhỏ, mất khung vuông + nét cong | layer `dien tram` (120 nét) bị bỏ "nét viền ký hiệu — dữ liệu lấy từ hatch" | giữ nét viền ở `KYHIEU_Congtrinh_Trambienap` / `_Hoga` (chỉ để bản vẽ giống gốc; **không thành dữ liệu GIS**, hatch vẫn là nguồn của `CongTrinhCapDien_P`) | so ảnh phóng to ở một trạm |
| **Bưu điện** (QH TTLL) chỉ còn chữ, mất ô vuông ký hiệu | ký hiệu vẽ trên layer **`AUDIT_D_…`** (AutoCAD đặt khi chạy lệnh AUDIT sửa lỗi) — layer đó bị coi là rác | trên bản đồ hạ tầng (`ROLE_PREFIX`), nét + vùng của `AUDIT_*` → `KYHIEU_Congtrinh_<CD|CN|TN|TTLL>`; **thêm 1 POINT** ở tâm mỗi ký hiệu (gộp các mảnh cách nhau ≤ 10 m) → `HTKT_<…>_Congtrinh`, web app nhận là `CongTrinh…_P` | cổng + ảnh |
| **Khung hình thoi quanh biển số** (914C, 915C) mất — người dùng chỉ ra "thiếu cái viền ở ngoài" | khung là nét khép kín 4 đỉnh, rộng 5 m, **266 m ngang** (hình vuông 188 m xoay 45°), layer **`KYHIEU`** (rác theo quy tắc); lần sửa đầu đặt ngưỡng 150 m nên vẫn mất | nét khép kín ≤ 8 đỉnh, cạnh 20–400 m, **biển số nằm giữa khung** (lệch ≤ 30 % bề rộng) → `KYHIEU_Congtrinh_Bienso`. Đừng đoán ngưỡng: **đo khung thật** (đỉnh, kích thước, layer) trước khi đặt | so ảnh phóng to ở **mỗi loại** biển số (911, 914B, 915C), không chỉ một cái |
| `.dxf` của QH_09 **AutoCAD không mở** ("Error in APPID Table / line 546") | kiểu nét cáp thông tin có chữ `^` — DXF coi `^` là mã điều khiển (`^J`) | `toDxf` ghi `^` thành `^ ` (dấu cách); bộ đọc DXF đổi lại | `verify-dxf-autocad.ps1` cho **cả 9 tệp**, không chỉ vài tệp |

### Hỏi "chuyển ký hiệu thành block để web app nhận 1 điểm được không?"
Hiện bộ đọc **luôn nổ block** thành nét + hatch; điểm chỉ sinh từ POINT, từ tâm vùng khép kín trên layer đã nhận ra, hoặc từ chữ. INSERT **không** thành điểm. Chọn cách A (đã làm): giữ ký hiệu nguyên nét/hatch cho đẹp + thêm POINT ở tâm; web app đọc POINT sẵn. Cách B (block thật, INSERT → điểm) cần sửa bộ đọc/IR và test — chỉ làm khi người dùng cần sửa từng ký hiệu như một đối tượng trong AutoCAD.
