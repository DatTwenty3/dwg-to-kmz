// Names, kinds and surfaces of the roads read from the drawing (roads.ts) and written by buildFeatures.
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { buildFeatures, chainIds, insideFlags, layerRows, suggestRow, layerRank, layerSurface, lineForSign, parseBridgeText, parseRoadText, parseRouteSign, roadFields, rowKey, textAlong, type MappingEntry } from '@/lib/dwg2gdb';
import { templateAttributes } from '@/lib/dwg2gdb/plan';

describe('parseRoadText', () => {
  it('reads the kind and rank from the name', () => {
    expect(parseRoadText('ĐƯỜNG HUYỆN 36')).toMatchObject({ name: 'Đường huyện 36', rank: 'huyen' });
    // a route number followed by its surface ("ĐT914B.Nhựa"), and a hương lộ
    expect(parseRoadText('ĐƯỜNG ĐT914B.NHỰA')).toMatchObject({ name: 'Đường tỉnh 914B', rank: 'tinh', surface: 'Nhựa' });
    expect(parseRoadText('ĐƯỜNG ĐT 915.Nhựa')).toMatchObject({ name: 'Đường tỉnh 915', rank: 'tinh' });
    expect(parseRoadText('ĐƯỜNG HL28.NHỰA')).toMatchObject({ name: 'Đường HL28', rank: null, surface: 'Nhựa' });
    expect(parseRoadText('ĐƯỜNG DH 18')).toMatchObject({ name: 'Đường huyện 18', rank: 'huyen' });
    expect(parseRoadText('ĐƯỜNG DH36')).toMatchObject({ name: 'Đường huyện 36', rank: 'huyen' });
    expect(parseRoadText('ĐT.911')).toMatchObject({ name: 'Đường tỉnh 911', rank: 'tinh' });
    expect(parseRoadText('ĐƯỜNG 915C')).toMatchObject({ name: 'Đường 915C', rank: 'tinh' });
    expect(parseRoadText('QL.91')).toMatchObject({ name: 'Quốc lộ 91', rank: 'quocLo' });
    expect(parseRoadText('TUYẾN SỐ 5')).toMatchObject({ name: 'Tuyến số 5', rank: null });
  });
  it('an expressway keeps its whole name and is written "Đường cao tốc" in both domains', () => {
    expect(parseRoadText('CAO TỐC TRÀ VINH - HỒNG NGỰ')).toMatchObject({ name: 'Cao Tốc Trà Vinh - Hồng Ngự', rank: 'caoToc' });
    expect(parseRoadText('ĐƯỜNG CAO TỐC BẾN LỨC')).toMatchObject({ rank: 'caoToc' });
    expect(layerRank('htktgtcaotoc')).toBe('caoToc');
    expect(roadFields('QuyHoach', { name: 'Cao Tốc X', rank: 'caoToc' })).toMatchObject({ loaiDuong: '1', capDuong: '1' });
    expect(roadFields('HienTrang', { name: 'Cao Tốc X', rank: 'caoToc' })).toMatchObject({ loaiDuong: '1', capDuong: '1' });
  });
  it('a name that tells no rank stays a name; the note in brackets is the surface', () => {
    expect(parseRoadText('ĐƯỜNG BA TRẠCH')).toMatchObject({ name: 'Đường Ba Trạch', rank: null });
    expect(parseRoadText('ĐƯỜNG D5 (QH VÙNG HUYỆN)')).toMatchObject({ name: 'Đường D5', rank: null, surface: null });
    expect(parseRoadText('ĐƯỜNG HL12 (ĐƯỜNG NHỰA)')).toMatchObject({ name: 'Đường HL12', surface: 'Nhựa' });
    expect(parseRoadText('ĐƯỜNG BÊ TÔNG BA TRẠCH')).toMatchObject({ name: 'Đường Ba Trạch', surface: 'Bê tông' });
  });
  it('a note of surface names nothing; utility lines and pipe notes are no road', () => {
    expect(parseRoadText('ĐƯỜNG NHỰA')).toEqual({ name: null, rank: null, surface: 'Nhựa' });
    expect(parseRoadText('ĐƯỜNG BÊ TÔNG')).toEqual({ name: null, rank: null, surface: 'Bê tông' });
    expect(parseRoadText('ĐƯỜNG DÂY 110KV')).toBeNull();
    expect(parseRoadText('ĐƯỜNG ỐNG D600')).toBeNull();
    expect(parseRoadText('Ø140 L=1400m')).toBeNull();
    expect(parseRoadText('TRƯỜNG TIỂU HỌC')).toBeNull();
  });
  it('bridges: a proper name, not the type note', () => {
    expect(parseBridgeText('Cầu Kênh Xáng')).toMatchObject({ name: 'Cầu Kênh Xáng' });
    expect(parseBridgeText('CẦU BÊ TÔNG')).toMatchObject({ name: null, note: 'Cầu Bê Tông' });
    expect(parseBridgeText('CẦU QUY HOẠCH MỚI')?.name).toBe('Cầu Quy Hoạch Mới');
    expect(parseBridgeText('Trường học')).toBeNull();
  });
});

describe('layers and codes', () => {
  it('surface and rank of the layer name', () => {
    expect(layerSurface('duongnhua')).toBe('Nhựa');
    expect(layerSurface('duongbetong')).toBe('Bê tông');
    expect(layerSurface('duongmon')).toBe('Đất');
    expect(layerSurface('htktgtheduong')).toBeNull();
    expect(layerRank('dquoclo')).toBe('quocLo');
    expect(layerRank('dtinh')).toBe('tinh');
    expect(layerRank('htktgtduongkhuvuc')).toBe('khuVuc');
  });
  it('codes come from the domains of each geodatabase (the labels differ)', () => {
    expect(roadFields('QuyHoach', { name: 'Đường huyện 36', rank: 'huyen', surface: 'Nhựa' })).toEqual({ tenDuong: 'Đường huyện 36', loaiDuong: '4', capDuong: '4', loaiChatLieuTraiMat: '2' });
    expect(roadFields('HienTrang', { rank: 'huyen' })).toEqual({ loaiDuong: '4', capDuong: '4' });
    expect(roadFields('HienTrang', { rank: 'quocLo' })).toEqual({ loaiDuong: '2', capDuong: '2' });
    expect(roadFields('QuyHoach', { rank: 'quocLo' })).toEqual({ loaiDuong: '2', capDuong: '2' });
  });
});

describe('matching texts to lines', () => {
  const along = { text: 'x', at: [50, 6] as [number, number], height: 4, rotation: 0 };
  it('takes the text written along the line, not one across it or far away', () => {
    expect(textAlong([[[0, 0], [100, 0]]], [along])).toBe(0);
    expect(textAlong([[[0, 0], [100, 0]]], [{ ...along, rotation: 90 }])).toBe(-1);
    expect(textAlong([[[0, 0], [100, 0]]], [{ ...along, at: [50, 80] }])).toBe(-1);
    expect(textAlong([[[0, 0], [100, 0]]], [{ ...along, at: [50, 15] }, along])).toBe(1);
  });
  it('chains: two ends meeting alone link the lines, a junction of three does not', () => {
    const ends = [
      { a: [0, 0], b: [10, 0] },
      { a: [10, 0], b: [20, 0] },
      { a: [20, 0], b: [30, 0] },
      { a: [20, 0], b: [20, 10] },
    ] as { a: [number, number]; b: [number, number] }[];
    const c = chainIds(ends);
    expect(c[0]).toBe(c[1]);
    expect(c[2]).not.toBe(c[1]);
    expect(c[3]).not.toBe(c[1]);
  });
});

describe('the roads of a drawing', () => {
  const road = (layer: string, y: number, x0 = 0): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[x0, y], [x0 + 100, y]], closed: false });
  const text = (t: string, x: number, y: number, rotation = 0): CadEntity => ({ kind: 'text', layer: 'TEN', color: '#ffffff', text: t, position: [x, y], height: 4, rotation, hAlign: 'left', vAlign: 'baseline' });
  const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [300, 100]], warnings: [] });
  const target = 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L';

  it('names a road from the text beside it, passes the name on to the pieces that continue it, keeps the others unnamed', () => {
    // two pieces of one road (one named) + a separate road
    const d = doc([road('DUONG_NHUA', 0), road('DUONG_NHUA', 0, 100), text('ĐƯỜNG HUYỆN 36', 30, 5), road('DUONG_NHUA', 50)]);
    const m = new Map<string, MappingEntry>([[rowKey('a', 'DUONG_NHUA', 'L'), { target, phanLoai: 'Đường nhựa' }]]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1) }], m, { boundary: null, sourceInGhiChu: false });
    const c = built.classes.find((x) => x.target === target)!;
    expect(c.features.map((f) => f.tenDoiTuong)).toEqual(['Đường huyện 36', 'Đường huyện 36', null]);
    expect(c.features[0].attrs).toMatchObject({ tenDuong: 'Đường huyện 36', loaiDuong: '4', capDuong: '4', loaiChatLieuTraiMat: '2' });
    expect(c.features[2].attrs).toEqual({ loaiChatLieuTraiMat: '2' }); // surface of the layer only
    expect(built.notes.join(' ')).toMatch(/Đặt tên cho 2 đoạn đường/);
    // written to the geodatabase
    expect(templateAttributes(c, c.features[0])).not.toHaveProperty('tenDuong'); // the plan adds attrs itself
  });

  it('the surface note beside an unnamed layer gives the surface; a layer saying so wins over it', () => {
    const d = doc([road('GT', 0), road('DUONG_BETONG', 50), text('ĐƯỜNG NHỰA', 30, 5), text('ĐƯỜNG NHỰA', 30, 55)]);
    const m = new Map<string, MappingEntry>([
      [rowKey('a', 'GT', 'L'), { target, phanLoai: 'x' }],
      [rowKey('a', 'DUONG_BETONG', 'L'), { target, phanLoai: 'x' }],
    ]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1) }], m, { boundary: null, sourceInGhiChu: false });
    const f = built.classes.find((x) => x.target === target)!.features;
    expect(f[0].attrs?.loaiChatLieuTraiMat).toBe('2');
    expect(f[1].attrs?.loaiChatLieuTraiMat).toBe('3');
  });

  it('a bridge gets the name written beside it and the type "Cầu"', () => {
    const d = doc([road('CAU', 0), text('Cầu Kênh Xáng', 30, 5), road('CAU', 80)]);
    const bt = 'QuyHoach/QuyHoachGiaoThong/CongTrinhGiaoThong_L';
    const m = new Map<string, MappingEntry>([[rowKey('a', 'CAU', 'L'), { target: bt, phanLoai: 'Cầu' }]]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1) }], m, { boundary: null, sourceInGhiChu: false });
    const f = built.classes.find((x) => x.target === bt)!.features;
    expect(f[0].attrs).toMatchObject({ tenCongTrinh: 'Cầu Kênh Xáng', loaiCongTrinh: '15', loaiHinhGiaoThong: '1' });
    expect(f[1].attrs).toEqual({ loaiCongTrinh: '15', loaiHinhGiaoThong: '1' });
  });
});

describe('route signs ("914C" in a diamond at the edge of the planning area)', () => {
  it('reads a bare route number only', () => {
    expect(parseRouteSign('914C', 'tinh')).toMatchObject({ name: 'Đường 914C', rank: 'tinh' });
    expect(parseRouteSign('914', null)).toMatchObject({ name: 'Đường 914', rank: 'tinh' });
    expect(parseRouteSign('QL.91', null)).toBeNull();
    expect(parseRouteSign('12', null)).toBeNull();
    expect(parseRouteSign('Đường 914', null)).toBeNull();
  });

  it('finds the line under the sign, else the one whose end points at it; upright text turning is ignored', () => {
    const lines = [[[0, 0], [400, 0]], [[0, 300], [400, 300]]];
    const sign = { text: '914', at: [1000, 5] as [number, number], height: 70, rotation: 11 };
    expect(lineForSign(lines, sign)).toBe(0);
    expect(lineForSign(lines, { ...sign, at: [200, 20] })).toBe(0); // on it
    expect(lineForSign(lines, { ...sign, at: [1000, 600] })).toBe(-1); // nothing points there
  });

  it('names the road that runs on to a sign outside the planning area, not the diamond drawn on the same layer', () => {
    const layer = 'HTKT_GT_Duongtinh';
    const line = (y: number): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[0, y], [400, y]], closed: false });
    const diamond: CadEntity = { kind: 'polyline', layer, color: '#ffffff', points: [[900, 0], [1000, 100], [1100, 0], [1000, -100]], closed: true };
    const sign: CadEntity = { kind: 'text', layer, color: '#ffffff', text: '914C', position: [1000, 0], height: 70, rotation: 11, hAlign: 'left', vAlign: 'baseline' };
    const d: CadDocument = { units: 'm', crs: null, layers: [], entities: [line(0), line(500), diamond, sign], bbox: [[0, 0], [1100, 500]], warnings: [] };
    const target = 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L';
    const m = new Map<string, MappingEntry>([[rowKey('a', layer, 'L'), { target, phanLoai: 'Đường tỉnh' }]]);
    const built = buildFeatures([{ id: 'a', name: 'a.dwg', doc: d, inside: Uint8Array.from([1, 1, 0, 0]) }], m, { boundary: null, sourceInGhiChu: false });
    const f = built.classes.find((x) => x.target === target)!.features;
    expect(f).toHaveLength(2);
    expect(f[0].attrs).toMatchObject({ tenDuong: 'Đường 914C', loaiDuong: '3' });
    expect(f[1].attrs?.tenDuong).toBeUndefined();
  });
});

describe('a route drawn as one wide dashed line on a layer called "TEXT"', () => {
  const square: [number, number][] = [[1000, 1000], [3000, 1000], [3000, 3000], [1000, 3000]];
  const line = (layer: string, a: [number, number], b: [number, number], width: number): CadEntity => ({ kind: 'polyline', layer, color: '#000000', width, points: [a, b], closed: false });
  const arrow = line('TEXT', [1500, 1500], [1560, 1500], 5);
  const route = line('TEXT', [0, 2000], [4000, 2000], 15); // both ends outside the area, 2 km of it inside
  const d: CadDocument = { units: 'm', crs: null, layers: [], entities: [arrow, route], bbox: [[0, 0], [4000, 4000]], warnings: [] };

  it('counts as inside although neither end is', () => {
    expect(Array.from(insideFlags(d, square))).toEqual([1, 1]);
    expect(Array.from(insideFlags({ ...d, entities: [line('TEXT', [0, 5000], [4000, 5000], 15)] }, square))).toEqual([0]);
  });

  it('has a row of its own (flagged for a look), apart from the arrows of the layer, which stay out', () => {
    const rows = layerRows('a', d, new Uint8Array([1, 1]));
    expect(rows.filter((r) => r.layer === 'TEXT' && r.kind === 'L').map((r) => [r.count, !!r.wide]).sort()).toEqual([[1, false], [1, true]]);
    const wide = rows.find((r) => r.wide)!;
    const plain = rows.find((r) => r.layer === 'TEXT' && !r.wide)!;
    expect(suggestRow(wide, 'qh-sdd', rows)).toMatchObject({ target: 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L', review: true });
    expect(suggestRow(plain, 'qh-sdd', rows).target).toBeNull();
  });
});
