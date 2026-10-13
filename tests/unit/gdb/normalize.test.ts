import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { collectGdbs, readCatalog, runCheck, type GdbEntry } from '@/lib/gdb';
import { fixGdalOutput } from '@/lib/gdb/gdalFix';
import { executePlan, fixClassName, pascalName, planNormalization, schemaKey, type NormalizeSource } from '@/lib/gdb/normalize';
import { buildSchemaGpkg } from '@/lib/gdb/schemaGpkg';
import { TT16_SCHEMA } from '@/lib/gdb/tt16Schema';
import { readTable } from '@/lib/gdb';
import initSqlJs from 'sql.js';
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
  it('creates the missing databases on the template frame, NenDiaHinh with its 4 classes', () => {
    const cls = { name: 'ChucNangSuDungDat_A', path: '', dataset: 'HienTrangSuDungDat', alias: '', shapeType: 'esriGeometryPolygon', geom: 'A' as const, srName: null, wkt: '', extent: null, fields: [{ name: 'Shape', alias: '', type: 'geometry' as const, length: 0, nullable: true }], rowCount: 1, rows: function* () {} };
    const src = { key: 's0', name: 'HienTrang.gdb', database: 'HienTrang', catalog: { datasets: ['HienTrangSuDungDat'], classes: [cls], tables: [] } };
    const plan = planNormalization([src], { maHoSoQH: '86QHC1000001', maThongTinQH: '862611000001', createMissingDatabases: true });
    expect(plan.outputs).toEqual(['HienTrang', 'QuyHoach', 'NenDiaHinh', 'MocGioi']);
    expect(plan.schemas).toEqual(['HienTrang', 'QuyHoach', 'NenDiaHinh', 'MocGioi']);
    const nen = plan.steps.filter((s) => s.out === 'NenDiaHinh');
    expect(nen.map((s) => s.label)).toEqual(['NenDiaHinh / DiemDoCao_P', 'NenDiaHinh / DuongDongMuc_L', 'NenDiaHinh / GhiChu_P', 'NenDiaHinh / NenDiaHinh_L']);
    expect(nen.every((s) => s.features === 0 && s.source === schemaKey('NenDiaHinh'))).toBe(true);
    expect(plan.notes.some((n) => /NenDiaHinh.gdb theo mẫu của Bộ Xây dựng \(1 nhóm, 4 lớp/.test(n))).toBe(true);
    // The uploaded class: created from the template, then its feature appended with the template fields.
    const ht = plan.steps.filter((s) => s.out === 'HienTrang' && s.label === 'HienTrangSuDungDat / ChucNangSuDungDat_A');
    expect(ht.map((s) => s.source)).toEqual([schemaKey('HienTrang'), 's0']);
    expect(ht[0].args).toContain('LAYER_ALIAS=Chức năng sử dụng đất');
    expect(ht[1].args).toContain('-append');
    expect(ht[1].args.join(' ')).toMatch(/'1' AS character\(50\)\) AS trangThaiQuyHoach/);
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
  const SQL = await initSqlJs();
  for (const db of plan.schemas) {
    const zip = new JSZip();
    zip.file(`${schemaKey(db)}.gpkg`, buildSchemaGpkg(SQL, db));
    writeFileSync(`${work}/in/${schemaKey(db)}.gpkg.zip`, await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
    paths.push(`${work}/in/${schemaKey(db)}.gpkg.zip`);
  }
  const opened = await Gdal.open(paths, [], ['vsizip']);
  expect(opened.errors).toEqual([]);
  const datasets = new Map<string, unknown>(opened.datasets.map((d: { path: string }) => [d.path.replace(/^.*\//, '').replace(/\.(gdb|gpkg)\.zip$/, ''), d]));
  const t0 = Date.now();
  try {
    await executePlan(Gdal, datasets, plan, `${tag}_`);
  } catch (e) {
    throw new Error(`${(e as Error).message}\nGDAL: ${errs.slice(-4).join(' | ')}`);
  }
  const ms = Date.now() - t0;
  const raw = walk(`${WORK}/out`, `${WORK}/out`).filter((e) => e.path.startsWith(`${tag}_`));
  const outEntries = fixGdalOutput(await Promise.all(raw.map(async (e) => ({ path: e.path.replace(`${tag}_`, 'HoSoGIS/'), bytes: new Uint8Array(await e.read()) }))));
  const after = await runCheck(outEntries, undefined, { provinceCode: '86' });
  return { before, after, plan, ms, errs, outEntries };
}

/** Every template class is in the output with the template's fields (order, type, alias, domain), alias, group and shape type. */
async function expectTemplate(entries: GdbEntry[]) {
  for (const g of collectGdbs(entries).gdbs) {
    const db = g.name.replace(/\.gdb$/i, '');
    const cat = await readCatalog(g);
    const items = readTable(await g.files.get('a00000004.gdbtable')!.read(), await g.files.get('a00000004.gdbtablx')!.read());
    const defs = new Map([...items.rows()].map((r) => [String(r.Path ?? ''), String(r.Definition ?? '')]));
    for (const ds of TT16_SCHEMA.databases[db] ?? [])
      for (const spec of ds.classes) {
        const c = cat.classes.find((x) => x.name === spec.name);
        expect(c, `${db} ${spec.name}`).toBeDefined();
        expect(c!.dataset).toBe(ds.name);
        expect(c!.shapeType).toBe({ A: 'esriGeometryPolygon', L: 'esriGeometryPolyline', P: 'esriGeometryPoint' }[spec.geom]);
        const fields = c!.fields.filter((f) => f.type !== 'objectid' && f.type !== 'geometry' && !/^shape_(length|area)$/i.test(f.name));
        expect(fields.map((f) => `${f.name}|${f.alias}|${f.type}|${f.type === 'string' ? f.length : ''}`), `${db} ${spec.name}`).toEqual(
          spec.fields.map((f) => `${f.name}|${f.alias}|${f.type}|${f.type === 'string' ? f.length : ''}`),
        );
        const def = defs.get(c!.path) ?? '';
        expect(def, `${db} ${spec.name} alias`).toContain(`<AliasName>${spec.alias}</AliasName>`);
        for (const f of spec.fields.filter((x) => x.domain)) expect(def, `${spec.name}.${f.name}`).toMatch(new RegExp(`<Name>${f.name}</Name>(?:(?!</GPFieldInfoEx>)[\\s\\S])*<DomainName>${f.domain}</DomainName>`));
        expect(def).not.toContain('esriGeometryLine<');
      }
  }
}

for (const [tag, dir] of [
  ['nhilong', FIXTURE_HOSOGIS],
  ['hamgiang', FIXTURE_HAMGIANG],
] as const) {
  describe.skipIf(!existsSync(dir))(`Chuẩn hóa TT16 — ${tag}`, () => {
    it('rebuilds every geodatabase to the circular, geometry untouched', async () => {
      const { before, after, plan, ms, errs, outEntries } = await normalizeFixture(dir, tag);
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
      // Every group (empty ones created by the normalisation included) has the "đúng hệ tọa độ" verdict.
      for (const g of after.gdbs) {
        expect(g.crs?.status, g.fileName).toBe('ok');
        for (const d of g.datasets) if (d.actualName) expect(d.crs?.status, `${g.fileName} ${d.name}`).toBe('ok');
      }
      expect(after.maHoSo.map(([v]) => v)).toEqual([OPTS.maHoSoQH]);
      expect(after.maThongTin.map(([v]) => v)).toEqual([OPTS.maThongTinQH]);
      await expectTemplate(outEntries);
    }, 300_000);
  });
}
