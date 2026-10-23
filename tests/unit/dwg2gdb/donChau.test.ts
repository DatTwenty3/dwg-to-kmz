// Đôn Châu end to end (dwg_to_gdb/DON CHAU, not committed — skipped without it): the route 914C is one wide dashed line on
// the layer "TEXT"; it has to arrive in MangLuoiGiaoThongDuongBo_L of the geodatabase, with its name, whole.
import { tt16Wkt } from '@/lib/gdb/tt16Schema';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import { analyzeDrawings, buildFeatures, colorContexts, initialMapping, loadFolder, planStage1 } from '@/lib/dwg2gdb';
import { collectGdbs, readCatalog, type GdbEntry } from '@/lib/gdb';
import { decodeShape } from '@/lib/gdb/shape';
import { fixGdalOutput } from '@/lib/gdb/gdalFix';
import { executePlan, planNormalization, schemaKey, type NormalizeSource } from '@/lib/gdb/normalize';
import { buildSchemaGpkg } from '@/lib/gdb/schemaGpkg';
import initSqlJs from 'sql.js';
import { WASM_DIR } from '../fixtures';

const ROOT = 'dwg_to_gdb/DON CHAU';
const WORK = 'node_modules/.cache/dwg2gdb-donchau';
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const entriesOf = (dir: string, root: string): GdbEntry[] => walk(dir).map((p) => ({ path: relative(root, p).split(sep).join('/'), read: async () => readFileSync(p) }));

describe.skipIf(!existsSync(ROOT))('Đôn Châu — tuyến 914C (nét đứt trên layer TEXT)', () => {
  it('is written to MangLuoiGiaoThongDuongBo_L of QuyHoach.gdb with its name and its whole length', async () => {
    const files = walk(ROOT).filter((f) => /\.dwg$/i.test(f)).map((f, i) => ({
      id: `f${i}`, name: f.split(sep).pop()!, path: relative(ROOT, f).split(sep).join('/'), size: statSync(f).size,
      read: async () => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
    }));
    const folder = await loadFolder(files, (_f, data) => parseDwg(data, { wasmBaseUrl: WASM_DIR }));
    const a = analyzeDrawings(folder.drawings);
    const mapping = initialMapping(a, null);
    const included = new Set(a.drawings.filter((d) => d.included).map((d) => d.id));
    const built = buildFeatures(
      folder.drawings.filter((p) => included.has(p.id)).map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: a.inside.get(p.id)!, color: colorContexts(a).get(p.id) })),
      mapping,
      { boundary: a.boundary?.ring ?? null, sourceInGhiChu: false, planUnit: 'XÃ ĐÔN CHÂU' },
    );
    const road = built.classes.find((c) => c.target === 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L')!;
    const inMemory = road.features.filter((f) => f.attrs?.tenDuong === 'Đường 914C');
    expect(inMemory).toHaveLength(1);

    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(`${WORK}/in`, { recursive: true });
    mkdirSync(`${WORK}/out`, { recursive: true });
    // @ts-expect-error — gdal3.js ships no types for its Node entry.
    const { default: initGdalJs } = await import('gdal3.js/node.js');
    const Gdal = await initGdalJs({ path: 'node_modules/gdal3.js/dist/package', dest: `${WORK}/out`, logHandler: () => {}, errorHandler: () => {} });
    const s1 = planStage1(built.classes, tt16Wkt(105, 3));
    for (const i of s1.inputs) writeFileSync(`${WORK}/in/${i.fileName}`, i.json);
    const o1 = await Gdal.open(s1.inputs.map((i) => `${WORK}/in/${i.fileName}`), [], []);
    await executePlan(Gdal, new Map<string, unknown>(o1.datasets.map((d: { path: string }) => [d.path.replace(/^.*[\\/]/, '').replace(/\.geojson$/, ''), d])), s1, 's1_');
    const stage1 = entriesOf(`${WORK}/out`, `${WORK}/out`).filter((e) => e.path.startsWith('s1_')).map((e) => ({ ...e, path: e.path.replace(/^s1_/, '') }));
    const { gdbs } = collectGdbs(stage1);
    const sources: NormalizeSource[] = [];
    const zips: string[] = [];
    for (let i = 0; i < gdbs.length; i++) {
      const zip = new JSZip();
      for (const [name, e] of gdbs[i].files) zip.file(`${gdbs[i].name}/${name}`, await e.read());
      const path = `${WORK}/in/s${i}.gdb.zip`;
      writeFileSync(path, await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
      zips.push(path);
      sources.push({ key: `s${i}`, name: gdbs[i].name, database: gdbs[i].name.replace(/\.gdb$/i, ''), catalog: await readCatalog(gdbs[i]) });
    }
    const plan = planNormalization(sources, { maHoSoQH: '86QHC1000001', maThongTinQH: '862611000001', createMissingDatabases: true });
    const SQL = await initSqlJs();
    for (const db of plan.schemas) {
      const zip = new JSZip();
      zip.file(`${schemaKey(db)}.gpkg`, buildSchemaGpkg(SQL, db));
      writeFileSync(`${WORK}/in/${schemaKey(db)}.gpkg.zip`, await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
      zips.push(`${WORK}/in/${schemaKey(db)}.gpkg.zip`);
    }
    const o2 = await Gdal.open(zips, [], ['vsizip']);
    await executePlan(Gdal, new Map<string, unknown>(o2.datasets.map((d: { path: string }) => [d.path.replace(/^.*[\\/]/, '').replace(/\.(gdb|gpkg)\.zip$/, ''), d])), plan, 'out_');
    const raw = entriesOf(`${WORK}/out`, `${WORK}/out`).filter((e) => e.path.startsWith('out_'));
    const out: GdbEntry[] = fixGdalOutput(await Promise.all(raw.map(async (e) => ({ path: e.path.replace(/^out_/, 'HoSoGIS/'), bytes: new Uint8Array(await e.read()) }))));
    const qh = await readCatalog(collectGdbs(out).gdbs.find((g) => g.name === 'QuyHoach.gdb')!);
    const cls = qh.classes.find((c) => c.name === 'MangLuoiGiaoThongDuongBo_L')!;
    const g = cls.fields.find((f) => f.geom)!;
    const lengths: { name: string; len: number }[] = [];
    for (const { row, shape } of cls.features!()) {
      const s = shape ? decodeShape(shape, g.geom!) : null;
      if (s?.type !== 'line' || !row.tenDuong) continue;
      const len = s.parts.reduce((sum, part) => sum + part.reduce((l, p, k) => (k ? l + Math.hypot(p[0] - part[k - 1][0], p[1] - part[k - 1][1]) : 0), 0), 0);
      lengths.push({ name: String(row.tenDuong), len: Math.round(len) });
    }
    console.log('GDB roads', cls.rowCount, JSON.stringify(lengths));
    const r914c = lengths.find((l) => l.name === 'Đường 914C');
    expect(r914c).toBeDefined();
    expect(r914c!.len).toBeGreaterThan(10000);
  }, 600_000);
});
