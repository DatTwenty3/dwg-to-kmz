// Compares two HoSoGIS folders class by class (the one written from the raw folder vs the one from the cleaned drawings):
// object counts, phanLoai tally, and the names of the road network (tenDuong / loaiDuong / capDuong). Skipped without CMP_A.
//   CMP_A="<HoSoGIS từ thư mục gốc>" CMP_B="<HoSoGIS từ bản sạch>" CMP_OUT=<tệp .txt> npx vitest run tests/unit/dwg2gdb/soSanhHoSoGIS.test.ts
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { it } from 'vitest';
import { collectGdbs, readCatalog } from '@/lib/gdb';

const A = process.env.CMP_A ?? '';
const B = process.env.CMP_B ?? '';
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

interface ClassStat { n: number; phan: Map<string, number>; names: Map<string, number>; loai: Map<string, number>; cap: Map<string, number>; len: number }
async function read(dir: string): Promise<Map<string, ClassStat>> {
  const out = new Map<string, ClassStat>();
  const entries = walk(dir).map((p) => ({ path: relative(dir, p).split(sep).join('/'), read: async () => readFileSync(p) }));
  for (const g of collectGdbs(entries).gdbs) {
    const cat = await readCatalog(g);
    for (const c of cat.classes) {
      if (!c.rowCount) continue;
      const s: ClassStat = { n: 0, phan: new Map(), names: new Map(), loai: new Map(), cap: new Map(), len: 0 };
      const bump = (m: Map<string, number>, k: unknown) => m.set(String(k ?? ''), (m.get(String(k ?? '')) ?? 0) + 1);
      for (const r of c.rows()) {
        s.n++;
        bump(s.phan, r.phanLoai);
        if (r.tenDuong) bump(s.names, r.tenDuong);
        else if (r.tenDoiTuong) bump(s.names, r.tenDoiTuong);
        if ('loaiDuong' in r) bump(s.loai, r.loaiDuong);
        if ('capDuong' in r) bump(s.cap, r.capDuong);
        s.len += Number(r.chieuDai ?? r.ChieuDai ?? 0) || 0;
      }
      out.set(`${g.name.replace(/\.gdb$/i, '')}/${c.name}`, s);
    }
  }
  return out;
}
const fmt = (m: Map<string, number>, n = 12) =>
  [...m.entries()]
    .sort((p, q) => q[1] - p[1])
    .slice(0, n)
    .map(([k, v]) => `${k || '∅'}×${v}`)
    .join('; ');

it.skipIf(!A || !B || !existsSync(A) || !existsSync(B))('so sánh hai HoSoGIS', async () => {
  const a = await read(A);
  const b = await read(B);
  const lines: string[] = [];
  for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(k);
    const y = b.get(k);
    const flag = !x ? 'chỉ-sạch' : !y ? 'CHỈ-GỐC' : x.n === y.n ? '=' : y.n >= x.n ? '+' : '!!';
    lines.push(`${flag.padEnd(8)} ${k}: gốc ${x?.n ?? 0} · sạch ${y?.n ?? 0}${x && y && Math.abs(x.len - y.len) > 1 ? ` · dài ${Math.round(x.len)} → ${Math.round(y.len)} m` : ''}`);
    if (fmt(x?.phan ?? new Map()) !== fmt(y?.phan ?? new Map()) || (x && /CongTrinhGiaoThong_L/.test(k))) {
      lines.push(`           phanLoai gốc : ${x ? fmt(x.phan) : ''}`);
      lines.push(`           phanLoai sạch: ${y ? fmt(y.phan) : ''}`);
    }
    if (/MangLuoiGiaoThongDuongBo_L|CongTrinhGiaoThong_L/.test(k)) {
      for (const [lab, p, q] of [['tên', x?.names, y?.names], ['loại', x?.loai, y?.loai], ['cấp', x?.cap, y?.cap]] as const) {
        lines.push(`           ${lab} gốc : ${p ? fmt(p, 30) : ''}`);
        lines.push(`           ${lab} sạch: ${q ? fmt(q, 30) : ''}`);
      }
    }
    if (/TenDonViHanhChinh_P/.test(k) && x && y) {
      lines.push(`           ĐVHC gốc : ${fmt(x.names, 20)}`);
      lines.push(`           ĐVHC sạch: ${fmt(y.names, 20)}`);
    }
  }
  const text = lines.join('\n');
  console.log(text);
  if (process.env.CMP_OUT) writeFileSync(process.env.CMP_OUT, text);
}, 600_000);
