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
3. Ranh hở < 2 % chiều dài **giữ hở như bản gốc** (chấm tròn, bề rộng, kiểu nét, khoảng hở — đếm chấm trong `.qgz` phải đúng bằng bản gốc: Lưu Nghiệp Anh 229). Web app tự đọc ranh hở là vùng `RanhGioiQuyHoach_A` (`nearlyClosedOutline` trong `geometry.ts`, dùng ở `findBoundary`, hàng bảng ghép và `buildFeatures`); trước đây bản sạch phải khép ranh vì web app báo layer chưa nhận ra, nay không cần nữa.
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

### Tên có trong bản vẽ sạch nhưng **không vào gdb** (Long Hiệp, người dùng mở HoSoGIS trong QGIS)
Cao tốc Trà Vinh – Hồng Ngự có nét + nhãn trong bản sạch, nhưng `tenDuong`/`tenDoiTuong` của tuyến để trống trong `QuyHoach.gdb` khi các đường khác (Đường 914B, N3…) đều có tên. Ba nguyên nhân chồng nhau ở web app (`roads.ts`, `features.ts` `nameRoads`):
1. `parseRoadText` không biết "Cao tốc …" → thêm hạng `caoToc` (miền giá trị TT16 có sẵn "Đường cao tốc" mã 1 ở cả `LoaiDuongBo` và `CapDuongBo`, HienTrang lẫn QuyHoach).
2. `nameRoads` bỏ mọi chữ nằm **ngoài ranh** (chỉ biển số tuyến được miễn) — nhãn cao tốc nằm ngoài ranh → cho phép chữ tên **cao tốc / quốc lộ / đường tỉnh** ngoài ranh đặt tên cho tuyến đi qua (chữ ghi chú/chú giải ngoài ranh vẫn bỏ vì phải song song và gần một tuyến GIS).
3. `textAlong` chỉ cho cách tim đường ≤ 2,5 × cao chữ (125 m), nhưng tuyến cao tốc vẽ **một nét rộng 60 m** và nhãn cách tim 178 m → `RoadText.reach` riêng (5 × cao chữ) cho các chữ ngoài ranh này.
**Bài học:** sau khi bản sạch có chữ/nét, kiểm tra tiếp **thuộc tính trong gdb** (`tenDuong`, `loaiDuong`, `capDuong`) chứ không chỉ việc chữ còn trong DXF. Cách nhanh: dựng `buildFeatures` trên thư mục sạch và in tên theo lớp `MangLuoiGiaoThongDuongBo_L` (so với thư mục gốc) — phải ra giống nhau, và tuyến cao tốc/quốc lộ/tỉnh phải có `loaiDuong`/`capDuong`.

### Vành quanh biển số/nhãn: **hình thoi VÀ hình tròn** (Lưu Nghiệp Anh "QL54", 10/2026)
Lần sửa trước chỉ nhận khung ≤ 8 đỉnh nên vòng tròn quanh nhãn quốc lộ lại mất: hình tròn đã được bộ đọc rã thành **65 đỉnh** (252 m, layer `KY HIEU`, tâm lệch chữ 20 m). Quy tắc nay: nét khép kín **≤ 70 đỉnh**, cạnh 20–400 m, **chữ/biển số nằm gần giữa** (lệch ≤ 30 % bề rộng) → `KYHIEU_Congtrinh_Bienso`. Đây là lần thứ ba cùng một loại lỗi (ngưỡng đặt theo **một** mẫu rồi mất mẫu khác) — khi người dùng báo "thiếu viền/vành", **liệt kê mọi khung quanh MỌI biển số/nhãn** của cả hồ sơ (số đỉnh, kích thước, layer, độ lệch tâm) rồi mới đặt ngưỡng; sau khi sửa so ảnh ở **từng loại** (thoi 911/914B/915C, tròn QL54/QL60).

## Thêm từ hồ sơ Đôn Châu (11/2026; mẫu `vi-du-quyet-dinh-don-chau.json`, `vi-du-chap-nhan-lech-don-chau.json`)
Hồ sơ cùng văn phòng với Long Hiệp / Lưu Nghiệp Anh nên nhiều layer khảo sát lặp lại — nhưng vẫn **phóng to xem** (`CMP_MODE=zoom`): vài layer ở đây khác.
| Layer | Quy tắc đoán | Thực chất | Cách biết | Quyết định |
|---|---|---|---|---|
| `KS_MO XAY_TUONG DAI` (5.128 nét) | rác khảo sát → bỏ | **mộ xây** (vòm bán nguyệt có gạch chân) | zoom quanh nghĩa địa/vườn | `NEN_Diahinh_Moma` (⚠) |
| `MUONG_AO` (3.636) | viền thửa (sdd) / thoát nước mưa (hạ tầng) | bờ ao/mương (đa giác lớn, 2.721 chữ "AO" ở KS_GHICHU) | zoom + quét chữ | `NEN_Diahinh_Muongao` mọi bản đồ — **quyết định không ghi tên bản vẽ** (layer nằm trong xref `xred HTHTKT`, `"drawing": "QH03"` không khớp) |
| `DUONG_DIEN` (5.429) + `block-kihieu` (816) | viền thửa / đường dây | cột điện + mũi tên hướng ("<<-o->>" dọc đường) | zoom dọc đường | `HTKT_CD_Duongday` (⚠, chưa rõ kV; chắc chắn không phải đường bộ) |
| `GA_CONG(THOATNUOC)` (24) | ống cấp nước (có "cong") | hố ga: ô vuông nhỏ có gạch chéo | zoom | `HTKT_TN_Hoga_Nuocmua` (web app nay đọc ô vuông đứng một mình là điểm) |
| `GHICHU` (486 chữ) | chữ chú thích | mã khảo sát: `dal2`, `nhua3`, `3dg`, `caubt` (loại mặt + bề rộng) | `CMP_MODE=scan` | bỏ |
| `KS_GHICHU` (8.479 chữ) | rác | nhãn từng khoanh (AO, RUỘNG LÚA, CÂY TẠP, ĐẤT TRỐNG…) + tên đường/cầu | scan | `BV_Chu_Chucnang` (⚠) |
| `KH` (588 hatch) | lúa | mảnh hatch 0,09 m² (tổng 0,03 ha) | thống kê diện tích hatch | `NEN_Diahinh_Kh` (⚠) — nhưng `HT_DAT_NN_Tronglua` (1.318 hatch, 1.286 ha) là thửa thật, đừng gộp |
| `DUONG NHUA` (1.360 **hatch**, rộng 13,5, kiểu Hidden) | đường nhựa | **thửa lúa** gắn nhầm layer (trung vị 0,34 ha; ở QH02 tô xanh lá) | thống kê diện tích hatch | QH02: để màu quyết (lúa); bản đồ hạ tầng (tô xám theo màu nền): bỏ |
| `EK22-11`, `EC22HH`, `E110-11` | `HTKT_CD_Duongday` ⚠ | đường dây 22 kV mới / 22 kV hiện hữu / 110 kV mới | **chữ trong kiểu nét** ("22KV", "110KV") + chú giải bản vẽ | không cần quyết định (cleaner đọc LTYPE) |
| `MBA QH` | đường dây + công trình | ký hiệu trạm biến áp 22/0,4 kV xây mới | chú giải | `HTKT_CD_Trambienap` |
| `0_XREF_DUYENHAI + TRACU` (6 nét) | `XEM_` / đường dây | ~80 m nét lạc của layer xref DGN | zoom | bỏ |
| `QHDD_DAT_KXD_Congnghiep`, `QHDH_DAT_NNK_Honuoc`, `QHDH_DAT_KXD_Dancunongthon` | viền thửa | **chỉ có đường viền** (không hatch) nhưng là vùng đất thật (khu công nghiệp 190 ha, hồ 66 ha) | so số vùng đất của bản đồ gốc với bản sạch | tự động: cleaner giữ layer đất tên `QHDD_…` |
| `QH_Ranh giới huyện` (rộng 5–15, kiểu nét ranh lập quy hoạch) | ranh huyện | **ranh lập quy hoạch** 5.909 ha | kiểu nét + diện tích | tự động (theo kiểu nét) |
| `BV_Rg_capxa` (3 đỉnh 87 m, rộng 20) | ranh xã | đoạn ranh xã ngắn sát ranh | zoom | giữ (ranh xã) |
Xref: `XRED_*` = xref; `NEN EXREF` / `RANH AP XREF` (tên không kiểu xref) được QH04/QH05 nạp; `NEN EXREF GT - MÀU SỐ 8` thiếu tệp (chỉ là nền đường màu 8) — báo, không hỏi.

## Hình chữ nhật khoanh nhãn tên — **không phải thửa đất** (Đôn Châu, 11/2026)
Người vẽ hay **khoanh một hình chữ nhật (hatch màu hoặc đường viền kín) quanh dòng chữ** để ghi tên công trình ("TRƯỜNG TH ĐÔN XUÂN A", "CHỢ XÃ ĐÔN XUÂN", "CHÙA ÔNG BÔN", "NHÀ VH ẤP CHỢ MR 0,0235", "ĐẤT CÔNG CỘNG") **ngay trên layer đất** (`QHDD_DAT_XD_Dato`) và **đè lên các thửa thật**. Web app/cleaner đọc nó như một thửa → ra vùng "Đất ở" thừa, chồng lên thửa thật (QH04/QH05 Đôn Châu: 32 khung → 30 vùng "Đất ở" + 2 vùng lúa thừa; HienTrang 4 vùng lúa thừa từ nhãn "RUỘNG LÚA").
- **Dấu hiệu** (`src/lib/dwg2gdb/labelBox.ts`, `findLabelBoxes`/`findLabelBoxesAcross` — một chuỗi chung cho cleaner và web app, không có luật riêng từng hồ sơ): hình chữ nhật (hatch hoặc nét kín **đúng 4 góc vuông**) + **cỡ vừa chữ** (diện tích 0,4–6 × diện tích ước của chữ) + chữ **nằm trong hoặc sát** khung; hoặc khung rộng hơn nhưng **ôm chữ ≥ 50 %** và **nằm trên vùng khác lớn ≥ 1,5 lần** (vùng đất không chồng nhau). Rồi lan sang **bản sao** cùng góc, ô **cùng cỡ + cùng hướng** (hộp mẫu chép nhiều chỗ) và **ô xếp chồng** (chạm/cách ≤ 6 m, không lớn hơn) — chỉ trong cùng layer. **Chữ có thể lệch khung vài chục mét** (MTEXT xuống dòng khác ước tính; ảnh `previewSvg` vẽ chữ một dòng nên không thấy) — đừng đòi chữ nằm trọn trong khung. **Tìm xuyên các bản vẽ**: khung ở xref, chữ ở bản đồ chủ. Thửa nhỏ có tên dài hơn nó (chữ thò ra) không phải khung.
- **Chỉ áp cho hàng đã ghép vào lớp đất** (`ChucNangSuDungDat_A`): nhà (`NHA_BKC` có số "2,68" bên trong), cầu (`CAU BE TONG` có chữ "Cầu bê tông") cũng là chữ nhật có chữ nằm trên vùng lớn hơn nhưng là **đối tượng thật** — bản thử đầu áp cho mọi layer đã đưa 22 cầu + hàng chục nhà Lưu Nghiệp Anh vào khung nhãn (phát hiện nhờ đọc danh sách ⚠ của hồ sơ **khác** hồ sơ đang sửa). Sau mỗi thay đổi nhận dạng, chạy lại cả ba hồ sơ và đọc danh sách ⚠ mới.
- **Cleaner**: chuyển vào layer `KHUNG_Nhan_Ten` (màu xám, tên bắt đầu bằng `khung` nên web app bỏ qua và `.qgz` không vẽ), chữ giữ nguyên ở layer chữ; BAO_CAO.md ghi từng khung kèm nhãn và **⚠ xem lại**. Quyết định áp trước nhận dạng này (`quyet-dinh.json` thắng) — nếu một khung thật ra là thửa (vd. "ĐẤT MỞ RỘNG TRƯỜNG HỌC 5,4 HA", "KHU CÔNG NGHIỆP … (THEO" ở QH04 là khu quy hoạch vẽ bằng hình chữ nhật), đặt `keep` về layer đất cho layer/loại đó và ghi lý do.
- **Web app** (`/boc-tach`): hàng bảng ghép chứa khung hiện **"Cần xem"** + dòng hổ phách "N nghi khung nhãn tên (vd. …) · Bỏ qua N" (nút loại các đối tượng đó khỏi bản xuất, hoàn tác được như loại đối tượng khác). Quy tắc mẫu ghép đã lưu **không** che cờ này.
- **Khi kiểm tra**: sau khi chạy, **liệt kê mọi hình chữ nhật còn lại trên layer đất** của DXF sạch (số, kích thước, chữ gần nhất) rồi mới kết luận — lần đầu chỉ bắt khung có chữ nằm trong nên người dùng gửi ảnh còn nhiều khung.  số vùng `ChucNangSuDungDat_A` bản sạch ít hơn bản gốc đúng bằng số khung — ghi vào `chap-nhan-lech.json` nếu cổng báo; đọc danh sách khung trong BAO_CAO.md (⚠) và đối chiếu ảnh để chắc không loại nhầm thửa thật. Nếu người dùng nói "vùng này bị nhận nhầm thành thửa" mà vùng đó là hình chữ nhật có chữ: kiểm tra ngưỡng của 3 điều kiện trên trên **mọi** khung của hồ sơ (kích thước, độ phủ chữ, tỷ lệ diện tích), đừng chỉnh theo một khung.

### Làm lại Đôn Châu lần 2 (11/2026): ô nhãn còn sót sau vòng đầu
- Thêm quy tắc **ô dải cùng bề cao** (cạnh ngắn ≤ 40 m, dài ≥ 2,5 × ngắn, cùng hướng/layer, cạnh ngắn bằng một khung đã nhận ±1 m) — hộp nhãn 3 dòng của một bản vẽ cùng cao 32 m; bắt thêm 2 ô không có chữ nào trong 280 m.
- **Kiểm bằng dữ liệu, không bằng ảnh `visualHoSoGIS`**: ảnh vẽ hatch CAD (xám/olive) dưới GIS nên ô nhãn vẫn hiện dù không còn trong gdb. Dùng `scripts/gdb-rects.py <QuyHoach.gdb>` (PyQGIS): chỉ còn 6 vùng chữ nhật (nhà văn hóa nhỏ, trường mở rộng 81 × 61 m, trạm bơm, một ô Đất ở 73 × 63 m lẻ). Một ô vuông lẻ không gắn được chữ nào thì **báo người dùng**, không đoán.
- QH02 hiện trạng có ~60 hình chữ nhật trên `DAT_NNK_Tronglua` có chữ "RUỘNG LÚA"/"ĐẤT RUỘNG"/"ĐẤT TRỐNG" nằm **đúng trong** khung: đó là **thửa ruộng thật** (khung to hơn chữ nhiều lần, không nằm trên vùng khác) — luật không bắt, đúng.
