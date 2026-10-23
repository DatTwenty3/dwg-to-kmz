// The geodatabases written by "Bóc tách" (after "Chuẩn hóa TT16") against the template folder of the Bộ Xây dựng
// (templete/…_gdb_template, not committed): groups, classes, shape types, aliases, fields (name, alias, type, length,
// domain, order), domains (values) and spatial reference. Needs the output of folder.test.ts (node_modules/.cache);
// skipped without the template, the outputs or PARITY_CHECK=1 (it reads the cache that folder.test.ts / gdb/normalize.test.ts write, so run those first, not in parallel). Set PARITY_OUT=<file> to write the full list of differences.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectGdbs, readCatalog, type GdbEntry, type GdbSource } from '@/lib/gdb';
import { readTable, tableFileName } from '@/lib/gdb/filegdb';
import { fixGdalOutput } from '@/lib/gdb/gdalFix';

const TEMPLATE = 'templete/86.VinhLong.CTDL_QuyHoachDTNT_TT16_VN2000_105-30_gdb_template';
/** Outputs to compare: Bóc tách (folder.test.ts) and Chuẩn hóa of the two uploaded HoSoGIS (gdb/normalize.test.ts). */
const OUTPUTS: [string, string, string][] = [
  ['Bóc tách Long Hiệp', 'node_modules/.cache/dwg2gdb/out', 'out_'],
  ['Chuẩn hóa Nhị Long', 'node_modules/.cache/gdal-normalize/out', 'nhilong_'],
  ['Chuẩn hóa Hàm Giang', 'node_modules/.cache/gdal-normalize/out', 'hamgiang_'],
];
const DBS = ['HienTrang', 'QuyHoach', 'MocGioi', 'NenDiaHinh'];

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const entries = (dir: string, prefix: string): GdbEntry[] => walk(dir).map((p) => ({ path: `${prefix}/${relative(dir, p).split(sep).join('/')}`, read: async () => readFileSync(p) }));

interface Item {
  type: string;
  path: string;
  def: string;
}

/** Every row of GDB_Items (type guid, path, definition XML). */
async function itemsOf(src: GdbSource): Promise<Item[]> {
  const buf = async (name: string) => src.files.get(name)!.read();
  const sys = readTable(await buf('a00000001.gdbtable'), await buf('a00000001.gdbtablx'));
  let id = 4;
  for (const r of sys.rows()) if (String(r.Name).toLowerCase() === 'gdb_items') id = Number(r.ID);
  const base = tableFileName(id);
  const t = readTable(await buf(`${base}.gdbtable`), await buf(`${base}.gdbtablx`));
  return [...t.rows()].map((r) => ({ type: String(r.Type), path: String(r.Path ?? ''), def: String(r.Definition ?? '') }));
}

const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1] ?? '';
const DOMAIN_TYPE = '{8C368B12-A12E-4C7E-9638-C9C64E69E98F}';

/** The comparable description of a geodatabase. */
async function describeGdb(src: GdbSource) {
  const cat = await readCatalog(src);
  const items = await itemsOf(src);
  const classes: Record<string, string> = {};
  for (const c of cat.classes) {
    const def = items.find((i) => i.path.toLowerCase().endsWith(`\\${c.name.toLowerCase()}`) && /ShapeType/.test(i.def))?.def ?? '';
    const fieldDomain = new Map<string, string>();
    for (const m of def.matchAll(/<GPFieldInfoEx[^>]*>([\s\S]*?)<\/GPFieldInfoEx>/g)) fieldDomain.set(tag(m[1], 'Name'), tag(m[1], 'DomainName'));
    classes[`${c.dataset ?? ''}/${c.name}`] = JSON.stringify({
      shape: c.shapeType,
      // Class-level alias only (the first AliasName of the XML may be a field's when the class has none).
      alias: tag(def.split('<GPFieldInfoEx')[0], 'AliasName'),
      sr: c.srName,
      // Shape / OBJECTID order and Shape_Length / Shape_Area position differ by driver (GDAL writes Shape first): known, cosmetic.
      fields: c.fields.filter((f) => !/^(Shape_Length|Shape_Area|Shape|OBJECTID)$/i.test(f.name)).map((f) => [f.name, f.alias, f.type, f.type === 'string' ? f.length : 0, fieldDomain.get(f.name) ?? '']),
    });
  }
  const domains: Record<string, string> = {};
  for (const i of items.filter((x) => x.type === DOMAIN_TYPE)) {
    const values = [...i.def.matchAll(/<CodedValue[^>]*>\s*<Name>([^<]*)<\/Name>\s*<Code[^>]*>([^<]*)<\/Code>/g)].map((m) => `${m[2]}=${m[1]}`).sort();
    domains[tag(i.def, 'DomainName')] = values.join('|');
  }
  return { datasets: cat.datasets, wkts: cat.datasetWkts ?? {}, tables: cat.tables.map((t) => `${t.dataset ?? ''}/${t.name}`).sort(), classes, domains };
}

// Reads the cache the other tests write, so it runs on its own: PARITY_CHECK=1 vitest run tests/unit/dwg2gdb/templateParity.test.ts
describe.skipIf(!existsSync(TEMPLATE) || !process.env.PARITY_CHECK)('Output geodatabases vs the template of the Bộ Xây dựng', () => {
  it.each(OUTPUTS)('%s: same groups, classes, fields (order, type, length, alias, domain) and domains', async (_name, OUT, prefix) => {
    if (!existsSync(`${OUT}/${prefix}QuyHoach.gdb`)) return; // the producing test was not run
    const diffs: string[] = [];
    for (const db of DBS) {
      const t = collectGdbs(entries(`${TEMPLATE}/${db}.gdb`, `${db}.gdb`)).gdbs[0];
      // The app applies fixGdalOutput (esriGeometryLine → esriGeometryPolyline) before zipping.
      const raw = await Promise.all(entries(`${OUT}/${prefix}${db}.gdb`, `${db}.gdb`).map(async (e) => ({ path: e.path, bytes: new Uint8Array(await e.read()) })));
      const fixed = fixGdalOutput(raw).map((e) => ({ path: e.path, read: async () => e.bytes }));
      const o = collectGdbs(fixed).gdbs[0];
      const [a, b] = [await describeGdb(t), await describeGdb(o)];
      const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
      for (const [d, w] of Object.entries(a.wkts)) if (b.wkts[d] !== w) diffs.push(`${db}: hệ tọa độ của nhóm ${d} khác (mẫu ${w.slice(0, 40)}… / ra ${(b.wkts[d] ?? '').slice(0, 40)}…)`);
      if (!same(a.tables, b.tables)) diffs.push(`${db}: bảng không hình học khác: mẫu=${a.tables} ra=${b.tables}`);
      for (const d of a.datasets) if (!b.datasets.includes(d)) diffs.push(`${db}: thiếu nhóm ${d}`);
      for (const d of b.datasets) if (!a.datasets.includes(d)) diffs.push(`${db}: thừa nhóm ${d}`);
      for (const [k, v] of Object.entries(a.classes)) {
        if (!(k in b.classes)) diffs.push(`${db}: thiếu lớp ${k}`);
        else if (v !== b.classes[k]) {
          const x = JSON.parse(v);
          const y = JSON.parse(b.classes[k]);
          for (const key of ['shape', 'alias', 'sr'] as const) if (x[key] !== y[key]) diffs.push(`${db} ${k}: ${key} mẫu="${x[key]}" ra="${y[key]}"`);
          const fx = x.fields as unknown[][];
          const fy = y.fields as unknown[][];
          for (let i = 0; i < Math.max(fx.length, fy.length); i++)
            if (!same(fx[i], fy[i])) diffs.push(`${db} ${k} trường #${i}: mẫu=${JSON.stringify(fx[i])} ra=${JSON.stringify(fy[i])}`);
        }
      }
      for (const k of Object.keys(b.classes)) if (!(k in a.classes)) diffs.push(`${db}: lớp thừa ${k}`);
      for (const [n, v] of Object.entries(a.domains)) {
        if (!(n in b.domains)) diffs.push(`${db}: thiếu domain ${n}`);
        else if (v !== b.domains[n]) diffs.push(`${db}: domain ${n} khác giá trị`);
      }
      for (const n of Object.keys(b.domains)) if (!(n in a.domains)) diffs.push(`${db}: domain thừa ${n}`);
    }
    if (process.env.PARITY_OUT) appendFileSync(process.env.PARITY_OUT, ['== ' + _name, ...(diffs.length ? diffs : ['giống hệt']), ''].join('\n'));
    // Classes / groups the user's own data had beyond the template (TenRieng_P, the NenDiaHinh of an uploaded HoSoGIS) are kept on purpose.
    expect(diffs.filter((d) => !/thừa/.test(d)).slice(0, 20)).toEqual([]);
  }, 300_000);
});
