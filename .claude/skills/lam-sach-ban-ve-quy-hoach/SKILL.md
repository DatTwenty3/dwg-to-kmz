---
name: lam-sach-ban-ve-quy-hoach
description: Làm sạch và chuẩn hóa bản vẽ quy hoạch DWG/DXF (nhận từ nhiều nơi, bẩn, xref/block lộn xộn) theo Thông tư 16/2025/TT-BXD để làm đầu vào cho web app LEDAT-GIS (/boc-tach). Dùng khi người dùng đưa một thư mục bản vẽ quy hoạch (đồ án quy hoạch chung xã/đô thị, phân khu, hạ tầng kỹ thuật…) và muốn "làm sạch", "chuẩn hóa", "dọn bản vẽ" theo tư duy kiến trúc sư quy hoạch. Claude tự xem bản vẽ (ảnh), tự quyết định, ra DXF sạch + báo cáo.
---

# Làm sạch bản vẽ quy hoạch theo Thông tư 16

Mục tiêu: người dùng đưa **một thư mục bản vẽ** (DWG/DXF, mỗi nơi một kiểu: xref, block, layer đặt tên tùy ý, nền địa chính lẫn vào…). Bạn xem, suy nghĩ như **kiến trúc sư quy hoạch**, và trả ra **bản vẽ sạch cuối cùng** — mỗi bản đồ một tệp `.dxf` — mà web app `/boc-tach` đọc vào là nhận đúng loại bản đồ, ranh, từng lớp dữ liệu. Không hỏi người dùng những gì bạn tự quyết được; chỉ hỏi khi thiếu dữ liệu (thiếu xref, không có ranh, không rõ đồ án) hoặc khi có quyết định mà sai sẽ làm mất nội dung quy hoạch thật.

Công cụ nằm sẵn trong repo (chạy ở thư mục gốc dự án, bằng Bash):

```bash
# 1. Kiểm kê + ảnh để xem (KHÔNG sửa gì)
CLEAN_IN="<thư mục bản vẽ>" CLEAN_OUT_DIR="<thư mục kết quả>" CLEAN_MODE=inventory npx vitest run tests/unit/dwg2gdb/cleanCad.test.ts
# 2. Làm sạch (đọc <kết quả>/quyet-dinh.json nếu có)
CLEAN_IN="<thư mục bản vẽ>" CLEAN_OUT_DIR="<thư mục kết quả>" CLEAN_MODE=clean npx vitest run tests/unit/dwg2gdb/cleanCad.test.ts
```

`CLEAN_OUT_DIR` mặc định `dwg_to_gdb_sach/<tên thư mục>` (đã gitignore — dữ liệu của chủ dự án, **không commit**). Bản vẽ lớn mất 1–2 phút. Dữ liệu thật không đưa vào `public/`.

## Quy trình (làm đủ, theo thứ tự)

### 1. Kiểm kê — nhìn trước khi làm
Chạy `inventory`, rồi **đọc `KIEM_KE.md` và XEM các ảnh** trong `kiem-ke/` bằng công cụ Read (đọc được PNG):
- `*_theo-layer.png`: mỗi layer một màu + chú giải các layer lớn → cho biết layer nào là nền địa chính, đường, vùng đất, ký hiệu.
- `*_goc.png`: bản vẽ như người vẽ thấy.
- Đầu `KIEM_KE.md`: ranh lập quy hoạch có tìm thấy không; **xref không tìm thấy** (bản chủ sẽ thiếu nền — báo người dùng bổ sung tệp, đừng đoán); tệp không đưa vào; loại bản đồ nhận ra cho từng tệp.
- Bảng layer: loại đối tượng (A vùng tô, L đường, P điểm, T chữ), trong ranh / tổng, màu, độ rộng, kiểu nét, **đề xuất của quy tắc** (⚠ = chưa chắc).

Hỏi chính mình cho mỗi bản đồ: *đây là bản đồ gì (sử dụng đất, giao thông, điện, nước, thoát nước, TTLL, hiện trạng, định hướng)? Đâu là nội dung quy hoạch, đâu là nền, đâu là khung/chú giải/ghi chú? Có layer nào đặt tên sai nhưng hình vẽ cho thấy nó là gì?* (xem `references/kien-thuc-quy-hoach.md`).

**Layer nào quy tắc đề xuất "bỏ", "viền thửa" hoặc `XEM_` mà số lượng lớn hay tên khó hiểu → phóng to xem, đừng tin tên.** Dùng `CMP_MODE=scan` (đọc chữ/độ rộng/kiểu nét của layer) và `CMP_MODE=zoom` (mỗi layer một màu quanh một chỗ) — xem `references/so-sanh-voi-ban-goc.md`. Bảng các layer đã đoán sai ở hồ sơ thật (mồ mả, nhãn khoanh đất, cột điện, cao độ, bờ ao…) nằm ở `references/layer-la-da-gap.md`: tra trước khi mất công xem.

### 2. Quyết định — ghi vào `quyet-dinh.json`
Quy tắc có sẵn xử lý phần lớn; bạn chỉ ghi **ngoại lệ** mà mắt và chuyên môn của bạn thấy khác. Định dạng và ví dụ: `references/quyet-dinh.md`. Ví dụ điển hình: layer lạ là đường điện 22 kV; layer `GHI CHU` thực ra là ghi chú ống nước cần giữ; tên layer ranh không nhận ra (`"ranh": "RANH_QH_XA"`); layer rác bản vẽ này có mà quy tắc chưa biết.

Nguyên tắc quyết định:
- **Giữ nội dung quy hoạch và nền; bỏ rác.** Nền địa chính (giải thửa) và nền đo đạc địa hình → **giữ** trên layer `NEN_*`, hiện sẵn, nằm dưới. Khung tên, chú giải, mặt cắt, kích thước, layer 0/Defpoints, ký hiệu cây khảo sát, nét suy biến → bỏ. Vùng đất, đường, ranh, hạ tầng, địa danh, ký hiệu công trình chức năng → giữ.
- **Màu và hình vẽ nói thật hơn tên layer.** Vùng tô màu đúng ACI Phụ lục I là loại đất đó dù layer tên lạ; nét rộng + dài là đường; nhiều vùng nhỏ cùng layer (trung vị ≤ 400 m²) là mặt bằng nhà.
- **Mâu thuẫn thì chọn theo ngữ cảnh và đánh dấu ⚠** (`"look": true`), không im lặng.
- **Không đoán thuộc tính.** Chỉ ghi cái bản vẽ nói rõ.
- Đừng sửa hình học. Chuẩn hóa = đúng layer, đúng màu, đúng loại nét, đúng nội dung; không dời, không vẽ lại.
- **Bản sạch phải trông như bản gốc ở những thứ không bị chuẩn hóa**: độ rộng, kiểu nét, màu viền, ký hiệu ranh. Mỗi lần `drop`/`keep` một layer nét (đặc biệt layer ranh, đường, viền vùng) tự hỏi *nó có mất độ rộng, kiểu nét, chấm tròn, màu gốc không?* — một lần `drop` layer ranh đã làm mất chấm tròn ranh (xem `layer-la-da-gap.md`, mục "Ranh").
- **Không `drop` layer ranh**. `keep` nó về `BV_Rg_lapquyhoach` để giữ nét gốc.
- Đối tượng của xref mang **tên tệp xref** trong `"drawing"`; đối tượng ngoài ranh bị loại trước mọi quyết định (`references/quyet-dinh.md`).

### 3. Làm sạch và nhìn lại
Chạy `clean`. Rồi:
1. Đọc `BAO_CAO.md`: mỗi layer gốc → layer mới / bỏ, lý do, ⚠. Mục "Kiểm tra: đọc lại bằng web app" phải ghi **✔**. Nếu có ⚠ (loại bản đồ nhận sai, layer chưa nhận ra, không thấy ranh) → sửa `quyet-dinh.json` hoặc quy tắc rồi chạy lại.
2. **Xem `*_xem-truoc.png` của từng bản đồ** (Read). So với `*_goc.png`: có mất vùng đất/đường quan trọng không? Có còn rác (nền xám dày, ký hiệu lạ) không? Màu vùng đất đúng bảng Phụ lục I không?
3. Lặp lại 2–3 cho tới khi sạch. Mỗi vòng ghi rõ đã đổi gì.

### 4. Kiểm tra đầu ra (bắt buộc)
- Báo cáo: ranh nhận lại đúng diện tích; mỗi tệp sạch được web app nhận **đúng loại bản đồ**; 0 layer "chưa nhận ra"; các lớp TT16 tạo được có số lượng hợp lý (so với ảnh).
- **So với bản gốc bằng mắt, ở 3–4 cửa sổ phóng to** (mép ranh, ngã ba đường lớn, khu dân cư, đường dây/ống) — `references/so-sanh-voi-ban-goc.md`. "✔" của web app không bắt được ranh mất chấm tròn, đường mất độ rộng hay viền đổi màu. Ranh, đường, viền vùng đất, đường dây điện phải **khớp bản gốc** (độ rộng, kiểu nét, màu); khác biệt có chủ ý (ký hiệu cây, mặt cắt, nền đất/kênh trên bản đồ hạ tầng) ghi rõ khi bàn giao.
- Mở bằng AutoCAD thật (lưu sang DWG) vừa là kiểm tra DXF hợp lệ vừa là cách duy nhất dựng ảnh **có kiểu nét** để so: `powershell -ExecutionPolicy Bypass -File scripts/verify-dxf-autocad.ps1 -Dxf <đường dẫn không dấu cách> -OutDwg <…>`; đọc lại DWG bằng `parseDwg` (kiểu nét có chữ 110kV…, chấm tròn ranh còn nguyên). `parseDxf` không đọc LTYPE nên đừng dựng ảnh so sánh từ DXF.

### 5. Bàn giao
Báo ngắn gọn bằng tiếng Việt: thư mục kết quả; mỗi bản đồ giữ/bỏ bao nhiêu; **những quyết định chuyên môn bạn đã tự chốt và lý do** (đặc biệt các ⚠); những gì chưa làm được (ví dụ xref thiếu); cách dùng (mở DXF bằng AutoCAD → Save As DWG; hoặc kéo cả thư mục vào `/boc-tach`). Không commit dữ liệu người dùng.

## Chuẩn đầu ra (công cụ đã làm, đừng làm lại bằng tay)
- **Vùng đất** → layer đúng tên Phụ lục I + màu ACI của ký hiệu (`references/tt16-layer-mau.md`); Mục 7 (xã) mượn tên layer của Mục có cùng loại đất **và cùng màu**; chưa có tên thì `DAT_<NNK|KXD>_<Tên>`. Giữ nguyên hatch mẫu.
- **Viền thửa** gom `BV_Vienthua` (giữ màu, độ rộng, kiểu nét gốc của từng nét); **ranh** `BV_Rg_lapquyhoach` (**giữ nét gốc**: rộng 5 m, kiểu chấm tròn, tỷ lệ nét 50; ranh hở < 2 % được khép; bản đồ không có ranh riêng nhận ranh chung với cùng nét) / `BV_Rg_capcoso` (14); **địa danh** `BV_Ten_Diadanh`; **tiêu đề** `BV_Ten_Banve` (loại bản đồ + tên đồ án — để web app nhận ra loại bản đồ và Mục).
- **Hạ tầng** một quy ước `HTKT_<CD|CN|TN|TTLL|GT>_<…>`: `HTKT_CD_Duongday22kV`, `HTKT_CD_Trambienap`, `HTKT_CN_Ongcapnuoc`, `HTKT_CN_Trucuuhoa`, `HTKT_TN_Tuyen_Nuocmua|Nuocthai`, `HTKT_TN_Hoga_…`, `HTKT_TTLL_Tuyencap`, `HTKT_GT_Duongtinh|Quoclo|Timduong|Heduong|Cau…`; chữ `…_Ghichu`, `HTKT_GT_Tenduong`, `HTKT_GT_Kyhieutuyen`.
- **Giữ nguyên**: hình học, độ rộng nét, hatch mẫu, **kiểu nét (LTYPE) kể cả kiểu có chữ trong khoảng hở** (đường 110kV/22kV…, ranh quy hoạch) — ghi vào DXF thành LTYPE phức hợp, AutoCAD mở/lưu được.
- **Nền là phần quan trọng của bản vẽ — luôn giữ, hiện sẵn, nằm dưới cùng.** Nền giải thửa địa chính và nền đo đạc địa hình (bờ đất, điểm, thực vật…) trong ranh được giữ nguyên trên layer riêng `NEN_Giaithua`, `NEN_Giaithua_Chu`, `NEN_Diahinh_*` (màu xám/ màu gốc), **không tắt, không đóng băng**, ghi vào file trước các đối tượng khác để quy hoạch nằm trên nền. Web app bỏ qua `NEN_*` nên không lẫn vào dữ liệu GIS. Tối đa 250.000 đối tượng nền/bản đồ (phần vượt ghi trong báo cáo, để ở bản gốc). Chỉ khi người dùng nói rõ muốn bản vẽ nhẹ mới chạy `CLEAN_NEN=0` (bỏ nền). **Đừng bỏ nền như rác** dù nó chiếm 90 % số đối tượng.
- **Bỏ**: rác khảo sát (ký hiệu cây khảo sát, layer 0/Defpoints, dimension, audit), ngoài ranh (trừ biển số/mũi tên tuyến ngay ngoài ranh), nét suy biến, trùng.

## Xử lý bản vẽ bẩn thường gặp
Xem `references/ban-ve-ban.md` (xref thiếu/lồng/bind, block, text VNI/TCVN3, layer 0, không có ranh, hai bản đồ cùng loại, đơn vị mm, bản vẽ khổng lồ…).

## Tài liệu tham khảo (đọc khi cần)
| Tệp | Dùng khi |
|---|---|
| `references/kien-thuc-quy-hoach.md` | hiểu từng loại bản đồ, cái gì là nền / rác / nội dung |
| `references/quyet-dinh.md` | viết `quyet-dinh.json` (định dạng, bẫy `drawing`/xref/ngoài ranh, bài học ranh) |
| `references/layer-la-da-gap.md` | gặp layer tên lạ (`MO_MA`, `KS-GHICHU`, `DUONG_DIEN`, `CAODO`…) hoặc cần xử lý ranh |
| `references/so-sanh-voi-ban-goc.md` | so bản sạch với bản gốc; người dùng nói "nét/ranh chưa giống" |
| `references/vi-du-quyet-dinh-luu-nghiep-anh.json` | mẫu `quyet-dinh.json` trọn bộ của một hồ sơ thật (9 bản đồ) |
| `references/tt16-layer-mau.md` | tên layer + màu ACI Phụ lục I |
| `references/ban-ve-ban.md` | xref, block, text cũ, thiếu ranh… |

## Khi nào hỏi người dùng
Chỉ hỏi (một lần, gom câu hỏi): thiếu xref; không có đường ranh nào và không thể suy ra; không biết đồ án thuộc xã/phường nào khi tên không có trong bản vẽ; hai bản đồ cùng loại khác năm mà cần chọn; layer có thể là nội dung quy hoạch thật nhưng bạn không đủ căn cứ (kèm đề xuất mặc định của bạn). Mọi thứ khác: tự quyết, ghi vào báo cáo.

## Giới hạn hiện có
Không ghi được `.dwg` (chỉ DXF). Ký hiệu SVG Phụ lục I chưa nhúng vào DXF. Hình (SHX shape) và POINT theo PDMODE chưa vẽ. Bản đồ hiện trạng **khảo sát** (nhãn loại đất nằm trong từng khoanh, không có hatch theo loại) chưa chuyển thành vùng đất từng khoanh — chỉ giữ nhãn (`BV_Chu_Chucnang`). Ảnh xem trước vẽ nét đứt và chấm tròn của ranh nhưng không vẽ chữ trong kiểu nét (110kV…); chữ đó có trong DXF. `parseDxf` không đọc LTYPE (ảnh so sánh dựng từ DXF thấy nét liền). Chữ `l` của font ký hiệu trong kiểu nét đổi thành ● (cỡ và độ dời được bù để chấm vẫn nằm đúng giữa đường).

## Sau khi làm sạch: kiểm tra đường sang `.qgz`
Bản sạch phải ra `.qgz` giống bản gốc: chữ biển số tuyến (911, 914, 914C), chấm ranh quy hoạch nằm trên đường, đường 110kV có chữ. Nếu sửa `cleanCad.ts`/`dxf.ts`, so số liệu `cadLayerData` của bản gốc và bản sạch (số chấm có `kt` > 0, khoảng cách chấm tới ranh, chữ 91x) trước khi bàn giao.

## So lớp-theo-lớp với bản gốc (bắt buộc trước khi bàn giao)
Sau `clean`, đọc lại thư mục sạch bằng `loadFolder` + `analyzeDrawings` + `buildFeatures` và so với thư mục gốc: **số đối tượng và `phanLoai` của từng lớp TT16** (đường, cầu, điện, nước, thoát nước, TTLL, sử dụng đất) phải khớp; số chấm ranh (`cad_diem` có `kt` > 0) và chữ biển số (`cad_chu`) phải bằng bản gốc. Lệch có nghĩa là cleaner đổi tên layer làm web app hiểu khác (ví dụ chữ "duong" trong `HTKT_CD_Duongday`, biển số trên layer `0`).
