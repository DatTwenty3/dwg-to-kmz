// Measurement of the colour classification on the owner's real folder (not committed — skipped without it):
// how many hatches the TT16 colour table recognises, and how that differs from the layer-name mapping.
// Prints tables; assertions are light. Used to tune NEAR_MAX / GAP_MIN (color.ts) and to find gaps in Mục 7.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import { analyzeDrawings, drawingTexts, initialMapping, loadFolder, rowKey, type Analysis, type LoadedFolder } from '@/lib/dwg2gdb';
import { classifyColor, colorKey, colorRole, describeColorKey } from '@/lib/dwg2gdb/colorClass';
import { isNeutral } from '@/lib/dwg2gdb/color';
import { pickSection } from '@/lib/dwg2gdb/section';
import { SECTION_TITLES } from '@/lib/dwg2gdb/tt16Symbols';
import { WASM_DIR } from '../fixtures';

const ROOT = 'dwg_to_gdb/LAY Y KIEN SXD';
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe.skipIf(!existsSync(ROOT))('Nhận dạng theo màu — xã Long Hiệp', () => {
  let folder: LoadedFolder;
  let a: Analysis;

  beforeAll(async () => {
    const files = walk(ROOT).map((f, i) => ({
      id: `f${i}`,
      name: f.split(sep).pop()!,
      path: relative(ROOT, f).split(sep).join('/'),
      size: statSync(f).size,
      read: async () => {
        const b = readFileSync(f);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    }));
    folder = await loadFolder(files, (_f, data) => parseDwg(data, { wasmBaseUrl: WASM_DIR }));
    a = analyzeDrawings(folder.drawings);
  }, 300_000);

  it('report', () => {
    const roleOf = new Map(a.drawings.map((d) => [d.id, d.role]));
    const included = new Set(a.drawings.filter((d) => d.included).map((d) => d.id));
    const sdd = folder.drawings.filter((p) => included.has(p.id) && colorRole(roleOf.get(p.id)!));

    // Hatch colours of the land-use maps inside the boundary.
    const hexCounts = new Map<string, number>();
    for (const p of sdd) {
      const inside = a.inside.get(p.id)!;
      p.doc.entities.forEach((e, i) => {
        if (e.kind === 'polygon' && inside[i]) hexCounts.set(e.color, (hexCounts.get(e.color) ?? 0) + 1);
      });
    }
    const titles = folder.drawings.filter((p) => !p.owner).flatMap((p) => drawingTexts(p.doc));
    const choice = pickSection(titles, hexCounts);
    const vote = pickSection([], hexCounts);
    const section = choice.section;
    console.log('Mục:', section, SECTION_TITLES[section ?? 0], '|', choice.why, '| bầu chọn riêng:', vote.section, vote.why);
    console.log('Bản đồ SDD:', sdd.map((p) => `${p.name} (${roleOf.get(p.id)})`).join('; '));

    const mapping = initialMapping(a, null);
    const tally = { exact: 0, near: 0, ambiguous: 0, none: 0, neutral: 0 };
    let total = 0;
    let differ = 0;
    let newlyFound = 0;
    let agree = 0;
    let layerNone = 0;
    const pairs = new Map<string, number>(); // "layer → màu → loại đất (layer gợi ý)" → số hatch
    const noneColors = new Map<string, number>();
    for (const p of sdd) {
      const inside = a.inside.get(p.id)!;
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || !inside[i]) return;
        total++;
        const m = mapping.get(rowKey(p.id, e.layer, 'A'));
        const layerUse = m?.target ? m.phanLoai : '';
        if (!layerUse) layerNone++;
        if (isNeutral(e.color)) {
          tally.neutral++;
          return;
        }
        const c = classifyColor(e.color, section);
        tally[c.level]++;
        if (c.level === 'none') {
          const k = `${e.color} @ ${e.layer}`;
          noneColors.set(k, (noneColors.get(k) ?? 0) + 1);
          return;
        }
        if (c.level === 'ambiguous') return;
        const use = describeColorKey('c' + e.color.slice(1), section)?.landUse ?? '';
        if (!layerUse) newlyFound++;
        else if (layerUse !== use) differ++;
        else agree++;
        const k = `${e.layer} → ${e.color} (số ${c.best?.aci}) → ${use}  [layer: ${layerUse || 'không nhận'}]`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      });
    }
    // Rows of the mapping table: layer × kind (now) vs layer × kind × colour group (after splitting).
    const rowsNow = new Set<string>();
    const rowsSplit = new Set<string>();
    for (const p of sdd) {
      const inside = a.inside.get(p.id)!;
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || !inside[i]) return;
        rowsNow.add(`${p.id}|${e.layer}`);
        rowsSplit.add(`${p.id}|${e.layer}|${colorKey(e, { section, role: roleOf.get(p.id)! })}`);
      });
    }
    console.log('Hàng bảng ghép (vùng, trong ranh): hiện nay', rowsNow.size, '→ sau khi tách theo màu', rowsSplit.size);
    console.log('Số hatch trong ranh của bản đồ SDD:', total);
    console.table(tally);
    console.log('So với ghép theo layer: giống', agree, '| khác', differ, '| trước bỏ/không nhận, nay nhận', newlyFound, '| layer không nhận', layerNone);
    console.log('Top cặp layer → màu → loại đất:');
    console.table([...pairs].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, n]) => ({ n, k })));
    console.log('Màu "none" phổ biến nhất (hex @ layer):');
    console.table([...noneColors].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, n]) => ({ n, k })));
    expect(total).toBeGreaterThan(0);
  });
});
