# Phụ lục I Thông tư 16 — layer và màu AutoCAD (ACI) của các ký hiệu bản vẽ

Trích từ `src/lib/dwg2gdb/tt16-cad-symbols.json` (sinh từ Thông tư, đã rà tay). Màu = mã ACI (Số N). **Mục 8 hạ tầng không có tên layer cũng không có màu** — layer hạ tầng theo quy ước của công cụ (xem SKILL.md).

## Mục 1 — Khung bản vẽ, ranh giới, địa danh (BV_*)

| Layer | Ký hiệu | ACI | Loại đất |
|---|---|---:|---|
| BV_Khungten | Khung tên | 7 |  |
| BV_Khungbanve | Khung bản vẽ | 7 |  |
| BV_Khungbanve | Khung bản vẽ | 7 |  |
| BV_Rg_quocgia | Ranh giới quốc gia | 206 |  |
| BV_Rg_captinh | Ranh giới tỉnh, thành phố | 238 |  |
| BV_Rg_capcoso | Ranh giới xã, phường, đặc khu | 14 |  |
| BV_Rg_lapquyhoach | Ranh giới lập quy hoạch | 1 |  |
| BV_Ten_Diadanh | Tên địa danh | 7 |  |

## Mục 2 — Quy hoạch chung đô thị 1/10.000

| Layer | Ký hiệu | ACI | Loại đất |
|---|---|---:|---|
| DAT_DD_Donvio | Đơn vị ở | 30 | Đất ở |
| DAT_DD_Honhop | Hỗn hợp | 22 | Đất hỗn hợp |
| DAT_DD_Coquandothi | Cơ quan, trụ sở đô thị | 34 | Đất cơ quan, trụ sở |
| DAT_DD_CayxanhCCdothi | Cây xanh sử dụng công cộng đô thị | 72 | Đất cây xanh sử dụng công cộng |
| DAT_DD_DVCCdothi | Dịch vụ - công cộng đô thị | 1 | Đất công cộng |
| DAT_DD_Giaothongdothi | Giao thông đô thị | 8 | Đất giao thông |
| DAT_DD_HTkhacdothi | Hạ tầng kỹ thuật khác cấp đô thị | 195 | Đất hạ tầng kỹ thuật |
| DAT_NDD_Daotao | Đào tạo, nghiên cứu | 144 | Đất giáo dục |
| DAT_NDD_Congnghiep | Sản xuất công nghiệp, kho tàng | 192 | Đất công nghiệp, tiểu thủ công nghiệp |
| DAT_NDD_Coquan | Cơ quan, trụ sở | 46 | Đất cơ quan, trụ sở |
| DAT_NDD_Yte | Y tế | 220 | Đất y tế |
| DAT_NDD_Dulich | Dịch vụ du lịch | 210 | Đất du lịch |
| DAT_NDD_CayxanhSDHC | Cây xanh sử dụng hạn chế | 94 | Đất cây xanh sử dụng hạn chế |
| DAT_NDD_Ditich | Di tích, tôn giáo | 16 | Đất di tích, danh thắng |
| DAT_NDD_DancuNT | Dân cư nông thôn | 57 | Đất ở |
| DAT_NDD_Vanhoathethao | Văn hóa, thể dục thể thao | 94 | Đất văn hóa |
| DAT_NDD_CayxanhCD | Cây xanh chuyên dụng | 126 | Đất cây xanh chuyên dụng |
| DAT_NDD_Anninh | An ninh | 64 | Đất quốc phòng, an ninh |
| DAT_NDD_Quocphong | Quốc phòng | 79 | Đất quốc phòng, an ninh |
| DAT_NNK_Nongnghiep | Sản xuất nông nghiệp | 3 | Đất sản xuất nông nghiệp |
| DAT_NNK_Thuysan | Nuôi trồng thủy sản | 150 | Đất nuôi trồng thủy sản |
| DAT_NNK_Honuoc | Hồ, ao, đầm | 154 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NNK_Songsuoi | Sông, suối, kênh, rạch | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NNK_Chuasudung | Chưa sử dụng | 9 | Đất chưa sử dụng |
| DAT_NNK_Rungdacdung | Rừng đặc dụng | 148 | Đất rừng đặc dụng |
| DAT_NNK_Rungphongho | Rừng phòng hộ | 129 | Đất rừng phòng hộ |
| DAT_NNK_Rungsanxuat | Rừng sản xuất | 107 | Đất rừng sản xuất |
| DAT_NNK_Matnuocbien | Mặt nước ven biển | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |

## Mục 3 — Quy hoạch chung đô thị 1/5.000

| Layer | Ký hiệu | ACI | Loại đất |
|---|---|---:|---|
| DAT_DD_Honhop_Nhomo | Hỗn hợp (nhóm nhà ở và dịch vụ) | 22 | Đất hỗn hợp |
| DAT_DD_Nhomnhao | Nhóm nhà ở | 42 | Đất ở |
| DAT_DD_TruongTHPT | Trường THPT | 24 | Đất giáo dục |
| DAT_DD_Truonghoc | Trường THCS, tiểu học, mầm non | 15 | Đất giáo dục |
| DAT_DD_DVCCdothi | Dịch vụ - công cộng đô thị | 1 | Đất công cộng |
| DAT_DD_Coquandothi | Cơ quan, trụ sở đô thị | 34 | Đất cơ quan, trụ sở |
| DAT_DD_CayxanhCCdothi | Cây xanh sử dụng công cộng đô thị | 72 | Đất cây xanh sử dụng công cộng |
| DAT_DD_Giaothongdothi | Giao thông đô thị | 8 | Đất giao thông |
| DAT_DD_HTkhacdothi | Hạ tầng kỹ thuật khác cấp đô thị | 195 | Đất hạ tầng kỹ thuật |
| DAT_NDD_Daotao | Đào tạo, nghiên cứu | 144 | Đất giáo dục |
| DAT_NDD_Congnghiep | Sản xuất công nghiệp, kho tàng | 192 | Đất công nghiệp, tiểu thủ công nghiệp |
| DAT_NDD_Coquan | Cơ quan, trụ sở | 46 | Đất cơ quan, trụ sở |
| DAT_NDD_Yte | Y tế | 220 | Đất y tế |
| DAT_NDD_Dulich | Dịch vụ du lịch | 210 | Đất du lịch |
| DAT_NDD_CayxanhSDHC | Cây xanh sử dụng hạn chế | 94 | Đất cây xanh sử dụng hạn chế |
| DAT_NDD_Ditich | Di tích, tôn giáo | 16 | Đất di tích, danh thắng |
| DAT_NDD_Vanhoathethao | Văn hóa, thể dục thể thao | 94 | Đất văn hóa |
| DAT_NDD_CayxanhCD | Cây xanh chuyên dụng | 126 | Đất cây xanh chuyên dụng |
| DAT_NDD_Anninh | An ninh | 64 | Đất quốc phòng, an ninh |
| DAT_NDD_Quocphong | Quốc phòng | 79 | Đất quốc phòng, an ninh |
| DAT_NNK_Nongnghiep | Sản xuất nông nghiệp | 3 | Đất sản xuất nông nghiệp |
| DAT_NNK_Thuysan | Nuôi trồng thủy sản | 150 | Đất nuôi trồng thủy sản |
| DAT_NNK_Rungdacdung | Rừng đặc dụng | 148 | Đất rừng đặc dụng |
| DAT_NNK_Rungphongho | Rừng phòng hộ | 129 | Đất rừng phòng hộ |
| DAT_NNK_Rungsanxuat | Rừng sản xuất | 107 | Đất rừng sản xuất |
| DAT_NNK_Chuasudung | Chưa sử dụng | 9 | Đất chưa sử dụng |
| DAT_NNK_Honuoc | Hồ, ao, đầm | 154 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NNK_Songsuoi | Sông, suối, kênh, rạch | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NNK_Matnuocbien | Mặt nước ven biển | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |

## Mục 4 — Quy hoạch phân khu

| Layer | Ký hiệu | ACI | Loại đất |
|---|---|---:|---|
| DAT_O_Nhomnhao | Nhóm nhà ở | 42 | Đất ở |
| DAT_O_Honhop_Nhomo | Hỗn hợp (nhóm nhà ở và dịch vụ) | 22 | Đất hỗn hợp |
| DAT_O_Langxom | Làng xóm, dân cư nông thôn | 57 | Đất ở |
| DAT_HTXH_Yte | Y tế | 220 | Đất y tế |
| DAT_HTXH_Vanhoa | Văn hóa | 243 | Đất văn hóa |
| DAT_HTXH_TruongTHPT | Trường THPT | 24 | Đất giáo dục |
| DAT_HTXH_Truonghoc | Trường THCS, tiểu học, mầm non | 15 | Đất giáo dục |
| DAT_HTXH_CayxanhCC | Cây xanh sử dụng công cộng | 72 | Đất cây xanh sử dụng công cộng |
| DAT_Cayxanhhanche | Cây xanh sử dụng hạn chế | 94 | Đất cây xanh sử dụng hạn chế |
| DAT_Cayxanhchuyendung | Cây xanh chuyên dụng | 126 | Đất cây xanh chuyên dụng |
| DAT_SX_Congnghiep | Sản xuất công nghiệp, kho tàng | 192 | Đất công nghiệp, tiểu thủ công nghiệp |
| DAT_SX_Vatlieu | Khai thác, chế biến khoáng sản, vật liệu xây dựng | 175 | Đất khoáng sản, vật liệu xây dựng |
| DAT_DaotaoNC | Đào tạo, nghiên cứu | 144 | Đất giáo dục |
| DAT_Coquan | Cơ quan, trụ sở | 34 | Đất cơ quan, trụ sở |
| DAT_Dichvu | Dịch vụ | 12 | Đất thương mại, dịch vụ |
| DAT_Dulich | Dịch vụ du lịch | 210 | Đất du lịch |
| DAT_Ditich_tongiao | Di tích, tôn giáo | 16 | Đất tôn giáo, tín ngưỡng |
| DAT_Anninh | An ninh | 64 | Đất quốc phòng, an ninh |
| DAT_Quocphong | Quốc phòng | 79 | Đất quốc phòng, an ninh |
| DAT_HTKT_DuongGT | Đường giao thông | 251 | Đất giao thông |
| DAT_HTKT_Baidoxe | Bãi đỗ xe | 252 | Đất giao thông |
| DAT_HTKT_Nghiatrang | Nghĩa trang | 251 | Đất nghĩa trang, nhà tang lễ |
| DAT_NN_Nongnghiep | Sản xuất nông nghiệp | 3 | Đất sản xuất nông nghiệp |
| DAT_NN_Thuysan | Nuôi trồng thủy sản | 150 | Đất nuôi trồng thủy sản |
| DAT_NN_Rungdacdung | Rừng đặc dụng | 148 | Đất rừng đặc dụng |
| DAT_NN_Rungphongho | Rừng phòng hộ | 129 | Đất rừng phòng hộ |
| DAT_NN_Rungsanxuat | Rừng sản xuất | 107 | Đất rừng sản xuất |
| DAT_KHAC_Chuasudung | Chưa sử dụng | 9 | Đất chưa sử dụng |
| DAT_KHAC_Honuoc | Hồ, ao, đầm | 154 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_KHAC_Songsuoi | Sông, suối, kênh, rạch | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_KHAC_Matnuocbien | Mặt nước ven biển | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |

## Mục 5 — Quy hoạch chi tiết

| Layer | Ký hiệu | ACI | Loại đất |
|---|---|---:|---|
| DAT_NO_Nhaolienke | Nhà ở liền kề | 32 | Đất ở |
| DAT_NO_Nhaobietthu | Nhà ở biệt thự | 56 | Đất ở |
| DAT_NO_Nhaochungcu | Nhà chung cư | 40 | Đất ở |
| DAT_NO_Nhaonongthon | Nhà ở nông thôn | 57 | Đất ở |
| DAT_NO_NhaochungcuHH | Nhà chung cư hỗn hợp | 44 | Đất hỗn hợp |
| DAT_CTHTXH_Yte | Y tế | 220 | Đất y tế |
| DAT_CTHTXH_Vanhoa | Văn hóa | 243 | Đất văn hóa |
| DAT_CTHTXH_TruongTHPT | Trường THPT | 24 | Đất giáo dục |
| DAT_CTHTXH_Truonghoc | Trường THCS, tiểu học, mầm non | 15 | Đất giáo dục |
| DAT_CTHTXH_Theducthethao | Thể dục thể thao | 94 | Đất cây xanh, thể dục thể thao |
| DAT_CTHTXH_CayxanhCC | Cây xanh sử dụng công cộng | 72 | Đất cây xanh sử dụng công cộng |
| DAT_CTHTXD_ThuongmaiDV | Thương mại, dịch vụ | 12 | Đất thương mại, dịch vụ |
| DAT_CTSX_Congnghiep | Sản xuất công nghiệp, kho tàng | 192 | Đất công nghiệp, tiểu thủ công nghiệp |
| DAT_CT_Daotaonghiencuu | Đào tạo, nghiên cứu | 144 | Đất giáo dục |
| DAT_CT_Coquan | Cơ quan, trụ sở | 34 | Đất cơ quan, trụ sở |
| DAT_CT_Dichvu | Dịch vụ | 12 | Đất thương mại, dịch vụ |
| DAT_CT_Dulich | Dịch vụ du lịch | 210 | Đất du lịch |
| DAT_CT_Ditichtongiao | Di tích, tôn giáo | 16 | Đất tôn giáo, tín ngưỡng |
| DAT_CT_Cayxanhhanche | Cây xanh sử dụng hạn chế | 94 | Đất cây xanh sử dụng hạn chế |
| DAT_CT_Cayxanhchuyendung | Cây xanh chuyên dụng | 126 | Đất cây xanh chuyên dụng |
| DAT_CTHTKT_DuongGT | Đường giao thông | 251 | Đất giao thông |
| DAT_CTHTKT_Baidoxe | Bãi đỗ xe | 252 | Đất giao thông |
| DAT_CTHTKT_Nghiatrang | Nghĩa trang | 251 | Đất nghĩa trang, nhà tang lễ |
| DAT_CTHTKT_Hatangkhac | Hạ tầng kỹ thuật khác | 199 | Đất hạ tầng kỹ thuật |
| DAT_CT_Anninh | An ninh | 64 | Đất quốc phòng, an ninh |
| DAT_CT_Quocphong | Quốc phòng | 79 | Đất quốc phòng, an ninh |
| DAT_NLK_Nongnghiep | Sản xuất nông nghiệp | 3 | Đất sản xuất nông nghiệp |
| DAT_NLK_Rungdacdung | Rừng đặc dụng | 148 | Đất rừng đặc dụng |
| DAT_NLK_Rungphongho | Rừng phòng hộ | 129 | Đất rừng phòng hộ |
| DAT_NLK_Rungsanxuat | Rừng sản xuất | 107 | Đất rừng sản xuất |
| DAT_NLK_Thuysan | Nuôi trồng thủy sản | 150 | Đất nuôi trồng thủy sản |
| DAT_NLK_Chuasudung | Chưa sử dụng | 9 | Đất chưa sử dụng |
| DAT_NLK_Honuoc | Hồ, ao, đầm | 154 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NLK_Songsuoi | Sông, suối, kênh, rạch | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NLK_Matnuocbien | Mặt nước ven biển | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |

## Mục 6 — Quy hoạch chung khu chức năng

| Layer | Ký hiệu | ACI | Loại đất |
|---|---|---:|---|
| DAT_KXD_Dancudothi | Phát triển dân cư đô thị | 30 | Đất ở |
| DAT_KXD_Daotao | Đào tạo, nghiên cứu | 144 | Đất giáo dục |
| DAT_KXD_Dancunongthon | Phát triển dân cư nông thôn | 57 | Đất ở |
| DAT_KXD_Honhop | Hỗn hợp | 22 | Đất hỗn hợp |
| DAT_KXD_Dichvucongcong | Dịch vụ - công cộng | 1 | Đất công cộng |
| DAT_KXD_CayxanhCC | Cây xanh sử dụng công cộng | 72 | Đất cây xanh sử dụng công cộng |
| DAT_KXD_CayxanhSDHC | Cây xanh sử dụng hạn chế | 94 | Đất cây xanh sử dụng hạn chế |
| DAT_KXD_CayxanhCD | Cây xanh chuyên dụng | 126 | Đất cây xanh chuyên dụng |
| DAT_KXD_Congnghiep | Sản xuất công nghiệp, kho tàng | 192 | Đất công nghiệp, tiểu thủ công nghiệp |
| DAT_KXD_Coquantruso | Cơ quan, trụ sở | 34 | Đất cơ quan, trụ sở |
| DAT_KXD_Yte | Y tế | 220 | Đất y tế |
| DAT_KXD_Vanhoathethao | Văn hóa, thể dục thể thao | 94 | Đất văn hóa |
| DAT_KXD_Dulich | Dịch vụ du lịch | 210 | Đất du lịch |
| DAT_KXD_Ditich | Di tích, tôn giáo | 16 | Đất di tích, danh thắng |
| DAT_KXD_Anninh | An ninh | 64 | Đất quốc phòng, an ninh |
| DAT_KXD_Quocphong | Quốc phòng | 79 | Đất quốc phòng, an ninh |
| DAT_KXD_Giaothong | Giao thông | 8 | Đất giao thông |
| DAT_KXD_HTKTkhac | Hạ tầng kỹ thuật khác | 195 | Đất hạ tầng kỹ thuật |
| DAT_NNK_Nongnghiep | Sản xuất nông nghiệp | 3 | Đất sản xuất nông nghiệp |
| DAT_NNK_Thuysan | Nuôi trồng thủy sản | 150 | Đất nuôi trồng thủy sản |
| DAT_NNK_Honuoc | Hồ, ao, đầm | 154 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NNK_Songsuoi | Sông, suối, kênh, rạch | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| DAT_NNK_Chuasudung | Chưa sử dụng | 9 | Đất chưa sử dụng |
| DAT_NNK_Rungdacdung | Rừng đặc dụng | 148 | Đất rừng đặc dụng |
| DAT_NNK_Rungphongho | Rừng phòng hộ | 129 | Đất rừng phòng hộ |
| DAT_NNK_Rungsanxuat | Rừng sản xuất | 107 | Đất rừng sản xuất |
| DAT_NNK_Matnuocbien | Mặt nước ven biển | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |

## Mục 7 — Quy hoạch chung xã (nông thôn) — Phụ lục I không đặt tên layer

| Layer | Ký hiệu | ACI | Loại đất |
|---|---|---:|---|
| — | Đất trồng lúa | 3 | Đất trồng lúa |
| — | Đất trồng trọt khác | 94 | Đất trồng cây hàng năm khác |
| — | Đất rừng sản xuất | 107 | Đất rừng sản xuất |
| — | Đất rừng phòng hộ | 129 | Đất rừng phòng hộ |
| — | Đất rừng đặc dụng | 148 | Đất rừng đặc dụng |
| — | Đất nuôi trồng thủy sản | 144 | Đất nuôi trồng thủy sản |
| — | Đất làm muối | 126 | Đất làm muối |
| — | Đất nông nghiệp khác | 72 | Đất nông nghiệp khác |
| — | Đất ở | 57 | Đất ở |
| — | Đất công cộng | 1 | Đất công cộng |
| — | Đất cây xanh, thể dục thể thao | 76 | Đất cây xanh, thể dục thể thao |
| — | Đất tôn giáo, danh lam di tích, đình đền | 16 | Đất tôn giáo, tín ngưỡng |
| — | Đất công nghiệp, tiểu thủ công nghiệp và làng nghề | 192 | Đất công nghiệp, tiểu thủ công nghiệp |
| — | Đất khoáng sản và sản xuất vật liệu xây dựng | 177 | Đất khoáng sản, vật liệu xây dựng |
| — | Đất xây dựng các chức năng khác | 34 | Đất chức năng khác |
| — | Đất xử lý chất thải rắn | 8 | Đất xử lý chất thải |
| — | Đất nghĩa trang, nghĩa địa | 251 | Đất nghĩa trang, nhà tang lễ |
| — | Đất hạ tầng kỹ thuật khác | 195 | Đất hạ tầng kỹ thuật |
| — | Đất hạ tầng phục vụ sản xuất | 203 | Đất hạ tầng phục vụ sản xuất |
| — | Đất quốc phòng, an ninh | 69 | Đất quốc phòng, an ninh |
| — | Đất sông ngòi, kênh rạch, mặt nước chuyên dùng | 152 | Đất sông, ngòi, kênh, rạch, suối, mặt nước |
| — | Đất chưa sử dụng | 73 | Đất chưa sử dụng |
