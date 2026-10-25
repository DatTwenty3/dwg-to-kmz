// Contour lines and spot heights go to NenDiaHinh.gdb (with caoDo), a boundary marker layer to MocGioi.gdb.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import initSqlJs from 'sql.js';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { buildFeatures, planStage1, rowKey, suggest, type MappingEntry } from '@/lib/dwg2gdb';
import { collectGdbs, readCatalog, type GdbEntry } from '@/lib/gdb';
import { executePlan, planNormalization, schemaKey, type NormalizeSource } from '@/lib/gdb/normalize';
import { buildSchemaGpkg } from '@/lib/gdb/schemaGpkg';
import { tt16Wkt } from '@/lib/gdb/tt16Schema';

const contour: CadEntity = { kind: 'polyline', layer: 'DONG MUC', color: '#a16207', points: [[0, 0], [100, 0]], closed: false };
const height = (t: string, x: number, y: number, layer = 'CAO DO'): CadEntity => ({ kind: 'text', layer, color: '#000000', text: t, position: [x, y], height: 2, rotation: 0, hAlign: 'left', vAlign: 'baseline' });
const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [100, 100]], warnings: [] });
const DONG_MUC = 'NenDiaHinh/NenDiaHinh/DuongDongMuc_L';
const DO_CAO = 'NenDiaHinh/NenDiaHinh/DiemDoCao_P';

describe('suggestions', () => {
  const f = { numericShare: 1 };
  it('contour lines, spot heights and markers have their own databases, on any map', () => {
    expect(suggest('ht-htkt', 'DONG MUC', 'L', f).target).toBe(DONG_MUC);
    expect(suggest('qh-cbkt', 'KS_DIEM DO CAO', 'P', f).target).toBe(DO_CAO);
    expect(suggest('ht-htkt', 'MOC GIOI', 'P', f).target).toBe('MocGioi/MocGioiQuyHoach/MocGioiQuyHoach_P');
    expect(suggest('ht-htkt', 'MOC', 'P', f).target ?? '').not.toContain('MocGioi'); // a survey benchmark, not a planning marker
    expect(suggest('moc', 'abc', 'L', f).target).toBe('MocGioi/MocGioiQuyHoach/MocGioiQuyHoach_L');
  });
  it('on a terrain map the numbers are spot heights; on a planning map a design level stays CaoDoNen', () => {
    expect(suggest('nen', 'TEXT', 'T', f).target).toBe(DO_CAO);
    expect(suggest('qh-cbkt', 'KS_CAO DO', 'T', f).target).toBe('QuyHoach/QuyHoachChuanBiKyThuat/CaoDoNen_P');
  });
});

describe('features', () => {
  it('spot heights carry caoDo from their text; a contour gets the number written along it', () => {
    const d = doc([contour, height('12,5', 40, 3), height('7.5', 20, 20, 'DIEM DO CAO'), height('+3.25', 70, 50, 'DIEM DO CAO')]);
    const m = new Map<string, MappingEntry>([
      [rowKey('a', 'DONG MUC', 'L'), { target: DONG_MUC, phanLoai: 'Đường đồng mức' }],
      [rowKey('a', 'DIEM DO CAO', 'T'), { target: DO_CAO, phanLoai: 'Điểm độ cao' }],
    ]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1) }], m, { boundary: null, sourceInGhiChu: false });
    const by = (cls: string) => built.classes.find((c) => c.cls === cls)!.features;
    expect(by('DiemDoCao_P').map((f) => f.attrs?.caoDo)).toEqual([7.5, 3.25]);
    expect(by('DuongDongMuc_L')[0].attrs?.caoDo).toBe(12.5);
  });
  it('a surveyed point and the height written at it are one point, with the height', () => {
    const spot: CadEntity = { kind: 'point', layer: 'DIEM', color: '#ffffff', position: [20.2, 20.3] };
    const d = doc([spot, height('7.5', 20, 20, 'DIEM DO CAO'), { kind: 'point', layer: 'DIEM', color: '#ffffff', position: [300, 300] }]);
    const m = new Map<string, MappingEntry>([
      [rowKey('a', 'DIEM', 'P'), { target: DO_CAO, phanLoai: 'Điểm đo' }],
      [rowKey('a', 'DIEM DO CAO', 'T'), { target: DO_CAO, phanLoai: 'Điểm độ cao' }],
    ]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1) }], m, { boundary: null, sourceInGhiChu: false });
    const pts = built.classes.find((c) => c.cls === 'DiemDoCao_P')!.features;
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ phanLoai: 'Điểm độ cao', tenDoiTuong: '7.5', attrs: { caoDo: 7.5 } });
    expect(pts[1].attrs?.caoDo).toBeUndefined();
  });
});

const WORK = 'node_modules/.cache/terrain';
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const entriesOf = (dir: string): GdbEntry[] => walk(dir).map((p) => ({ path: relative(dir, p).split(sep).join('/'), read: async () => readFileSync(p) }));

describe('written to the geodatabases (GDAL, Node)', () => {
  it('NenDiaHinh.gdb keeps the contour and the spot heights with caoDo; MocGioi.gdb the marker', async () => {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(`${WORK}/in`, { recursive: true });
    mkdirSync(`${WORK}/out`, { recursive: true });
    const d = doc([contour, height('12.5', 40, 3), height('7.5', 20, 20, 'DIEM DO CAO'), { kind: 'point', layer: 'MOC', color: '#ff0000', position: [50, 50] }]);
    const m = new Map<string, MappingEntry>([
      [rowKey('a', 'DONG MUC', 'L'), { target: DONG_MUC, phanLoai: 'Đường đồng mức' }],
      [rowKey('a', 'DIEM DO CAO', 'T'), { target: DO_CAO, phanLoai: 'Điểm độ cao' }],
      [rowKey('a', 'MOC', 'P'), { target: 'MocGioi/MocGioiQuyHoach/MocGioiQuyHoach_P', phanLoai: 'Mốc giới quy hoạch' }],
    ]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1) }], m, { boundary: null, sourceInGhiChu: false });
    // @ts-expect-error — gdal3.js ships no types for its Node entry.
    const { default: initGdalJs } = await import('gdal3.js/node.js');
    const Gdal = await initGdalJs({ path: 'node_modules/gdal3.js/dist/package', dest: `${WORK}/out`, logHandler: () => {}, errorHandler: () => {} });
    const s1 = planStage1(built.classes, tt16Wkt(105.5, 3));
    for (const i of s1.inputs) writeFileSync(`${WORK}/in/${i.fileName}`, i.json);
    const o1 = await Gdal.open(s1.inputs.map((i) => `${WORK}/in/${i.fileName}`), [], []);
    await executePlan(Gdal, new Map<string, unknown>(o1.datasets.map((x: { path: string }) => [x.path.replace(/^.*[\\/]/, '').replace(/\.geojson$/, ''), x])), s1, 's1_');
    const stage1 = entriesOf(`${WORK}/out`).filter((e) => e.path.startsWith('s1_')).map((e) => ({ ...e, path: e.path.replace(/^s1_/, '') }));
    const { gdbs } = collectGdbs(stage1);
    expect(gdbs.map((g) => g.name).sort()).toEqual(['MocGioi.gdb', 'NenDiaHinh.gdb']);

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
    await executePlan(Gdal, new Map<string, unknown>(o2.datasets.map((x: { path: string }) => [x.path.replace(/^.*[\\/]/, '').replace(/\.(gdb|gpkg)\.zip$/, ''), x])), plan, 'out_');
    const out = entriesOf(`${WORK}/out`).filter((e) => e.path.startsWith('out_')).map((e) => ({ ...e, path: e.path.replace(/^out_/, '') }));
    const all = collectGdbs(out).gdbs;
    const rows = async (db: string, cls: string) => {
      const cat = await readCatalog(all.find((g) => g.name === `${db}.gdb`)!);
      return [...cat.classes.find((c) => c.name === cls)!.rows()];
    };
    const spots = await rows('NenDiaHinh', 'DiemDoCao_P');
    expect(spots.map((r) => Number(r.caoDo))).toEqual([7.5]);
    const lines = await rows('NenDiaHinh', 'DuongDongMuc_L');
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].caoDo)).toBe(12.5);
    expect(String(lines[0].maDoiTuong)).toMatch(/^86QHC1000001-DuongDongMuc_L-\d+$/);
    expect(await rows('MocGioi', 'MocGioiQuyHoach_P')).toHaveLength(1);
  }, 120_000);
});
