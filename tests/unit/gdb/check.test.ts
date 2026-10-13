import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellProblem, checkGdb, checkSubmission, collectGdbs, describeMaThongTin, parseMaHoSo, parseMaThongTin, parseSr, sampleCodes, runCheck, TT16_DATABASES, type GdbCatalog, type GdbEntry, type GdbField } from '@/lib/gdb';
import { FIXTURE_HOSOGIS } from '../fixtures';

function walk(dir: string, root: string, out: GdbEntry[] = []): GdbEntry[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else out.push({ path: relative(root, p).replace(/\\/g, '/'), read: async () => readFileSync(p) });
  }
  return out;
}

const WKT =
  'PROJCS["VN_2000_Tra_Vinh_3deg",GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",105.5],PARAMETER["Scale_Factor",0.9999],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

describe('TT16 rules', () => {
  it('reads central meridian and zone width from the WKT', () => {
    expect(parseSr(WKT)).toEqual({ name: 'VN_2000_Tra_Vinh_3deg', vn2000: true, lon0: 105.5, zone: 3 });
    expect(parseSr('')).toBeNull();
  });

  it('maDoiTuong is only right when it starts with a valid maHoSoQH', () => {
    const ctx = { oid: 3, ma: '86QPK1000001', className: 'ChucNangSuDungDat_A' };
    expect(cellProblem('maDoiTuong', '86QPK1000001-ChucNangSuDungDat_A-3', ctx)).toBeNull();
    expect(cellProblem('maDoiTuong', '86QPK1000001-ChucNangSuDungDat_A-4', ctx)).toMatch(/mẫu/);
    expect(cellProblem('maDoiTuong', '00000_-ChucNangSuDungDat_A-3', { ...ctx, ma: '00000_' })).toMatch(/maHoSoQH sai/);
    expect(cellProblem('maHoSoQH', '', ctx)).toBe('Chưa nhập');
  });

  it('lists 14/14/1 thematic groups and 70/81/3 reference classes like the circular', () => {
    const by = Object.fromEntries(TT16_DATABASES.map((d) => [d.name, d]));
    expect(by.HienTrang.datasets).toHaveLength(14);
    expect(by.QuyHoach.datasets).toHaveLength(14);
    expect(by.MocGioi.datasets).toHaveLength(1);
    // HienTrang numbering skips 42, 43 and 51 → 67 classes; QuyHoach skips 52 and 54 → 79.
    expect(by.HienTrang.datasets.reduce((t, d) => t + d.classes.length, 0)).toBe(67);
    expect(by.QuyHoach.datasets.reduce((t, d) => t + d.classes.length, 0)).toBe(79);
  });

  it('parses maThongTinQH (12 digits, TT 24/2025/TT-BXD art. 4)', () => {
    const p = parseMaThongTin('012511012345')!;
    expect(p).toMatchObject({ province: '01', provinceName: 'Hà Nội', year: 2025, level: '1', kind: '1', adjust: '0', serial: '12345' });
    expect(describeMaThongTin(p)).toBe('Hà Nội · 2025 · QH chung đô thị · lập lần đầu');
    expect(parseMaThongTin('11111_')).toBeNull();
    expect(parseMaThongTin('012551012345')).toBeNull(); // cấp độ 5 không có
    expect(parseMaThongTin('012511312345')).toBeNull(); // điều chỉnh chỉ 0–2
    expect(cellProblem('maThongTinQH', '11111_', { oid: 1, ma: '', className: 'X_A' })).toMatch(/Sai mẫu/);
    expect(cellProblem('maThongTinQH', '862613000001', { oid: 1, ma: '', className: 'X_A' })).toBeNull();
  });

  it('sample codes are valid and share the province', () => {
    const s = sampleCodes('86', 2026);
    expect(s).toEqual({ maHoSoQH: '86QHC1000001', maThongTinQH: '862611000001' });
    expect(parseMaHoSo(s.maHoSoQH)?.province).toBe('86');
    expect(parseMaThongTin(s.maThongTinQH)).toMatchObject({ province: '86', year: 2026 });
  });

  it('parses maHoSoQH', () => {
    expect(parseMaHoSo('04QHC0010001')).toMatchObject({ province: '04', provinceName: 'Cao Bằng', kind: 'QHC', seq: '0001' });
    expect(parseMaHoSo('00000_')).toBeNull();
    expect(parseMaHoSo('04QHX0010001')).toBeNull();
  });
});

describe('checkGdb (synthetic catalog)', () => {
  const field = (name: string, length = 15) => ({ name, alias: '', type: 'string' as const, length, nullable: true });
  const goodFields: GdbField[] = [
    { name: 'OBJECTID', alias: '', type: 'objectid' as const, length: 0, nullable: false },
    { name: 'Shape', alias: '', type: 'geometry' as const, length: 0, nullable: true },
    field('maThongTinQH'),
    field('maHoSoQH'),
    field('maDoiTuong', 100),
    field('tenDoiTuong', 100),
    field('phanLoai', 250),
    field('ghiChu', 250),
  ];
  const cls = (name: string, dataset: string | null, shapeType: string, rows: Record<string, string | number | null>[], fields = goodFields) => ({
    name,
    path: dataset ? `\\${dataset}\\${name}` : `\\${name}`,
    dataset,
    alias: name,
    shapeType,
    geom: ({ esriGeometryPolygon: 'A', esriGeometryPolyline: 'L', esriGeometryPoint: 'P' } as const)[shapeType as 'esriGeometryPoint'] ?? null,
    srName: 'VN_2000_Can_Tho_3deg',
    wkt: WKT,
    extent: [583000, 1108000, 584000, 1109000] as [number, number, number, number],
    fields,
    rowCount: rows.length,
    rows: function* () {
      yield* rows;
    },
  });

  it('reports ok, wrong geometry, missing field, wrong dataset, bad and extra names', () => {
    const row = (oid: number, cls: string) => ({ OBJECTID: oid, maThongTinQH: '862521000001', maHoSoQH: '86QPK1000001', maDoiTuong: `86QPK1000001-${cls}-${oid}`, tenDoiTuong: 'a', phanLoai: 'b', ghiChu: null });
    const cat: GdbCatalog = {
      datasets: ['ViTriRanhGioi', 'HienTrangSuDungDat', 'hien_trang_khac'],
      classes: [
        cls('RanhGioiQuyHoach_A', 'ViTriRanhGioi', 'esriGeometryPolygon', [row(1, 'RanhGioiQuyHoach_A')]),
        cls('RanhGioiHanhChinh_L', 'ViTriRanhGioi', 'esriGeometryPolygon', [row(1, 'RanhGioiHanhChinh_L')]),
        cls('ChucNangSuDungDat_A', 'ViTriRanhGioi', 'esriGeometryPolygon', [row(1, 'ChucNangSuDungDat_A')]),
        cls('PhanVungSDDkhac_A', 'HienTrangSuDungDat', 'esriGeometryPolygon', [{ OBJECTID: 1, maHoSoQH: '' }], goodFields.slice(0, 4)),
        cls('Cây_xanh_P', 'HienTrangSuDungDat', 'esriGeometryPoint', []),
        cls('TenRieng_P', null, 'esriGeometryPoint', [row(1, 'TenRieng_P')]),
      ],
      tables: [],
    };
    const r = checkGdb({ name: 'HienTrang.gdb', dir: 'HienTrang.gdb' }, cat);
    expect(r.database).toBe('HienTrang');
    expect(r.nameStatus).toBe('ok');
    const ds = Object.fromEntries(r.datasets.map((d) => [d.name, d]));
    expect(ds.ViTriRanhGioi.status).toBe('error'); // contains RanhGioiHanhChinh_L with the wrong geometry
    expect(ds.HienTrangGiaoThong.status).toBe('missing');
    expect(ds.hien_trang_khac.status).toBe('error');
    const c = (d: string, n: string) => ds[d].classes.find((x) => x.name === n)!;
    // The 6 fields are right; the class-specific fields of the template are missing (one warning listing them).
    const rg = c('ViTriRanhGioi', 'RanhGioiQuyHoach_A');
    expect(rg.status).toBe('warn');
    expect(rg.issues.map((i) => i.text)).toEqual([expect.stringMatching(/^Thiếu \d+ trường theo mẫu Bộ Xây dựng$/)]);
    expect(c('ViTriRanhGioi', 'TenDonViHanhChinh_P').status).toBe('absent');
    expect(c('ViTriRanhGioi', 'RanhGioiHanhChinh_L').status).toBe('error'); // _L but polygon
    expect(c('HienTrangSuDungDat', 'ChucNangSuDungDat_A').status).toBe('warn'); // in ViTriRanhGioi
    const pv = c('HienTrangSuDungDat', 'PhanVungSDDkhac_A');
    expect(pv.status).toBe('error');
    expect(pv.fields.filter((f) => f.status === 'missing').map((f) => f.name)).toEqual(['maDoiTuong', 'tenDoiTuong', 'phanLoai', 'ghiChu']);
    expect(pv.fields.find((f) => f.name === 'maHoSoQH')!.issues[0].text).toMatch(/chưa nhập/i);
    expect(c('HienTrangSuDungDat', 'Cây_xanh_P').status).toBe('error');
    expect(r.rootClasses.map((x) => [x.name, x.status])).toEqual([['TenRieng_P', 'extra']]);
    expect(r.counts.classes.extra).toBe(2);
    expect(r.maHoSo).toEqual([['86QPK1000001', 4]]);
    expect(c('ViTriRanhGioi', 'RanhGioiQuyHoach_A').sample).toMatchObject({ total: 1, columns: expect.arrayContaining([expect.objectContaining({ name: 'maHoSoQH' })]) });
  });

  it('reports extra fields as "trường dư"', () => {
    const fields = [...goodFields, field('loaiDiaDanh', 50), { name: 'Shape_Area', alias: '', type: 'float64' as const, length: 0, nullable: true }];
    const cat: GdbCatalog = { datasets: ['MocGioiQuyHoach'], classes: [cls('MocGioiQuyHoach_P', 'MocGioiQuyHoach', 'esriGeometryPoint', [], fields)], tables: [] };
    const r = checkGdb({ name: 'MocGioi.gdb', dir: 'MocGioi.gdb' }, cat);
    const m = r.datasets[0].classes[0];
    expect(m.extraFields).toEqual(['loaiDiaDanh']);
    expect(m.status).toBe('warn');
    expect(m.issues.some((i) => /trường dư/i.test(i.text))).toBe(true);
  });

  it('flags a wrong file name and guesses the database from its datasets', () => {
    const r = checkGdb({ name: 'QH_2050.gdb', dir: 'QH_2050.gdb' }, { datasets: ['QuyHoachGiaoThong', 'QuyHoachCapNuoc'], classes: [], tables: [] });
    expect(r.nameStatus).toBe('error');
    expect(r.database).toBe('QuyHoach');
  });
});

describe('coordinate verdict of groups / geodatabases without data', () => {
  const W = (lon0: number) =>
    `PROJCS["VN_2000_x",GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000"]],PROJECTION["Transverse_Mercator"],PARAMETER["Central_Meridian",${lon0}],PARAMETER["Scale_Factor",0.9999]]`;
  const NHI_LONG: [number, number, number, number] = [578404, 1102658, 589679, 1115014];
  const cls = (name: string, dataset: string, lon0: number, extent: typeof NHI_LONG | null, n: number) => ({
    name, path: '', dataset, alias: name, shapeType: 'esriGeometryPolygon', geom: 'A' as const, srName: 'VN_2000_x', wkt: W(lon0), extent,
    fields: [], rowCount: n, rows: function* () {},
  });
  const cat = (classes: ReturnType<typeof cls>[]): GdbCatalog => ({
    datasets: [...new Set(classes.map((c) => c.dataset))],
    datasetWkts: Object.fromEntries(classes.map((c) => [c.dataset, c.wkt])),
    classes,
    tables: [],
  });

  it('empty groups and empty geodatabases inherit the verdict of the data in the same coordinate system', () => {
    const ht = checkGdb(
      { name: 'HienTrang.gdb', dir: 'HienTrang.gdb' },
      cat([cls('ChucNangSuDungDat_A', 'HienTrangSuDungDat', 105.5, NHI_LONG, 10), cls('CongTrinh_A', 'HienTrangKhongGianKienTrucCanhQuan', 105.5, null, 0)]),
      { provinceCode: '86' },
    );
    const qh = checkGdb({ name: 'QuyHoach.gdb', dir: 'QuyHoach.gdb' }, cat([cls('PhanKhuQuyHoach_A', 'QuyHoachSuDungDat', 105.5, null, 0)]), { provinceCode: '86' });
    const sub = checkSubmission([ht, qh], [{ parent: '' }, { parent: '' }], []);
    const empty = ht.datasets.find((d) => d.name === 'HienTrangKhongGianKienTrucCanhQuan')!;
    expect(ht.crs?.status).toBe('ok');
    expect(empty.crs?.status).toBe('ok');
    expect(empty.crs?.text).toMatch(/cùng hệ tọa độ với dữ liệu của geodatabase/);
    const q = sub.gdbs.find((g) => g.fileName === 'QuyHoach.gdb')!;
    expect(q.crs?.status).toBe('ok');
    expect(q.crs?.text).toMatch(/cùng hệ tọa độ với HienTrang.gdb/);
    expect(q.datasets.find((d) => d.name === 'QuyHoachSuDungDat')!.crs?.status).toBe('ok');
  });

  it('an empty group in another coordinate system is flagged, not inherited', () => {
    const ht = checkGdb(
      { name: 'HienTrang.gdb', dir: 'HienTrang.gdb' },
      cat([cls('ChucNangSuDungDat_A', 'HienTrangSuDungDat', 105.5, NHI_LONG, 10), cls('ChucNangSuDungDat_B_A', 'HienTrangSuDungDat', 105.5, NHI_LONG, 1), cls('CongTrinh_A', 'HienTrangKhongGianKienTrucCanhQuan', 107, null, 0)]),
      { provinceCode: '86' },
    );
    const d = ht.datasets.find((x) => x.name === 'HienTrangKhongGianKienTrucCanhQuan')!;
    expect(d.crs).toBeNull();
    expect(d.issues.some((i) => /khác hệ tọa độ của geodatabase/.test(i.text))).toBe(true);
  });
});

describe.skipIf(!existsSync(FIXTURE_HOSOGIS))('real HoSoGIS (Xã Nhị Long)', () => {
  it('reads the four geodatabases and checks them', async () => {
    const entries = walk(FIXTURE_HOSOGIS, join(FIXTURE_HOSOGIS, '..'));
    expect(collectGdbs(entries).gdbs.map((g) => g.name)).toEqual(['HienTrang.gdb', 'MocGioi.gdb', 'NenDiaHinh.gdb', 'QuyHoach.gdb']);
    const rep = await runCheck(entries);
    expect(rep.folder).toMatchObject({ name: 'HoSoGIS', nameOk: true });
    expect(rep.folder!.projectFiles.length).toBeGreaterThan(0);
    expect(rep.missingDatabases).toEqual([]);
    const ht = rep.gdbs.find((g) => g.database === 'HienTrang')!;
    expect(ht.nameStatus).toBe('ok');
    expect(ht.counts.datasets).toEqual({ expected: 14, present: 5 });
    const cn = ht.datasets.find((d) => d.name === 'HienTrangSuDungDat')!.classes.find((c) => c.name === 'ChucNangSuDungDat_A')!;
    expect(cn.rowCount).toBe(892);
    expect(cn.srName).toMatch(/VN_2000/);
    // The sample carries placeholder codes ("00000_") → format error on maHoSoQH, all fields present.
    expect(cn.fields.every((f) => f.actual)).toBe(true);
    expect(cn.fields.find((f) => f.name === 'maHoSoQH')!.status).toBe('error');
    expect(cn.fields.find((f) => f.name === 'maThongTinQH')!.status).toBe('error'); // "11111_"
    // maDoiTuong embeds the (invalid) maHoSoQH → wrong as well.
    expect(cn.fields.find((f) => f.name === 'maDoiTuong')!.status).toBe('error');
    expect(cn.extraFields).toEqual(['loaiDiaDanh']);
    expect(cn.sr).toMatchObject({ lon0: 105.5, zone: 3 });
    expect(ht.datasets.find((d) => d.name === 'ViTriRanhGioi')!.sr).toMatchObject({ lon0: 105.5, zone: 3 });
    // Location found from the data extent (Trà Vinh, now Vĩnh Long).
    expect(ht.crs?.status).toBe('warn'); // maHoSoQH is a placeholder → province unknown, 105° (Cần Thơ) also fits
    expect(ht.datasets.find((d) => d.name === 'ViTriRanhGioi')!.crs?.expectedLon0).toContain(105.5);
    const qh = rep.gdbs.find((g) => g.database === 'QuyHoach')!;
    expect(qh.datasets.flatMap((d) => d.classes).find((c) => c.name === 'TenRieng_P')?.inReference).toBe(false);
    const nen = rep.gdbs.find((g) => g.database === 'NenDiaHinh')!;
    expect(nen.datasets.map((d) => d.name).sort()).toEqual(['BienGioiDiaGioi', 'CoSoDoDac', 'DanCuCoSoHaTang', 'DiaHinh']);
    // No list in the circular for NenDiaHinh: well-named groups/classes are "Đạt", not "Bổ sung".
    expect(nen.datasets.every((d) => d.status !== 'extra' && d.classes.every((c) => c.status !== 'extra'))).toBe(true);
    // Groups that are not there carry no coordinate verdict.
    for (const d of ht.datasets) if (d.status === 'missing') expect(d.crs).toBeNull();
    expect(rep.maHoSo[0][0]).toBe('00000_');
  });
});
