// "Bóc tách DWG → HoSoGIS" as a command: the core of /boc-tach (src/workers/dwgTt16.worker.ts) run on any folder of DWG/DXF
// and written to disk. Skipped unless HS_IN is set.
//
//   HS_IN="<thư mục bản vẽ>" HS_OUT="<thư mục kết quả>" npx vitest run tests/unit/dwg2gdb/xuatHoSoGIS.test.ts
//
// Writes <HS_OUT>/HoSoGIS/{HienTrang,QuyHoach,NenDiaHinh,MocGioi}.gdb + <tên>.qgz + <tên>.gpkg and <HS_OUT>/HOSOGIS_BAOCAO.json
// (per-class counts, the Thông tư 16 check, boundary, province / KTT). Everything (name, province, KTT, codes) is read from
// the drawings the way the web app reads it; HS_LON0 / HS_PROVINCE_CODE override the KTT / province code when the drawings
// do not say. HS_DXF=1 also writes the summary drawing BanVeTongHop.dxf next to HoSoGIS.
import { tt16Wkt } from '@/lib/gdb/tt16Schema';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { parseDwg, parseDxf } from '@/lib/cad';
import {
  analyzeDrawings,
  buildFeatures,
  buildQgs,
  cadLayerData,
  cadSourceDocument,
  cleanProjectName,
  colorContexts,
  drawingTexts,
  guessesInProvince,
  initialMapping,
  loadFolder,
  planCadGpkg,
  planStage1,
  planUnitFromTitle,
  projectNameFromTexts,
  provinceFromTexts,
  summaryDocument,
} from '@/lib/dwg2gdb';
import { collectGdbs, readCatalog, runCheck, type GdbEntry } from '@/lib/gdb';
import { codeForProvince } from '@/lib/gdb/crs';
import { fixGdalOutput } from '@/lib/gdb/gdalFix';
import { executePlan, planNormalization, schemaKey, type NormalizeSource } from '@/lib/gdb/normalize';
import { buildSchemaGpkg } from '@/lib/gdb/schemaGpkg';
import { loadSvgLibrary } from '@/lib/dwg2gdb/qgisSvg';
import { sampleCodes } from '@/lib/gdb/tt16';
import { locateVn2000 } from '@/lib/geo/search';
import { toDxf } from '@/lib/export/dxf';
import { WASM_DIR } from '../fixtures';

const IN = process.env.HS_IN ?? '';
const OUT = process.env.HS_OUT ?? '';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const entriesOf = (dir: string): GdbEntry[] => walk(dir).map((p) => ({ path: relative(dir, p).split(sep).join('/'), read: async () => readFileSync(p) }));

describe.skipIf(!IN || !existsSync(IN))('Xuất HoSoGIS từ thư mục bản vẽ', () => {
  it('đọc → bóc tách → chuẩn hóa TT16 → .qgz → kiểm tra', async () => {
    const WORK = `node_modules/.cache/hosogis-${Date.now()}`;
    mkdirSync(`${WORK}/in`, { recursive: true });
    mkdirSync(`${WORK}/out`, { recursive: true });
    mkdirSync(OUT, { recursive: true });

    // ── Read the folder like the worker does.
    const files = walk(IN)
      .filter((f) => /\.(dwg|dxf)$/i.test(f))
      .map((f, i) => ({
        id: `f${i}`,
        name: f.split(sep).pop()!,
        path: relative(IN, f).split(sep).join('/'),
        size: statSync(f).size,
        read: async () => {
          const b = readFileSync(f);
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        },
      }));
    const folder = await loadFolder(files, (f, data) => (/\.dxf$/i.test(f.name) ? parseDxf(data, { wasmBaseUrl: WASM_DIR }) : parseDwg(data, { wasmBaseUrl: WASM_DIR })));
    const a = analyzeDrawings(folder.drawings);
    const mapping = initialMapping(a, null);
    const included = new Set(a.drawings.filter((d) => d.included).map((d) => d.id));
    const b = a.boundary;
    expect(b, 'không tìm thấy ranh lập quy hoạch').toBeTruthy();
    const ring = b!.ring;

    // ── Name, province, KTT: from the title blocks and the location, as the page pre-selects them.
    const mainTexts = folder.drawings.filter((p) => !p.owner).flatMap((p) => drawingTexts(p.doc));
    const province = provinceFromTexts(mainTexts);
    const projectTitle =
      mainTexts
        .flatMap((t) => t.split('\n'))
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .find((t) => /^QUY HOẠCH (CHUNG|PHÂN KHU|CHI TIẾT)/i.test(t) && t.length < 160) ?? '';
    const at: [number, number] = [(Math.min(...ring.map((p) => p[0])) + Math.max(...ring.map((p) => p[0]))) / 2, (Math.min(...ring.map((p) => p[1])) + Math.max(...ring.map((p) => p[1]))) / 2];
    const guesses = guessesInProvince(locateVn2000(at[1], at[0]), province);
    const lon0 = process.env.HS_LON0 ? Number(process.env.HS_LON0) : (guesses[0]?.lon0 ?? 105.5);
    const provinceCode = process.env.HS_PROVINCE_CODE ?? (province ? codeForProvince(province) : null);
    const projectName = cleanProjectName(projectNameFromTexts(mainTexts) ?? 'HoSoGIS');
    const codes = sampleCodes(provinceCode ?? '86');

    // ── Features.
    const inputs = folder.drawings.filter((p) => included.has(p.id)).map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: a.inside.get(p.id)!, color: colorContexts(a).get(p.id) }));
    const built = buildFeatures(inputs, mapping, { boundary: ring, sourceInGhiChu: false, planUnit: planUnitFromTitle(projectTitle) });
    expect(built.classes.length).toBeGreaterThan(0);

    // ── GDAL (Node): stage 1, then "Chuẩn hóa TT16".
    // @ts-expect-error — gdal3.js ships no types for its Node entry.
    const { default: initGdalJs } = await import('gdal3.js/node.js');
    const errs: string[] = [];
    const Gdal = await initGdalJs({ path: 'node_modules/gdal3.js/dist/package', dest: `${WORK}/out`, logHandler: () => {}, errorHandler: (m: string) => errs.push(m) });
    const s1 = planStage1(built.classes, tt16Wkt(lon0, 3));
    for (const i of s1.inputs) writeFileSync(`${WORK}/in/${i.fileName}`, i.json);
    const o1 = await Gdal.open(s1.inputs.map((i) => `${WORK}/in/${i.fileName}`), [], []);
    const ds1 = new Map<string, unknown>(o1.datasets.map((d: { path: string }) => [d.path.replace(/^.*[\\/]/, '').replace(/\.geojson$/, ''), d]));
    try {
      await executePlan(Gdal, ds1, s1, 's1_');
    } catch (e) {
      throw new Error(`${(e as Error).message} — GDAL: ${errs.slice(-3).join(' | ')}`);
    }
    const stage1 = entriesOf(`${WORK}/out`)
      .filter((e) => e.path.startsWith('s1_'))
      .map((e) => ({ ...e, path: e.path.replace(/^s1_/, '') }));
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
    const plan = planNormalization(sources, { maHoSoQH: codes.maHoSoQH, maThongTinQH: codes.maThongTinQH, createMissingDatabases: true });
    const SQL = await initSqlJs();
    for (const db of plan.schemas) {
      const zip = new JSZip();
      zip.file(`${schemaKey(db)}.gpkg`, buildSchemaGpkg(SQL, db));
      writeFileSync(`${WORK}/in/${schemaKey(db)}.gpkg.zip`, await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
      zips.push(`${WORK}/in/${schemaKey(db)}.gpkg.zip`);
    }
    const o2 = await Gdal.open(zips, [], ['vsizip']);
    const ds2 = new Map<string, unknown>(o2.datasets.map((d: { path: string }) => [d.path.replace(/^.*[\\/]/, '').replace(/\.(gdb|gpkg)\.zip$/, ''), d]));
    await executePlan(Gdal, ds2, plan, 'out_');
    const raw = entriesOf(`${WORK}/out`).filter((e) => e.path.startsWith('out_'));
    const out: GdbEntry[] = fixGdalOutput(await Promise.all(raw.map(async (e) => ({ path: e.path.replace(/^out_/, 'HoSoGIS/'), bytes: new Uint8Array(await e.read()) }))));

    // ── "Bản vẽ CAD" (.gpkg) + the QGIS project.
    const roleOf = new Map(a.drawings.map((d) => [d.id, d]));
    const used = folder.drawings.filter((p) => included.has(p.id)).map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: a.inside.get(p.id)!, color: colorContexts(a).get(p.id), role: roleOf.get(p.id)!.role }));
    const cad = cadLayerData(cadSourceDocument(used, mapping, ring));
    const cadPlan = planCadGpkg(cad, tt16Wkt(lon0, 3), projectName);
    for (const i of cadPlan.inputs) writeFileSync(`${WORK}/in/${i.fileName}`, i.json);
    const oc = await Gdal.open(cadPlan.inputs.map((i) => `${WORK}/in/${i.fileName}`), [], []);
    await executePlan(Gdal, new Map<string, unknown>(oc.datasets.map((d: { path: string }) => [d.path.replace(/^.*[\\/]/, '').replace(/\.geojson$/, ''), d])), cadPlan, 'cad_');
    const cadFile = `${WORK}/out/cad_${projectName}.gpkg`;
    expect(existsSync(cadFile)).toBe(true);
    out.push({ path: `HoSoGIS/${projectName}.gpkg`, read: async () => readFileSync(cadFile) });

    const fromDisk = (async (url: string) => {
      const m = /\/tt16-svg\/(hatch|point)\/(.+)$/.exec(String(url));
      const path = m ? `tt16-${m[1]}-svg/${m[2]}` : '';
      return existsSync(path) ? new Response(readFileSync(path)) : new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const svg = await loadSvgLibrary(built.classes, 'http://local', fromDisk);
    const qgs = buildQgs({
      cad: { counts: cad.counts, patternColors: cad.patternColors },
      svg: svg ?? undefined,
      name: projectName,
      title: projectTitle || projectName,
      classes: built.classes,
      lon0,
      zone: 3,
      extent: [Math.min(...ring.map((q) => q[0])) - 200, Math.min(...ring.map((q) => q[1])) - 200, Math.max(...ring.map((q) => q[0])) + 200, Math.max(...ring.map((q) => q[1])) + 200],
    });
    const qz = new JSZip();
    qz.file(`${projectName}.qgs`, qgs);
    const qbytes = await qz.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    out.push({ path: `HoSoGIS/${projectName}.qgz`, read: async () => qbytes });

    // ── Check, then write to disk.
    const report = await runCheck(out, undefined, { provinceCode });
    rmSync(join(OUT, 'HoSoGIS'), { recursive: true, force: true });
    for (const e of out) {
      const target = join(OUT, e.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, await e.read());
    }
    if (process.env.HS_DXF === '1') {
      const doc = summaryDocument(used, mapping, { boundary: ring, texts: true });
      writeFileSync(join(OUT, 'BanVeTongHop.dxf'), toDxf(doc, { units: 'm', layers: doc.layers.map((l) => l.name) }));
    }
    const catalogs: Record<string, Record<string, number>> = {};
    for (const g of collectGdbs(out).gdbs) catalogs[g.name] = Object.fromEntries((await readCatalog(g)).classes.map((c) => [c.name, c.rowCount ?? 0]));
    writeFileSync(
      join(OUT, 'HOSOGIS_BAOCAO.json'),
      JSON.stringify(
        {
          projectName,
          projectTitle,
          province: province?.name ?? null,
          provinceCode,
          lon0,
          guesses: guesses.slice(0, 4).map((g) => ({ province: g.province, lon0: g.lon0 })),
          boundaryHa: Math.round(b!.area / 1e4),
          drawings: a.drawings.map((d) => ({ name: d.name, role: d.role, included: d.included, owner: d.owner?.name ?? null })),
          missingXrefs: folder.missingXrefs,
          unused: folder.unused.map((u) => u.name),
          classes: built.classes.map((c) => ({ target: c.target, count: c.features.length, named: c.features.filter((f) => f.tenDoiTuong).length })),
          catalogs,
          notes: built.notes,
          cad: { counts: cad.counts, thinned: cad.thinned },
          check: {
            issues: report.issues,
            gdbs: report.gdbs.map((g) => ({ name: g.fileName, errors: g.counts.errors, warnings: g.counts.warnings, crs: g.crs, issues: g.issues })),
          },
        },
        null,
        1,
      ),
    );
    rmSync(WORK, { recursive: true, force: true });
    expect(report.gdbs.length).toBe(4);
  }, 1_800_000);
});
