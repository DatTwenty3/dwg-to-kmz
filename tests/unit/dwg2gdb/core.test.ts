// "Bóc tách DWG → TT16" on small synthetic drawings (no data files needed).
import { TT16_SCHEMA, tt16Wkt } from '@/lib/gdb/tt16Schema';
import { templateAttributes } from '@/lib/dwg2gdb/plan';
import { LAND_USE } from '@/lib/dwg2gdb/suggest';
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import {
  analyzeDrawings,
  buildFeatures,
  emptyTemplate,
  findBoundary,
  guessRole,
  guessesInProvince,
  initialMapping,
  insideFlags,
  landUseOf,
  compactName,
  mergeTemplate,
  planStage1,
  provinceFromTexts,
  readTemplate,
  resolveXref,
  rowKey,
  suggest,
  TemplateError,
  templateDecisions,

  xrefNameRole,
  type MappingEntry,
} from '@/lib/dwg2gdb';
import { ringsToPolygons } from '@/lib/dwg2gdb/geometry';
import { parseSr } from '@/lib/gdb/check';

const X0 = 590_000;
const Y0 = 1_070_000;
const sq = (x: number, y: number, s: number): Vec2[] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const doc = (entities: CadEntity[]): CadDocument => ({
  units: 'm',
  crs: null,
  layers: [...new Set(entities.map((e) => e.layer))].map((name) => ({ name, color: '#888888', visible: true })),
  entities,
  bbox: [
    [X0, Y0],
    [X0 + 5000, Y0 + 5000],
  ],
  warnings: [],
});
const poly = (layer: string, ring: Vec2[]): CadEntity => ({ kind: 'polygon', layer, color: '#00ff00', rings: [ring], fillOpacity: 0.5 });
const line = (layer: string, points: Vec2[], closed = false): CadEntity => ({ kind: 'polyline', layer, color: '#ff0000', points, closed });
const text = (layer: string, t: string, at: Vec2, height = 5): CadEntity => ({
  kind: 'text',
  layer,
  color: '#000000',
  text: t,
  position: at,
  height,
  rotation: 0,
  hAlign: 'center',
  vAlign: 'middle',
});

/** A land use map: boundary 4 × 4 km, two parcels with a label, a legend swatch outside the boundary. */
const sdd = doc([
  line('BV_Rg_Lapquyhoach', sq(X0, Y0, 4000), true),
  poly('DAT_XD_Khudancu', sq(X0 + 100, Y0 + 100, 200)),
  poly('DAT_NN_Tronglua', sq(X0 + 1000, Y0 + 1000, 500)),
  text('G-CHU', 'TRƯỜNG TIỂU HỌC LONG HIỆP', [X0 + 200, Y0 + 200], 8),
  text('G-CHU', 'nhỏ', [X0 + 150, Y0 + 150], 2),
  text('TEXT', 'BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050', [X0 + 6000, Y0], 30),
  text('TEXT', 'XÃ LONG HIỆP, TỈNH VĨNH LONG', [X0 + 6000, Y0 + 100], 20),
  poly('DAT_XD_Khudancu', sq(X0 + 6000, Y0 + 500, 10)), // legend, outside
  line('long duong', [
    [X0 + 50, Y0 + 2000],
    [X0 + 3900, Y0 + 2000],
  ]),
]);

describe('roles', () => {
  it('reads the map kind from the title, then the file name', () => {
    expect(guessRole('a.dwg', ['BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050'])).toEqual({ role: 'qh-sdd', title: 'BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050', year: 2050 });
    expect(guessRole('x.dwg', ['BẢN ĐỒ HIỆN TRẠNG ĐIỀU KIỆN TỰ NHIÊN, HIỆN TRẠNG PHÂN BỐ DÂN CƯ VÀ SỬ DỤNG ĐẤT'])).toMatchObject({ role: 'ht-sdd' });
    expect(guessRole('x.dwg', ['BẢN ĐỒ HIỆN TRẠNG HỆ THỐNG HẠ TẦNG KỸ THUẬT'])).toMatchObject({ role: 'ht-htkt' });
    expect(guessRole('QH_08 Ban do cap dien.dwg', [])).toMatchObject({ role: 'qh-dien' });
    expect(guessRole('QH_11 Ban do dinh huong quy hoach thoat nuoc.dwg', [])).toMatchObject({ role: 'qh-tn' });
    expect(guessRole('Xr_nen giao GIao thong.dwg', [])).toMatchObject({ role: 'xref' });
    expect(guessRole('khung fix a0.dwg', [])).toMatchObject({ role: 'xref' });
    expect(xrefNameRole('Xr_nen giao GIao thong.dwg')).toBe('qh-gt');
    expect(xrefNameRole('Xr_Nen Hien Trang.dwg')).toBe('ht-sdd');
  });

  it('finds the province of the dossier in the title block', () => {
    expect(provinceFromTexts(['QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG ĐẾN NĂM 2050', 'TỈNH VĨNH LONG'])?.name).toBe('Vĩnh Long');
    expect(provinceFromTexts(['không có tên tỉnh'])).toBeNull();
    const guesses = [
      { lng: 0, lat: 0, lon0: 105, province: 'Hậu Giang' },
      { lng: 0, lat: 0, lon0: 105.5, province: 'Trà Vinh' },
    ];
    expect(guessesInProvince(guesses, provinceFromTexts(['TỈNH VĨNH LONG'])).map((g) => g.lon0)).toEqual([105.5]);
  });
});

describe('suggestions', () => {
  it('maps land use, infrastructure and boundaries by layer name', () => {
    expect(suggest('qh-sdd', 'DAT_XD_Khudancu', 'A')).toMatchObject({ target: 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A', phanLoai: 'Đất ở' });
    expect(suggest('ht-sdd', 'HK-QH-OLangXom', 'A')).toMatchObject({ target: 'HienTrang/HienTrangSuDungDat/ChucNangSuDungDat_A', phanLoai: 'Đất ở' });
    expect(suggest('qh-sdd', 'LOGIOI_LINE', 'L').target).toBe('QuyHoach/QuyHoachCGDD_CGXDHanhLangHTKT/ChiGioiDuongDo_L');
    expect(suggest('qh-dien', 'HTKT_CD_Tuyen 22 kV', 'L')).toMatchObject({ target: 'QuyHoach/QuyHoachCapDien/MangLuoiPhanPhoiDien_L', phanLoai: 'Đường dây 22 kV' });
    expect(suggest('qh-dien', 'dien tram', 'A').target).toBe('QuyHoach/QuyHoachCapDien/CongTrinhCapDien_P');
    expect(suggest('qh-nuoc', 'CAPNUOC', 'L').target).toBe('QuyHoach/QuyHoachCapNuoc/MangLuoiCapNuoc_L');
    expect(suggest('qh-tn', 'THOAT NUOC MUA', 'L').target).toBe('QuyHoach/QuyHoachChuanBiKyThuat/MangLuoiThoatNuocMua_L');
    expect(suggest('qh-tn', 'HT_Nuoc mua_Ho ga', 'A')).toMatchObject({ target: 'QuyHoach/QuyHoachChuanBiKyThuat/CongTrinhCBKT_P', phanLoai: 'Hố ga thoát nước mưa' });
    expect(suggest('qh-tn', 'HT_Nuoc mua_Ho ga', 'L').target).toBeNull();
    expect(suggest('qh-gt', 'BV_Rg_Lapquyhoach', 'L', { closedShare: 1 }).target).toBe('QuyHoach/ViTriRanhGioi/RanhGioiQuyHoach_A');
    expect(suggest('ht-htkt', 'CAODO', 'T', { numericShare: 1 }).target).toBe('HienTrang/HienTrangChuanBiKyThuat/CaoDoNen_P');
  });

  it('leaves annotation and repeated land use out, flags unknown layers', () => {
    for (const l of ['0', 'TEXT', 'G-CHU', 'KYHIEU', 'BV_Khungten', 'kichthuoc', 'Defpoints']) expect(suggest('qh-sdd', l, 'L').target, l).toBeNull();
    const bg = suggest('qh-gt', 'QHDD_DAT_XD_Congnghiep', 'A');
    expect(bg.target).toBeNull();
    expect(bg.unknown).toBeFalsy();
    expect(suggest('qh-gt', 'GIAO DUC_ TIEU HOC', 'A').unknown).toBeFalsy();
    expect(suggest('ht-sdd', 'layer hatch', 'A').unknown).toBe(true);
    expect(suggest('xref', 'DAT_XD_Khudancu', 'A').target).toBeNull();
  });

  it('knows the usual land use words', () => {
    expect(landUseOf(compactName('QHDD_DAT_XD_Cayxanhtheducthethao'))).toBe('Đất cây xanh, thể dục thể thao');
    expect(landUseOf(compactName('DATCHUASU DUNG'))).toBe('Đất chưa sử dụng');
    expect(landUseOf(compactName('MUONG_AO'))).toBe('Đất sông, ngòi, kênh, rạch, suối, mặt nước');
    expect(landUseOf(compactName('21-HaTang'))).toBe('Đất hạ tầng kỹ thuật');
  });
});

describe('boundary, inventory and features', () => {
  it('keeps what is inside the planning boundary', () => {
    const b = findBoundary(sdd)!;
    expect(b.area).toBe(16e6);
    const flags = insideFlags(sdd, b.ring);
    expect([...flags]).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 1]);
  });

  it('builds land use areas with their labels, the boundary for both databases, nothing from the legend', () => {
    const parsed = [{ id: 'd1', name: 'QH06.dwg', path: 'QH06.dwg', doc: sdd }];
    const a = analyzeDrawings(parsed);
    expect(a.drawings[0]).toMatchObject({ role: 'qh-sdd', year: 2050, included: true });
    const m = initialMapping(a, null);
    expect(m.get(rowKey('d1', 'DAT_XD_Khudancu', 'A'))).toMatchObject({ target: 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A', source: 'auto' });
    const built = buildFeatures([{ id: 'd1', name: 'QH06.dwg', doc: sdd, inside: a.inside.get('d1')! }], m, { boundary: a.boundary!.ring, sourceInGhiChu: true });
    const cls = (t: string) => built.classes.find((c) => c.target === t);
    const lu = cls('QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A')!;
    expect(lu.features).toHaveLength(2);
    expect(lu.features[0]).toMatchObject({ tenDoiTuong: 'TRƯỜNG TIỂU HỌC LONG HIỆP', phanLoai: 'Đất ở', ghiChu: 'Nguồn: QH06.dwg · DAT_XD_Khudancu' });
    expect(lu.features[0].geometry.type).toBe('MultiPolygon');
    expect(cls('QuyHoach/ViTriRanhGioi/RanhGioiQuyHoach_A')!.features).toHaveLength(1);
    expect(cls('QuyHoach/ViTriRanhGioi/RanhGioiQuyHoach_A')!.features[0].tenDoiTuong).toBeNull();
    expect(cls('HienTrang/ViTriRanhGioi/RanhGioiQuyHoach_A')).toBeUndefined(); // no existing-state data
  });

  it('converts geometry kinds and merges duplicates', () => {
    const d = doc([
      poly('tram', sq(X0, Y0, 4)),
      poly('tram', sq(X0 + 0.2, Y0 + 0.2, 3.5)), // same symbol, second hatch
      line('ong', [
        [X0, Y0],
        [X0 + 100, Y0],
      ]),
      line('ong', [
        [X0, Y0],
        [X0 + 100, Y0],
      ]), // drawn twice
      line('vung', sq(X0, Y0, 50), true),
      line('vung', [
        [X0, Y0],
        [X0 + 5, Y0 + 5],
      ]), // open: cannot become an area
    ]);
    const inside = new Uint8Array(d.entities.length).fill(1);
    const m = new Map<string, MappingEntry>([
      [rowKey('a', 'tram', 'A'), { target: 'QuyHoach/QuyHoachCapDien/CongTrinhCapDien_P', phanLoai: 'Trạm biến áp' }],
      [rowKey('a', 'ong', 'L'), { target: 'QuyHoach/QuyHoachCapNuoc/MangLuoiCapNuoc_L', phanLoai: '' }],
      [rowKey('a', 'vung', 'L'), { target: 'QuyHoach/QuyHoachCapNuoc/PhanVungCapNuoc_A', phanLoai: '' }],
    ]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside }], m, { boundary: null, sourceInGhiChu: false });
    const n = (t: string) => built.classes.find((c) => c.target === t)?.features.length;
    expect(n('QuyHoach/QuyHoachCapDien/CongTrinhCapDien_P')).toBe(1);
    expect(n('QuyHoach/QuyHoachCapNuoc/MangLuoiCapNuoc_L')).toBe(1);
    expect(n('QuyHoach/QuyHoachCapNuoc/PhanVungCapNuoc_A')).toBe(1);
    expect(built.notes.join(' ')).toMatch(/1 đường hở/);
    expect(built.notes.join(' ')).toMatch(/2 đối tượng trùng/);
  });

  it('turns hatch rings into polygons with holes', () => {
    const polys = ringsToPolygons([sq(0, 0, 10), sq(2, 2, 2), sq(20, 20, 5)]);
    expect(polys).toHaveLength(2);
    expect(polys[0]).toHaveLength(2);
  });
});

describe('templates', () => {
  it('saves decisions, reapplies them and ignores bad input', () => {
    const a = analyzeDrawings([{ id: 'd1', name: 'QH06.dwg', path: 'QH06.dwg', doc: sdd }]);
    const m = initialMapping(a, null);
    m.set(rowKey('d1', 'long duong', 'L'), { target: 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L', phanLoai: 'Đường trục', source: 'manual', reason: '' });
    const t = mergeTemplate(emptyTemplate(), templateDecisions(a.drawings, a.rows, m));
    const back = readTemplate(JSON.parse(JSON.stringify(t)));
    expect(back.rules.some((r) => r.layer === 'longduong' && r.phanLoai === 'Đường trục')).toBe(true);
    const again = initialMapping(a, back);
    expect(again.get(rowKey('d1', 'long duong', 'L'))).toMatchObject({ target: 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L', source: 'template' });
    expect(() => readTemplate({ format: 'x' })).toThrow(TemplateError);
    const cleaned = readTemplate({ format: 'ledat-gis-layer-map', version: 1, rules: [{ role: 'qh-sdd', layer: 'a', kind: 'A', target: 'QuyHoach/Bad/Cls_A' }, { role: 'qh-sdd', layer: 'b', kind: 'T', target: 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A' }] });
    expect(cleaned.rules).toEqual([]);
  });
});

describe('xrefs and writing', () => {
  it('resolves an xref in the host folder first, copies of the same file once', () => {
    const files = [
      { id: '1', name: 'Xr_Mat nuoc.dwg', path: '3/Xr_Mat nuoc.dwg', size: 10 },
      { id: '2', name: 'Xr_Mat nuoc.dwg', path: '4/Xr_Mat nuoc.dwg', size: 10 },
      { id: '3', name: 'Xr_Nen Hien Trang.dwg', path: '2/Xr_Nen Hien Trang.dwg', size: 5 },
      { id: '4', name: 'Xr_Nen Hien Trang.dwg', path: '4/Xr_Nen Hien Trang.dwg', size: 6 },
    ];
    expect(resolveXref('Xr_Mat nuoc', '4/QH07.dwg', files)?.id).toBe('1');
    expect(resolveXref('Xr_Nen Hien Trang', '4/QH07.dwg', files)?.id).toBe('4');
    expect(resolveXref('Không có', '4/QH07.dwg', files)).toBeNull();
  });

  it('writes the coordinate system the check recognises', () => {
    const sr = parseSr(tt16Wkt(105.5, 3));
    expect(sr).toMatchObject({ name: 'VN-2000_TM-3_105-30', vn2000: true, lon0: 105.5, zone: 3 });
    const plan = planStage1(
      [
        { target: 'QuyHoach/A/B_A', db: 'QuyHoach', dataset: 'A', cls: 'B_A', geom: 'A', features: [], styles: [] },
        { target: 'QuyHoach/A/C_L', db: 'QuyHoach', dataset: 'A', cls: 'C_L', geom: 'L', features: [], styles: [] },
      ],
      'WKT',
    );
    expect(plan.steps[0].args).not.toContain('-update');
    expect(plan.steps[1].args).toContain('-update');
    expect(plan.steps[1].args).toEqual(expect.arrayContaining(['-nln', 'C_L', '-nlt', 'MULTILINESTRING', 'FEATURE_DATASET=A']));
  });
});

describe('summary drawing (DXF)', () => {
  it('keeps hatch patterns, colours and texts, layers by class and phanLoai', async () => {
    const { summaryDocument } = await import('@/lib/dwg2gdb');
    const { toDxf } = await import('@/lib/export/dxf');
    const { parseHatchPattern } = await import('@/lib/cad/dxf/entities');
    const hatch = { angle: 0, scale: 8, double: false, type: 1, lines: [{ angle: 90, base: [0, 0] as Vec2, offset: [-5.6569, 5.6569] as Vec2, dashes: [1.5, -9.8137] }] };
    const d = doc([
      { kind: 'polygon', layer: 'DAT_NN_Tronglua', color: '#33cc33', rings: [sq(X0, Y0, 50)], fillOpacity: 0.35, pattern: 'GRASS', hatch },
      text('G-CHU', 'ĐẤT TRỒNG LÚA', [X0 + 25, Y0 + 25]),
    ]);
    const inside = new Uint8Array(d.entities.length).fill(1);
    const m = new Map<string, MappingEntry>([[rowKey('a', 'DAT_NN_Tronglua', 'A'), { target: 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A', phanLoai: 'Đất trồng lúa' }]]);
    const s = summaryDocument([{ id: 'a', name: 'a.dwg', doc: d, inside, role: 'qh-sdd' }], m, { boundary: null, texts: true });
    expect(s.layers.map((l) => l.name)).toEqual(['QH_Chu_G-CHU', 'QH_ChucNangSuDungDat_A_Đất trồng lúa']);
    const dxf = toDxf(s, { units: 'm', layers: s.layers.map((l) => l.name) });
    expect(dxf).toMatch(/\n2\nGRASS\n70\n0\n/);
    expect(dxf).toContain('ĐẤT TRỒNG LÚA');
    // Read back: the pattern lines survive.
    const lines = dxf.split('\n');
    const start = lines.indexOf('HATCH');
    const groups: { code: number; value: string }[] = [];
    for (let i = start + 1; i + 1 < lines.length && lines[i] !== '0'; i += 2) groups.push({ code: Number(lines[i]), value: lines[i + 1] });
    const back = parseHatchPattern(groups);
    expect(back).toMatchObject({ scale: 8, lines: [{ angle: 90, offset: [-5.6569, 5.6569], dashes: [1.5, -9.8137] }] });
  });
});

describe('QGIS project name', () => {
  it('comes from the title block and stays a clean file name', async () => {
    const { cleanProjectName, projectNameFromTexts } = await import('@/lib/dwg2gdb');
    expect(projectNameFromTexts(['QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG ĐẾN NĂM 2050'])).toBe('QHC_XaLongHiep');
    expect(projectNameFromTexts(['QUY HOẠCH PHÂN KHU PHƯỜNG NINH KIỀU THÀNH PHỐ CẦN THƠ'])).toBe('QPK_PhuongNinhKieu');
    expect(cleanProjectName('QHC_XaLongHiep')).toBe('QHC_XaLongHiep');
    expect(cleanProjectName('qhc xã long hiệp')).toBe('QhcXaLongHiep');
    expect(cleanProjectName('  ')).toBe('DoAnQuyHoach');
  });
});

describe('administrative unit names', () => {
  it('recognises unit labels by their text, not their layer', async () => {
    const { adminName } = await import('@/lib/dwg2gdb');
    expect(adminName('ẤP TRÀ SẤT')).toEqual({ name: 'ẤP TRÀ SẤT', kind: 'Ấp' });
    expect(adminName('X. HÀM GIANG')).toEqual({ name: 'X. HÀM GIANG', kind: 'Xã' });
    expect(adminName('Xã Trà Cú')).toEqual({ name: 'Xã Trà Cú', kind: 'Xã' });
    expect(adminName('KHÓM 3')).toBeNull(); // no letters after the unit word
    expect(adminName('XÃ NHỊ TRƯỜNG VÀ\nXÃ TẬP SƠN')).toBeNull();
    expect(adminName('HƯỚNG ĐI\nXÃ NHỊ TRƯỜNG')).toBeNull();
    expect(adminName('ÁP LỰC NƯỚC')).toBeNull();
    expect(adminName('XÃ LONG HIỆP, TỈNH VĨNH LONG')).toBeNull();
  });

  it('adds one point per name into TenDonViHanhChinh_P', () => {
    const d = doc([text('TEXT', 'ẤP TRÀ SẤT', [X0 + 10, Y0 + 10], 5), text('G-CHU', 'ẤP TRÀ SẤT', [X0 + 900, Y0 + 900], 9), text('G-CHU', 'ẤP CHỢ', [X0 + 50, Y0 + 50])]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: new Uint8Array(3).fill(1) }], new Map(), { boundary: null, sourceInGhiChu: false });
    const c = built.classes.find((x) => x.cls === 'TenDonViHanhChinh_P')!;
    expect(c.features.map((f) => [f.tenDoiTuong, f.phanLoai, f.geometry.type === 'Point' ? f.geometry.coordinates : null])).toEqual([
      ['ẤP TRÀ SẤT', 'Ấp', [X0 + 900, Y0 + 900]],
      ['ẤP CHỢ', 'Ấp', [X0 + 50, Y0 + 50]],
    ]);
  });
});

describe('plan unit', () => {
  it('reads the commune / ward of the plan from its title', async () => {
    const { planUnitFromTitle } = await import('@/lib/dwg2gdb');
    expect(planUnitFromTitle('QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG ĐẾN NĂM 2050')).toBe('XÃ LONG HIỆP');
    expect(planUnitFromTitle('Quy hoạch phân khu phường Ninh Kiều thành phố Cần Thơ')).toBe('PHƯỜNG NINH KIỀU');
    expect(planUnitFromTitle('BẢN ĐỒ GIAO THÔNG')).toBeNull();
  });
});

it('plan unit survives line breaks in the title', async () => {
  const { planUnitFromTitle } = await import('@/lib/dwg2gdb');
  expect(planUnitFromTitle('QUY HOẠCH CHUNG\nXÃ   LONG HIỆP, TỈNH VĨNH LONG')).toBe('XÃ LONG HIỆP');
});

describe('template attributes', () => {
  const pt = { type: 'Point' as const, coordinates: [0, 0] };
  it('codes every land use label of the suggestions in ChucNangSuDungDatM1', () => {
    for (const [, label] of LAND_USE) {
      const a = templateAttributes({ db: 'QuyHoach', cls: 'ChucNangSuDungDat_A', geom: 'A' }, { geometry: pt, tenDoiTuong: null, phanLoai: label, ghiChu: null });
      expect(a.chucNangSuDungDatMuc1, label).toMatch(/^\d+$/);
    }
    expect(templateAttributes({ db: 'HienTrang', cls: 'ChucNangSuDungDat_A', geom: 'A' }, { geometry: pt, tenDoiTuong: null, phanLoai: 'Đất ở', ghiChu: null })).toEqual({ chucNangSuDungDatMuc1: '52' });
  });
  it('fills loaiTenDVHC and chieuDai', () => {
    expect(templateAttributes({ db: 'QuyHoach', cls: 'TenDonViHanhChinh_P', geom: 'P' }, { geometry: pt, tenDoiTuong: 'Long Hiệp', phanLoai: 'Xã', ghiChu: null })).toEqual({ loaiTenDVHC: '3' });
    expect(templateAttributes({ db: 'QuyHoach', cls: 'TenDonViHanhChinh_P', geom: 'P' }, { geometry: pt, tenDoiTuong: 'Ấp 1', phanLoai: 'Ấp', ghiChu: null })).toEqual({});
    const line = { type: 'MultiLineString' as const, coordinates: [[[0, 0], [3, 4], [3, 10]]] };
    const cls = TT16_SCHEMA.databases.QuyHoach.flatMap((d) => d.classes).find((c) => c.geom === 'L' && c.fields.some((f) => f.name === 'chieuDai'))!;
    expect(templateAttributes({ db: 'QuyHoach', cls: cls.name, geom: 'L' }, { geometry: line, tenDoiTuong: null, phanLoai: null, ghiChu: null }).chieuDai).toBe(11);
  });
});
