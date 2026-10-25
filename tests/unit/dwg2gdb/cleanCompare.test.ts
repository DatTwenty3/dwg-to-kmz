// Đối chiếu bản vẽ gốc ↔ bản đã làm sạch — công cụ của skill .claude/skills/lam-sach-ban-ve-quy-hoach (bỏ qua nếu không có CMP_MODE).
// Dùng khi người dùng nói "nét/ranh chưa giống bản gốc": đừng đoán, dựng ảnh cạnh nhau rồi so từng lớp.
//
//   CMP_MODE=scan CMP_FILE=<.dwg> CMP_LAYERS="KS-GHICHU|MO_MA" CMP_OUT=<txt>                      # layer chứa gì (loại, độ rộng, kiểu nét, chữ hay gặp)
//   CMP_MODE=zoom CMP_FILE=<.dwg> CMP_ANCHOR="MO_MA" CMP_W=300 CMP_LAYERS="MO_MA|BODAT" CMP_OUT=<png>  # phóng to một chỗ, mỗi layer một màu + chú giải
//   CMP_MODE=side CMP_IN=<thư mục gốc> CMP_MAP=QH07 CMP_CLEAN=<.dwg|.dxf> CMP_CX=577000 CMP_CY=1074300 CMP_W=2500 CMP_OUT=<png>
//
// `side`: trái = bản gốc (cả xref), phải = bản sạch. **CMP_CLEAN nên là DWG do AutoCAD lưu từ DXF sạch** (scripts/verify-dxf-autocad.ps1):
// `parseDxf` không đọc LTYPE nên ảnh dựng từ DXF luôn thấy nét liền — dùng nó để so kiểu nét sẽ kết luận sai. Chữ và nền NEN_* không vẽ
// (CMP_NOBASE=0 để vẽ nền). Cạnh ảnh có <CMP_OUT>.txt: số đối tượng theo layer trong cửa sổ của mỗi bên.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/lib/cad/types';
import { parseDwg, parseDxf } from '@/lib/cad';
import { analyzeDrawings, loadFolder, previewSvg } from '@/lib/dwg2gdb';
import { WASM_DIR } from '../fixtures';

const MODE = process.env.CMP_MODE ?? '';
const env = (k: string) => process.env[k] ?? '';
const bytes = (f: string) => {
  const b = readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const read = (f: string): Promise<CadDocument> => (/\.dxf$/i.test(f) ? parseDxf(bytes(f), { wasmBaseUrl: WASM_DIR }) : parseDwg(bytes(f), { wasmBaseUrl: WASM_DIR }));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const layerSet = () => env('CMP_LAYERS').split('|').filter(Boolean);
const png = (svg: string) => sharp(Buffer.from(svg), { limitInputPixels: false }).png();

function firstPoint(e: CadDocument['entities'][number]): [number, number] | undefined {
  if (e.kind === 'polyline') return e.points[0];
  if (e.kind === 'polygon') return e.rings[0]?.[0];
  if (e.kind === 'text' || e.kind === 'point') return e.position;
  return undefined;
}

describe.skipIf(!MODE)('Đối chiếu gốc ↔ sạch', () => {
  it.skipIf(MODE !== 'scan')('scan: layer chứa gì', { timeout: 600_000 }, async () => {
    const doc = await read(env('CMP_FILE'));
    const out: string[] = [];
    for (const layer of layerSet()) {
      const es = doc.entities.filter((e) => e.layer === layer);
      const kinds: Record<string, number> = {};
      const widths: number[] = [];
      const types = new Set<string>();
      const texts = new Map<string, number>();
      for (const e of es) {
        kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
        if (e.kind === 'polyline') {
          widths.push(e.width ?? 0);
          types.add(e.lineType ?? '');
        }
        if (e.kind === 'text') texts.set(e.text, (texts.get(e.text) ?? 0) + 1);
      }
      const top = [...texts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t, n]) => `${t}×${n}`).join(' | ');
      out.push(`LAYER ${layer}: ${JSON.stringify(kinds)}${widths.length ? ` w=${Math.min(...widths)}..${Math.max(...widths)}` : ''} lt=[${[...types].join(',')}]${top ? `\n  ${top}` : ''}`);
    }
    writeFileSync(env('CMP_OUT') || 'scan.txt', out.join('\n'));
    expect(out.length).toBeGreaterThan(0);
  });

  it.skipIf(MODE !== 'zoom')('zoom: phóng to một chỗ', { timeout: 600_000 }, async () => {
    const doc = await read(env('CMP_FILE'));
    const only = layerSet();
    const xs: number[] = [];
    const ys: number[] = [];
    for (const e of doc.entities) {
      const p = env('CMP_ANCHOR') && e.layer !== env('CMP_ANCHOR') ? undefined : firstPoint(e);
      if (p) { xs.push(p[0]); ys.push(p[1]); }
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const cx = env('CMP_CX') ? Number(env('CMP_CX')) : xs[Math.floor(xs.length / 2)];
    const cy = env('CMP_CY') ? Number(env('CMP_CY')) : ys[Math.floor(ys.length / 2)];
    const W = Number(env('CMP_W') || 600);
    const { svg } = previewSvg(doc, { px: 2000, box: [cx - W / 2, cy - W / 2, cx + W / 2, cy + W / 2], colorBy: 'layer', include: only.length ? (i) => only.includes(doc.entities[i].layer) : undefined });
    await png(svg).toFile(env('CMP_OUT') || 'zoom.png');
    writeFileSync(`${env('CMP_OUT') || 'zoom.png'}.txt`, `tâm ${cx},${cy} rộng ${W} m`);
  });

  it.skipIf(MODE !== 'side')('side: gốc | sạch', { timeout: 900_000 }, async () => {
    const IN = env('CMP_IN');
    expect(existsSync(IN)).toBe(true);
    const files = walk(IN).filter((f) => /\.(dwg|dxf)$/i.test(f)).map((f, i) => ({
      id: `f${i}`, name: f.split(sep).pop()!, path: relative(IN, f).split(sep).join('/'), size: statSync(f).size,
      read: async () => bytes(f),
    }));
    const folder = await loadFolder(files, (f, data) => (/\.dxf$/i.test(f.name) ? parseDxf(data, { wasmBaseUrl: WASM_DIR }) : parseDwg(data, { wasmBaseUrl: WASM_DIR })));
    const a = analyzeDrawings(folder.drawings);
    const key = (env('CMP_MAP') || 'QH07').toLowerCase();
    const main = a.drawings.find((d) => d.name.toLowerCase().startsWith(key) && !d.owner);
    expect(main).toBeTruthy();
    const group = a.drawings.filter((d) => d.id === main!.id || d.owner?.id === main!.id);
    const docs = group.map((g) => folder.drawings.find((p) => p.id === g.id)!.doc);
    const orig: CadDocument = { ...docs[0], entities: docs.flatMap((d) => d.entities), lineTypes: Object.assign({}, ...docs.map((d) => d.lineTypes ?? {})) };
    const clean = await read(env('CMP_CLEAN'));
    const cx = Number(env('CMP_CX'));
    const cy = Number(env('CMP_CY'));
    const W = Number(env('CMP_W') || 1500);
    const box: [number, number, number, number] = [cx - W / 2, cy - W / 2, cx + W / 2, cy + W / 2];
    const bare = env('CMP_NOBASE') !== '0';
    const base = /^(nen|0$|kyhieu|ks|plan|bodat|mo_ma|nha|diem|caodo)/i;
    const r1 = previewSvg(orig, { px: 1400, box, include: bare ? (i) => !base.test(orig.entities[i].layer) && orig.entities[i].kind !== 'text' : undefined });
    const r2 = previewSvg(clean, { px: 1400, box, include: bare ? (i) => !/^NEN_/.test(clean.entities[i].layer) && clean.entities[i].kind !== 'text' : undefined });
    const out = env('CMP_OUT') || 'side.png';
    writeFileSync(`${out}.txt`, `GỐC ${JSON.stringify(r1.legend.map((l) => `${l.layer}:${l.count}`))}\nSẠCH ${JSON.stringify(r2.legend.map((l) => `${l.layer}:${l.count}`))}`);
    const p1 = await png(r1.svg).toBuffer();
    const p2 = await png(r2.svg).toBuffer();
    const h = Math.max((await sharp(p1).metadata()).height ?? 1, (await sharp(p2).metadata()).height ?? 1);
    await sharp({ create: { width: 2820, height: h, channels: 3, background: '#ffffff' } }).composite([{ input: p1, left: 0, top: 0 }, { input: p2, left: 1420, top: 0 }]).png().toFile(out);
  });
});
