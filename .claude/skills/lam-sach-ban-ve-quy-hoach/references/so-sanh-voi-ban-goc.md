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
