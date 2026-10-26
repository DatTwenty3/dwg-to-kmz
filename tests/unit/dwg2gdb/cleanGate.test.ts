// Cổng kiểm tra trước khi bàn giao bản vẽ đã làm sạch (skill lam-sach-ban-ve-quy-hoach, bước 4): đọc lại thư mục sạch như web
// app /boc-tach sẽ đọc và so với thư mục gốc, từng lớp TT16. Bỏ qua nếu không có GATE_RAW / GATE_CLEAN.
//
//   GATE_RAW="dwg_to_gdb/<hồ sơ>" GATE_CLEAN="dwg_to_gdb_sach/<hồ sơ>" npx vitest run tests/unit/dwg2gdb/cleanGate.test.ts
//
// Bắt buộc không mất đối tượng (≥ 99 % số của bản gốc; nhãn phanLoai đổi được in ra để xem): giao thông, cầu, điện, nước, thoát nước, TTLL, ranh, tên ĐVHC. Không bắt buộc (do quyết
// định chuyên môn của người dùng: nền địa hình, cao độ): sử dụng đất, nhà, cao độ — chỉ in ra. Ngoài ra: không layer "chưa nhận
// ra", số chấm ranh và chữ biển số tuyến không ít hơn bản gốc.
//
// Chênh lệch **có chủ ý** (bản gốc phân loại sai và người làm sạch sửa lại: bờ ao đọc thành thoát nước mưa, cống thoát nước đọc
// thành cấp nước, nét suy biến một điểm…) ghi vào `<GATE_CLEAN>/chap-nhan-lech.json`: { "<lớp>": "lý do" }. Lớp đó in " ok" kèm lý
// do thay vì " !!", và lý do đi theo hồ sơ bàn giao. Không ghi khi chỉ muốn cổng im lặng — mỗi dòng phải là một quyết định.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDwg, parseDxf } from '@/lib/cad';
import { analyzeDrawings, buildFeatures, cadLayerData, cadSource, colorContexts, initialMapping, loadFolder } from '@/lib/dwg2gdb';
import { WASM_DIR } from '../fixtures';

const RAW = process.env.GATE_RAW ?? '';
const CLEAN = process.env.GATE_CLEAN ?? '';
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

async function summarize(root: string) {
  const files = walk(root).filter((f) => /\.(dwg|dxf)$/i.test(f)).map((f, i) => ({
    id: `f${i}`, name: f.split(sep).pop()!, path: relative(root, f).split(sep).join('/'), size: statSync(f).size,
    read: async () => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
  }));
  const folder = await loadFolder(files, (f, data) => (/\.dxf$/i.test(f.name) ? parseDxf(data, { wasmBaseUrl: WASM_DIR }) : parseDwg(data, { wasmBaseUrl: WASM_DIR })));
  const a = analyzeDrawings(folder.drawings);
  const mapping = initialMapping(a, null);
  const used = a.drawings.filter((d) => d.included).map((d) => d.id);
  const inputs = folder.drawings.filter((p) => used.includes(p.id)).map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: a.inside.get(p.id)!, color: colorContexts(a).get(p.id), role: (a.drawings.find((x) => x.id === p.id) as unknown as { role: never }).role }));
  const built = buildFeatures(inputs, mapping, { boundary: a.boundary?.ring ?? null, sourceInGhiChu: false, planUnit: '' });
  const classes = new Map<string, { n: number; phanLoai: Map<string, number> }>();
  for (const c of built.classes) {
    const pl = new Map<string, number>();
    for (const f of c.features) pl.set(f.phanLoai ?? '', (pl.get(f.phanLoai ?? '') ?? 0) + 1);
    classes.set(c.target, { n: c.features.length, phanLoai: pl });
  }
  const data = cadLayerData(cadSource(inputs, mapping, a.boundary?.ring ?? null).doc);
  const pts = (JSON.parse(data.json.points ?? '{"features":[]}').features as { properties: { kt: number } }[]).filter((f) => f.properties.kt > 0).length;
  const txt = JSON.parse(data.json.texts ?? '{"features":[]}').features as { properties: { chu: string } }[];
  const signs = txt.filter((f) => /^\d{3}[A-Z]?$/.test(f.properties.chu.trim())).length;
  const unknown = [...mapping].filter(([, v]) => (v as { unknown?: boolean }).unknown).map(([k]) => k.replace(/\u0001/g, ' · '));
  return { classes, dots: pts, signs, unknown, boundary: a.boundary?.ring?.length ?? 0 };
}

const MUST = /GiaoThong|CapDien|CapNuoc|ThoatNuoc|ThongTin|RanhGioi|TenDonViHanhChinh|ChiGioiDuongDo/;

describe.skipIf(!RAW || !CLEAN || !existsSync(RAW) || !existsSync(CLEAN))('Cổng kiểm tra bản vẽ sạch', () => {
  it(`${CLEAN} đọc lại giống ${RAW}`, { timeout: 3_600_000 }, async () => {
    const [raw, clean] = [await summarize(RAW), await summarize(CLEAN)];
    const lines: string[] = [`chấm ranh: gốc ${raw.dots} · sạch ${clean.dots}`, `chữ biển số: gốc ${raw.signs} · sạch ${clean.signs}`, `layer chưa nhận ra (sạch): ${clean.unknown.length}`];
    const bad: string[] = [];
    const acceptFile = join(CLEAN, 'chap-nhan-lech.json');
    const accepted: Record<string, string> = existsSync(acceptFile) ? JSON.parse(readFileSync(acceptFile, 'utf8')) : {};
    for (const k of [...new Set([...raw.classes.keys(), ...clean.classes.keys()])].sort()) {
      const a = raw.classes.get(k);
      const b = clean.classes.get(k);
      const must = MUST.test(k);
      const same = (a?.n ?? 0) === (b?.n ?? 0) && JSON.stringify([...(a?.phanLoai ?? [])].sort()) === JSON.stringify([...(b?.phanLoai ?? [])].sort());
      const lost = must && (b?.n ?? 0) < (a?.n ?? 0) * 0.99;
      lines.push(`${same ? '  =' : lost && accepted[k] ? ' ok' : lost ? ' !!' : '  ~'} ${k}: gốc ${a?.n ?? 0} · sạch ${b?.n ?? 0}${same ? '' : `  gốc ${JSON.stringify([...(a?.phanLoai ?? [])])} → sạch ${JSON.stringify([...(b?.phanLoai ?? [])])}`}${lost && accepted[k] ? `  — chấp nhận: ${accepted[k]}` : ''}`);
      // A loss is what matters: the clean drawing may well hold more (a layer the original left unrecognised), never less.
      if (lost && !accepted[k]) bad.push(k);
    }
    writeFileSync(`node_modules/.cache/clean-gate-${CLEAN.replace(/[^\w]+/g, '_')}.txt`, lines.join('\n'));
    console.log(lines.join('\n'));
    expect(clean.boundary).toBe(raw.boundary);
    expect(clean.unknown, 'layer chưa nhận ra').toEqual([]);
    expect(clean.dots).toBeGreaterThanOrEqual(raw.dots - 1);
    expect(clean.signs).toBeGreaterThanOrEqual(raw.signs);
    expect(bad, 'lớp bắt buộc khớp bản gốc').toEqual([]);
  });
});
