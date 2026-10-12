import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { collectGdbs, readCatalog, runCheck, type GdbEntry } from '@/lib/gdb';
import { executePlan, fixClassName, pascalName, planNormalization, type NormalizeSource } from '@/lib/gdb/normalize';
import { FIXTURE_HAMGIANG, FIXTURE_HOSOGIS } from '../fixtures';

function walk(dir: string, root: string, out: GdbEntry[] = []): GdbEntry[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else if (!n.endsWith('.zip') && !n.endsWith('.lock')) out.push({ path: relative(root, p).replace(/\\/g, '/'), read: async () => readFileSync(p) });
  }
  return out;
}

describe('names', () => {
  it('fixes class / group names to the rule', () => {
    expect(pascalName('cây xanh đô thị')).toBe('CayXanhDoThi');
    expect(fixClassName('Cây_xanh_P', 'P')).toBe('CayXanh_P');
    expect(fixClassName('RanhGioiHanhChinh_L', 'L')).toBe('RanhGioiHanhChinh_L');
    expect(fixClassName('DuongBo', 'L')).toBe('DuongBo_L');
    expect(fixClassName('TramBom_A', 'P')).toBe('TramBom_P');
  });
});

describe('missing databases', () => {
  it('creates an empty NenDiaHinh.gdb with the Hàm Giang structure only when it was not uploaded', () => {
    const cls = { name: 'ChucNangSuDungDat_A', path: '', dataset: 'HienTrangSuDungDat', alias: '', shapeType: 'esriGeometryPolygon', geom: 'A' as const, srName: null, wkt: '', extent: null, fields: [{ name: 'Shape', alias: '', type: 'geometry' as const, length: 0, nullable: true }], rowCount: 1, rows: function* () {} };
    const src = { key: 's0', name: 'HienTrang.gdb', database: 'HienTrang', catalog: { datasets: ['HienTrangSuDungDat'], classes: [cls], tables: [] } };
    const plan = planNormalization([src], { maHoSoQH: '86QHC1000001', maThongTinQH: '862611000001', createMissingDatabases: true });
    expect(plan.outputs).toEqual(['HienTrang', 'QuyHoach', 'NenDiaHinh', 'MocGioi']);
    const nen = plan.steps.filter((s) => s.out === 'NenDiaHinh');
    expect(nen).toHaveLength(25);
    expect(nen.every((s) => s.features === 0 && s.source === 's0')).toBe(true);
    expect(nen.map((s) => s.label)).toContain('ThuyHe / MatNuocTinh_A');
    expect(plan.notes.some((n) => /NenDiaHinh.gdb theo cấu trúc mẫu xã Hàm Giang \(6 nhóm, 25 lớp/.test(n))).toBe(true);
    // Uploaded NenDiaHinh: kept as is (no template classes added); option off: nothing created.
    expect(planNormalization([src], { maHoSoQH: '86QHC1000001', maThongTinQH: '862611000001', createMissingDatabases: false }).outputs).toEqual(['HienTrang']);
  });
});

const OPTS = { maHoSoQH: '86QHC1000001', maThongTinQH: '862511000001', createMissingDatabases: true };

// One GDAL for the whole file, like the browser worker (gdal3.js keeps global state); each run writes to its own
// output prefix in the shared output folder.
const WORK = 'node_modules/.cache/gdal-normalize';
const errs: string[] = [];
type Gdal = { open: (p: string[], o: string[], v: string[]) => Promise<{ errors: string[]; datasets: { path: string }[] }> } & Parameters<typeof executePlan>[0];
let gdalPromise: Promise<Gdal> | null = null;
const gdal = () =>
  (gdalPromise ??= (async () => {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(`${WORK}/out`, { recursive: true });
    // @ts-expect-error — gdal3.js ships no types for its Node entry.
    const { default: initGdalJs } = await import('gdal3.js/node.js');
    return initGdalJs({ path: 'node_modules/gdal3.js/dist/package', dest: `${WORK}/out`, logHandler: () => {}, errorHandler: (m: string) => errs.push(m) });
  })());

async function normalizeFixture(dir: string, tag: string) {
  const entries = walk(dir, join(dir, '..'));
  const before = await runCheck(entries, undefined, { provinceCode: '86' });
  const { gdbs } = collectGdbs(entries);
  const Gdal = await gdal();
  const work = `${WORK}/${tag}`;
  mkdirSync(`${work}/in`, { recursive: true });
  const sources: NormalizeSource[] = [];
  const paths: string[] = [];
  for (let i = 0; i < gdbs.length; i++) {
    const g = gdbs[i];
    const zip = new JSZip();
    for (const [, e] of g.files) zip.file(`${g.name}/${e.path.slice(e.path.lastIndexOf('/') + 1)}`, await e.read());
    const key = `s${i}_${g.name.replace(/\.gdb$/i, '')}`;
    writeFileSync(`${work}/in/${key}.gdb.zip`, await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
    paths.push(`${work}/in/${key}.gdb.zip`);
    sources.push({ key, name: g.name, database: before.gdbs.find((r) => r.dir === g.dir)?.database ?? null, catalog: await readCatalog(g) });
  }
  const plan = planNormalization(sources, OPTS);
  const opened = await Gdal.open(paths, [], ['vsizip']);
  expect(opened.errors).toEqual([]);
  const datasets = new Map<string, unknown>(opened.datasets.map((d: { path: string }) => [d.path.replace(/\.gdb\.zip$/, ''), d]));
  const t0 = Date.now();
  try {
    await executePlan(Gdal, datasets, plan, `${tag}_`);
  } catch (e) {
    throw new Error(`${(e as Error).message}\nGDAL: ${errs.slice(-4).join(' | ')}`);
  }
  const ms = Date.now() - t0;
  const outEntries = walk(`${WORK}/out`, `${WORK}/out`)
    .filter((e) => e.path.startsWith(`${tag}_`))
    .map((e) => ({ ...e, path: e.path.replace(`${tag}_`, 'HoSoGIS/') }));
  const after = await runCheck(outEntries, undefined, { provinceCode: '86' });
  return { before, after, plan, ms, errs, outEntries };
}

for (const [tag, dir] of [
  ['nhilong', FIXTURE_HOSOGIS],
  ['hamgiang', FIXTURE_HAMGIANG],
] as const) {
  describe.skipIf(!existsSync(dir))(`Chuẩn hóa TT16 — ${tag}`, () => {
    it('rebuilds every geodatabase to the circular, geometry untouched', async () => {
      const { before, after, plan, ms, errs } = await normalizeFixture(dir, tag);
      console.log(`${tag}: ${plan.steps.length} steps in ${ms} ms`, plan.notes, errs.slice(-3));
      expect(after.gdbs.map((g) => g.fileName).sort()).toEqual(['HienTrang.gdb', 'MocGioi.gdb', 'NenDiaHinh.gdb', 'QuyHoach.gdb']);
      for (const g of after.gdbs) {
        // Every required group is there, every class has exactly the 6 fields, codes valid.
        expect(g.counts.datasets.present).toBe(g.counts.datasets.expected);
        for (const c of [...g.datasets.flatMap((d) => d.classes), ...g.rootClasses]) {
          expect(c.status, `${g.fileName} ${c.name}: ${JSON.stringify(c.issues)} ${JSON.stringify(c.fields.flatMap((f) => f.issues))}`).not.toBe('error');
          expect(c.extraFields).toEqual([]);
        }
        // Same number of features per class as before.
        const src = before.gdbs.find((b) => b.database === g.database);
        if (src)
          for (const c of src.datasets.flatMap((d) => d.classes).concat(src.rootClasses)) {
            if (c.rowCount === null || c.status === 'absent') continue;
            const out = [...g.datasets.flatMap((d) => d.classes), ...g.rootClasses].find((x) => (x.actualName ?? x.name).toLowerCase() === (c.actualName ?? c.name).toLowerCase());
            expect(out?.rowCount, `${g.fileName} ${c.name}`).toBe(c.rowCount);
          }
      }
      expect(after.maHoSo.map(([v]) => v)).toEqual([OPTS.maHoSoQH]);
      expect(after.maThongTin.map(([v]) => v)).toEqual([OPTS.maThongTinQH]);
    }, 300_000);
  });
}
