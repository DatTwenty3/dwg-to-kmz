# So sánh bản sạch với bản gốc (bắt buộc trước khi bàn giao)

Mục tiêu: người dùng mở bản sạch cạnh bản gốc phải thấy **cùng nét, cùng ranh, cùng đường**. Chỉ số liệu và ảnh `*_xem-truoc.png` là chưa đủ — ảnh xem trước từng thiếu chấm tròn của ranh mà số liệu vẫn "✔". Công cụ: `tests/unit/dwg2gdb/cleanCompare.test.ts` (bỏ qua nếu không có `CMP_MODE`).

## Bẫy phải nhớ
1. **Ảnh dựng từ DXF luôn thấy nét liền**: `parseDxf` không đọc LTYPE. Muốn so **kiểu nét** (đứt đen–trắng, 110kV, chấm ranh), lưu DXF qua AutoCAD sang DWG rồi dựng ảnh từ DWG:
   ```powershell
   # sao DXF ra đường dẫn KHÔNG có dấu cách rồi:
   powershell -ExecutionPolicy Bypass -File scripts/verify-dxf-autocad.ps1 -Dxf C:\tmp\qh06.dxf -OutDwg C:\tmp\qh06.dwg
   ```
2. **Layer của xref mang tên tệp xref**: trong `quyet-dinh.json`, `"drawing": "QH07"` không khớp đối tượng nằm trong `Xr_ Nen giao thong.dwg`; dùng `"drawing": "Xr_ Nen giao"`.
3. **Đối tượng ngoài ranh bị loại trước khi quyết định** (trừ chữ biển số, đường/ký hiệu tuyến sát ranh): `keep` không cứu được chúng.
4. Ảnh bản gốc (`*_goc.png`) và xem trước đã đổi màu trắng thành xám đậm — **trắng trên nền trắng không thấy**; trong AutoCAD (nền đen) vẫn là trắng. Đừng kết luận "mất" khi chỉ nhìn ảnh.

## Quy trình
1. **Chọn 3–4 cửa sổ** (đủ để thấy mọi loại nét): mép ranh (nơi ranh cắt đường, có chấm tròn), một ngã ba đường lớn, khu dân cư (nhà + đường nhỏ), nơi có đường dây điện/ống. Lấy toạ độ từ `bbox` trong báo cáo hoặc `CMP_ANCHOR` (tâm theo trung vị một layer).
2. **Ảnh cạnh nhau** (trái gốc | phải sạch):
   ```bash
   CMP_MODE=side CMP_IN="<thư mục gốc>" CMP_MAP=QH06 CMP_CLEAN="<.../qh06.dwg do AutoCAD lưu>" \
     CMP_CX=580600 CMP_CY=1073600 CMP_W=1200 CMP_OUT="<thư mục tạm>/qh06_ranh.png" \
     npx vitest run tests/unit/dwg2gdb/cleanCompare.test.ts
   ```
   Đọc ảnh (Read) và `<CMP_OUT>.txt` (số đối tượng theo layer mỗi bên). `CMP_W` 1000–2500 m cho đường/ranh; 300–700 m cho nhà, ký hiệu.
3. **Kiểm từng thứ**, ghi lại cái nào khớp/khác:
   | Thứ cần so | Khớp khi |
   |---|---|
   | Ranh | đỏ, rộng như gốc, **có chấm tròn**, đi đúng đường; không có đoạn thẳng lạ nối hai đầu |
   | Đường | cùng độ rộng, cùng kiểu nét (đứt đen–trắng, đôi), cùng vị trí; không đường nào biến mất |
   | Viền vùng đất | **cùng màu** viền (tím khu công nghiệp, nâu đất ở…) và kiểu chấm |
   | Đường dây điện | còn chữ 110kV/22kV trong chỗ hở |
   | Ký hiệu hướng tuyến, biển số, cầu | còn, cùng chỗ |
   | Chữ | tiếng Việt đúng dấu, không chồng nát hơn gốc |
4. **Khác biệt có chủ ý** (nói rõ khi bàn giao, đừng sửa): ký hiệu cây khảo sát, mặt cắt, vùng đất/kênh trên bản đồ hạ tầng và giao thông (lấy từ bản đồ sdd), viền thửa gom về `BV_Vienthua`, màu vùng đất đổi sang ACI Phụ lục I.
5. **Khác biệt không chủ ý**: tìm layer bằng `scan`/`zoom`:
   ```bash
   CMP_MODE=scan CMP_FILE="<bản gốc.dwg>" CMP_LAYERS="MO_MA|KS-GHICHU" CMP_OUT=<txt> npx vitest run tests/unit/dwg2gdb/cleanCompare.test.ts
   CMP_MODE=zoom CMP_FILE="<bản gốc.dwg>" CMP_ANCHOR="MO_MA" CMP_W=300 CMP_LAYERS="MO_MA|BODAT|DUONG_DIEN" CMP_OUT=<png> npx vitest run tests/unit/dwg2gdb/cleanCompare.test.ts
   ```
   `scan`: loại đối tượng, độ rộng, kiểu nét, chữ hay gặp của layer. `zoom`: phóng to quanh một layer, **mỗi layer một màu + chú giải** — cách nhanh nhất để biết một layer là gì (xem `layer-la-da-gap.md`). Sửa bằng `quyet-dinh.json` (hoặc `cleanCad.ts` nếu là quy tắc chung), chạy lại `clean`, so lại.
6. Khi người dùng nói "nét/ranh chưa giống gốc": **tái hiện trước khi sửa** — dựng đúng cửa sổ họ nhìn (nhờ họ nói bản đồ + khu vực nếu chưa rõ), tìm khác biệt thật, sửa, so lại, rồi mới báo. Đừng trả lời "đã đúng" chỉ vì số liệu ✔.

## Xem trong AutoCAD thật (khi nghi kiểu nét)
`accoreconsole` không chụp màn hình. Cách thực dụng: DWG do AutoCAD lưu → `parseDwg` → in `lineTypes[<tên>]` và `lineScale/width` của đối tượng, so từng phần tử với bản gốc (độ dài nét/hở, chữ, cỡ chữ, độ dời). Đã làm cho ranh: bản gốc `[1.035 + chữ "l" cỡ 1.5, 2.465]`, bản sạch `[1.035 + "●" cỡ 2.44, 2.465]` (Arial ● bé hơn Wingdings nên cỡ tăng để cùng đường kính).

## Ảnh hai bên cho người kiểm tra (`*_so-sanh.png`)
Công cụ `cleanCad.test.ts` (bước `clean`) tự sinh cho mỗi bản đồ một ảnh chia đôi: **trái = bản vẽ gốc (cả xref) với layer gốc, phải = bản sạch với layer đã chuẩn hóa**, cùng khung nhìn (ranh + lề, nới sang trái để bảng chú giải không đè bản đồ), **mỗi layer một màu** và chú giải 28 layer lớn nhất có số đối tượng ở góc trên trái mỗi bên. Cách dùng khi kiểm:
1. Nhìn chú giải trái: layer nào lớn nhất? (nền giải thửa, ký hiệu cây khảo sát, nhà…). Nhìn chú giải phải: những layer đó đã thành gì (`NEN_*`, `KTCQ_*`, `DAT_*`, `HTKT_*`, `BV_*`)?
2. Một mảng màu bên trái **biến mất** bên phải → phải có lý do trong bảng "Bỏ" của `BAO_CAO.md` (ký hiệu cây, mặt cắt, vùng đất/kênh lặp ở bản đồ hạ tầng…). Không có lý do → lỗi, sửa.
3. Một hình bên phải **không có bên trái** → chỉ được là ranh chuẩn công cụ vẽ cho bản đồ không có ranh riêng (cấp điện, nước, TTLL…).
4. Ảnh dựng từ DXF trong bộ nhớ (có LTYPE nên thấy nét đứt, chấm ranh) — khác với ảnh dựng từ file DXF đọc lại (nét liền).

Ảnh là bước nhìn **tổng thể**; vẫn phải phóng to 3–4 cửa sổ (`CMP_MODE=side`) cho nét, ranh, đường như mục trên.

## Bài kiểm "đưa sang .qgz" (bắt buộc khi sửa cách giữ nét/chữ/ký hiệu)
Bản sạch là đầu vào của web app → HoSoGIS + `.qgz`. Chạy cả chuỗi trên thư mục sạch rồi mở bằng QGIS thật:
```bash
FOLDER_ROOT="dwg_to_gdb_sach/<hồ sơ>" npx vitest run tests/unit/dwg2gdb/folder.test.ts   # → node_modules/.cache/dwg2gdb/ (gdb, .gpkg, .qgs)
```
(1 test "recognises every map" còn kỳ vọng hồ sơ cũ — bỏ qua, 4 test còn lại phải đạt.) Gom `HoSoGIS/` = 4 `*.gdb` (đổi tên `out_X.gdb` → `X.gdb`) + `.qgs` + `.gpkg` cùng tên, rồi PyQGIS (`E:\2. software\QGIS 4.2.1\bin\python-qgis.bat`): đọc project (CRS hợp lệ, 0 lớp lỗi) và vẽ các cửa sổ — nhãn cao tốc, ký hiệu trạm/bưu điện, ranh. Đạt khi: hệ tọa độ đúng (EPSG:9209 với KTT 105°30'), tên đường hiện, ký hiệu hiện (nhóm "Bản vẽ CAD"), ranh có chấm. Ảnh QGIS khác ảnh `previewSvg` ở màu/nền — chỉ cần có đủ thành phần.

## Sau mỗi lần sửa quy tắc chạy lại **cả ba hồ sơ mẫu**
`cleanCad.test.ts` (clean) + `cleanGate.test.ts` cho Long Hiệp, Lưu Nghiệp Anh, Đôn Châu. Quy tắc mới từng làm hỏng hồ sơ khác (nhãn "QL60" chỉ có ở Lưu Nghiệp Anh; quy tắc "chữ dọc đường" lúc đầu giữ cả chú giải "ĐƯỜNG ỐNG CẤP NƯỚC"). Cổng có `chữ tên đường` / `chữ biển số` / `chấm ranh` — bản sạch không được ít hơn bản gốc.

## Khi người dùng báo "chữ/ký hiệu không nằm giữa" — hỏi nó nhìn ở đâu trước
Chữ "QL54" lệch khỏi vòng tròn trong ảnh `_so-sanh.png` / `_xem-truoc.png` (10/2026) **không phải lỗi dữ liệu**: dữ liệu (DWG → IR → DXF, AutoCAD, QGIS `.qgz`) đều canh giữa đúng (chữ `center/baseline`, tâm chữ lệch tâm vòng 3 m); chính `previewSvg` vẽ mọi chữ từ điểm chèn, bỏ qua `hAlign/vAlign`, và vẽ cỡ chữ = chiều cao (bé hơn thật, chiều cao TEXT là chiều cao chữ hoa = 0,716 cỡ chữ). Đã sửa: `text-anchor` theo `hAlign`, `dy` theo `vAlign`, cỡ = chiều cao / 0,716 (test `previewSvg.test.ts`). Cách xử lý gọn: (1) hỏi người dùng đang nhìn ảnh/phần mềm nào (ảnh công cụ xuất, `.qgz`, `.dxf` mở trong QGIS/ArcGIS/AutoCAD); (2) in `hAlign/vAlign/position` của chữ trong IR và tâm của hình quanh nó từ **cả bản gốc lẫn bản sạch** — nếu hai bên giống nhau thì lỗi ở khâu vẽ, không phải ở làm sạch; (3) kiểm lại bằng đúng phần mềm nhìn thấy lỗi. Hai ảnh người dùng gửi (bản gốc cũng lệch y như bản sạch) là dấu hiệu lỗi ở bộ vẽ ảnh, vì bản gốc không bị làm sạch động vào.
