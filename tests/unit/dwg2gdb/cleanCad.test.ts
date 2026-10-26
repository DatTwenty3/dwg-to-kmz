// "Làm sạch, chuẩn hóa bản vẽ theo TT16" — the tool the skill .claude/skills/lam-sach-ban-ve-quy-hoach drives (skipped
// unless CLEAN_IN is set). A folder of DWG/DXF (xrefs, blocks…) in, a clean DXF per map + pictures + reports out:
//
//   CLEAN_IN="<folder>" CLEAN_MODE=inventory npx vitest run tests/unit/dwg2gdb/cleanCad.test.ts   # look first
//   CLEAN_IN="<folder>" CLEAN_MODE=clean     npx vitest run tests/unit/dwg2gdb/cleanCad.test.ts   # then clean
//
// Env: CLEAN_IN (folder), CLEAN_OUT_DIR (default dwg_to_gdb_sach/<folder name>), CLEAN_DECISIONS (JSON of CleanOverride[],
// default <out>/quyet-dinh.json when it exists), CLEAN_PNG=0 to skip pictures.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity, LineTypeDef } from '@/lib/cad/types';
import { parseDwg, parseDxf } from '@/lib/cad';
import { toDxf } from '@/lib/export/dxf';
import {
  addTitleBlock,
  analyzeDrawings,
  buildFeatures,
  cleanDocument,
  colorContexts,
  compactName,
  drawingTexts,
  initialMapping,
  loadFolder,
  previewSvg,
  roleById,
  type CleanLine,
  type CleanOverride,
  type CleanResult,
} from '@/lib/dwg2gdb';
import { WASM_DIR } from '../fixtures';

const IN = process.env.CLEAN_IN ?? '';
const MODE = process.env.CLEAN_MODE ?? 'clean';
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const fmt = (n: number) => n.toLocaleString('vi-VN');
const safe = (s: string) => s.replace(/\.(dwg|dxf)$/i, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim();
// A picture is written from memory with a few retries: a real-time virus scanner can hold a large new file for a moment ("unable to open for write").
const writeFileRetry = async (file: string, data: Buffer) => {
  for (let k = 0; ; k++) {
    try { writeFileSync(file, data); return; } catch (e) { if (k >= 4) throw e; await new Promise((r) => setTimeout(r, 1500 * (k + 1))); }
  }
};
const png = async (svg: string, file: string) => { await writeFileRetry(file, await sharp(Buffer.from(svg), { limitInputPixels: false }).png().toBuffer()); };

describe.skipIf(!IN || !existsSync(IN))('Làm sạch bản vẽ theo TT16', () => {
  it(basename(IN), { timeout: 3_600_000 }, async () => {
    const OUT = process.env.CLEAN_OUT_DIR ?? `dwg_to_gdb_sach/${basename(IN)}`;
    mkdirSync(OUT, { recursive: true });
    const decisionsFile = process.env.CLEAN_DECISIONS ?? `${OUT}/quyet-dinh.json`;
    // quyet-dinh.json: [overrides…] or { "ranh": "<layer or /regex/>", "overrides": […] } (ranh: the layer of the planning area).
    const decided = existsSync(decisionsFile) ? (JSON.parse(readFileSync(decisionsFile, 'utf8')) as CleanOverride[] | { ranh?: string; overrides?: CleanOverride[] }) : [];
    const overrides: CleanOverride[] = Array.isArray(decided) ? decided : (decided.overrides ?? []);
    const ranhSpec = Array.isArray(decided) ? undefined : decided.ranh;
    const asRegex = ranhSpec ? /^\/(.+)\/[a-z]*$/.exec(ranhSpec) : null;
    const ranhLayer = ranhSpec ? new RegExp(asRegex ? asRegex[1] : compactName(ranhSpec).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined;
    const pictures = process.env.CLEAN_PNG !== '0';

    const files = walk(IN).filter((f) => /\.(dwg|dxf)$/i.test(f)).map((f, i) => ({
      id: `f${i}`, name: f.split(sep).pop()!, path: relative(IN, f).split(sep).join('/'), size: statSync(f).size,
      read: async () => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
    }));
    const folder = await loadFolder(files, (f, data) => (/\.dxf$/i.test(f.name) ? parseDxf(data, { wasmBaseUrl: WASM_DIR }) : parseDwg(data, { wasmBaseUrl: WASM_DIR })));
    const a = analyzeDrawings(folder.drawings, undefined, ranhLayer);
    const mapping = initialMapping(a, null);
    const colors = colorContexts(a);
    const docOf = new Map(folder.drawings.map((p) => [p.id, p]));
    const mains = a.drawings.filter((d) => d.included && !d.owner && roleById(d.role).db);
    expect(mains.length).toBeGreaterThan(0);

    const head = [`# ${MODE === 'inventory' ? 'Kiểm kê' : 'Làm sạch'} bản vẽ — ${basename(IN)}`, ''];
    head.push(`Ranh lập quy hoạch: ${a.boundary ? `${fmt(Math.round(a.boundary.area / 1e4))} ha` : '**không tìm thấy** (cần chỉ ra layer ranh)'}. ${overrides.length ? `Có ${overrides.length} quyết định trong \`${decisionsFile}\`.` : 'Chưa có tệp quyết định.'}`, '');
    if (folder.missingXrefs.length) head.push(`⚠ **Xref không tìm thấy** (bản vẽ chủ sẽ thiếu nền — cần bổ sung tệp): ${folder.missingXrefs.join('; ')}`, '');
    if (folder.unused.length) head.push(`Tệp không dùng (khung tên, sơ đồ vị trí, xref không ai tham chiếu…): ${folder.unused.map((u) => u.name).join(', ')}`, '');
    const skipped = a.drawings.filter((d) => !d.included || (!d.owner && !roleById(d.role).db));
    if (skipped.length) head.push(`Không đưa vào: ${skipped.map((d) => `${d.name} (${roleById(d.role).label})`).join(', ')}`, '');
    const md = [...head];
    const written: { dxf: string; name: string; role: string }[] = [];

    for (const m of mains) {
      const group = a.drawings.filter((d) => d.included && (d.id === m.id || d.owner?.id === m.id));
      const inputs = group.map((g) => { const p = docOf.get(g.id)!; return { id: g.id, name: g.name, doc: p.doc, inside: a.inside.get(g.id)!, color: colors.get(g.id), role: g.role }; });
      const res: CleanResult = cleanDocument(inputs, mapping, a.boundary?.ring ?? null, overrides, { keepBase: process.env.CLEAN_NEN !== '0' });
      const base = safe(m.name);
      const titles = MODE === 'clean' ? addTitleBlock(res.doc, m.role, inputs.flatMap((i) => drawingTexts(i.doc))) : [];
      md.push(`## ${m.name}`, '', `${roleById(m.role).label} · ${group.length} tệp (kể cả xref: ${group.filter((g) => g.owner).map((g) => g.name).join(', ') || 'không'}) · đọc ${fmt(res.totals.read)} đối tượng → ${MODE === 'clean' ? `**giữ ${fmt(res.totals.kept)}**, ` : `đề xuất giữ ${fmt(res.totals.kept)}, `}ngoài ranh ${fmt(res.totals.outside)}, bỏ/gộp ${fmt(res.totals.read - res.totals.kept - res.totals.outside)}.`, '');

      // The originals, as drawn (xrefs included), and the area they are shown in: the planning boundary plus a margin.
      const merged: CadDocument = { units: 'm', crs: null, layers: [], entities: inputs.flatMap((i) => i.doc.entities), bbox: [[0, 0], [0, 0]], warnings: [], lineTypes: Object.assign({}, ...inputs.map((i) => i.doc.lineTypes ?? {})) as Record<string, LineTypeDef> };
      const ring = a.boundary?.ring ?? null;
      const xs = (ring ?? []).map((p) => p[0]);
      const ys = (ring ?? []).map((p) => p[1]);
      const pad = ring ? 0.08 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
      const box = ring ? ([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad] as [number, number, number, number]) : undefined;
      if (pictures) {
        mkdirSync(`${OUT}/kiem-ke`, { recursive: true });
        if (MODE === 'inventory') {
          merged.bbox = box ? [[box[0], box[1]], [box[2], box[3]]] : merged.bbox;
          await png(previewSvg(merged, { px: 2600, box, colorBy: 'layer', title: `${m.name} — màu theo layer` }).svg, `${OUT}/kiem-ke/${base}_theo-layer.png`);
          await png(previewSvg(merged, { px: 2600, box, colorBy: 'entity', title: `${m.name} — như bản vẽ gốc` }).svg, `${OUT}/kiem-ke/${base}_goc.png`);
          md.push(`Ảnh: \`kiem-ke/${base}_theo-layer.png\` (mỗi layer một màu + chú giải) · \`kiem-ke/${base}_goc.png\` (như bản vẽ).`, '');
        }
      }

      // Per source layer: what it is, how much of it lies in the area, what the rules propose.
      const byLayer = new Map<string, { kinds: Record<string, number>; inside: number; total: number; colors: Set<string>; widths: number[]; lt: Set<string> }>();
      inputs.forEach((inp) => inp.doc.entities.forEach((e: CadEntity, i) => {
        const r = byLayer.get(e.layer) ?? { kinds: {}, inside: 0, total: 0, colors: new Set(), widths: [], lt: new Set() };
        r.kinds[e.kind] = (r.kinds[e.kind] ?? 0) + 1;
        r.total++;
        if (inp.inside[i]) r.inside++;
        if (r.colors.size < 3) r.colors.add(e.color);
        if (e.kind === 'polyline' && e.width) r.widths.push(e.width);
        if (e.kind === 'polyline' && e.lineType && !/continuous/i.test(e.lineType)) r.lt.add(e.lineType);
        byLayer.set(e.layer, r);
      }));
      const proposal = (layer: string) => {
        const ls = res.lines.filter((l: CleanLine) => l.from.endsWith(` · ${layer}`));
        const to = [...new Set(ls.filter((l) => l.to && l.kept).map((l) => l.to!))];
        const drop = [...new Set(ls.filter((l) => !l.to).map((l) => l.why))];
        const look = ls.some((l) => l.look);
        return `${to.length ? `→ ${to.join(', ')}` : ''}${to.length && drop.length ? ' · ' : ''}${drop.length ? `bỏ: ${drop.join('; ').slice(0, 80)}` : ''}${look ? ' ⚠' : ''}` || '(ngoài ranh)';
      };
      if (MODE === 'inventory') {
        md.push('### Layer (theo số đối tượng trong ranh)', '', '| Layer | Loại | Trong ranh / tổng | Màu | Độ rộng | Kiểu nét | Đề xuất của quy tắc |', '|---|---|---:|---|---|---|---|');
        for (const [layer, r] of [...byLayer].sort((x, y) => y[1].inside - x[1].inside).slice(0, 90)) {
          const w = r.widths.length ? `${Math.min(...r.widths).toFixed(1)}–${Math.max(...r.widths).toFixed(1)}` : '';
          md.push(`| ${layer} | ${Object.entries(r.kinds).map(([k, v]) => `${({ polyline: 'L', polygon: 'A', text: 'T', point: 'P', table: 'B' } as Record<string, string>)[k] ?? k}${v}`).join(' ')} | ${fmt(r.inside)} / ${fmt(r.total)} | ${[...r.colors].join(' ')} | ${w} | ${[...r.lt].join(', ')} | ${proposal(layer)} |`);
        }
        md.push('');
        continue;
      }

      const dxfText = toDxf(res.doc, { units: 'm', layers: res.doc.layers.map((l) => l.name) });
      writeFileSync(`${OUT}/${base}_TT16.dxf`, dxfText);
      written.push({ dxf: `${OUT}/${base}_TT16.dxf`, name: `${base}_TT16.dxf`, role: m.role });
      if (pictures) await png(previewSvg(res.doc, { px: 2400, colorBy: 'entity', include: (i) => !res.doc.layers.some((l) => !l.visible && l.name === res.doc.entities[i].layer) }).svg, `${OUT}/${base}_xem-truoc.png`);
      if (pictures) {
        // The picture for the person who checks: the same area twice, every layer in its own colour with its name in the legend —
        // left the drawing and layers as received, right the cleaned drawing and its standard layers.
        const PX = 2000;
        // The legend sits in the top-left corner of each picture: widen the area to the left so it lies on blank paper, not on the map.
        const wide = box ? ([box[0] - 0.26 * (box[2] - box[0]), box[1], box[2], box[3]] as [number, number, number, number]) : undefined;
        const left = previewSvg(merged, { px: PX, box: wide, colorBy: 'layer', title: `GỐC — ${m.name} (layer gốc)` });
        const right = previewSvg(res.doc, { px: PX, box: wide, colorBy: 'layer', title: `SẠCH — ${base}_TT16.dxf (layer đã chuẩn hóa)` });
        const [pl, pr] = await Promise.all([sharp(Buffer.from(left.svg), { limitInputPixels: false }).png().toBuffer(), sharp(Buffer.from(right.svg), { limitInputPixels: false }).png().toBuffer()]);
        const h = Math.max(left.height, right.height);
        await writeFileRetry(`${OUT}/${base}_so-sanh.png`, await sharp({ create: { width: PX * 2 + 24, height: h, channels: 3, background: '#9ca3af' } }).composite([{ input: pl, left: 0, top: 0 }, { input: pr, left: PX + 24, top: 0 }]).png().toBuffer());
      }
      if (titles.length) md.push(`Tiêu đề ghi vào bản vẽ (layer BV_Ten_Banve, để web app nhận ra loại bản đồ và Mục): ${titles.map((t) => `“${t}”`).join(' · ')}`, '');
      const keep = res.lines.filter((l) => l.to && l.kept).sort((x, y) => y.kept - x.kept);
      md.push('### Giữ / đổi layer', '', '| Layer gốc | → Layer mới | SL | Lý do | |', '|---|---|---:|---|---|');
      for (const l of keep) md.push(`| ${l.from} | ${l.to} | ${fmt(l.kept)} | ${l.why} | ${l.look ? '⚠ xem lại' : ''} |`);
      const drop = res.lines.filter((l) => !l.to || !l.kept).sort((x, y) => y.dropped - x.dropped);
      md.push('', '### Bỏ', '', '| Layer gốc | SL | Lý do | |', '|---|---:|---|---|');
      for (const l of drop.slice(0, 80)) md.push(`| ${l.from} | ${fmt(l.dropped)} | ${l.why} | ${l.look ? '⚠ xem lại' : ''} |`);
      if (drop.length > 80) md.push(`| … còn ${drop.length - 80} dòng nhỏ | | | |`);
      md.push('', `### Layer của tệp sạch (${res.doc.layers.length})`, '', res.doc.layers.map((l) => `\`${l.name}\``).join(' · '), '');
    }

    if (MODE === 'clean' && written.length) {
      // The clean drawings are the input of the web app: read them back the way the app does and see what it makes of them.
      const back = await loadFolder(
        written.map((w, i) => ({ id: `c${i}`, name: w.name, path: w.name, size: 0, read: async () => { const b = readFileSync(w.dxf); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; } })),
        (_f, data) => parseDxf(data, { wasmBaseUrl: WASM_DIR }),
      );
      const b = analyzeDrawings(back.drawings);
      const bm = initialMapping(b, null);
      const bc = colorContexts(b);
      md.push('## Kiểm tra: đọc lại bằng web app', '', `Ranh nhận ra: ${b.boundary ? `${fmt(Math.round(b.boundary.area / 1e4))} ha` : '**KHÔNG** nhận ra ranh'}${a.boundary && b.boundary ? ` (gốc ${fmt(Math.round(a.boundary.area / 1e4))} ha)` : ''}.`, '', '| Tệp sạch | Loại bản đồ nhận ra | Loại gốc | Layer chưa nhận ra (cần xem) | Lớp TT16 tạo được |', '|---|---|---|---:|---|');
      const problems: string[] = [];
      for (let i = 0; i < written.length; i++) {
        const d = b.drawings.find((x) => x.name === written[i].name);
        if (!d) { problems.push(`${written[i].name}: không đọc lại được`); continue; }
        const rows = b.rows.filter((r) => r.drawing === d.id && r.count > 0);
        const unknown = rows.filter((r) => r.kind !== 'T' && bm.get(r.key)?.unknown && !bm.get(r.key)?.target);
        const built = buildFeatures([{ id: d.id, name: d.name, doc: back.drawings.find((x) => x.id === d.id)!.doc, inside: b.inside.get(d.id)!, color: bc.get(d.id) }], bm, { boundary: b.boundary?.ring ?? null, sourceInGhiChu: false, planUnit: '' });
        const classes = built.classes.map((c) => `${c.cls} ${c.features.length}`).join(', ');
        md.push(`| ${written[i].name} | ${roleById(d.role).label} | ${roleById(written[i].role as never).label} | ${unknown.length}${unknown.length ? ` (${unknown.map((r) => r.layer).slice(0, 4).join(', ')})` : ''} | ${classes || '—'} |`);
        if (d.role !== written[i].role) problems.push(`${written[i].name}: web app nhận là "${roleById(d.role).label}" thay vì "${roleById(written[i].role as never).label}" (đặt lại tên tệp có từ khóa loại bản đồ)`);
        if (unknown.length) problems.push(`${written[i].name}: ${unknown.length} layer chưa nhận ra`);
      }
      md.push('', problems.length ? `⚠ **Cần xử lý:**\n${problems.map((p) => `- ${p}`).join('\n')}` : '✔ Web app nhận ra đủ loại bản đồ, ranh và các layer.');
    }
    writeFileSync(`${OUT}/${MODE === 'inventory' ? 'KIEM_KE' : 'BAO_CAO'}.md`, md.join('\n'));
  });
});
