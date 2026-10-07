'use client';
// Báo cáo PDF kết quả kiểm tra CSDL GIS theo Thông tư 16/2025/TT-BXD — tạo ngay trên trình duyệt (jsPDF + autotable,
// tải động khi bấm xuất). Chữ tiếng Việt dùng Be Vietnam Pro (TTF trong public/fonts, OFL) vì font chuẩn của PDF
// không có dấu tiếng Việt. Mỗi trang có logo + LEDAT-GIS / GEOSPATIAL SOLUTIONS ở đầu và số trang ở chân.
import type { jsPDF } from 'jspdf';
import type { ClassReport, GdbReport, Level, Status, SubmissionReport } from '@/lib/gdb/check';
import { rowsFor } from '@/lib/gdb/rows';
import { describeMaThongTin, parseMaHoSo, parseMaThongTin, TT16_DATABASES } from '@/lib/gdb/tt16';
import { BRAND_NAVY, LOGO_PATH, LOGO_VIEWBOX } from './brand';

type RGB = [number, number, number];
const NAVY: RGB = [14, 31, 59];
const GRAY: RGB = [113, 113, 122];
const LIGHT: RGB = [244, 244, 245];
const TONE: Record<Status, RGB> = {
  ok: [5, 150, 105],
  warn: [180, 83, 9],
  error: [185, 28, 28],
  missing: [185, 28, 28],
  absent: [161, 161, 170],
  extra: [37, 99, 235],
};
const LABEL: Record<Status, string> = { ok: 'Đạt', warn: 'Cần xem lại', error: 'Sai', missing: 'Thiếu', absent: 'Chưa có', extra: 'Bổ sung' };
const LEVEL: Record<Level, { text: string; tone: RGB }> = {
  error: { text: 'Lỗi', tone: TONE.error },
  warn: { text: 'Cảnh báo', tone: TONE.warn },
  info: { text: 'Ghi chú', tone: GRAY },
};
const GEOM = { A: 'Vùng', L: 'Đường', P: 'Điểm' } as const;
const FONT = 'BeVietnamPro';
const M = 14; // page margin (mm)
const fmt = (n: number) => n.toLocaleString('vi-VN');
const actualDatasets = (g: GdbReport) => g.datasets.filter((d) => d.actualName).length;
const actualClasses = (g: GdbReport) => [...g.datasets.flatMap((d) => d.classes), ...g.rootClasses].filter((c) => c.status !== 'absent').length;

/** Logo mark rasterised from the brand path (jsPDF cannot draw SVG paths). */
function logoPng(px = 256): string {
  const [x0, y0, w, h] = LOGO_VIEWBOX.split(/\s+/).map(Number);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.scale(px / w, px / h);
  ctx.translate(-x0, -y0);
  ctx.fillStyle = BRAND_NAVY;
  ctx.fill(new Path2D(LOGO_PATH), 'evenodd');
  return c.toDataURL('image/png');
}

async function fontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được font ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const srText = (c: { sr: { vn2000: boolean; name: string; lon0: number | null; zone: number | null } | null }) => {
  if (!c.sr) return '';
  const d = c.sr.lon0;
  const ktt = d === null ? '' : ` • ${Math.floor(d + 1e-9)}°${String(Math.round((d - Math.floor(d + 1e-9)) * 60)).padStart(2, '0')}'`;
  return `${c.sr.vn2000 ? 'VN2000' : c.sr.name}${ktt}${c.sr.zone ? ` • Múi ${c.sr.zone}°` : ''}`;
};

export interface PdfOptions {
  /** Include "Ghi chú" (reference classes not present) in the issue lists. */
  includeInfo?: boolean;
}

export async function buildGdbPdf(rep: SubmissionReport, opts: PdfOptions = {}): Promise<{ blob: Blob; fileName: string }> {
  const [{ jsPDF: JsPDF }, { autoTable }, regular, bold] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    fontBase64('/fonts/BeVietnamPro-Regular.ttf'),
    fontBase64('/fonts/BeVietnamPro-Bold.ttf'),
  ]);
  const doc: jsPDF = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('BeVietnamPro-Regular.ttf', regular);
  doc.addFileToVFS('BeVietnamPro-Bold.ttf', bold);
  doc.addFont('BeVietnamPro-Regular.ttf', FONT, 'normal');
  doc.addFont('BeVietnamPro-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
  doc.setProperties({ title: 'Báo cáo kiểm tra CSDL GIS quy hoạch', author: 'LEDAT-GIS', creator: 'LEDAT-GIS — Geospatial Solutions' });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const logo = logoPng();
  const now = new Date();
  const stamp = now.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  const TOP = 28; // content starts below the page header
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? TOP;

  const header = () => {
    doc.addImage(logo, 'PNG', M, 8, 11, 11);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text('LEDAT-GIS', M + 13.5, 13.4);
    const brandW = doc.getTextWidth('LEDAT-GIS');
    doc.setFont(FONT, 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(...GRAY);
    // Spread the tagline across the wordmark width, as in the logo artwork.
    const tag = 'GEOSPATIAL SOLUTIONS';
    const step = (brandW - doc.getTextWidth(tag)) / (tag.length - 1);
    doc.text(tag, M + 13.5, 17.6, { charSpace: Math.max(0, step) });
    doc.setFontSize(8.5);
    doc.text('Báo cáo kiểm tra CSDL GIS quy hoạch', W - M, 12.6, { align: 'right' });
    doc.text(stamp, W - M, 16.8, { align: 'right' });
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.4);
    doc.line(M, 21.5, W - M, 21.5);
  };
  const tableDefaults = {
    margin: { top: TOP, left: M, right: M, bottom: 16 },
    styles: { font: FONT, fontSize: 8, cellPadding: 1.6, textColor: [39, 39, 42] as RGB, lineColor: [228, 228, 231] as RGB, lineWidth: 0.1 },
    headStyles: { font: FONT, fontStyle: 'bold' as const, fillColor: NAVY, textColor: [255, 255, 255] as RGB, halign: 'center' as const },
    didDrawPage: header,
  };
  const heading = (text: string, y: number, size = 11.5) => {
    if (y > H - 40) {
      doc.addPage();
      header();
      y = TOP + 2;
    }
    doc.setFont(FONT, 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...NAVY);
    doc.text(text, M, y);
    return y + 3;
  };

  // ---------- Title & conclusion ----------
  header();
  let y = TOP + 6;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  doc.text('BÁO CÁO KIỂM TRA CƠ SỞ DỮ LIỆU GIS QUY HOẠCH', W / 2, y, { align: 'center' });
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  y += 5.5;
  doc.text('Căn cứ Thông tư 16/2025/TT-BXD (Phụ lục II); mã thông tin quy hoạch theo Nghị định 111/2024/NĐ-CP và Thông tư 24/2025/TT-BXD', W / 2, y, {
    align: 'center',
    maxWidth: W - 2 * M,
  });

  const errors = rep.gdbs.reduce((t, g) => t + g.counts.errors, rep.issues.filter((i) => i.level === 'error').length);
  const warnings = rep.gdbs.reduce((t, g) => t + g.counts.warnings, rep.issues.filter((i) => i.level === 'warn').length);
  const maHoSo = rep.maHoSo[0]?.[0];
  const pHoSo = maHoSo ? parseMaHoSo(maHoSo) : null;
  const maTT = rep.maThongTin[0]?.[0];
  const pTT = maTT ? parseMaThongTin(maTT) : null;

  autoTable(doc, {
    ...tableDefaults,
    startY: y + 5,
    theme: 'plain',
    styles: { ...tableDefaults.styles, fontSize: 9, lineWidth: 0 },
    columnStyles: { 0: { cellWidth: 42, textColor: GRAY } },
    body: [
      ['Thời điểm kiểm tra', stamp],
      ['Dữ liệu', rep.folder ? `Thư mục ${rep.folder.name} — ${rep.gdbs.map((g) => g.fileName).join(', ')}` : rep.gdbs.map((g) => g.fileName).join(', ')],
      ...(rep.folder ? [['Tệp tổng hợp', rep.folder.projectFiles.join(', ') || '— chưa có —']] : []),
      [
        'maHoSoQH',
        maHoSo
          ? `${maHoSo}${pHoSo ? ` (${pHoSo.provinceName ?? 'mã tỉnh ' + pHoSo.province} · ${pHoSo.kind})` : ' — sai mẫu'}${rep.maHoSo.length > 1 ? ` · và ${rep.maHoSo.length - 1} giá trị khác` : ''}`
          : '— chưa nhập —',
      ],
      [
        'maThongTinQH',
        maTT
          ? `${maTT}${pTT ? ` (${describeMaThongTin(pTT)})` : ' — sai mẫu 12 chữ số'}${rep.maThongTin.length > 1 ? ` · và ${rep.maThongTin.length - 1} giá trị khác` : ''}`
          : '— chưa nhập —',
      ],
      ['Kết luận', errors ? `CHƯA ĐẠT — ${fmt(errors)} lỗi cần sửa, ${fmt(warnings)} mục cần xem lại` : `ĐẠT${warnings ? ` — ${fmt(warnings)} mục cần xem lại` : ''}`],
    ],
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 1 && d.row.index === d.table.body.length - 1) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.textColor = errors ? TONE.error : TONE.ok;
      }
    },
  });

  // ---------- 1. Summary ----------
  y = heading('1. Tổng hợp', lastY() + 8);
  const summary = TT16_DATABASES.map((db) => {
    const g = rep.gdbs.find((x) => x.database === db.name);
    if (!g) return [db.name + '.gdb', db.title, '—', '—', '—', '—', rep.folder ? 'Thiếu' : 'Chưa tải lên'];
    const c = g.counts;
    // NenDiaHinh: the circular lists no groups/classes for it → show what the file has (marked *).
    if (!db.datasets.length) return [g.fileName, db.title, `${actualDatasets(g)}*`, `${actualClasses(g)}*`, '—', fmt(c.errors), fmt(c.warnings)];
    return [
      g.fileName,
      db.title,
      `${c.datasets.present}/${c.datasets.expected}`,
      `${c.classes.present}/${c.classes.reference}`,
      String(c.classes.extra),
      fmt(c.errors),
      fmt(c.warnings),
    ];
  });
  for (const g of rep.gdbs.filter((x) => !x.database))
    summary.push([g.fileName, 'Không xác định', `${actualDatasets(g)}*`, `${actualClasses(g)}*`, '—', fmt(g.counts.errors), fmt(g.counts.warnings)]);
  const starred = summary.some((r) => r[2].endsWith('*'));
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [['Geodatabase', 'Cơ sở dữ liệu', 'Nhóm dữ liệu', 'Lớp dữ liệu', 'Lớp bổ sung', 'Lỗi', 'Cảnh báo']],
    body: summary,
    foot: [
      [
        {
          content: `Nhóm dữ liệu: có / bắt buộc (Phụ lục II, Phần 2). Lớp dữ liệu: có / danh mục tham khảo (Phần 3).${
            starred ? ' * Thông tư không quy định danh mục cho CSDL này — ghi số nhóm / lớp đang có.' : ''
          }`,
          colSpan: 7,
        },
      ],
    ],
    footStyles: { font: FONT, fontStyle: 'normal', fontSize: 7, textColor: GRAY, fillColor: [255, 255, 255] },
    showFoot: 'lastPage',
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      const v = String(d.cell.raw);
      if (d.column.index === 5 && v !== '0' && v !== '—') d.cell.styles.textColor = TONE.error;
      if (d.column.index === 6 && v !== '0' && v !== '—') d.cell.styles.textColor = TONE.warn;
      if (v === 'Thiếu') d.cell.styles.textColor = TONE.error;
      if (v === 'Chưa tải lên') d.cell.styles.textColor = GRAY;
    },
  });
  if (rep.issues.length) {
    autoTable(doc, {
      ...tableDefaults,
      startY: lastY() + 3,
      head: [['Mức', 'Vấn đề của hồ sơ']],
      body: rep.issues.map((i) => [LEVEL[i.level].text, i.text]),
      columnStyles: { 0: { cellWidth: 20 } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 0) d.cell.styles.textColor = LEVEL[rep.issues[d.row.index].level].tone;
      },
    });
  }

  // ---------- 2. Each geodatabase ----------
  rep.gdbs.forEach((g: GdbReport, gi) => {
    y = heading(`2.${gi + 1}. ${g.fileName}${g.databaseTitle ? ` — ${g.databaseTitle}` : ''}`, lastY() + 9);
    if (g.crs) {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...TONE[g.crs.status]);
      const prov = g.province
        ? ` (tỉnh: ${g.province.code}${g.province.source === 'user' ? ' — người kiểm tra chọn' : ` — theo ${g.province.source}`})`
        : ' (chưa xác định được tỉnh của đồ án)';
      const lines = doc.splitTextToSize(`Hệ tọa độ${g.srNames.length ? ` ${g.srNames.join(', ')}` : ''}: ${g.crs.text}${prov}`, W - 2 * M) as string[];
      doc.text(lines, M, y + 1.5);
      y += lines.length * 3.8;
    }
    if (g.issues.length) {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8.5);
      for (const i of g.issues) {
        doc.setTextColor(...LEVEL[i.level].tone);
        const lines = doc.splitTextToSize(`• ${i.text}`, W - 2 * M) as string[];
        doc.text(lines, M, y + 1.5);
        y += lines.length * 3.8;
      }
    }

    // Structure: dataset rows (shaded) followed by their classes.
    type Line = { kind: 'ds' | 'cls'; status: Status; cells: string[]; crs?: Status };
    const lines: Line[] = [];
    const clsLine = (c: ClassReport): Line => ({
      kind: 'cls',
      status: c.status,
      cells: [
        `   ${c.actualName ?? c.name}`,
        GEOM[(c.actualGeom ?? c.expectedGeom) as 'A'] ?? '',
        c.rowCount === null ? '' : fmt(c.rowCount),
        c.fields.filter((f) => !f.actual).map((f) => f.name).join(', '),
        c.extraFields.join(', '),
        LABEL[c.status],
      ],
    });
    for (const d of g.datasets) {
      lines.push({
        kind: 'ds',
        status: d.status,
        cells: [
          `${d.actualName ?? d.name}${d.title ? ` — ${d.title}` : ''}`,
          d.status === 'missing'
            ? 'Chưa có nhóm dữ liệu'
            : `${srText(d) || 'Chưa xác định hệ tọa độ'}${d.crs && d.crs.status !== 'ok' ? `
${d.crs.text}` : d.crs ? ' — đúng vị trí' : ''}`,
          '',
          '',
          '',
          LABEL[d.status],
        ],
        crs: d.crs?.status,
      });
      for (const c of d.classes) lines.push(clsLine(c));
    }
    if (g.rootClasses.length) {
      lines.push({ kind: 'ds', status: 'warn', cells: ['Lớp ngoài nhóm dữ liệu', '', '', '', '', ''] });
      for (const c of g.rootClasses) lines.push(clsLine(c));
    }
    autoTable(doc, {
      ...tableDefaults,
      startY: y + 1,
      head: [['Nhóm dữ liệu / Lớp dữ liệu', 'Kiểu', 'Số đối tượng', 'Trường thiếu', 'Trường dư', 'Kết quả']],
      body: lines.map((l) => (l.kind === 'ds' ? [{ content: l.cells[0] }, { content: l.cells[1], colSpan: 4 }, l.cells[5]] : l.cells)),
      columnStyles: { 1: { cellWidth: 15 }, 2: { cellWidth: 20, halign: 'right' }, 3: { cellWidth: 34 }, 4: { cellWidth: 28 }, 5: { cellWidth: 20, halign: 'center' } },
      didParseCell: (d) => {
        if (d.section !== 'body') return;
        const l = lines[d.row.index];
        if (l.kind === 'ds') {
          d.cell.styles.fillColor = LIGHT;
          d.cell.styles.fontStyle = 'bold';
          if (d.column.index === 1) {
            d.cell.styles.fontStyle = 'normal';
            d.cell.styles.textColor = l.crs && l.crs !== 'ok' ? TONE[l.crs] : GRAY;
          }
        } else if (l.status === 'absent') d.cell.styles.textColor = TONE.absent;
        if (d.column.index === 5 || (l.kind === 'ds' && d.column.index === 2)) d.cell.styles.textColor = TONE[l.status];
        if (l.kind === 'cls' && d.column.index === 3 && d.cell.raw) d.cell.styles.textColor = TONE.error;
        if (l.kind === 'cls' && d.column.index === 4 && d.cell.raw) d.cell.styles.textColor = TONE.warn;
      },
    });

    // Numbered issue list.
    const rows = rowsFor(rep, g, { ds: null, cls: null }).filter((r) => r.kind !== 'Hồ sơ' && (opts.includeInfo || r.level !== 'info'));
    if (rows.length) {
      y = heading('Lỗi cần sửa & cảnh báo', lastY() + 7, 10);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        head: [['STT', 'Mức', 'Đối tượng', 'Nội dung']],
        body: rows.map((r, i) => [String(i + 1), LEVEL[r.level].text, `${r.kind} ${r.name}${r.field ? `\nField ${r.field}` : ''}`, r.example ? `${r.text}, vd. "${r.example}"` : r.text]),
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 17 }, 2: { cellWidth: 52 } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 1) d.cell.styles.textColor = LEVEL[rows[d.row.index].level].tone;
        },
      });
    } else {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...TONE.ok);
      doc.text('Không có lỗi hay cảnh báo.', M, lastY() + 6);
    }
  });

  // ---------- Notes ----------
  y = heading('Ghi chú', lastY() + 10, 10);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const notes = [
    'Nhóm dữ liệu (Phụ lục II, Phần 2) và 6 trường thuộc tính tối thiểu (Phần 3, mục 4) là bắt buộc; danh sách lớp dữ liệu ở Phần 3 là nội dung tham khảo — lớp chưa có ghi "Chưa có", không tính là lỗi; lớp phát sinh đặt tên theo <LopDuLieu>_<A|P|L>.',
    'Trường ngoài 6 trường quy định (trừ OBJECTID, Shape, Shape_Length, Shape_Area) được ghi là trường dư.',
    'maHoSoQH: <mã tỉnh 2 số><QHC|QPK|QCT><x><xx><xxxx>; maDoiTuong: <maHoSoQH>-<Tên lớp>-<ObjectID>; maThongTinQH: 12 chữ số <mã tỉnh><năm><cấp độ><loại QH><điều chỉnh><5 số>.',
    'Báo cáo được tạo tự động bởi LEDAT-GIS; dữ liệu được đọc trên máy người dùng, không tải lên máy chủ.',
  ];
  for (const n of notes) {
    const l = doc.splitTextToSize(`• ${n}`, W - 2 * M) as string[];
    if (y + l.length * 3.5 > H - 16) {
      doc.addPage();
      header();
      y = TOP + 2;
    }
    doc.text(l, M, y + 1);
    y += l.length * 3.5 + 0.8;
  }

  // ---------- Footer with page numbers ----------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(228, 228, 231);
    doc.setLineWidth(0.2);
    doc.line(M, H - 11, W - M, H - 11);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text('LEDAT-GIS · Kiểm tra CSDL GIS theo Thông tư 16/2025/TT-BXD', M, H - 7);
    doc.text(`Trang ${p}/${pages}`, W - M, H - 7, { align: 'right' });
  }

  const base = (rep.folder?.name ?? rep.gdbs[0]?.fileName.replace(/\.gdb$/i, '') ?? 'CSDL').replace(/[^\w.-]+/g, '_');
  return { blob: doc.output('blob'), fileName: `bao-cao-TT16-${base}-${now.toISOString().slice(0, 10)}.pdf` };
}
