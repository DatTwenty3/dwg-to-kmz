// "Dò bằng mắt" after a conversion: draws the CAD road layers (grey, true width) under the GIS roads (red = tim đường,
// blue = cầu, green dashed = chỉ giới đường đỏ; Long Hiệp read back from the geodatabase written by folder.test.ts,
// Đôn Châu from the built classes), with the road names. Writes SVG + PNG into $VISUAL_OUT (skipped without it):
//   VISUAL_OUT=<dir> npx vitest run tests/unit/dwg2gdb/folder.test.ts tests/unit/dwg2gdb/visualRoads.test.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import { analyzeDrawings, buildFeatures, colorContexts, initialMapping, loadFolder } from '@/lib/dwg2gdb';
import { collectGdbs, readCatalog } from '@/lib/gdb';
import { decodeShape } from '@/lib/gdb/shape';
import { WASM_DIR } from '../fixtures';

const S = process.env.VISUAL_OUT ?? '';
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
type Pl = { pts: number[][]; w: number; label?: string; cls: string };

function svg(cad: Pl[], gis: Pl[], texts: { at: number[]; t: string }[], box: number[], px: number): string {
  const [x0, y0, x1, y1] = box;
  const sc = px / (x1 - x0);
  const H = Math.round((y1 - y0) * sc);
  const X = (x: number) => ((x - x0) * sc).toFixed(1);
  const Y = (y: number) => ((y1 - y) * sc).toFixed(1);
  const d = (pts: number[][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('');
  const inBox = (pts: number[][]) => pts.some((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${H}" viewBox="0 0 ${px} ${H}"><rect width="100%" height="100%" fill="#fff"/>`];
  for (const l of cad) if (inBox(l.pts)) out.push(`<path d="${d(l.pts)}" fill="none" stroke="#9ca3af" stroke-width="${Math.max(2.5, l.w * sc)}" stroke-linecap="round"/>`);
  const col: Record<string, string> = { road: '#dc2626', bridge: '#2563eb', cg: '#16a34a' };
  for (const l of gis) if (inBox(l.pts)) out.push(`<path d="${d(l.pts)}" fill="none" stroke="${col[l.cls] ?? '#dc2626'}" stroke-width="${l.cls === 'cg' ? 0.8 : 1.4}" ${l.cls === 'cg' ? 'stroke-dasharray="4 3"' : ''}/>`);
  for (const t of texts) if (t.at[0] >= x0 && t.at[0] <= x1 && t.at[1] >= y0 && t.at[1] <= y1) out.push(`<text x="${X(t.at[0])}" y="${Y(t.at[1])}" font-size="11" font-family="Arial" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">${t.t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
  out.push('</svg>');
  return out.join('');
}

const ROAD_LAYER = /duong|gt|giao|cau|tim|hem|quoc|tinh|nhua|beton|long|via|mep|^d-|logioi|ken/i;

it.skipIf(!process.env.VISUAL_OUT)('road overlay images', async () => {
  mkdirSync(S, { recursive: true });
  for (const [name, ROOT, useGdb] of [['doncha', 'dwg_to_gdb/DON CHAU', false], ['longhiep', 'dwg_to_gdb/LAY Y KIEN SXD', true]] as const) {
    if (!existsSync(ROOT)) continue;
    const files = walk(ROOT).filter((f) => /\.dwg$/i.test(f)).map((f, i) => ({
      id: `f${i}`, name: f.split(sep).pop()!, path: relative(ROOT, f).split(sep).join('/'), size: statSync(f).size,
      read: async () => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
    }));
    const folder = await loadFolder(files, (_f, data) => parseDwg(data, { wasmBaseUrl: WASM_DIR }));
    const a = analyzeDrawings(folder.drawings);
    const m = initialMapping(a, null);
    const incl = new Set(a.drawings.filter((d) => d.included).map((d) => d.id));
    const cad: Pl[] = [];
    const seen = new Set<string>();
    for (const p of folder.drawings.filter((x) => incl.has(x.id))) {
      const flags = a.inside.get(p.id)!;
      p.doc.entities.forEach((e, i) => {
        if (!flags[i] || e.kind !== 'polyline' || e.points.length < 2) return;
        if (!ROAD_LAYER.test(e.layer) || /DAT_|KYHIEU|^0$|KH-mc|MCN|DIEN/i.test(e.layer)) return;
        const k = `${Math.round(e.points[0][0])}|${Math.round(e.points[0][1])}|${e.points.length}`;
        if (seen.has(k)) return;
        seen.add(k);
        cad.push({ pts: e.points, w: e.width ?? 0, cls: 'cad' });
      });
    }
    const gis: Pl[] = [];
    const texts: { at: number[]; t: string }[] = [];
    const clsOf = (n: string) => (/CongTrinhGiaoThong_L/.test(n) ? 'bridge' : /ChiGioiDuongDo/.test(n) ? 'cg' : 'road');
    if (useGdb) {
      for (const db of ['out_QuyHoach.gdb', 'out_HienTrang.gdb']) {
        const W = `node_modules/.cache/dwg2gdb/out/${db}`;
        const entries = walk(W).map((p) => ({ path: `${db}/` + relative(W, p).split(sep).join('/'), read: async () => readFileSync(p) }));
        const cat = await readCatalog(collectGdbs(entries).gdbs[0]);
        for (const c of cat.classes.filter((x) => /MangLuoiGiaoThongDuongBo_L|CongTrinhGiaoThong_L|ChiGioiDuongDo_L/.test(x.name))) {
          const g = c.fields.find((f) => f.geom)!;
          for (const { row, shape } of c.features!()) {
            if (!shape) continue;
            const s = decodeShape(shape, g.geom!);
            if (s?.type !== 'line') continue;
            for (const part of s.parts) {
              gis.push({ pts: part, w: 0, cls: clsOf(c.name) });
              if (row.tenDuong && /QuyHoach/.test(db)) texts.push({ at: part[Math.floor(part.length / 2)], t: String(row.tenDuong) });
            }
          }
        }
      }
    } else {
      const built = buildFeatures(folder.drawings.filter((p) => incl.has(p.id)).map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: a.inside.get(p.id)!, color: colorContexts(a).get(p.id) })), m, { boundary: a.boundary?.ring ?? null, sourceInGhiChu: false, planUnit: '' });
      for (const c of built.classes.filter((x) => /MangLuoiGiaoThongDuongBo_L|CongTrinhGiaoThong_L|ChiGioiDuongDo_L/.test(x.cls)))
        for (const f of c.features) {
          if (f.geometry.type !== 'MultiLineString') continue;
          for (const line of f.geometry.coordinates) gis.push({ pts: line, w: 0, cls: clsOf(c.cls) });
          const ten = f.attrs?.tenDuong ?? f.attrs?.tenCongTrinh;
          if (ten) texts.push({ at: f.geometry.coordinates[0][Math.floor(f.geometry.coordinates[0].length / 2)], t: String(ten) });
        }
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (const l of gis) for (const p of l.pts) { xs.push(p[0]); ys.push(p[1]); }
    xs.sort((p, q) => p - q); ys.sort((p, q) => p - q);
    const q = (arr: number[], f: number) => arr[Math.floor(arr.length * f)];
    const pad = 300;
    const box = [q(xs, 0.002) - pad, q(ys, 0.002) - pad, q(xs, 0.998) + pad, q(ys, 0.998) + pad];
    writeFileSync(`${S}/vis_${name}_full.svg`, svg(cad, gis, texts, box, 2000));
    // zoom: the densest quarter (centre of the GIS roads)
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    const w = (box[2] - box[0]) / 4;
    writeFileSync(`${S}/vis_${name}_zoom.svg`, svg(cad, gis, texts, [cx - w, cy - w * 0.6, cx + w, cy + w * 0.6], 2000));
    writeFileSync(`${S}/vis_${name}_info.txt`, `cad=${cad.length} gis=${gis.length} box=${box.map(Math.round)}`);
    const sharp = (await import('sharp')).default;
    for (const part of ['full', 'zoom']) await sharp(`${S}/vis_${name}_${part}.svg`, { density: 72 }).png().toFile(`${S}/vis_${name}_${part}.png`);
  }
}, 900000);
