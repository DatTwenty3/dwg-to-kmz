// cleanCad.ts on small synthetic drawings: layers named as Phụ lục I names them, junk dropped, the rest kept.
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { addTitleBlock, CANONICAL_TITLE, cleanDocument, guessRole, landUseSymbol, pascalAscii, rowKey } from '@/lib/dwg2gdb';

describe('landUseSymbol', () => {
  it('a commune plan (Mục 7) takes the colour of its Mục and the layer name of the Mục that names it with that colour', () => {
    expect(landUseSymbol('Đất ở', 7)).toMatchObject({ layer: 'DAT_KXD_Dancunongthon', aci: 57 });
    expect(landUseSymbol('Đất sông, ngòi, kênh, rạch, suối, mặt nước', 7)).toMatchObject({ layer: 'DAT_NNK_Songsuoi', aci: 152 });
    expect(landUseSymbol('Đất trồng lúa', 7)).toMatchObject({ layer: 'DAT_NNK_Tronglua', aci: 3 });
  });
  it('writes a layer of its own where no Mục names one', () => {
    expect(pascalAscii('Đất sông, kênh')).toBe('Datsongkenh');
  });
});

describe('cleanDocument', () => {
  const sq = (x: number): CadEntity => ({ kind: 'polygon', layer: 'HT_DAT_NN_Tronglua', color: '#00ff00', fillOpacity: 0.4, rings: [[[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]]] });
  const line = (layer: string): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[0, 5], [100, 5]], closed: false });
  const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [100, 100]], warnings: [] });
  const mapping = new Map([
    [rowKey('a', 'HT_DAT_NN_Tronglua', 'A', 'c00ff00'), { target: 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A', phanLoai: 'Đất trồng lúa' }],
    [rowKey('a', 'Nen giai thua', 'L'), { target: null, phanLoai: '', reason: 'Nền giải thửa' }],
  ]);
  it('keeps the hatch on the Phụ lục I layer and colour, drops the cadastral base and what is outside the area', () => {
    const d = doc([sq(0), line('Nen giai thua'), sq(500)]);
    const r = cleanDocument([{ id: 'a', name: 'a.dwg', doc: d, inside: Uint8Array.from([1, 1, 0]), role: 'qh-sdd', color: { role: 'qh-sdd', section: 7, hexCounts: new Map() } as never }], mapping, null);
    expect(r.doc.entities).toHaveLength(1);
    expect(r.doc.entities[0]).toMatchObject({ kind: 'polygon', layer: 'DAT_NNK_Tronglua', color: '#00ff00' });
    expect(r.totals).toMatchObject({ read: 3, kept: 1, outside: 1 });
    expect(r.lines.find((l) => l.from.endsWith('Nen giai thua'))).toMatchObject({ to: null, dropped: 1 });
  });
});

describe('title block', () => {
  it('every standard title reads back as its own kind of map', () => {
    for (const [role, title] of Object.entries(CANONICAL_TITLE)) expect(guessRole('x.dxf', [title!]).role, title).toBe(role);
  });
  it('keeps the original title when it reads back as the same kind, else writes the standard one; the plan title is kept', () => {
    const doc = (): CadDocument => ({ units: 'm', crs: null, layers: [], entities: [], bbox: [[0, 0], [1600, 1000]], warnings: [] });
    const a = doc();
    expect(addTitleBlock(a, 'qh-dien', ['BẢN ĐỒ ĐỊNH HƯỚNG QUY HOẠCH CẤP ĐIỆN ĐẾN NĂM 2050', 'QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG', 'ghi chú'])).toEqual(['BẢN ĐỒ ĐỊNH HƯỚNG QUY HOẠCH CẤP ĐIỆN ĐẾN NĂM 2050', 'QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG']);
    expect(a.entities.every((e) => e.layer === 'BV_Ten_Banve' && e.kind === 'text')).toBe(true);
    const b = doc();
    expect(addTitleBlock(b, 'qh-sdd', ['BẢN ĐỒ ĐỊNH HƯỚNG PHÁT TRIỂN KHÔNG GIAN'])).toEqual(['BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT']);
  });
});

describe('decisions (overrides)', () => {
  const line = (layer: string, y = 5): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[0, y], [100, y]], closed: false });
  const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [100, 100]], warnings: [] });
  const input = (d: CadDocument) => ({ id: 'a', name: 'QH08 cap dien.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1), role: 'qh-dien' as const });

  it('a decision wins over the built-in rules: keep under a chosen layer, drop, by layer name / regex / drawing', () => {
    const d = doc([line('DD-LA', 5), line('GHI CHU', 6), line('cay_khao_sat_1', 7), line('cay_khao_sat_2', 8)]);
    const r = cleanDocument([input(d)], new Map(), null, [
      { layer: 'dd la', action: 'keep', to: 'HTKT_CD_Duongday22kV', why: 'đường dây 22 kV' },
      { layer: '/^cay_khao_sat/i', action: 'drop', why: 'cây khảo sát' },
      { drawing: 'QH99', layer: 'GHI CHU', action: 'drop' }, // another drawing: not applied here
    ]);
    expect(r.doc.entities.map((e) => e.layer)).toEqual(['HTKT_CD_Duongday22kV']); // GHI CHU: no rule keeps it, nothing says it is content
    expect(r.lines.find((l) => l.from.endsWith('cay_khao_sat_1'))).toMatchObject({ to: null, why: 'cây khảo sát' });
  });

  it('a power line named by its voltage goes to the 22 kV layer and keeps its line type', () => {
    const e = { ...(line('EE-22') as Extract<CadEntity, { kind: 'polyline' }>), lineType: 'TH-D.22', lineScale: 1 };
    const d: CadDocument = { ...doc([e]), lineTypes: { 'TH-D.22': { elements: [{ length: 5 }, { length: -5, text: '22kV', textScale: 2 }] } } };
    const r = cleanDocument([input(d)], new Map(), null);
    expect(r.doc.entities[0]).toMatchObject({ layer: 'HTKT_CD_Duongday22kV', lineType: 'TH-D.22' });
    expect(r.doc.lineTypes?.['TH-D.22']).toBeDefined();
  });

  it('a route number written big on layer "0" is a sign and stays; small numbers and other texts on layer "0" are junk', () => {
    const t = (txt: string, h: number): CadEntity => ({ kind: 'text', layer: '0', color: '#ffffff', text: txt, position: [50, 50], height: h, rotation: 0, hAlign: 'center', vAlign: 'middle' });
    const d = doc([t('914B', 60), t('915', 2), t('hello', 60)]);
    const r = cleanDocument([input(d)], new Map(), null);
    expect(r.doc.entities.map((e) => [e.kind === 'text' ? e.text : '', e.layer])).toEqual([['914B', 'HTKT_GT_Kyhieutuyen']]);
  });

  it('a closed line drawn with the line type "Ranh giới lập quy hoạch" is the planning boundary, whatever its layer is called', () => {
    const ring: CadEntity = { kind: 'polyline', layer: 'Ranh giới huyện', color: '#ff0000', points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true, lineType: 'QH_Ranh giới lập quy hoạch', lineScale: 50 };
    const d: CadDocument = { ...doc([ring]), lineTypes: { 'QH_Ranh giới lập quy hoạch': { elements: [{ length: 1, text: 'l', textScale: 1.5 }, { length: 2.5 }] } } };
    const r = cleanDocument([{ ...input(d), role: 'qh-sdd' as const }], new Map(), [[0, 0], [100, 0], [100, 100], [0, 100]]);
    expect(r.doc.entities.filter((e) => e.layer === 'BV_Rg_lapquyhoach')).toHaveLength(1); // once: no second copy added for the boundary
    expect(r.doc.entities.some((e) => e.layer === 'BV_Rg_capcoso')).toBe(false);
    expect(r.doc.entities[0]).toMatchObject({ lineType: 'QH_Ranh giới lập quy hoạch', lineScale: 50 });
  });
});

describe('symbols, road names and sign frames (Long Hiệp)', () => {
  const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [1000, 1000]], warnings: [] });
  const ring: [number, number][] = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
  const road = (layer: string, x0: number, x1: number): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[x0, 500], [x1, 500]], closed: false });
  const text = (t: string, x: number, y: number, rotation: number, layer = 'TEXT'): CadEntity => ({ kind: 'text', layer, color: '#ffffff', text: t, position: [x, y], height: 5, rotation, hAlign: 'left', vAlign: 'baseline' });
  const roadMap = new Map([[rowKey('a', 'HTKT_GT_Duongtinh', 'L'), { target: 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L', phanLoai: 'Đường tỉnh' }]]);
  const input = (d: CadDocument, inside: number[], role: 'qh-gt' | 'qh-ttll' = 'qh-gt') => ({ id: 'a', name: 'QH.dwg', doc: d, inside: Uint8Array.from(inside), role });

  it('keeps the name of a road that leaves the area when it runs along the kept road, not a label that stands alone or across', () => {
    const d = doc([road('HTKT_GT_Duongtinh', 900, 1090), text('CAO TỐC TRÀ VINH - HỒNG NGỰ', 1010, 508, 0), text('HƯỚNG ĐI XÃ NHỊ TRƯỜNG', 1010, 560, 0), text('ĐƯỜNG NGANG', 1010, 508, 90)]);
    const r = cleanDocument([input(d, [1, 0, 0, 0])], roadMap, ring);
    const names = r.doc.entities.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text);
    expect(names).toEqual(['CAO TỐC TRÀ VINH - HỒNG NGỰ']);
    expect(r.doc.entities.find((e) => e.kind === 'text')).toMatchObject({ layer: 'HTKT_GT_Tenduong' });
  });

  it('keeps the outline of a transformer station symbol (its hatch is the data) on a layer of pictograms', () => {
    const outline: CadEntity = { kind: 'polyline', layer: 'dien tram', color: '#ff0000', points: [[10, 10], [20, 10], [20, 20], [10, 20]], closed: true };
    const m = new Map([[rowKey('a', 'dien tram', 'L'), { target: null, phanLoai: '', reason: 'Nét viền ký hiệu (hố ga, trạm điện…) — đối tượng lấy từ điểm / hatch' }]]);
    const r = cleanDocument([input(doc([outline]), [1])], m, ring);
    expect(r.doc.entities.map((e) => e.layer).filter((l) => l !== 'BV_Rg_lapquyhoach')).toEqual(['KYHIEU_Congtrinh_Trambienap']);
  });

  it('a pictogram left on an AUDIT layer is content: drawn as it was, one point for the whole symbol', () => {
    const sq = (x: number): CadEntity[] => [
      { kind: 'polygon', layer: 'AUDIT_D_0412', color: '#00cc99', fillOpacity: 0.4, rings: [[[x, 100], [x + 10, 100], [x + 10, 110], [x, 110]]] },
      { kind: 'polyline', layer: 'AUDIT_D_0412', color: '#00cc99', points: [[x, 100], [x + 10, 110]], closed: false },
    ];
    const d = doc([...sq(100), ...sq(300)]);
    const r = cleanDocument([input(d, [1, 1, 1, 1], 'qh-ttll')], new Map(), ring);
    expect(r.doc.entities.filter((e) => e.layer === 'KYHIEU_Congtrinh_TTLL')).toHaveLength(4);
    const points = r.doc.entities.filter((e) => e.kind === 'point');
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ layer: 'HTKT_TTLL_Congtrinh', position: [105, 105] });
  });

  it('the diamond round a route number is kept beside the number', () => {
    const frame: CadEntity = { kind: 'polyline', layer: '0', color: '#0000ff', points: [[100, 100], [110, 110], [100, 120], [90, 110]], closed: true };
    const r = cleanDocument([input(doc([frame, text('914C', 100, 108, 0)]), [1, 1])], new Map(), ring);
    expect(r.doc.entities.map((e) => e.layer).filter((l) => l !== 'BV_Rg_lapquyhoach').sort()).toEqual(['HTKT_GT_Kyhieutuyen', 'KYHIEU_Congtrinh_Bienso']);
  });
  it('a circle round a highway label (65 vertices, 252 m, layer KY HIEU) is kept too', () => {
    const circle: CadEntity = { kind: 'polyline', layer: 'KY HIEU', color: '#ffffff', width: 4.9, closed: true, points: Array.from({ length: 65 }, (_, k) => [500 + 126 * Math.cos((2 * Math.PI * (k % 64)) / 64), 500 + 126 * Math.sin((2 * Math.PI * (k % 64)) / 64)] as [number, number]) };
    const label = { ...text('QL54', 480, 480, 0, '0'), height: 60 } as CadEntity;
    const r = cleanDocument([input(doc([circle, label]), [1, 1])], new Map(), ring);
    expect(r.doc.entities.filter((e) => e.layer === 'KYHIEU_Congtrinh_Bienso')).toHaveLength(1);
    expect(r.doc.entities.filter((e) => e.layer === 'HTKT_GT_Kyhieutuyen')).toHaveLength(1);
  });
  it('a diamond of 266 m on the layer KYHIEU (Long Hiệp) is kept too, a parcel that merely contains a sign off-centre is not', () => {
    const diamond = (cx: number, cy: number, r: number): CadEntity => ({ kind: 'polyline', layer: 'KYHIEU', color: '#ffffff', points: [[cx - r, cy], [cx, cy + r], [cx + r, cy], [cx, cy - r]], closed: true });
    const big = cleanDocument([input(doc([diamond(500, 500, 133), text('915C', 500, 480, 0, 'TEXT')]), [1, 1])], new Map(), ring);
    expect(big.doc.entities.filter((e) => e.layer === 'KYHIEU_Congtrinh_Bienso')).toHaveLength(1);
    const off = cleanDocument([input(doc([diamond(500, 500, 133), text('915C', 600, 500, 0, 'TEXT')]), [1, 1])], new Map(), ring);
    expect(off.doc.entities.filter((e) => e.layer === 'KYHIEU_Congtrinh_Bienso')).toHaveLength(0);
  });
});
