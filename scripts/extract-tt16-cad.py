# Trích bảng "Tên phân lớp – Định dạng – Màu" của Phụ lục I, Thông tư 16/2025/TT-BXD từ file PDF của chủ dự án
# (gdb/Thông tư 16.pdf — gitignore, không commit). Chạy:
#   PYTHONIOENCODING=utf-8 python -I scripts/extract-tt16-cad.py "gdb/Thông tư 16.pdf" out.json
# Cần PyMuPDF (`import fitz`). Các trang phụ lục xoay 270°: hàng của bảng chạy theo trục x của trang, nên
# hàng = tâm x của từ, cột = y. Mỗi tên phân lớp (BV_…, DAT_…) được ghép với "Số N" và "Vùng/Đường/Điểm/Chữ"
# cùng hàng, nằm bên phải nó. Kết quả thô: còn sót vài dòng (BV_Ten_*, DAT_KXD_Congnghiep) và Mục 7 / Mục 8
# không có tên phân lớp — xem docs/plan-nhan-dang-theo-mau.md.
import fitz, sys, re, json

d = fitz.open(sys.argv[1])
NAME = re.compile(r'^[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+$')
KINDS = ('Vùng', 'Đường', 'Điểm', 'Chữ')
rows = []
miss = []
# Phụ lục I: trang 56..112 (chỉ số 55..111). Từ trang 113 là Phụ lục II (GIS), không thuộc bảng này.
for pi in range(55, min(112, len(d))):
    p = d[pi]
    rot = p.rotation
    W = []
    for w in p.get_text('words'):
        x0, y0, x1, y1, t = w[:5]
        if rot in (90, 270):
            r, c0, c1 = (x0 + x1) / 2, y0, y1
        else:
            r, c0, c1 = (y0 + y1) / 2, x0, x1
        W.append((r, c0, c1, t))
    colors = []
    for r, c0, c1, t in W:
        if t == 'Số':
            nx = [v for v in W if abs(v[0] - r) < 3 and 0 <= v[1] - c1 < 20 and re.match(r'^\d+$', v[3])]
            if nx:
                colors.append((r, c0, int(min(nx, key=lambda v: v[1])[3])))
    for r, c0, c1, t in W:
        if not NAME.match(t):
            continue
        cands = [c for c in colors if abs(c[0] - r) < 4 and c[1] > c0]
        k = [v[3] for v in W if v[3] in KINDS and abs(v[0] - r) < 4 and v[1] > c0]
        if cands:
            rows.append({'page': pi + 1, 'layer': t, 'kind': k[0] if k else None, 'aci': min(cands, key=lambda c: c[1])[2]})
        else:
            miss.append((pi + 1, t))
json.dump(rows, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(rows), 'matched;', len(miss), 'missing')
for m in miss:
    print('MISS', m)
