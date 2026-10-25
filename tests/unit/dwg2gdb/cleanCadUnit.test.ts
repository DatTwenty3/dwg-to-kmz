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
});
