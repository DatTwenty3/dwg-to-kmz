// "Dò bằng mắt" of a written HoSoGIS: draws the CAD of the source folder (grey / true hatch colours) under the GIS read back from
// the geodatabases (colours), one picture per theme — roads, boundary, land use, utilities, terrain — as a whole and zoomed in.
// Skipped unless VIS_OUT is set:
//   VIS_CAD="<thư mục bản vẽ gốc>" VIS_GDB="<…/HoSoGIS>" VIS_OUT=<thư mục ảnh> npx vitest run tests/unit/dwg2gdb/visualHoSoGIS.test.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { it } from 'vitest';
import { parseDwg, parseDxf } from '@/lib/cad';
import { analyzeDrawings, loadFolder } from '@/lib/dwg2gdb';
import { collectGdbs, readCatalog } from '@/lib/gdb';
import { decodeShape } from '@/lib/gdb/shape';
import { WASM_DIR } from '../fixtures';

const CAD = process.env.VIS_CAD ?? '';
const GDB = process.env.VIS_GDB ?? '';
const OUT = process.env.VIS_OUT ?? '';
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

type Pt = [number, number];
interface Gis { cls: string; db: string; lines: Pt[][]; rings: Pt[][]; points: Pt[]; label?: string; phan?: string }
interface CadLine { pts: Pt[]; w: number; layer: string }
interface CadFill { rings: Pt[][]; color: string; layer: string }

const col = { grey: '#9ca3af' };
function render(box: number[], px: number, cad: CadLine[], fills: CadFill[], gis: Gis[], style: (g: Gis) => { stroke?: string; fill?: string; w?: number; dash?: string; dot?: number }, labels: boolean): string {
  const [x0, y0, x1, y1] = box;
  const sc = px / (x1 - x0);
  const H = Math.round((y1 - y0) * sc);
  const X = (x: number) => ((x - x0) * sc).toFixed(1);
  const Y = (y: number) => ((y1 - y) * sc).toFixed(1);
  const d = (pts: Pt[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('') + (close ? 'Z' : '');
  const inBox = (pts: Pt[]) => pts.some((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1);
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${H}" viewBox="0 0 ${px} ${H}"><rect width="100%" height="100%" fill="#fff"/>`];
  for (const f of fills) for (const r of f.rings) if (inBox(r)) o.push(`<path d="${d(r, true)}" fill="${f.color}" fill-opacity="0.55" stroke="none"/>`);
  for (const l of cad) if (inBox(l.pts)) o.push(`<path d="${d(l.pts)}" fill="none" stroke="${col.grey}" stroke-width="${Math.max(1.6, l.w * sc)}" stroke-linecap="round"/>`);
  for (const g of gis) {
    const s = style(g);
    for (const l of g.lines) if (inBox(l)) o.push(`<path d="${d(l)}" fill="none" stroke="${s.stroke ?? '#dc2626'}" stroke-width="${s.w ?? 1.4}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`);
    for (const r of g.rings) if (inBox(r)) o.push(`<path d="${d(r, true)}" fill="${s.fill ?? 'none'}" fill-opacity="0.35" stroke="${s.stroke ?? '#111'}" stroke-width="${s.w ?? 1}"/>`);
    for (const p of g.points) if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) o.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${s.dot ?? 2.5}" fill="${s.stroke ?? '#dc2626'}"/>`);
    if (labels && g.label) {
      const part = g.lines[0] ?? g.rings[0];
      const at = part?.[Math.floor(part.length / 2)] ?? g.points[0];
      if (at && at[0] >= x0 && at[0] <= x1 && at[1] >= y0 && at[1] <= y1)
        o.push(`<text x="${X(at[0])}" y="${Y(at[1])}" font-size="12" font-family="Arial" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${g.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
    }
  }
  o.push('</svg>');
  return o.join('');
}

it.skipIf(!OUT || !existsSync(CAD) || !existsSync(GDB))('ảnh CAD đè GIS', async () => {
  mkdirSync(OUT, { recursive: true });
  // ── CAD
  const files = walk(CAD)
    .filter((f) => /\.(dwg|dxf)$/i.test(f))
    .map((f, i) => ({
      id: `f${i}`,
      name: f.split(sep).pop()!,
      path: relative(CAD, f).split(sep).join('/'),
      size: statSync(f).size,
      read: async () => {
        const b = readFileSync(f);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    }));
  const folder = await loadFolder(files, (f, data) => (/\.dxf$/i.test(f.name) ? parseDxf(data, { wasmBaseUrl: WASM_DIR }) : parseDwg(data, { wasmBaseUrl: WASM_DIR })));
  const a = analyzeDrawings(folder.drawings);
  const incl = new Set(a.drawings.filter((d) => d.included).map((d) => d.id));
  const roleOf = new Map(a.drawings.map((d) => [d.id, d.role]));
  const lines: (CadLine & { role: string })[] = [];
  const fills: (CadFill & { role: string })[] = [];
  const seen = new Set<string>();
  for (const p of folder.drawings.filter((x) => incl.has(x.id))) {
    const flags = a.inside.get(p.id)!;
    p.doc.entities.forEach((e, i) => {
      if (!flags[i]) return;
      if (e.kind === 'polyline' && e.points.length >= 2) {
        const k = `${p.id}|${e.layer}|${Math.round(e.points[0][0])}|${Math.round(e.points[0][1])}|${e.points.length}`;
        if (seen.has(k)) return;
        seen.add(k);
        lines.push({ pts: e.points as Pt[], w: e.width ?? 0, layer: e.layer, role: String(roleOf.get(p.id)) });
      } else if (e.kind === 'polygon') fills.push({ rings: e.rings as Pt[][], color: e.color, layer: e.layer, role: String(roleOf.get(p.id)) });
    });
  }
  // ── GIS
  const gis: Gis[] = [];
  const entries = walk(GDB).map((p) => ({ path: relative(GDB, p).split(sep).join('/'), read: async () => readFileSync(p) }));
  for (const g of collectGdbs(entries).gdbs) {
    const cat = await readCatalog(g);
    for (const c of cat.classes) {
      const gf = c.fields.find((f) => f.geom);
      if (!gf || !c.rowCount) continue;
      for (const { row, shape } of c.features!()) {
        if (!shape) continue;
        const s = decodeShape(shape, gf.geom!);
        if (!s) continue;
        const item: Gis = { cls: c.name, db: g.name.replace(/\.gdb$/i, ''), lines: [], rings: [], points: [], label: (row.tenDuong ?? row.tenDoiTuong) ? String(row.tenDuong ?? row.tenDoiTuong) : undefined, phan: row.phanLoai ? String(row.phanLoai) : undefined };
        if (s.type === 'line') item.lines = s.parts as Pt[][];
        else if (s.type === 'polygon') item.rings = s.parts as Pt[][];
        else item.points = s.points as Pt[];
        gis.push(item);
      }
    }
  }
  const sharp = (await import('sharp')).default;
  const themes: { name: string; cad: (l: CadLine & { role: string }) => boolean; fill: boolean; gis: (g: Gis) => boolean; style: (g: Gis) => ReturnType<Parameters<typeof render>[5]>; labels: boolean }[] = [
    {
      name: 'giaothong',
      cad: (l) => /duong|gt|giao|cau|quoc|nhua|beton|mon|^d-|ken/i.test(l.layer) && !/DAT_|KYHIEU|^0$|KH-mc|MCN|DIEN|MUONG|NHA|MO_MA|HANGRAO/i.test(l.layer),
      fill: false,
      gis: (g) => /MangLuoiGiaoThongDuongBo|CongTrinhGiaoThong_L|ChiGioiDuongDo/.test(g.cls),
      style: (g) => (/CongTrinhGiaoThong/.test(g.cls) ? { stroke: '#2563eb', w: 2.2 } : /ChiGioi/.test(g.cls) ? { stroke: '#16a34a', w: 0.8, dash: '4 3' } : g.db === 'HienTrang' ? { stroke: '#ea580c', w: 1.2 } : { stroke: '#dc2626', w: 1.4 }),
      labels: true,
    },
    {
      name: 'ranh',
      cad: (l) => /rg_lapquyhoach|ranh/i.test(l.layer),
      fill: false,
      gis: (g) => /RanhGioiQuyHoach|TenDonViHanhChinh/.test(g.cls),
      style: (g) => (/Ranh/.test(g.cls) ? { stroke: '#dc2626', w: 2 } : { stroke: '#7c3aed', dot: 4 }),
      labels: true,
    },
    {
      name: 'dat',
      cad: () => false,
      fill: true,
      gis: (g) => g.db === 'QuyHoach' && /ChucNangSuDungDat_A|RanhGioiQuyHoach/.test(g.cls),
      style: () => ({ stroke: '#111', w: 0.7 }),
      labels: false,
    },
    {
      name: 'hatang',
      cad: (l) => /dien|^tt$|capnuoc|cap nuoc|trucchay|thoat nuoc|tnm|qh-tt|ttll|ho ga/i.test(l.layer) && !/DAT_/i.test(l.layer),
      fill: false,
      gis: (g) => /PhanPhoiDien|CapNuoc_L|ThoatNuoc.*_L|CapThongTin|CongTrinhCBKT_P|CongTrinhTNT|CongTrinhThongTin/.test(g.cls),
      style: (g) => (/Dien/.test(g.cls) ? { stroke: '#dc2626', w: 1.6 } : /CapNuoc/.test(g.cls) ? { stroke: '#2563eb', w: 1.6 } : /ThoatNuoc/.test(g.cls) ? { stroke: '#16a34a', w: 1.4 } : /ThongTin/.test(g.cls) ? { stroke: '#7c3aed', w: 1.6 } : { stroke: '#f59e0b', dot: 1.6 }),
      labels: false,
    },
    {
      name: 'diahinh',
      cad: (l) => /bodat|song_ho|moma|mo_ma|muong|caodo|diem|ranh_thuc/i.test(l.layer),
      fill: false,
      gis: (g) => g.db === 'NenDiaHinh',
      style: (g) => (g.points.length ? { stroke: '#dc2626', dot: 1.4 } : { stroke: '#0e7490', w: 0.9 }),
      labels: false,
    },
  ];
  const ptsOf = (g: Gis) => [...g.lines.flat(), ...g.rings.flat(), ...g.points];
  const ranhPts = gis.filter((g) => /RanhGioiQuyHoach_A/.test(g.cls) && g.db === 'QuyHoach').flatMap(ptsOf);
  const xs = ranhPts.map((p) => p[0]).sort((p, q) => p - q);
  const ys = ranhPts.map((p) => p[1]).sort((p, q) => p - q);
  const pad = 600;
  const box = [xs[0] - pad, ys[0] - pad, xs[xs.length - 1] + pad, ys[ys.length - 1] + pad];
  const info: string[] = [`box=${box.map(Math.round)}`];
  // Densest 1,5 km × 1 km window of the GIS roads = a village: the second zoom.
  const cell = 500;
  const dens = new Map<string, number>();
  for (const g of gis.filter((g) => /MangLuoiGiaoThongDuongBo_L/.test(g.cls))) for (const p of g.lines.flat()) dens.set(`${Math.floor(p[0] / cell)}|${Math.floor(p[1] / cell)}`, (dens.get(`${Math.floor(p[0] / cell)}|${Math.floor(p[1] / cell)}`) ?? 0) + 1);
  const best = [...dens.entries()].sort((p, q) => q[1] - p[1])[0][0].split('|').map(Number);
  const zooms: [string, number[]][] = [
    ['toancanh', box],
    ['canhcanh1', [(box[0] + box[2]) / 2 - 1500, (box[1] + box[3]) / 2 - 1000, (box[0] + box[2]) / 2 + 1500, (box[1] + box[3]) / 2 + 1000]],
    ['canhcanh2', [best[0] * cell - 1000, best[1] * cell - 700, best[0] * cell + 2000, best[1] * cell + 1300]],
  ];
  for (const t of themes) {
    const cl = lines.filter(t.cad);
    const fl = t.fill ? fills.filter((f) => /qh-sdd/.test(f.role) && !/Matnuoc/.test(f.layer)) : [];
    const gg = gis.filter(t.gis);
    info.push(`${t.name}: cad ${cl.length} fills ${fl.length} gis ${gg.length}`);
    for (const [zn, zb] of zooms) {
      const svg = render(zb, 2000, cl, fl, gg, t.style, t.labels && zn !== 'toancanh');
      const f = `${OUT}/${t.name}_${zn}`;
      writeFileSync(`${f}.svg`, svg);
      await sharp(`${f}.svg`, { density: 72 }).png().toFile(`${f}.png`);
    }
  }
  writeFileSync(`${OUT}/info.txt`, info.join('\n'));
}, 1_800_000);
