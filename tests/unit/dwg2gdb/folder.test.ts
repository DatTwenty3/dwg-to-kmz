// "Bóc tách DWG → TT16" end to end on the owner's real folder (dwg_to_gdb/, not committed — skipped without it):
// read the DWGs + xrefs, suggest the mapping, build features, write with GDAL (Node), normalise, check.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import {
  analyzeDrawings,
  buildFeatures,
  initialMapping,
  loadFolder,
  planStage1,
  buildQgs,
  roleById,
  summaryDocument,
  vn2000EsriWkt,
  type Analysis,
  type BuildResult,
  type LoadedFolder,
} from '@/lib/dwg2gdb';
import { collectGdbs, readCatalog, runCheck, type GdbEntry, type SubmissionReport } from '@/lib/gdb';
import { executePlan, planNormalization, type NormalizeSource } from '@/lib/gdb/normalize';
import { createRequire } from 'node:module';
import { toDxf } from '@/lib/export/dxf';
import { WASM_DIR } from '../fixtures';

const ROOT = 'dwg_to_gdb/LAY Y KIEN SXD';
const WORK = 'node_modules/.cache/dwg2gdb';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const entriesOf = (dir: string, root: string): GdbEntry[] =>
  walk(dir).map((p) => ({ path: relative(root, p).split(sep).join('/'), read: async () => readFileSync(p) }));

describe.skipIf(!existsSync(ROOT))('Bóc tách DWG → TT16 — xã Long Hiệp', () => {
  let folder: LoadedFolder;
  let a: Analysis;
  let built: BuildResult;
  let report: SubmissionReport;
  let mappingUsed: ReturnType<typeof initialMapping>;
  let qgs = '';
  let summary = '';

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
    const mapping = initialMapping(a, null);
    mappingUsed = mapping;
    const included = new Set(a.drawings.filter((d) => d.included).map((d) => d.id));
    built = buildFeatures(
      folder.drawings.filter((p) => included.has(p.id)).map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: a.inside.get(p.id)! })),
      mapping,
      { boundary: a.boundary?.ring ?? null, sourceInGhiChu: false },
    );

    // GDAL (Node): stage 1 from GeoJSON, then "Chuẩn hóa TT16" of the stage-1 geodatabases.
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(`${WORK}/in`, { recursive: true });
    mkdirSync(`${WORK}/out`, { recursive: true });
    // @ts-expect-error — gdal3.js ships no types for its Node entry.
    const { default: initGdalJs } = await import('gdal3.js/node.js');
    const errs: string[] = [];
    const Gdal = await initGdalJs({ path: 'node_modules/gdal3.js/dist/package', dest: `${WORK}/out`, logHandler: () => {}, errorHandler: (m: string) => errs.push(m) });
    const s1 = planStage1(built.classes, vn2000EsriWkt(105.5, 3, 'Trà Vinh'));
    for (const i of s1.inputs) writeFileSync(`${WORK}/in/${i.fileName}`, i.json);
    const o1 = await Gdal.open(s1.inputs.map((i) => `${WORK}/in/${i.fileName}`), [], []);
    const ds1 = new Map<string, unknown>(o1.datasets.map((d: { path: string }) => [d.path.replace(/^.*[\\/]/, '').replace(/\.geojson$/, ''), d]));
    try {
      await executePlan(Gdal, ds1, s1, 's1_');
    } catch (e) {
      throw new Error(`${(e as Error).message} — GDAL: ${errs.slice(-3).join(' | ')}`);
    }
    const stage1 = entriesOf(`${WORK}/out`, `${WORK}/out`)
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
    const plan = planNormalization(sources, { maHoSoQH: '86QHC1000001', maThongTinQH: '862611000001', createMissingDatabases: true });
    const o2 = await Gdal.open(zips, [], ['vsizip']);
    const ds2 = new Map<string, unknown>(o2.datasets.map((d: { path: string }) => [d.path.replace(/^.*[\\/]/, '').replace(/\.gdb\.zip$/, ''), d]));
    await executePlan(Gdal, ds2, plan, 'out_');
    const out = entriesOf(`${WORK}/out`, `${WORK}/out`)
      .filter((e) => e.path.startsWith('out_'))
      .map((e) => ({ ...e, path: e.path.replace(/^out_/, 'HoSoGIS/') }));
    // Tệp tổng hợp (QGIS project) next to the geodatabases.
    const b = a.boundary!.ring;
    qgs = buildQgs({
      name: 'QHC_XaLongHiep',
      title: 'QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG ĐẾN NĂM 2050',
      classes: built.classes,
      lon0: 105.5,
      zone: 3,
      extent: [Math.min(...b.map((q) => q[0])), Math.min(...b.map((q) => q[1])), Math.max(...b.map((q) => q[0])), Math.max(...b.map((q) => q[1]))],
    });
    const qz = new JSZip();
    qz.file('QHC_XaLongHiep.qgs', qgs);
    const qbytes = await qz.generateAsync({ type: 'uint8array' });
    writeFileSync(`${WORK}/QHC_XaLongHiep.qgs`, qgs);
    out.push({ path: 'HoSoGIS/QHC_XaLongHiep.qgz', read: async () => qbytes });
    report = await runCheck(out, undefined, { provinceCode: '86' });

    summary += `boundary ${a.boundary ? Math.round(a.boundary.area / 1e4) : 0} ha · unused ${folder.unused.map((u) => u.name).join(', ')} · missing ${folder.missingXrefs.join(', ')}\n`;
    for (const d of a.drawings) summary += `  ${d.included ? '●' : '○'} ${d.owner ? '  ↳ ' : ''}${d.name} — ${roleById(d.role).label}${d.note ? ` (${d.note})` : ''}\n`;
    for (const c of built.classes) summary += `  ${c.target}: ${c.features.length} (có tên ${c.features.filter((f) => f.tenDoiTuong).length})\n`;
    summary += built.notes.join('\n') + '\n';
    for (const g of report.gdbs) summary += `  ${g.fileName}: lỗi ${g.counts.errors}, cảnh báo ${g.counts.warnings}, crs ${g.crs?.status} ${g.crs?.text ?? ''}\n`;
    summary += [...report.issues, ...report.gdbs.flatMap((g) => g.issues)].map((i) => `  [${i.level}] ${i.text}`).join('\n');
    writeFileSync('node_modules/.cache/dwg2gdb-summary.txt', summary);
  }, 900_000);

  it('recognises every map of the folder', () => {
    const role = (name: RegExp) => a.drawings.find((d) => !d.owner && name.test(d.name))?.role;
    expect(role(/^QH02_BanDo/)).toBe('ht-sdd');
    expect(role(/hien trang ha tang/i)).toBe('ht-htkt');
    expect(role(/^QH06/)).toBe('qh-sdd');
    expect(role(/^QH_07/)).toBe('qh-gt');
    expect(role(/^QH_08/)).toBe('qh-dien');
    expect(role(/^QH_09/)).toBe('qh-ttll');
    expect(role(/^QH_10/)).toBe('qh-nuoc');
    expect(role(/^QH_11/)).toBe('qh-tn');
    expect(role(/^QH01/)).toBe('vitri');
    // QH05 (2030) is left out because QH06 (2050) is there.
    expect(a.drawings.find((d) => /^QH05/.test(d.name))?.included).toBe(false);
    // The road network of QH07 is in its xref.
    const xr = a.drawings.find((d) => /nen giao/i.test(d.name));
    expect(xr?.owner?.name).toMatch(/^QH_07/);
    expect(xr?.role).toBe('qh-gt');
    // The planning area: 6.516,8 ha in the explanatory note.
    expect(a.boundary!.area / 1e4).toBeGreaterThan(6500);
    expect(a.boundary!.area / 1e4).toBeLessThan(6530);
  });

  it('builds land use, roads, power, water, drainage and the boundary', () => {
    const n = (t: string) => built.classes.find((c) => c.target === t)?.features.length ?? 0;
    expect(n('HienTrang/HienTrangSuDungDat/ChucNangSuDungDat_A')).toBeGreaterThan(10_000);
    expect(n('QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A')).toBeGreaterThan(300);
    expect(n('QuyHoach/QuyHoachCapDien/MangLuoiPhanPhoiDien_L')).toBeGreaterThan(10);
    expect(n('QuyHoach/QuyHoachCapNuoc/MangLuoiCapNuoc_L')).toBeGreaterThan(50);
    expect(n('QuyHoach/QuyHoachChuanBiKyThuat/MangLuoiThoatNuocMua_L')).toBeGreaterThan(50);
    expect(n('QuyHoach/ViTriRanhGioi/RanhGioiQuyHoach_A')).toBe(1);
    expect(n('HienTrang/ViTriRanhGioi/RanhGioiQuyHoach_A')).toBe(1);
    // Labels inside land use areas become tenDoiTuong.
    const qh = built.classes.find((c) => c.target === 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A')!;
    expect(qh.features.some((f) => /TRƯỜNG|TRUNG TÂM|UBND|CÔNG NGHIỆP/.test(f.tenDoiTuong ?? ''))).toBe(true);
  });

  it('writes a HoSoGIS that passes the Thông tư 16 check (geodatabases + QGIS project)', () => {
    expect(report.gdbs.map((g) => g.fileName).sort()).toEqual(['HienTrang.gdb', 'MocGioi.gdb', 'NenDiaHinh.gdb', 'QuyHoach.gdb']);
    for (const g of report.gdbs) {
      expect(g.counts.errors, `${g.fileName}: ${JSON.stringify(g.issues)}`).toBe(0);
      expect(g.crs?.status, g.fileName).toBe('ok');
    }
    const errors = report.issues.filter((i) => i.level === 'error').map((i) => i.text);
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  it('builds a well-formed QGIS project pointing at the geodatabases', () => {
    const sax = createRequire(import.meta.url)('sax');
    const parser = sax.parser(true);
    const sources: string[] = [];
    let cats = 0;
    parser.onopentag = (t: { name: string; attributes: Record<string, string> }) => {
      if (t.name === 'layer-tree-layer') sources.push(t.attributes.source);
      if (t.name === 'category') cats++;
    };
    parser.write(qgs).close(); // throws on malformed XML
    expect(sources).toContain('./QuyHoach.gdb|layername=ChucNangSuDungDat_A');
    expect(sources).toContain('./HienTrang.gdb|layername=CongTrinh_A');
    expect(cats).toBeGreaterThan(20);
    expect(qgs).toContain('<authid>EPSG:9209</authid>');
    expect(qgs).toContain('class="LinePatternFill"');
    expect(qgs).toContain('fieldName="tenDoiTuong"');
    expect(qgs).toContain('<Absolute type="bool">false</Absolute>');
  });

  it('writes the summary drawing (DXF) with the original hatches, colours and texts', () => {
    const roles = new Map(a.drawings.map((d) => [d.id, d]));
    const doc = summaryDocument(
      folder.drawings
        .filter((p) => roles.get(p.id)?.included)
        .map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: a.inside.get(p.id)!, role: roles.get(p.id)!.role })),
      mappingUsed,
      { boundary: a.boundary?.ring ?? null, texts: true },
    );
    expect(doc.layers.some((l) => l.name === 'QH_ChucNangSuDungDat_A_Đất ở')).toBe(true);
    expect(doc.layers.some((l) => /^HT_Chu_/.test(l.name))).toBe(true);
    const dxf = toDxf(doc, { units: 'm', layers: doc.layers.map((l) => l.name) });
    writeFileSync(`${WORK}/TongHop.dxf`, dxf);
    // Pattern hatches keep their pattern (name + lines), Vietnamese text is there.
    expect(dxf).toMatch(/\nHATCH\n[\s\S]{0,400}?\n2\nGRASS\n70\n0\n/);
    expect(dxf).toContain('\n78\n');
    expect(dxf).toContain('TRƯỜNG');
    summary += `\nDXF ${(dxf.length / 1048576).toFixed(1)} MB, ${doc.layers.length} layers, ${doc.entities.length} entities\n`;
    writeFileSync('node_modules/.cache/dwg2gdb-summary.txt', summary);
  });
});
