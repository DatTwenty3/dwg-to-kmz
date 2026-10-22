// What makes the QGIS project look like the CAD drawing: widths set on the vertices, line types (dashes and the
// texts inside them), every object inside the area (not only the mapped layers), and the land-use rules around it.
import { describe, expect, it } from 'vitest';
import { vertexWidth } from '@/lib/cad/normalize/source';
import type { CadDocument, CadEntity, LineTypeDef, Vec2 } from '@/lib/cad/types';
import {
  analyzeDrawings,
  cadLayerData,
  cadSourceDocument,
  compactName,
  buildQgs,
  cadOutputView,
  cadSource,
  featureKept,
  dashString,
  findBoundary,
  initialMapping,
  lineTypeTexts,
  textWidth,
  suggest,
  type MappingEntry,
  type MappingTemplate,
} from '@/lib/dwg2gdb';

const X0 = 590_000;
const Y0 = 1_070_000;
const LAND_USE = 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A';
const sq = (x: number, y: number, s: number): Vec2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const text = (t: string, at: Vec2, height = 8, layer = 'G-CHU'): CadEntity => ({ kind: 'text', layer, color: '#000000', text: t, position: at, height, rotation: 0, hAlign: 'center', vAlign: 'middle' });
const doc = (entities: CadEntity[], extra: Partial<CadDocument> = {}): CadDocument => ({
  units: 'm',
  crs: null,
  layers: [...new Set(entities.map((e) => e.layer))].map((name) => ({ name, color: '#888888', visible: true })),
  entities,
  bbox: [[X0, Y0], [X0 + 5000, Y0 + 5000]],
  warnings: [],
  ...extra,
});
const TITLE = text('BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050', [X0 + 6000, Y0], 30);
const parsed = (d: CadDocument) => [{ id: 'd1', name: 'QH06_Ban Do QH SDD NAM 2050.dwg', path: 'QH06.dwg', doc: d }];

describe('widths set on the vertices', () => {
  it('a road drawn 20 m wide on every vertex is one 20 m width; a taper gets its mean width; none → undefined', () => {
    expect(vertexWidth([{ startWidth: 20, endWidth: 20 }, { startWidth: 20, endWidth: 20 }, { startWidth: 0, endWidth: 0 }])).toBe(20);
    expect(vertexWidth([{ startWidth: 10, endWidth: 0 }, { startWidth: 0, endWidth: 0 }])).toBe(5);
    expect(vertexWidth([{ startWidth: 0, endWidth: 0 }, { startWidth: 0, endWidth: 0 }])).toBeUndefined();
    // closed: the last vertex has its own segment back to the first
    expect(vertexWidth([{ startWidth: 8, endWidth: 8 }, { startWidth: 8, endWidth: 8 }, { startWidth: 8, endWidth: 8 }], true)).toBe(8);
  });
});

describe('line types', () => {
  // The 110 kV line of the Đôn Châu drawing: a long dash, then the letters of "110kV" each in a gap.
  const def: LineTypeDef = {
    elements: [
      { length: 60 },
      { length: -3, text: '1', textScale: 6, offset: [0, -2.5] },
      { length: -3, text: '1', textScale: 6, offset: [0, -2.5] },
      { length: -3, text: '0', textScale: 6, offset: [0, -2.5] },
    ],
  };
  it('dash string: dashes and gaps scaled, consecutive gaps merged, a pattern too fine to draw gives none', () => {
    expect(dashString(def, 1)).toBe('60;9');
    expect(dashString(def, 2)).toBe('120;18');
    expect(dashString({ elements: [{ length: 0.02 }, { length: -0.01 }] }, 1)).toBe('');
    expect(dashString({ elements: [{ length: 0.25 }, { length: -0.125 }] }, 1)).toBe('0.25;0.125');
    // a pattern that starts with a gap starts with an empty dash (a trailing dash with no gap after it is dropped)
    expect(dashString({ elements: [{ length: -2 }, { length: 3 }] }, 1)).toBe('0;2');
    expect(dashString({ elements: [{ length: 5 }, { length: -2 }, { length: 0 }, { length: -2 }] }, 1)).toBe('5;2;0.001;2');
  });
  it('writes the letters along the line, each at its place of the pattern, turned with the line', () => {
    const t = lineTypeTexts([[0, 0], [200, 0]], false, def, 1);
    // period 69: dash 60 then three letters every 3 m (60, 63, 66 · 129… · 198); the next period is past the end
    expect(t.slice(0, 3).map((x) => [x.text, Math.round(x.at[0]), x.angle, x.height])).toEqual([['1', 60, 0, 6], ['1', 63, 0, 6], ['0', 66, 0, 6]]);
    expect(t).toHaveLength(7);
    expect(t[0].at[1]).toBeCloseTo(-2.5);
    // a line going up turns the letters 90°
    expect(lineTypeTexts([[0, 0], [0, 100]], false, def, 1)[0].angle).toBeCloseTo(90);
    expect(lineTypeTexts([[0, 0], [100, 0]], false, { elements: [{ length: 5 }, { length: -2 }] }, 1)).toEqual([]);
    // a line drawn westward: the text is turned to read left to right and keeps its place (anchor at its far end)
    const west = lineTypeTexts([[200, 0], [0, 0]], false, { elements: [{ length: 60 }, { length: -3, text: 'AB', textScale: 6 }] }, 1)[0];
    expect(west.angle).toBeCloseTo(0);
    expect(west.at[0]).toBeCloseTo(140 - textWidth('AB', 6), 5); // starts 60 m from the start (x = 140), runs west
    expect(west.at[1]).toBeCloseTo(-6); // the text box moved from above the (reversed) frame to below the line
  });
  it('lines carry their dash string and the letters become text features', () => {
    const e: CadEntity = { kind: 'polyline', layer: 'QH_EE-110', color: '#ff0000', points: [[0, 0], [200, 0]], closed: false, width: 2, lineType: '110HH', lineScale: 1 };
    const d = cadLayerData(doc([e], { lineTypes: { '110HH': def } }));
    expect(JSON.parse(d.json.lines!).features[0].properties).toMatchObject({ rong: 2, net: '60;9' });
    expect(d.counts.texts).toBe(7);
    expect(JSON.parse(d.json.texts!).features[0].properties).toMatchObject({ chu: '1', cao: 6, canh: 2, mau: '#ff0000' });
  });
});

describe('every object inside the area is in the CAD drawing', () => {
  const entries = (o: Record<string, string | null>) => new Map<string, MappingEntry>(Object.entries(o).map(([k, v]) => [k, { target: v, phanLoai: v ? 'Đất ở' : '' }]));
  const polyW = (layer: string, width: number): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: sq(X0 + 100, Y0 + 100, 400), closed: true, width });
  const d = doc([
    TITLE,
    { kind: 'polyline', layer: 'KHONG_GHEP', color: '#0000ff', points: [[X0 + 10, Y0 + 10], [X0 + 90, Y0 + 10]], closed: false }, // never mapped
    text('914', [X0 + 300, Y0 + 300], 40, 'HTKT_GT_Duongtinh'),
    { kind: 'polygon', layer: 'DAT_O', color: '#7f7f3f', fillOpacity: 0.5, rings: [sq(X0 + 1000, Y0 + 1000, 100)] }, // land use → geodatabase layer
    polyW('HTKT_GT_Duongtinh', 20), // a band the suggestion took for a parcel
  ]);
  const a = analyzeDrawings(parsed(d), null);
  const m = initialMapping(a, null);
  const input = [{ id: 'd1', name: 'QH06.dwg', doc: d, inside: new Uint8Array(d.entities.length).fill(1), role: 'qh-sdd' as const }];

  it('mapped or not, except the land-use hatches the geodatabase draws; a wide polyline stays even when taken for land use', () => {
    const forced = new Map<string, MappingEntry>(m);
    for (const [k, v] of m) if (/DAT_O|HTKT_GT_Duongtinh/.test(k) && !/T$/.test(k)) forced.set(k, { ...v, target: LAND_USE, phanLoai: 'Đất ở' });
    const out = cadSourceDocument(input, forced, null);
    const layers = out.entities.map((e) => `${e.kind}:${e.layer}`).sort();
    expect(layers).toContain('polyline:QH_KHONG_GHEP');
    expect(layers).toContain('text:QH_HTKT_GT_Duongtinh');
    expect(layers).toContain('polyline:QH_HTKT_GT_Duongtinh'); // the wide one
    expect(layers.some((l) => l.endsWith('DAT_O'))).toBe(false);
  });
  it('the planning boundary is added when the drawings have none, once', () => {
    const ring = sq(X0, Y0, 2000);
    const out = cadSourceDocument(input, entries({}), ring);
    expect(out.entities.filter((e) => e.layer === 'QH_Ranh giới lập quy hoạch')).toHaveLength(1);
  });
  it('a copy of the same object in two drawings is written once', () => {
    const two = [input[0], { ...input[0], id: 'd2' }];
    expect(cadSourceDocument(two, entries({}), null).entities).toHaveLength(cadSourceDocument([input[0]], entries({}), null).entities.length);
  });
});

describe('roads drawn as open lines on a land-use map', () => {
  const open = { layerHasPolygons: false, closedShare: 0 };
  it('an open road / bridge layer is the road network (a dossier whose only map is the land-use one)', () => {
    // the thin lines on both sides of a road are its reserve (chỉ giới đường đỏ), the wide polyline is the road
    expect(suggest('qh-sdd', 'HTKT_GT_Heduong', 'L', open).target).toBe('QuyHoach/QuyHoachCGDD_CGXDHanhLangHTKT/ChiGioiDuongDo_L');
    expect(suggest('qh-sdd', 'HTKT_GT_Duongkhuvuc', 'L', open).target).toBe('QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L');
    expect(suggest('qh-sdd', 'HTKT_GT_Cau', 'L', open).target).toBe('QuyHoach/QuyHoachGiaoThong/CongTrinhGiaoThong_L');
    expect(suggest('ht-sdd', 'DUONG_BETONG', 'L', open).target).toBe('HienTrang/HienTrangGiaoThong/MangLuoiGiaoThongDuongBo_L');
    expect(suggest('ht-htkt', 'KS_CAU-CONG', 'L', open).target).toBe('HienTrang/HienTrangGiaoThong/CongTrinhGiaoThong_L');
  });
  it('the planned road layer of the HTKT_GT_ habit is a road, not a land-use background', () => {
    expect(suggest('qh-gt', 'HTKT_GT_Quyhoach', 'L', open)).toMatchObject({ target: 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L', phanLoai: 'Đường quy hoạch' });
  });
  it('the outline of a symbol is not data (its point is)', () => {
    for (const [role, layer] of [['qh-tn', 'HT_Nuoc mua_Ho ga'], ['qh-dien', 'dien tram']] as const) {
      const s = suggest(role, layer, 'L', open);
      expect(s.target).toBeNull();
      expect(s.unknown).toBeFalsy();
    }
  });
  it('the cadastral base ("Nen giai thua") is no data of the plan', () => {
    for (const kind of ['A', 'L', 'P'] as const) expect(suggest('qh-sdd', 'Nen giai thua', kind, open).unknown).toBeFalsy();
    expect(suggest('qh-sdd', 'Nen giai thua', 'A', open).target).toBeNull();
  });
  it('concrete yards and embankments are no road', () => {
    expect(suggest('ht-htkt', 'NEN_BETONG', 'L', open).target).toBeNull();
    expect(suggest('ht-htkt', 'KE_BETONG', 'L', open).target).toBeNull();
    expect(suggest('ht-htkt', 'DUONG_BETONG', 'L', open).target).toContain('MangLuoiGiaoThong');
  });
  it('outlines of a road lot (closed, or with a hatch on the layer) stay out', () => {
    expect(suggest('qh-sdd', 'DUONG NHUA', 'L', { layerHasPolygons: true, closedShare: 1 }).target).toBeNull();
    expect(suggest('qh-sdd', 'DUONG NHUA', 'L', { layerHasPolygons: false, closedShare: 1 }).target).not.toContain('MangLuoiGiaoThong');
  });
});

describe('land-use layers named as in Phụ lục I', () => {
  it('outlines of such a layer with no hatch on it become land use; the existing-state copy "HT_…" does not', () => {
    const open = { layerHasPolygons: false, closedShare: 0 };
    expect(suggest('qh-sdd', 'QHDD_DAT_KXD_Dancunongthon', 'L', open)).toMatchObject({ target: LAND_USE, phanLoai: 'Đất ở' });
    expect(suggest('qh-sdd', 'HT_DAT_KXD_Dancunongthon', 'L', open).target).toBeNull();
    // with hatches on the layer the outlines are only their borders
    expect(suggest('qh-sdd', 'QHDD_DAT_KXD_Dancunongthon', 'L', { layerHasPolygons: true, closedShare: 0 }).target).toBeNull();
  });
  it('a saved rule whose land use is no value of Phụ lục (the layer name of an old version) is replaced by today\'s suggestion', () => {
    const d = doc([TITLE, { kind: 'polygon', layer: 'DAT_NNK_Honuoc', color: '#005cb8', fillOpacity: 0.5, rings: [sq(X0 + 100, Y0 + 100, 100)] }]);
    const a = analyzeDrawings(parsed(d), null);
    const rule = (phanLoai: string): MappingTemplate => ({
      format: 'ledat-gis-layer-map',
      version: 1,
      name: 't',
      updated: '',
      rules: [{ role: 'qh-sdd', layer: compactName('DAT_NNK_Honuoc'), kind: 'A', target: LAND_USE, phanLoai }],
    });
    const key = a.rows.find((r) => r.layer === 'DAT_NNK_Honuoc')!.key;
    expect(initialMapping(a, rule('DAT_NNK_Honuoc')).get(key)).toMatchObject({ phanLoai: 'Đất sông, ngòi, kênh, rạch, suối, mặt nước', source: 'auto' });
    // a value of the Phụ lục chosen by the user stays
    expect(initialMapping(a, rule('Đất ở')).get(key)).toMatchObject({ phanLoai: 'Đất ở', source: 'template' });
  });
});

describe('the area of a plan without a boundary layer', () => {
  const line = (layer: string, points: Vec2[], closed = false): CadEntity => ({ kind: 'polyline', layer, color: '#ff0000', points, closed });
  it('a legend sample on the "lập quy hoạch" layer is not the area: the commune outline (≥ 100 ha) is', () => {
    const d = doc([line('BV_Rg_Lapquyhoach', [[X0, Y0 + 9000], [X0 + 189, Y0 + 9000]]), line('QH_Ranh giới huyện', sq(X0, Y0, 3000), true)]);
    expect(findBoundary(d)).toMatchObject({ layer: 'QH_Ranh giới huyện', area: 9e6 });
  });
  it('a boundary line that stops a little short of its start is closed; with a named boundary the outline is not used', () => {
    const open = [...sq(X0, Y0, 1000), [X0, Y0 + 20]] as Vec2[];
    expect(findBoundary(doc([line('BV_Rg_Lapquyhoach', open)]))).toMatchObject({ layer: 'BV_Rg_Lapquyhoach' });
    const both = doc([line('BV_Rg_Lapquyhoach', sq(X0, Y0, 500), true), line('QH_Ranh giới huyện', sq(X0, Y0, 3000), true)]);
    expect(findBoundary(both)?.layer).toBe('BV_Rg_Lapquyhoach');
  });
});

describe('dashed lines in the project', () => {
  it('are not clipped to the view, so the pattern keeps its phase and the letters stay in the gaps', () => {
    const qgs = buildQgs({ name: 'T', title: 'T', classes: [], lon0: 105.5, zone: 3, extent: [0, 0, 1, 1], cad: { counts: { lines: 1, areas: 0, texts: 0, points: 0 }, patternColors: [] } });
    const symbols = [...qgs.matchAll(/<symbol type="line" name="(\d)" alpha="1" clip_to_extent="(\d)"/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(symbols).toEqual(['0:1', '1:1', '2:0', '3:0']);
  });
});

describe('dots of the boundary line type and the signs just outside the area', () => {
  it('the letter "l" of the planning boundary is a dot: a circle 0.7 of the text height, centred near the text origin', () => {
    const l: LineTypeDef = { elements: [{ length: 1, text: 'l', textScale: 1.5, offset: [0, -0.68] }, { length: 2.5 }] };
    const t = lineTypeTexts([[0, 0], [400, 0]], false, l, 50);
    expect(t[0].dot).toBeCloseTo(52.5);
    expect(t[0].at[0]).toBeCloseTo(0 + 75 * 0.4);
    expect(t[0].at[1]).toBeCloseTo(-34 + 75 * 0.45);
    const e: CadEntity = { kind: 'polyline', layer: 'QH_Ranh', color: '#ff0000', points: [[0, 0], [400, 0]], closed: false, lineType: 'R', lineScale: 50 };
    const d = cadLayerData(doc([e], { lineTypes: { R: l } }));
    expect(d.counts.texts).toBe(0);
    expect(JSON.parse(d.json.points!).features[0].properties).toMatchObject({ kt: 52.5, mau: '#ff0000' });
  });

  const near = (layer: string, x: number, kind: 'polyline' | 'text' = 'polyline'): CadEntity =>
    kind === 'text' ? text('914C', [X0 + x, Y0 + 500], 20, layer) : { kind: 'polyline', layer, color: '#ffffff', points: [[X0 + x, Y0 + 500], [X0 + x + 40, Y0 + 500]], closed: false };
  it('objects within 10 % of the area outside it come in, from the layers of the map and not of the sheet', () => {
    const ring = sq(X0, Y0, 1000); // margin 100 m
    const d = doc([near('HTKT_GT_Duongtinh', -80), near('HTKT_GT_Duongtinh', -80, 'text'), near('HTKT_GT_Duongtinh', -300), near('BV_Khungten', -80), near('DAT_O', -80)]);
    const flags = new Uint8Array(d.entities.length); // none inside
    const base = { id: 'd1', name: 'QH.dwg', doc: d, inside: flags, role: 'qh-sdd' as const };
    const out = cadSourceDocument([base], new Map(), ring).entities.map((e) => `${e.kind}:${e.layer}`).sort();
    expect(out.filter((l) => !l.includes('Ranh'))).toEqual(['polyline:QH_DAT_O', 'polyline:QH_HTKT_GT_Duongtinh', 'text:QH_HTKT_GT_Duongtinh']);
    // what the user deleted on the map does not come back through the margin
    const removed = cadSourceDocument([{ ...base, removed: new Set([0, 1]) }], new Map(), ring).entities.filter((e) => e.layer === 'QH_HTKT_GT_Duongtinh');
    expect(removed).toHaveLength(0);
  });
});

describe('Biên tập → "Bản vẽ CAD"', () => {
  const road = (layer: string): CadEntity => ({ kind: 'polyline', layer, color: '#ff0000', points: [[X0 + 10, Y0 + 10], [X0 + 90, Y0 + 10]], closed: false });
  const d = doc([road('HTKT_GT_Heduong'), road('KS_X'), text('Ghi chú', [X0 + 50, Y0 + 50])]);
  const input = (id: string) => ({ id, name: `${id}.dwg`, doc: d, inside: new Uint8Array(d.entities.length).fill(1), role: 'qh-sdd' as const });

  it('each object keeps the copies it has in the drawings, under the `cad:` ids; the boundary the app adds has none', () => {
    const src = cadSource([input('a'), input('b')], new Map(), sq(X0, Y0, 1000));
    expect(src.doc.entities).toHaveLength(4); // the 3 objects once + the boundary
    expect(src.refs[0]).toEqual([[['cad:a', 0]], [['cad:b', 0]]]);
    expect(src.refs[3]).toEqual([]);
  });

  it('what the user removed (every copy) is left out of the export; the other copies do not come back', () => {
    const out = cadSourceDocument([{ ...input('a'), removed: new Set([0]) }, { ...input('b'), removed: new Set([0]) }], new Map(), null);
    expect(out.entities.map((e) => e.layer)).toEqual(['QH_KS_X', 'QH_G-CHU']);
    // one copy removed only: the other one stays
    expect(cadSourceDocument([{ ...input('a'), removed: new Set([0]) }, input('b')], new Map(), null).entities).toHaveLength(3);
  });

  it('the edit view has one handle per object (e<k>, x<k> when the app added it) on the layers of the drawing', () => {
    const v = cadOutputView(cadSource([input('a')], new Map(), sq(X0, Y0, 1000)));
    expect(v.doc.layers.map((l) => l.name).sort()).toEqual(['QH_G-CHU', 'QH_HTKT_GT_Heduong', 'QH_KS_X', 'QH_Ranh giới lập quy hoạch']);
    expect(v.doc.entities.map((e) => e.handle)).toEqual(['e0', 'e1', 'e2', 'x3']);
    // the page removes with featureKept: all the copies of an object left out → not written
    expect(featureKept(v.refs[0], new Map([['cad:a', new Set([0])]]))).toBe(false);
    expect(featureKept(v.refs[1], new Map([['cad:a', new Set([0])]]))).toBe(true);
  });
});
