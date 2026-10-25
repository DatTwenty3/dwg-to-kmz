# Tư duy của kiến trúc sư quy hoạch khi làm sạch bản vẽ

Bản vẽ quy hoạch nhận từ nhiều văn phòng: mỗi nơi một thói quen đặt layer, vẽ nền, đóng block. Bạn làm sạch như người hiểu **bản đồ này để làm gì**: một đồ án quy hoạch (chung xã/đô thị, phân khu, chi tiết) trình bày *đất đai được sử dụng thế nào* và *hạ tầng đi đâu*, trên một nền đo đạc/địa chính. Nội dung quy hoạch phải còn nguyên; nền, rác, khung phải ra.

## 1. Bản đồ gì? (tiêu đề + tên tệp quyết định)
| Loại | Nội dung phải có | Hạ tầng/nền thường lặp lại (không phải nội dung chính) |
|---|---|---|
| Hiện trạng sử dụng đất | vùng đất theo loại, ranh, địa danh, công trình chức năng | đường làm nền |
| Quy hoạch sử dụng đất / định hướng phát triển không gian | vùng đất quy hoạch (hatch), đường, ranh, tên, ký hiệu công trình | nền hiện trạng, sông kênh |
| Giao thông | tim đường, cấp đường, lộ giới/chỉ giới, cầu, tên đường, biển số tuyến | nền sử dụng đất (bỏ) |
| Cấp điện | đường dây theo cấp điện áp, trạm biến áp, trạm cắt | nền (bỏ) |
| Cấp nước | tuyến ống (đường kính), trụ cứu hỏa, trạm/nhà máy nước | nền (bỏ) |
| Thoát nước (mưa/thải) | cống, kênh mương, hố ga, trạm bơm, trạm xử lý | nền (bỏ) |
| Thông tin liên lạc | tuyến cáp, trạm | nền (bỏ) |
| Hiện trạng hạ tầng | các mạng hiện hữu (điện, nước, thoát nước, TTLL, đường) | |

Khi tiêu đề nói "định hướng phát triển không gian" mà hồ sơ không có bản đồ sử dụng đất riêng và phần lớn hatch nằm trên layer loại đất → đọc như **bản đồ sử dụng đất**.

## 2. Phạm vi: chỉ trong *ranh lập quy hoạch*
Đường khép kín lớn nhất trên layer ranh (`BV_Rg_Lapquyhoach`, "RANH QH"…), nhiều bản vẽ dùng chung một xref ranh → lấy cái chung. Khung tên, chú giải, mặt cắt, sơ đồ vị trí nằm ngoài ranh thì tự rơi ra (nền thì chỉ giữ phần trong ranh). Ngoại lệ phải giữ ngay ngoài ranh: **biển số tuyến** (hình thoi ghi 911, 914C ở đầu đường đi ra), mũi tên hướng tuyến.
Không có layer ranh → dùng ranh hành chính xã/phường (đường khép kín ≥ 100 ha); vẫn không có → hỏi người dùng hoặc chỉ ra layer trong `quyet-dinh.json` (`"ranh"`).

## 3. Cái gì là nền, cái gì là nội dung
**Nền — giữ, hiện sẵn, nằm dưới cùng (quyết định của chủ dự án: "đó là phần quan trọng của bản vẽ"):**
- Nền địa chính / giải thửa (hàng chục nghìn nét + số thửa, thường kiểu nét HIDDEN, xám — dấu hiệu: > 90 % số đối tượng, nhỏ, đều) → `NEN_Giaithua`, `NEN_Giaithua_Chu`.
- Nền đo đạc địa hình: bờ đất, điểm đo, thực vật, khối ký hiệu của xref khảo sát → `NEN_Diahinh_*`.
- Nền không phải dữ liệu GIS: web app bỏ qua, nhưng bản vẽ CAD vẫn cần nó để đọc quy hoạch. Chỉ cắt khi vượt 250.000 đối tượng/bản đồ (báo trong báo cáo).

**Bỏ (rác):**
- Ký hiệu cây khảo sát (`KYHIEU` khảo sát, `KS_*`, `SPM_MAP_*`), khung bản vẽ, khung tên, bảng, chú giải, hoa gió, thước tỷ lệ, kích thước/dimension, `0`/`Defpoints`/`AUDIT_*`, sơ đồ ghép mảnh.
- Nét suy biến (một điểm, chiều dài 0), vùng diện tích ≈ 0, đối tượng trùng (cùng hình ở hai bản đồ/hai bản sao xref).

**Giữ (nội dung quy hoạch):**
- Vùng đất (hatch) theo loại; đường tim, hè đường/lộ giới, cầu, cống; ranh; tên địa danh/ấp/xã; ký hiệu công trình chức năng (trường, chợ, trạm…); đường dây/ống/cáp và công trình hạ tầng; ghi chú chức năng, diện tích; tiêu đề bản đồ.

## 4. Nhận ra bằng mắt (cảm quan) khi tên layer không giúp
- **Vùng tô theo màu ACI Phụ lục I** (xem `tt16-layer-mau.md`): lúa xanh lá (3), đất ở vàng (57), sông xanh dương (152), công cộng đỏ (1), công nghiệp tím (192)… Màu đúng bảng là bằng chứng mạnh hơn tên layer (người vẽ hay chỉ quan tâm màu).
- **Nhiều vùng tô nhỏ cùng layer** (≥ 30, trung vị diện tích ≤ 400 m²): mặt bằng nhà/công trình, không phải loại đất.
- **Nét rộng, dài** (≥ 8 m, ≥ 1 km): tuyến đường, dù layer tên "TEXT" (ví dụ tuyến 914C vẽ một nét 15 m, kiểu DASHED, layer `TEXT`). Hai nét mảnh hai bên một nét rộng = hè/lộ giới. Nét liền mảnh khép kín nhỏ (sân, nền bê tông) ≠ đường.
- **Chấm đỏ nhỏ dọc ống nước** = trụ cứu hỏa; **tam giác** dọc đường dây = trạm biến áp; **hình thoi + số** ở đầu đường = biển số tuyến.
- **Kiểu nét có chữ** (`110kV`, `22kV`, `TH-D.22`…) = đường dây điện theo cấp điện áp: tên LTYPE và chữ trong khoảng hở nói cấp điện áp — phải giữ nguyên kiểu nét. Dấu chấm tròn lặp lại màu đỏ = ranh lập quy hoạch.
- **Chữ**: tên xã/ấp ("XÃ LONG HIỆP", "ẤP BÀO MÔN"), tên kênh, tên đường ("ĐƯỜNG HUYỆN 36", "TUYẾN SỐ 5"), biển số tuyến ("914C"), ghi chú ống ("Ø140 L=1400m" — `Ø` có thể bị đọc thành `ị`/`Þ`), ghi chú chức năng ("KHU TDTT 0,10 HA").

## 5. Tên layer Phụ lục I (Mục 1–7) và hạ tầng
Vùng đất: `DAT_KXD_*` (đất xây dựng), `DAT_NNK_*` (nông nghiệp, mặt nước, rừng…). Bản vẽ: `BV_*`. Hạ tầng Phụ lục I không đặt tên → quy ước công cụ `HTKT_<CD|CN|TN|TTLL|GT>_…`. Các tiền tố `QHDD_`, `QHDH_`, `HT_`, `HK_`, `NTM_` của văn phòng vẽ chỉ là tiền tố (hiện trạng/quy hoạch/đô thị/nông thôn) — loại đất nằm ở phần sau.

## 6. Hiện trạng ↔ quy hoạch
Bản đồ hiện trạng ghi vào `HienTrang.gdb`, quy hoạch vào `QuyHoach.gdb`. Cùng một loại bản đồ hai năm (2030, 2050) thì dùng năm mới nhất. Layer ranh thuộc cả hai.

## 7. Sau 2025
Hai cấp hành chính: không còn cấp huyện. "Ranh giới huyện" trong bản vẽ cũ thường là ranh xã cũ/mới → `BV_Rg_capcoso` (đánh dấu ⚠). Kinh tuyến trục theo tỉnh cũ của bản vẽ (xem CLAUDE.md điểm 5).

## 8. Không bao giờ
Dời/vẽ lại hình học; đoán thuộc tính (tình trạng, mức độ tác động…); bỏ nội dung chỉ vì không nhận ra tên layer (đặt `XEM_*` và ghi ⚠ hoặc hỏi); commit dữ liệu người dùng.
