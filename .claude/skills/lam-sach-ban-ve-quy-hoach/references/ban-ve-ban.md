# Bản vẽ bẩn thường gặp — xử lý thế nào

| Tình huống | Dấu hiệu | Xử lý |
|---|---|---|
| **Xref** (bản chủ gần như rỗng, nền nằm ở tệp khác) | `KIEM_KE.md` đầu trang: "kể cả xref: …"; bản chủ chỉ vài chục đối tượng | Công cụ tự đọc xref một lần/tệp, lồng nhau cũng theo, tệp không đặt tên xref nhưng được tham chiếu cũng là xref. **Thiếu xref** → báo "⚠ Xref không tìm thấy", xin người dùng tệp; đừng kết luận bản đồ trống |
| **Block / INSERT** (ký hiệu đóng block, block lồng) | ký hiệu nhỏ dày đặc, ATTRIB | Bộ đọc nổ block đệ quy (scale/xoay/OCS); ATTRIB là chữ. Không cần làm gì thêm |
| **Xref đã bind / đóng thành block** | layer có dạng `Xr_nen$0$layer` | Vẫn là layer thường; nhận theo tên sau dấu `$0$`. Nếu khó, ghi quyết định theo `/regex/` |
| **Nhiều bản đồ trong một tệp** (nhiều tờ cạnh nhau) | ranh nhiều vòng, khung tên lặp | Chỉ vòng lớn nhất/phổ biến nhất là ranh; hỏi người dùng nếu thực sự là nhiều đồ án |
| **Hai bản cùng loại** (QH05 2030 + QH06 2050) | tiêu đề cùng loại, khác năm | Dùng năm mới nhất cho dữ liệu; vẫn làm sạch cả hai nếu người dùng muốn |
| **Chữ tiếng Việt cũ** (VNI/TCVN3/windows-1258) | `ÑAÁT`, `Þ`, `ị` trước số | Bộ đọc tự giải mã theo nội dung; `Ø140` bị đọc `ị140` được sửa. Cảnh báo deck "Missing character" trong cmd chỉ là ký tự ngoài bảng chữ, vô hại |
| **Layer 0 / Defpoints / `*SPM_MAP_*`** | đối tượng lẻ | bỏ |
| **Không có layer ranh** | `KIEM_KE.md`: "không tìm thấy ranh" | dự phòng: ranh xã ≥ 100 ha; vẫn không → `"ranh": "<layer>"` trong quyết định, hoặc hỏi |
| **Đơn vị mm hoặc tọa độ lệch tâm** | bbox quá lớn, hatch không có | công cụ coi bản vẽ theo mét; nếu ảnh rỗng/sai tỷ lệ, báo người dùng chọn đơn vị/hệ tọa độ trong web app trước |
| **Bản vẽ khổng lồ** (> 1 triệu đối tượng khảo sát) | KIEM_KE đọc lâu | bình thường (1–2 phút); ảnh xem trước tự lược nét ngắn |
| **Hatch không có hình/nhiều họ đường** | vùng tô đặc | vẫn là vùng đất; mẫu hatch giữ nếu có |
| **Layer đặt tên sai nhưng đúng màu** | vùng lúa nằm trong layer `giao thong` | tin màu (ACI Phụ lục I) nếu hình vẽ khớp; ghi `look` |
| **Tuyến vẽ bằng một nét rộng trên layer chữ** | `TEXT` L, rộng 15 m, dài km | công cụ tách thành hàng "nét rộng, dài như tuyến đường" → đường (⚠); kiểm lại bằng ảnh |
| **Kiểu nét có chữ** | LTYPE `110kV`, `22kV`… | ghi vào DXF thành LTYPE phức hợp; đừng đổi thành layer riêng/ chữ rời |

## Dấu hiệu bản vẽ đã sạch đủ
- Mục "đọc lại bằng web app" ✔: nhận đúng loại bản đồ, ranh, 0 layer chưa nhận ra.
- Ảnh xem trước: không còn nền xám dày; vùng đất đúng bảng màu; đường, ranh, tên đủ; chữ không chồng nát (chồng nhẹ do bản vẽ gốc thì chấp nhận).
- Số liệu hợp lý: vài trăm đến vài chục nghìn đối tượng/bản đồ chứ không phải triệu.
