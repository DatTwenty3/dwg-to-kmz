# Bóc các mẫu hatch (ký hiệu + màu, không viền) của Phụ lục I, Thông tư 16/2025/TT-BXD ra từng file SVG nền trong suốt.
# Nguồn: gdb/Thông tư 16.pdf (gitignore, không commit). Chạy:
#   python -I scripts/extract-tt16-hatch-svg.py "gdb/Thông tư 16.pdf" tt16-hatch-svg
# Cần PyMuPDF (`import fitz`). Trang phụ lục là vector (hatch đã được PDF "nổ" thành các nét mảnh), nên chép lại đúng
# từng nét + màu. Mỗi dòng bảng lấy ô "Hiện trạng" (ô đầu tiên — hatch thuần; hai ô quy hoạch là hatch + khung đậm/đứt).
# Hàng = tâm y của "Số N" (cột Màu); ô mẫu = các nét có tâm nằm trong cột "Hiện trạng" và gần hàng đó nhất.
# Chỉ Mục 2–7 (trang 62–95) có vùng tô sử dụng đất; Mục 1 (khung/ranh) và Mục 8 (hạ tầng) không phải hatch.
import fitz, sys, re, json, os, unicodedata, html

sys.stdout.reconfigure(encoding='utf-8')

PDF, OUT = sys.argv[1], sys.argv[2]
MUC_PAGES = {2: (62, 66), 3: (67, 71), 4: (72, 79), 5: (80, 85), 6: (86, 90), 7: (91, 95)}
NAME = re.compile(r'^[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+$')
COL_HALF = 38       # nửa bề rộng cột "Hiện trạng" (pt) để nhận nét
ROW_HALF = 30       # nửa chiều cao hàng (pt)
MAX_LINE = 130      # nét dài hơn thế là đường kẻ bảng, không phải hatch


def slug(s):
    s = unicodedata.normalize('NFD', s.replace('đ', 'd').replace('Đ', 'D'))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_')[:60]


def hexc(c):
    return '#%02x%02x%02x' % tuple(round(v * 255) for v in c)


def fmt(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return s if s not in ('-0', '') else '0'


def path_d(items, M, ox, oy):
    """Đổi các item của PyMuPDF thành chuỗi 'd' SVG, đã xoay theo trang và dời về gốc ô."""
    def P(p):
        q = fitz.Point(p) * M
        return '%s %s' % (fmt(q.x - ox), fmt(q.y - oy))
    d, last = [], None
    for it in items:
        k = it[0]
        if k == 'l':
            if last != tuple(it[1]):
                d.append('M' + P(it[1]))
            d.append('L' + P(it[2]))
            last = tuple(it[2])
        elif k == 'c':
            if last != tuple(it[1]):
                d.append('M' + P(it[1]))
            d.append('C' + ' '.join(P(q) for q in it[2:5]))
            last = tuple(it[4])
        elif k == 're':
            r = it[1]
            d.append('M' + P((r.x0, r.y0)) + 'L' + P((r.x1, r.y0)) + 'L' + P((r.x1, r.y1)) + 'L' + P((r.x0, r.y1)) + 'Z')
            last = None
        elif k == 'qu':
            q = it[1]
            d.append('M' + P(q.ul) + 'L' + P(q.ur) + 'L' + P(q.lr) + 'L' + P(q.ll) + 'Z')
            last = None
    return ''.join(d)


def subpaths(dr):
    """Tách một drawing thành các nét liền mạch. PDF gộp hatch của nhiều ô (hiện trạng / đợt đầu / dài hạn) vào MỘT path."""
    out, cur, last = [], [], None
    for it in dr['items']:
        if it[0] in ('re', 'qu'):
            if cur:
                out.append(cur)
            out.append([it])
            cur, last = [], None
            continue
        start = tuple(it[1])
        if cur and (last is None or abs(start[0] - last[0]) > 0.02 or abs(start[1] - last[1]) > 0.02):
            out.append(cur)
            cur = []
        cur.append(it)
        last = tuple(it[-1])
    if cur:
        out.append(cur)
    return out


def bounds(items):
    xs, ys = [], []
    for it in items:
        pts = [it[1]] if it[0] in ('re', 'qu') else it[1:]
        for q in pts:
            if it[0] in ('re', 'qu'):
                r = fitz.Rect(q) if it[0] == 're' else q.rect
                xs += [r.x0, r.x1]
                ys += [r.y0, r.y1]
            else:
                xs.append(q[0])
                ys.append(q[1])
    return fitz.Rect(min(xs), min(ys), max(xs), max(ys))


def frame_items(grp, box, M):
    """4 cạnh khung chữ nhật (nét mảnh dài gần hết ô, nằm sát mép) — chỉ coi là khung khi đủ cả 4 phía."""
    bx0, by0, bx1, by1 = box
    bw, bh = bx1 - bx0, by1 - by0
    sides = {'t': [], 'b': [], 'l': [], 'r': []}
    for i, (r, _) in enumerate(grp):
        w, h = r.width, r.height
        if h < 1.2 and w >= 0.97 * bw:
            if abs(r.y0 - by0) < 0.8:
                sides['t'].append(i)
            if abs(r.y1 - by1) < 0.8:
                sides['b'].append(i)
        if w < 1.2 and h >= 0.97 * bh:
            if abs(r.x0 - bx0) < 0.8:
                sides['l'].append(i)
            if abs(r.x1 - bx1) < 0.8:
                sides['r'].append(i)
    if all(sides.values()):
        return set(sum(sides.values(), []))
    return set()


doc = fitz.open(PDF)
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.svg'):
        os.remove(os.path.join(OUT, f))

SYM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'lib', 'dwg2gdb', 'tt16-cad-symbols.json')
VN = {}
VN_ROW = {}
if os.path.exists(SYM):
    for e in json.load(open(SYM, encoding='utf-8')):
        VN.setdefault(e['layer'], e['name'])
        VN_ROW.setdefault((e['page'], e['aci']), []).append(e)

MANUAL = {
    (2, 251): ('DAT_NDD_GiaothongDN', 'Giao thông đối ngoại'),
    (3, 251): ('DAT_NDD_GiaothongDN', 'Giao thông đối ngoại'),
    (2, 199): ('DAT_NDD_HTkhacdoingoai', 'Hạ tầng kỹ thuật khác ngoài đô thị'),
    (3, 199): ('DAT_NDD_HTkhacdoingoai', 'Hạ tầng kỹ thuật khác ngoài đô thị'),
    (4, 94): ('DAT_HTXH_Theducthethao', 'Thể dục thể thao'),
    (4, 199): ('DAT_HTKT_Hatangkhac', 'Hạ tầng kỹ thuật khác'),
}

index = []
warn = []
hx = None
for muc, (pa, pb) in MUC_PAGES.items():
    hx = None
    seen_names = {}
    for pn in range(pa, pb + 1):
        p = doc[pn - 1]
        M = p.rotation_matrix
        words = [(fitz.Rect(w[:4]) * M, w[4]) for w in p.get_text('words')]
        # cột "Hiện trạng"
        for (r, t), (r2, t2) in zip(words, words[1:]):
            if t == 'Hiện' and t2 == 'trạng':
                hx = (r.x0 + r2.x1) / 2
        # hàng: "Số N"
        anchors = []
        for r, t in words:
            if t == 'Số':
                nx = [(r2, t2) for r2, t2 in words if re.fullmatch(r'\d+', t2) and abs((r2.y0 + r2.y1) / 2 - (r.y0 + r.y1) / 2) < 3 and 0 <= r2.x0 - r.x1 < 12]
                if nx:
                    anchors.append(((r.y0 + r.y1) / 2, int(nx[0][1])))
        anchors.sort()
        if hx is None or not anchors:
            if anchors:
                warn.append('M%d tr.%d: có %d hàng nhưng chưa biết cột Hiện trạng' % (muc, pn, len(anchors)))
            continue
        # nét vẽ
        draws = []
        for dr0 in p.get_drawings():
            r0 = fitz.Rect(dr0['rect']) * M
            if len(dr0['items']) > 1 and (r0.width > 90 or r0.height > 60 or r0.x0 < hx - 37 or r0.x1 > hx + 37):   # path gộp nhiều ô → tách thành các nét liền
                parts = []
                for sp in subpaths(dr0):
                    chunks = [sp]
                    b = bounds(sp) * M
                    if dr0['type'] == 's' and (b.width > 74 or b.height > 60 or b.x0 < hx - 37 or b.x1 > hx + 37):   # nét liền chạy xuyên nhiều ô → tách từng đoạn
                        chunks = [[it] for it in sp]
                    for ch in chunks:
                        d2 = dict(dr0)
                        d2['items'] = ch
                        d2['closePath'] = False
                        parts.append((d2, bounds(ch) * M))
            else:
                parts = [(dr0, r0)]
            for dr, r in parts:
                r.normalize()
                if r.width > MAX_LINE or r.height > MAX_LINE:
                    continue
                cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
                if abs(cx - hx) > COL_HALF:
                    continue
                draws.append((r, dr, cy))
        for ai, (ay, aci) in enumerate(anchors):
            grp = [(r, dr) for r, dr, cy in draws if abs(cy - ay) < ROW_HALF
                   and min(anchors, key=lambda a: abs(a[0] - cy))[0] == ay]
            if not grp:
                warn.append('M%d tr.%d Số %d: không có mẫu hatch ở cột Hiện trạng' % (muc, pn, aci))
                continue
            # mỗi ô hatch chỉ có một màu → bỏ nét khác màu (nét của hàng bên cạnh lọt vào)
            def col(dr):
                c = dr.get('fill') if 'f' in dr['type'] and dr.get('fill') is not None else dr.get('color')
                return hexc(c) if c is not None else None
            counts = {}
            for _, dr in grp:
                counts[col(dr)] = counts.get(col(dr), 0) + 1
            main = max(counts, key=counts.get)
            if counts[main] >= 0.7 * len(grp):
                grp = [g for g in grp if col(g[1]) == main]
            # Khung ô (2 cạnh ngang dài ~ bề rộng ô) cho biết ô thật nằm ở đâu → loại nét của ô bên cạnh lọt vào cửa sổ cột
            hs = [r for r, _ in grp if r.height < 1.2 and 40 <= r.width <= 90]
            pairs = [(t, u) for t in hs for u in hs if 20 <= u.y0 - t.y0 <= 36 and abs(t.x0 - u.x0) < 1 and abs(t.x1 - u.x1) < 1]
            if pairs:   # khung ô = cặp cạnh trên/dưới; chọn cặp xa nhau nhất (≤ 36 pt, loại nét của hàng bên cạnh)
                t, u = max(pairs, key=lambda tu: (round(tu[1].y0 - tu[0].y0), -abs((tu[0].y0 + tu[1].y1) / 2 - ay)))
                grp = [g for g in grp if t.x0 - 0.6 <= (g[0].x0 + g[0].x1) / 2 <= t.x1 + 0.6
                       and t.y0 - 0.6 <= (g[0].y0 + g[0].y1) / 2 <= u.y1 + 0.6]
            else:       # không tìm được khung: bỏ cạnh ngang dài lạc ra ngoài thân hatch (nét của hàng bên cạnh)
                body = [r for r, _ in grp if not (r.height < 1.2 and r.width >= 40)]
                if body:
                    by0, by1 = min(r.y0 for r in body), max(r.y1 for r in body)
                    grp = [g for g in grp if not (g[0].height < 1.2 and g[0].width >= 40 and (g[0].y0 < by0 - 2 or g[0].y1 > by1 + 2))]
            box = (min(r.x0 for r, _ in grp), min(r.y0 for r, _ in grp), max(r.x1 for r, _ in grp), max(r.y1 for r, _ in grp))
            fr = frame_items(grp, box, M)
            if not fr and pairs:    # khung đã biết từ cặp cạnh ngang → bỏ 4 cạnh dù hatch có nét chìa ra ngoài khung
                fx0, fx1, fy0, fy1 = t.x0, t.x1, t.y0, u.y1
                fh = fy1 - fy0
                fr = {i for i, (r, _) in enumerate(grp)
                      if (r.height < 1.2 and r.width >= 0.97 * (fx1 - fx0) and (abs(r.y0 - fy0) < 0.8 or abs(r.y1 - fy1) < 0.8))
                      or (r.width < 1.2 and r.height >= 0.97 * fh and (abs(r.x0 - fx0) < 0.8 or abs(r.x1 - fx1) < 0.8))}
            if not fr:      # dự phòng: khung vẽ bằng nét tô (fill) mảnh dài sát mép, còn hatch là nét 's'
                bw, bh = box[2] - box[0], box[3] - box[1]
                cand = {i for i, (r, dr) in enumerate(grp) if dr['type'] == 'f' and (
                    (r.height < 1.2 and r.width >= 0.97 * bw and (abs(r.y0 - box[1]) < 0.8 or abs(r.y1 - box[3]) < 0.8))
                    or (r.width < 1.2 and r.height >= 0.97 * bh and (abs(r.x0 - box[0]) < 0.8 or abs(r.x1 - box[2]) < 0.8)))}
                if len(cand) >= 4:
                    fr = cand
            keep = [g for i, g in enumerate(grp) if i not in fr]
            if not keep:
                warn.append('M%d tr.%d Số %d: chỉ có khung' % (muc, pn, aci))
                continue
            # nhãn của hàng
            band = [(r, t) for r, t in words if abs((r.y0 + r.y1) / 2 - ay) < ROW_HALF
                    and min(anchors, key=lambda a: abs(a[0] - (r.y0 + r.y1) / 2))[0] == ay]
            names = [t for r, t in band if NAME.match(t)]
            label_words = sorted([(round(r.y0 / 4), r.x0, t) for r, t in band if 62 < r.x0 and r.x1 < hx - COL_HALF + 8 and not NAME.match(t)])
            label = re.sub(r'^[-+]\s*', '', ' '.join(t for _, _, t in label_words))
            if not names:   # tên layer vẽ bằng nét (không có chữ) → tra bảng ký hiệu đã trích theo trang + số màu
                hit = [e for e in VN_ROW.get((pn, aci), []) if e['kind'] == 'A'] or VN_ROW.get((pn, aci), [])
                if hit and hit[0]['layer']:
                    names = [hit[0]['layer']]
                elif (muc, aci) in MANUAL:      # tên layer trong PDF là nét vẽ, bảng trích thiếu → đọc tay từ trang PDF
                    names, label = [MANUAL[(muc, aci)][0]], MANUAL[(muc, aci)][1]
            if names and not label:
                label = VN.get(names[0], '')
            # viewBox: theo khung nếu có (giữ đúng bề rộng ô), không thì theo nét
            vb = box if fr else (min(r.x0 for r, _ in keep), min(r.y0 for r, _ in keep), max(r.x1 for r, _ in keep), max(r.y1 for r, _ in keep))
            ox, oy = vb[0], vb[1]
            W, H = vb[2] - vb[0], vb[3] - vb[1]
            els, dedupe = [], set()
            for r, dr in keep:
                d = path_d(dr['items'], M, ox, oy)
                if not d:
                    continue
                at = []
                t = dr['type']
                fill = dr.get('fill') if 'f' in t else None
                stroke = dr.get('color') if 's' in t else None
                if fill is not None:
                    at.append('fill="%s"' % hexc(fill))
                    if (dr.get('fill_opacity') or 1) < 1:
                        at.append('fill-opacity="%s"' % fmt(dr['fill_opacity']))
                    if not dr.get('even_odd', True):
                        pass
                    else:
                        at.append('fill-rule="evenodd"')
                else:
                    at.append('fill="none"')
                if stroke is not None:
                    at.append('stroke="%s" stroke-width="%s"' % (hexc(stroke), fmt(dr.get('width') or 1)))
                    if (dr.get('stroke_opacity') or 1) < 1:
                        at.append('stroke-opacity="%s"' % fmt(dr['stroke_opacity']))
                    if dr.get('lineCap') and dr['lineCap'][0] == 1:
                        at.append('stroke-linecap="round"')
                    if dr.get('lineJoin') == 1:
                        at.append('stroke-linejoin="round"')
                    if dr.get('dashes') and dr['dashes'].strip() not in ('[] 0', '[ ] 0'):
                        nums = re.findall(r'[\d.]+', dr['dashes'])
                        if len(nums) > 1:
                            at.append('stroke-dasharray="%s"' % ' '.join(nums[:-1]))
                key = (d, ' '.join(at))
                if key in dedupe:
                    continue
                dedupe.add(key)
                els.append('<path d="%s" %s/>' % (d, ' '.join(at)))
            if not els:
                continue
            base = names[0] if names else (slug(label) or 'ky_hieu')
            nm = '%s_%d' % (base, aci)
            seen_names[nm] = seen_names.get(nm, 0) + 1
            fn = 'M%d_%s%s.svg' % (muc, nm, '' if seen_names[nm] == 1 else '_%d' % seen_names[nm])
            sc = 4
            svg = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                   '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">\n'
                   '<title>%s</title>\n%s\n</svg>\n') % (fmt(W * sc), fmt(H * sc), fmt(W), fmt(H),
                                                          html.escape(('%s — Số %d' % (names[0] if names else label, aci))), '\n'.join(els))
            open(os.path.join(OUT, fn), 'w', encoding='utf-8').write(svg)
            cols = sorted({hexc(dr['fill']) for _, dr in keep if dr.get('fill') is not None and 'f' in dr['type']} |
                          {hexc(dr['color']) for _, dr in keep if dr.get('color') is not None and 's' in dr['type']})
            index.append({'file': fn, 'muc': muc, 'page': pn, 'layer': names[0] if names else None, 'label': label,
                          'aci': aci, 'colors': cols, 'paths': len(els), 'frameRemoved': bool(fr),
                          'width': round(W, 1), 'height': round(H, 1)})

json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# Trang xem nhanh (nền caro để thấy độ trong suốt) — SVG nhúng thẳng vào trang, mở bằng file:// vẫn thấy
rows = []
for e in index:
    svg = open(os.path.join(OUT, e['file']), encoding='utf-8').read().split('?>', 1)[1]
    svg = re.sub(r'<title>.*?</title>', '', svg, flags=re.S)
    svg = re.sub(r' width="[^"]*" height="[^"]*"', '', svg, count=1)
    rows.append('<figure><div class="sw">%s</div><figcaption><b>%s</b><br>%s<br>Mục %d · Số %d · %s</figcaption></figure>' % (
        svg, html.escape(e['layer'] or ''), html.escape(e['label'] or ''), e['muc'], e['aci'], ' '.join(e['colors'])))
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(
    '<!doctype html><meta charset="utf-8"><title>Hatch TT16</title><style>'
    'body{font:12px system-ui;margin:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}'
    'figure{margin:0;border:1px solid #ccd;padding:8px;border-radius:8px}'
    '.sw{height:84px;display:flex;align-items:center;justify-content:center;'
    'background:conic-gradient(#ddd 25%,#fff 0 50%,#ddd 0 75%,#fff 0) 0 0/12px 12px}'
    '.sw svg{max-width:100%;max-height:100%;height:80px}'
    'figcaption{margin-top:6px;color:#334}</style>' + ''.join(rows))
print(len(index), 'svg;', len(warn), 'cảnh báo')
for w in warn:
    print('WARN', w)
