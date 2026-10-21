# Bóc các ký hiệu ĐIỂM (biểu tượng gọn: trạm điện, bến cảng, giếng, cột...) của Phụ lục I, Thông tư 16/2025/TT-BXD ra SVG nền
# trong suốt. Nguồn: gdb/Thông tư 16.pdf (gitignore). Chạy:
#   python -I scripts/extract-tt16-point-svg.py "gdb/Thông tư 16.pdf" tt16-point-svg
# Cần PyMuPDF. Mục 8 (trang 97–112, hạ tầng kỹ thuật) là bảng 3 cột ký hiệu: Hiện trạng / Quy hoạch đợt đầu / Quy hoạch dài hạn;
# mỗi dòng nhãn nằm ở cột 2 (chữ thật), tên phân lớp + "Điểm/Đường" của PDF là nét vẽ nên không đọc được → điểm được nhận theo hình:
# cụm nét gọn (≤ 48 pt, tỉ lệ ≤ 2,3) và nhãn dòng không phải Vùng/Tuyến/Đường/Kênh/Mương. Chữ nằm trong ký hiệu (số cấp cảng...)
# được giữ thành <text>. Mỗi ô (3 giai đoạn) xuất một file: *_ht / *_dd / *_dh.
import fitz, sys, re, json, os, unicodedata, html

sys.stdout.reconfigure(encoding='utf-8')
PDF, OUT = sys.argv[1], sys.argv[2]
PAGES = range(97, 113)
MAX_BOX = 48
MAX_ASPECT = 2.3
SKIP_LABEL = re.compile(r'^(Vùng|Kênh|Tuyến|Đường|Mương|Hành lang|Cáp|Ống|Tuyên|Nước (sạch|thô)|Trong nước|Quốc tế|Hầm|Cầu)', re.I)
STAGES = (('ht', 'Hiện trạng'), ('dd', 'Quy hoạch đợt đầu'), ('dh', 'Quy hoạch dài hạn'))


def slug(s):
    s = unicodedata.normalize('NFD', s.replace('đ', 'd').replace('Đ', 'D'))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_')[:60]


def hexc(c):
    return '#%02x%02x%02x' % tuple(round(v * 255) for v in c)


def fmt(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return s if s not in ('-0', '') else '0'


def bounds(items):
    xs, ys = [], []
    for it in items:
        if it[0] == 're':
            xs += [it[1].x0, it[1].x1]; ys += [it[1].y0, it[1].y1]
        elif it[0] == 'qu':
            r = it[1].rect
            xs += [r.x0, r.x1]; ys += [r.y0, r.y1]
        else:
            for q in it[1:]:
                xs.append(q[0]); ys.append(q[1])
    return fitz.Rect(min(xs), min(ys), max(xs), max(ys))


def subpaths(dr):
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


def path_d(items, M, ox, oy):
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


def style_attrs(dr):
    at, t = [], dr['type']
    fill = dr.get('fill') if 'f' in t else None
    stroke = dr.get('color') if 's' in t else None
    if fill is not None:
        at.append('fill="%s"' % hexc(fill))
        if (dr.get('fill_opacity') or 1) < 1:
            at.append('fill-opacity="%s"' % fmt(dr['fill_opacity']))
        if dr.get('even_odd', True):
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
    return ' '.join(at)


def hcenter(words, a, b):
    for (r, t), (r2, t2) in zip(words, words[1:]):
        if t == a and t2 == b:
            return (r.x0 + r2.x1) / 2
    return None


doc = fitz.open(PDF)
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.svg'):
        os.remove(os.path.join(OUT, f))

index, skipped = [], []
cols = None
for pn in PAGES:
    p = doc[pn - 1]
    M = p.rotation_matrix
    words = [(fitz.Rect(w[:4]) * M, w[4]) for w in p.get_text('words')]
    h = [hcenter(words, 'Hiện', 'trạng'), hcenter(words, 'Đợt', 'đầu'), hcenter(words, 'Dài', 'hạn')]
    if all(v is not None for v in h):
        cols = h
    if cols is None:
        continue
    half = (cols[1] - cols[0]) / 2
    xlo, xhi = cols[0] - half, cols[2] + half

    # nét vẽ trong vùng 3 cột (tách path gộp nhiều ô; bỏ đường kẻ bảng)
    pieces = []
    for dr0 in p.get_drawings():
        r0 = fitz.Rect(dr0['rect']) * M
        r0.normalize()
        if r0.y1 < 112 or r0.y0 > 560 or r0.x1 < xlo or r0.x0 > xhi:
            continue
        if len(dr0['items']) > 1 and (r0.width > 2 * half or r0.height > 60):
            parts = []
            for sp in subpaths(dr0):
                b = bounds(sp) * M
                b.normalize()
                chunks = [sp]
                if dr0['type'] == 's' and (b.width > 2 * half or b.height > 60):
                    chunks = [[it] for it in sp]
                for ch in chunks:
                    d2 = dict(dr0)
                    d2['items'] = ch
                    d2['closePath'] = False
                    bb = bounds(ch) * M
                    bb.normalize()
                    parts.append((d2, bb))
        else:
            parts = [(dr0, r0)]
        for dr, r in parts:
            if r.width > 70 or r.height > 70:
                continue
            cx = (r.x0 + r.x1) / 2
            if xlo <= cx <= xhi:
                pieces.append((r, dr))
    # chữ nằm trong ký hiệu (số cấp cảng, ...)
    spans = []
    for b in p.get_text('dict')['blocks']:
        for ln in b.get('lines', []):
            for sp in ln['spans']:
                r = fitz.Rect(sp['bbox']) * M
                r.normalize()
                if xlo <= (r.x0 + r.x1) / 2 <= xhi and r.y0 > 112 and sp['text'].strip():
                    spans.append((r, sp))
    # dòng ký hiệu = vùng quanh từng mục nhãn ở cột 2 (nhãn nhiều dòng gộp một mục; ranh giữa hai mục = trung điểm)
    lw = sorted([(((r.y0 + r.y1) / 2), r.x0, t) for r, t in words if 70 <= r.x0 < cols[0] - 45 and r.y0 > 112])
    lines = []
    for y, x, t in lw:
        if lines and abs(lines[-1][0] - y) < 3:
            lines[-1][1].append((x, t))
        else:
            lines.append([y, [(x, t)]])
    items = []
    for y, ws in lines:
        txt = ' '.join(t for _, t in sorted(ws))
        if items and y - items[-1]['ys'][-1] < 16 and not re.match(r'^[-+.*]', txt):
            items[-1]['ys'].append(y)
            items[-1]['txt'].append(txt)
        else:
            items.append({'ys': [y], 'txt': [txt]})
    for it in items:
        it['cy'] = sum(it['ys']) / len(it['ys'])
    for k, it in enumerate(items):
        it['lo'] = (items[k - 1]['cy'] + it['cy']) / 2 if k else 112
        it['hi'] = (it['cy'] + items[k + 1]['cy']) / 2 if k + 1 < len(items) else 560
    def band(r):
        cy = (r.y0 + r.y1) / 2
        for k, it in enumerate(items):
            if it['lo'] <= cy < it['hi']:
                return k
        return -1
    # cụm nét chạm nhau (nới 2 pt mỗi phía: nét đứt, vòng tròn bị đứt) trong cùng một cột giai đoạn; cụm thuộc dòng theo tâm cụm
    n = len(pieces)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    order = sorted(range(n), key=lambda i: pieces[i][0].x0)
    for ii, i in enumerate(order):
        ri = pieces[i][0]
        for j in order[ii + 1:]:
            rj = pieces[j][0]
            if rj.x0 > ri.x1 + 4:
                break
            gap = 4 if band(ri) == band(rj) else 0.8     # khác dòng nhãn: chỉ nối khi nét thật sự chạm nhau
            if rj.y0 <= ri.y1 + gap and ri.y0 <= rj.y1 + gap and rj.x0 <= ri.x1 + gap and abs((ri.x0 + ri.x1) / 2 - (rj.x0 + rj.x1) / 2) < 2 * half:
                parent[find(i)] = find(j)
    comps = {}
    for i in range(n):
        comps.setdefault(find(i), []).append(pieces[i])
    cells_map = {}
    groups = []
    for g in comps.values():
        gh = max(r.y1 for r, _ in g) - min(r.y0 for r, _ in g)
        if gh > MAX_BOX and len({band(r) for r, _ in g}) > 1:   # cụm dính nhiều dòng → chia lại theo tâm từng nét
            by = {}
            for pr in g:
                by.setdefault(band(pr[0]), []).append(pr)
            groups.extend(by.values())
        else:
            groups.append(g)
    for g in groups:
        cx = (min(r.x0 for r, _ in g) + max(r.x1 for r, _ in g)) / 2
        cy = (min(r.y0 for r, _ in g) + max(r.y1 for r, _ in g)) / 2
        ci = min(range(3), key=lambda c: abs(cols[c] - cx))
        if abs(cols[ci] - cx) > half:
            continue
        for k, it in enumerate(items):
            if it['lo'] <= cy < it['hi']:
                cells_map.setdefault((k, ci), []).extend(g)
                break
    cells = []
    for (k, ci), g in sorted(cells_map.items()):
        label = re.sub(r'^[-+.*\s]+', '', ' '.join(items[k]['txt'])).strip()
        cells.append((label, STAGES[ci][0], STAGES[ci][1], g,
                      (min(r.x0 for r, _ in g), min(r.y0 for r, _ in g), max(r.x1 for r, _ in g), max(r.y1 for r, _ in g))))
    for label, sfx, stage, grp, (gx0, gy0, gx1, gy1) in cells:
        tx = [(r, sp) for r, sp in spans if gx0 - 1 <= r.x0 and r.x1 <= gx1 + 1 and gy0 - 1 <= r.y0 and r.y1 <= gy1 + 1]
        if True:
            x0 = min(r.x0 for r, _ in grp); y0 = min(r.y0 for r, _ in grp)
            x1 = max(r.x1 for r, _ in grp); y1 = max(r.y1 for r, _ in grp)
            w, hh = x1 - x0, y1 - y0
            if w < 3 or hh < 3:
                continue
            ok = w <= MAX_BOX and hh <= MAX_BOX and max(w / hh, hh / w) <= MAX_ASPECT
            if not ok or SKIP_LABEL.match(label):
                skipped.append('tr.%d %s [%s] %.0fx%.0f' % (pn, label or '?', sfx, w, hh))
                continue
            els, seen = [], set()
            for r, dr in grp:
                d = path_d(dr['items'], M, x0, y0)
                if not d:
                    continue
                at = style_attrs(dr)
                if (d, at) in seen:
                    continue
                seen.add((d, at))
                els.append('<path d="%s" %s/>' % (d, at))
            for r, sp in tx:
                if not (x0 - 1 <= r.x0 and r.x1 <= x1 + 1 and y0 - 1 <= r.y0 and r.y1 <= y1 + 1):
                    continue
                c = sp.get('color', 0)
                col = '#%02x%02x%02x' % ((c >> 16) & 255, (c >> 8) & 255, c & 255)
                els.append('<text x="%s" y="%s" font-family="Arial, Helvetica, sans-serif" font-size="%s" fill="%s">%s</text>' % (
                    fmt(r.x0 - x0), fmt(r.y1 - y0 - 0.2 * r.height), fmt(sp['size']), col, html.escape(sp['text'].strip())))
            if not els:
                continue
            base = slug(label) or 'ky_hieu'
            fn = 'M8_t%d_%s_%s.svg' % (pn, base, sfx)
            n = 2
            while os.path.exists(os.path.join(OUT, fn)):
                fn = 'M8_t%d_%s_%d_%s.svg' % (pn, base, n, sfx)
                n += 1
            sc = 4
            title = '%s — %s' % (label or 'ký hiệu', stage)
            open(os.path.join(OUT, fn), 'w', encoding='utf-8').write(
                '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">\n'
                '<title>%s</title>\n%s\n</svg>\n' % (fmt(w * sc), fmt(hh * sc), fmt(w), fmt(hh), html.escape(title), '\n'.join(els)))
            cs = sorted({m for e in els for m in re.findall(r'(?:fill|stroke)="(#[0-9a-f]{6})"', e)})
            index.append({'file': fn, 'muc': 8, 'page': pn, 'label': label, 'stage': stage, 'colors': cs,
                          'width': round(w, 1), 'height': round(hh, 1)})


# --- Ký hiệu chức năng cụ thể trong cột Ghi chú của Mục 2–6 (vòng tròn/tam giác có chữ: văn hóa, trường THPT, chợ, y tế...) ---
MUC_PAGES = {2: (62, 66), 3: (67, 71), 4: (72, 79), 5: (80, 85), 6: (86, 90)}
seen_icons = {}
for muc, (pa, pb) in MUC_PAGES.items():
    for pn in range(pa, pb + 1):
        p = doc[pn - 1]
        M = p.rotation_matrix
        words = [(fitz.Rect(w[:4]) * M, w[4]) for w in p.get_text('words')]
        pcs = []
        for dr0 in p.get_drawings():
            r = fitz.Rect(dr0['rect']) * M
            r.normalize()
            if r.x0 > 690 and r.y0 > 120 and r.width < 40 and r.height < 40:
                pcs.append((r, dr0))
        if not pcs:
            continue
        parent = list(range(len(pcs)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for i in range(len(pcs)):
            for j in range(i + 1, len(pcs)):
                a, b = pcs[i][0], pcs[j][0]
                if a.x0 <= b.x1 + 2 and b.x0 <= a.x1 + 2 and a.y0 <= b.y1 + 2 and b.y0 <= a.y1 + 2:
                    parent[find(i)] = find(j)
        comps = {}
        for i, pc in enumerate(pcs):
            comps.setdefault(find(i), []).append(pc)
        spans = []
        for blk in p.get_text('dict')['blocks']:
            for ln in blk.get('lines', []):
                for sp in ln['spans']:
                    r = fitz.Rect(sp['bbox']) * M
                    r.normalize()
                    if sp['text'].strip():
                        spans.append((r, sp))
        for g in comps.values():
            x0 = min(r.x0 for r, _ in g); y0 = min(r.y0 for r, _ in g)
            x1 = max(r.x1 for r, _ in g); y1 = max(r.y1 for r, _ in g)
            w, hh = x1 - x0, y1 - y0
            if not (10 <= w <= 40 and 10 <= hh <= 40) or max(w / hh, hh / w) > 1.6 or len(g) < 2:
                continue
            cy = (y0 + y1) / 2
            near = sorted([(round(r.y0 / 4), r.x0, t) for r, t in words if r.x0 >= x1 - 1 and r.x0 < x1 + 140 and abs((r.y0 + r.y1) / 2 - cy) < 16])
            label = ' '.join(t for _, _, t in near)
            els = []
            for r, dr in g:
                d = path_d(dr['items'], M, x0, y0)
                if d:
                    els.append('<path d="%s" %s/>' % (d, style_attrs(dr)))
            for r, sp in spans:
                if x0 - 1 <= r.x0 and r.x1 <= x1 + 1 and y0 - 1 <= r.y0 and r.y1 <= y1 + 1:
                    c = sp.get('color', 0)
                    els.append('<text x="%s" y="%s" font-family="Arial, Helvetica, sans-serif" font-size="%s" fill="#%06x">%s</text>' % (
                        fmt(r.x0 - x0), fmt(r.y1 - y0 - 0.2 * r.height), fmt(sp['size']), c & 0xffffff, html.escape(sp['text'].strip())))
            if not els:
                continue
            key = ''.join(els)[:400]
            if key in seen_icons:      # cùng ký hiệu lặp ở các Mục khác (nhãn có thể là nét vẽ nên so theo hình)
                if muc not in seen_icons[key]['alsoIn'] and muc != seen_icons[key]['muc']:
                    seen_icons[key]['alsoIn'].append(muc)
                continue
            if not label:               # không có nhãn chữ và chưa gặp ở Mục nào → không đặt tên được (thường là chữ nét vẽ)
                continue
            fn = 'M%d_t%d_%s.svg' % (muc, pn, slug(label) or 'ky_hieu')
            n = 2
            while os.path.exists(os.path.join(OUT, fn)):
                fn = 'M%d_t%d_%s_%d.svg' % (muc, pn, slug(label) or 'ky_hieu', n)
                n += 1
            sc = 4
            open(os.path.join(OUT, fn), 'w', encoding='utf-8').write(
                '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">\n'
                '<title>%s</title>\n%s\n</svg>\n' % (fmt(w * sc), fmt(hh * sc), fmt(w), fmt(hh), html.escape(label or 'ký hiệu'), '\n'.join(els)))
            cs = sorted({m for e in els for m in re.findall(r'(?:fill|stroke)="(#[0-9a-f]{6})"', e)})
            ent = {'file': fn, 'muc': muc, 'page': pn, 'label': label, 'stage': 'Ký hiệu chức năng (ghi chú)', 'colors': cs,
                   'width': round(w, 1), 'height': round(hh, 1), 'alsoIn': []}
            seen_icons[key] = ent
            index.append(ent)

json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
cells = []
for e in index:
    svg = open(os.path.join(OUT, e['file']), encoding='utf-8').read().split('?>', 1)[1]
    svg = re.sub(r'<title>.*?</title>', '', svg, flags=re.S)
    svg = re.sub(r' width="[^"]*" height="[^"]*"', '', svg, count=1)
    cells.append('<figure><div class="sw">%s</div><figcaption><b>%s</b><br>%s · tr.%d</figcaption></figure>' % (
        svg, html.escape(e['label'] or ''), html.escape(e['stage']), e['page']))
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(
    '<!doctype html><meta charset="utf-8"><title>Ký hiệu điểm TT16</title><style>'
    'body{font:12px system-ui;margin:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}'
    'figure{margin:0;border:1px solid #ccd;padding:8px;border-radius:8px}'
    '.sw{height:64px;display:flex;align-items:center;justify-content:center;'
    'background:conic-gradient(#ddd 25%,#fff 0 50%,#ddd 0 75%,#fff 0) 0 0/12px 12px}'
    '.sw svg{max-width:100%;max-height:100%;height:56px}figcaption{margin-top:6px;color:#334}</style>' + ''.join(cells))
print(len(index), 'svg;', len(skipped), 'ô bỏ (không phải điểm)')
if os.environ.get('SHOW_SKIPPED'):
    for s in skipped:
        print('SKIP', s)
