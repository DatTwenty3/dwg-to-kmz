# `quyet-dinh.json` — quyết định của người xem bản vẽ

Đặt trong thư mục kết quả (`<CLEAN_OUT_DIR>/quyet-dinh.json`) hoặc trỏ bằng `CLEAN_DECISIONS=<đường dẫn>`. Áp dụng **trước** mọi quy tắc có sẵn. Chỉ ghi ngoại lệ.

Hai dạng:
```jsonc
// 1. Danh sách quyết định
[ { "layer": "GHI CHU ONG", "action": "keep", "to": "HTKT_CN_Ghichu", "why": "ghi chú đường kính ống nước" } ]

// 2. Kèm ranh lập quy hoạch (layer của đường ranh, tên hoặc /regex/)
{ "ranh": "RANH_QH_XA", "overrides": [ … ] }
```

Một quyết định (`CleanOverride`):
| Trường | Ý nghĩa |
|---|---|
| `layer` | Tên layer (không phân biệt hoa/thường, bỏ khoảng trắng) hoặc `"/regex/i"` |
| `drawing` | (tuỳ chọn) một phần tên tệp bản vẽ — chỉ áp cho bản vẽ đó |
| `kind` | (tuỳ chọn) `polyline` · `polygon` · `text` · `point` |
| `action` | `"drop"` bỏ · `"keep"` giữ |
| `to` | keep: tên layer đích (theo chuẩn: `DAT_NNK_Tronglua`, `HTKT_CD_Duongday22kV`, `HTKT_TN_Tuyen_Nuocmua`, `BV_Rg_lapquyhoach`…) |
| `color` | keep: màu `#rrggbb` (mặc định giữ màu đối tượng; vùng đất: nên dùng đúng ACI Phụ lục I) |
| `why` | lý do — ghi vào báo cáo |
| `look` | `true` = đánh dấu ⚠ để người dùng xem lại |

Ví dụ:
```json
{
  "ranh": "/ranh.*(lap|qh)/i",
  "overrides": [
    { "layer": "/^(tree|cay|survey)/i", "action": "drop", "why": "ký hiệu cây khảo sát" },
    { "layer": "DD-22", "kind": "polyline", "action": "keep", "to": "HTKT_CD_Duongday22kV", "why": "đường dây 22 kV (kiểu nét có chữ 22kV)" },
    { "drawing": "QH08", "layer": "TRAM", "action": "keep", "to": "HTKT_CD_Trambienap", "why": "trạm biến áp" },
    { "layer": "hatch_vang", "kind": "polygon", "action": "keep", "to": "DAT_KXD_Dancunongthon", "color": "#7f7f3f", "why": "đất ở nông thôn (màu 57)", "look": true }
  ]
}
```

Màu ACI → hex: dùng bảng `tt16-layer-mau.md` (cột ACI) và hàm `aciHex` trong `src/lib/dwg2gdb/color.ts`.

Sau mỗi lần sửa: chạy lại `clean`, xem lại ảnh và mục "Kiểm tra: đọc lại bằng web app". Một quyết định được dùng lại cho mọi bản vẽ trong thư mục nếu không ghi `drawing`.

## Bài học: ranh và nét đường phải giống bản gốc
- **Đừng `drop` layer ranh** (`BV_Rg_Lapquyhoach`…). Công cụ sẽ tự vẽ lại một ranh đơn giản (mất độ rộng, kiểu nét chấm tròn). Dùng `{"layer": "<layer ranh>", "kind": "polyline", "action": "keep", "to": "BV_Rg_lapquyhoach", "color": "#ff0000"}` để giữ nét gốc; ranh hở < 2 % chiều dài giữ hở như bản gốc (web app vẫn đọc là vùng), bề rộng và kiểu nét giữ nguyên. Bản đồ không có ranh riêng (chỉ có mẫu trong chú giải) được vẽ ranh theo nét của ranh dài nhất.
- Viền thửa/lô gom `BV_Vienthua` **giữ màu gốc** (không ép xám) — viền khu công nghiệp tím, viền đất ở nâu chấm… phải giống bản vẽ.
- Khi người dùng nói "nét chưa giống gốc": đừng đoán — dựng ảnh cạnh nhau (bản gốc | DXF đã **lưu qua AutoCAD sang DWG**, vì `parseDxf` không đọc kiểu nét nên ảnh từ DXF luôn thấy nét liền) ở 2–3 cửa sổ (mép ranh, ngã tư, khu dân cư) rồi so từng lớp.

## Bẫy khi viết quyết định
- `"drawing"` so với **tên tệp của chính bản vẽ chứa đối tượng**. Đối tượng nằm trong xref (`Xr_ Nen giao thong.dwg`) thì phải ghi `"drawing": "Xr_ Nen giao"`, ghi `"QH07"` sẽ không khớp.
- Đối tượng **ngoài ranh** bị loại trước khi xét quyết định (trừ chữ biển số tuyến và đường/ký hiệu tuyến nằm sát ranh): `keep` không cứu được chúng.
- Quyết định đầu tiên khớp thắng (theo thứ tự trong tệp): đặt quyết định cụ thể (`drawing`, `kind`) lên trên quyết định chung.
- `kind` rất hữu ích: cùng một layer có thể vừa có chữ vừa có nét (`CAU BE TONG`: nét → `HTKT_GT_Cau`, chữ để mặc định).
- Quyết định `keep` luôn kèm `"why"` cụ thể (nói hình vẽ trông thế nào, không chỉ "theo tên") và `"look": true` khi đoán từ hình vẽ chứ không từ tên/màu chuẩn.
- Mẫu trọn bộ: `vi-du-quyet-dinh-luu-nghiep-anh.json`.
- Layer có kiểu nét ranh (`QH_Ranh giới lập quy hoạch`) chưa chắc là ranh lập quy hoạch của bản đồ: Long Hiệp có `QH_Ranh giới huyện` cùng kiểu nét nhưng là một vòng khác (6.641 ha so với 6.516 ha). So số đỉnh/diện tích với ranh web app nhận ra trước khi `keep` về `BV_Rg_lapquyhoach`; nếu khác, đặt `BV_Rg_capcoso`.
- Quyết định sửa phân loại sai của bản gốc (bờ ao thành nền, cống thoát nước ra khỏi cấp nước…) làm cổng kiểm tra báo "mất đối tượng": ghi lý do vào `chap-nhan-lech.json` (xem SKILL.md, mục Cổng kiểm tra).
