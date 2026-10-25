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
