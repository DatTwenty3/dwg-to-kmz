// Colour classification of hatches inside the mapping table, the exporters and the templates (synthetic drawings).
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import {
  aciHex,
  analyzeDrawings,
  buildFeatures,
  colorContexts,
  emptyTemplate,
  initialMapping,
  mergeTemplate,
  readTemplate,
  rowKey,
  summaryDocument,
  templateDecisions,
  type MappingEntry,
} from '@/lib/dwg2gdb';

const X0 = 590_000;
const Y0 = 1_070_000;
const sq = (x: number, y: number, s: number): Vec2[] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const poly = (layer: string, ring: Vec2[], color: string): CadEntity => ({ kind: 'polygon', layer, color, rings: [ring], fillOpacity: 0.5 });
const text = (t: string, at: Vec2, height = 8): CadEntity => ({ kind: 'text', layer: 'G-CHU', color: '#000000', text: t, position: at, height, rotation: 0, hAlign: 'center', vAlign: 'middle' });
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
const TITLE = text('BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050', [X0 + 6000, Y0], 30);
const LUA = aciHex(3); // Đất trồng lúa (Mục 7)
const O = aciHex(57); // Đất ở
const THPT = aciHex(24);
const LAND_USE = 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A';

const parsed = (d: CadDocument) => [{ id: 'd1', name: 'QH06_Ban Do QH SDD NAM 2050.dwg', path: 'QH06.dwg', doc: d }];
const entry = (m: Map<string, MappingEntry>, layer: string, color: string) => m.get(rowKey('d1', layer, 'A', 'c' + color.slice(1)));

describe('mapping rows split by colour group', () => {
  // One layer holding two colours (the draughtsman cared for colour, not for the layer), a layer with a random name.
  const d = doc([
    TITLE,
    poly('DAT_NN_Tronglua', sq(X0 + 100, Y0 + 100, 100), LUA),
    poly('DAT_NN_Tronglua', sq(X0 + 300, Y0 + 100, 100), O), // an "ở" parcel drawn on the rice layer
    poly('B', sq(X0 + 600, Y0 + 100, 100), THPT),
    poly('B', sq(X0 + 800, Y0 + 100, 100), '#7f007f'), // a colour the table does not know
  ]);
  const a = analyzeDrawings(parsed(d), 7);

  it('one row per colour of a layer, none for unknown or neutral colours', () => {
    const rows = a.rows.filter((r) => r.kind === 'A');
    expect(rows.map((r) => `${r.layer}|${r.colorKey}`).sort()).toEqual(['B|', `DAT_NN_Tronglua|c${LUA.slice(1)}`, `DAT_NN_Tronglua|c${O.slice(1)}`].sort());
  });

  it('a hatch of a known colour goes to its land use whatever its layer is called', () => {
    // Mục 7 has no "giáo dục" colour: the colour of số 24 is none → falls back to the layer name (unknown for "B").
    const m = initialMapping(a, null);
    expect(entry(m, 'DAT_NN_Tronglua', LUA)).toMatchObject({ target: LAND_USE, phanLoai: 'Đất trồng lúa', source: 'auto' });
    expect(entry(m, 'DAT_NN_Tronglua', O)).toMatchObject({ target: LAND_USE, phanLoai: 'Đất ở', review: true });
    expect(m.get(rowKey('d1', 'B', 'A'))).toMatchObject({ target: null, unknown: true });
  });

  it('buildFeatures, summaryDocument and the edit view read the same rows: two colours → two phanLoai', () => {
    const m = initialMapping(a, null);
    const color = colorContexts(a).get('d1');
    const input = [{ id: 'd1', name: 'QH06.dwg', doc: d, inside: a.inside.get('d1')!, color }];
    const built = buildFeatures(input, m, { boundary: null, sourceInGhiChu: false });
    const lu = built.classes.find((c) => c.target === LAND_USE)!;
    expect(lu.features.map((f) => f.phanLoai).sort()).toEqual(['Đất trồng lúa', 'Đất ở']);
    const sum = summaryDocument([{ ...input[0], role: 'qh-sdd' }], m, { boundary: null, texts: false });
    expect(sum.layers.map((l) => l.name).sort()).toEqual(['QH_ChucNangSuDungDat_A_Đất trồng lúa', 'QH_ChucNangSuDungDat_A_Đất ở']);
    // Without the colour context the coloured rows are not found: the key must come from the shared function.
    expect(buildFeatures([{ ...input[0], color: undefined }], m, { boundary: null, sourceInGhiChu: false }).classes).toHaveLength(0);
  });

  it('colours off (null) leaves one row per layer', () => {
    const off = analyzeDrawings(parsed(d), null);
    expect(off.section).toBeNull();
    expect(off.rows.filter((r) => r.kind === 'A').every((r) => r.colorKey === '')).toBe(true);
  });
});

describe('colour against the layer name', () => {
  it('a colour and a name that end in the same ChucNangSuDungDatM1 value keep the specific label', () => {
    const d = doc([TITLE, poly('GIAO DUC_ TIEU HOC', sq(X0 + 100, Y0 + 100, 100), aciHex(1))]); // số 1 = đất công cộng
    const a = analyzeDrawings(parsed(d), 7);
    const m = entry(initialMapping(a, null), 'GIAO DUC_ TIEU HOC', aciHex(1));
    expect(m).toMatchObject({ target: LAND_USE, phanLoai: 'Đất giáo dục' });
    expect(m).not.toHaveProperty('review', true);
  });

  it('a colour two land uses share needs a decision — unless the layer name settles it', () => {
    const d = doc([TITLE, poly('X1', sq(X0 + 100, Y0 + 100, 100), aciHex(94)), poly('CAYXANH_HANCHE', sq(X0 + 300, Y0 + 100, 100), aciHex(94))]);
    const a = analyzeDrawings(parsed(d), 2);
    const m = initialMapping(a, null);
    expect(entry(m, 'X1', aciHex(94))).toMatchObject({ target: null, unknown: true });
    const row = a.rows.find((r) => r.layer === 'X1')!;
    expect(row.colorMatch?.level).toBe('ambiguous');
    expect([row.colorMatch?.landUse, row.colorMatch?.alt?.landUse].sort()).toEqual(['Đất cây xanh sử dụng hạn chế', 'Đất văn hóa']);
  });

  it('counts the hatches whose label names another land use', () => {
    const d = doc([TITLE, poly('K', sq(X0 + 100, Y0 + 100, 200), O), text('KHU THƯƠNG MẠI DỊCH VỤ', [X0 + 200, Y0 + 200])]);
    const a = analyzeDrawings(parsed(d), 7);
    expect(a.rows.find((r) => r.layer === 'K' && r.kind === 'A')?.labelConflicts).toBe(1);
  });
});

describe('templates with colour', () => {
  const d = doc([TITLE, poly('DAT_NN_Tronglua', sq(X0 + 100, Y0 + 100, 100), LUA), poly('DAT_NN_Tronglua', sq(X0 + 300, Y0 + 100, 100), O)]);
  const a = analyzeDrawings(parsed(d), 7);

  it('saves and reapplies a rule for one colour only', () => {
    const base = initialMapping(a, null);
    const key = rowKey('d1', 'DAT_NN_Tronglua', 'A', 'c' + O.slice(1));
    base.set(key, { target: LAND_USE, phanLoai: 'Đất công cộng', source: 'manual', reason: '' });
    const decisions = templateDecisions(a.drawings, a.rows, base);
    const mine = decisions.filter((r) => r.layer === 'datnntronglua');
    expect(mine.map((r) => r.color).sort()).toEqual([LUA, O].sort());
    const next = initialMapping(a, mergeTemplate(emptyTemplate(), decisions));
    expect(next.get(key)).toMatchObject({ phanLoai: 'Đất công cộng', source: 'template' });
    expect(next.get(rowKey('d1', 'DAT_NN_Tronglua', 'A', 'c' + LUA.slice(1)))?.phanLoai).toBe('Đất trồng lúa');
  });

  it('an old template (layer only, no colour) still applies to a colour the table cannot decide', () => {
    const amb = doc([TITLE, poly('X1', sq(X0 + 100, Y0 + 100, 100), aciHex(94))]);
    const b = analyzeDrawings(parsed(amb), 2);
    const old = readTemplate({ format: 'ledat-gis-layer-map', version: 1, name: 'cũ', updated: '', rules: [{ role: 'qh-sdd', layer: 'x1', kind: 'A', target: LAND_USE, phanLoai: 'Đất văn hóa' }] });
    expect(initialMapping(b, old).get(rowKey('d1', 'X1', 'A', 'c' + aciHex(94).slice(1)))).toMatchObject({ phanLoai: 'Đất văn hóa', source: 'template' });
  });

  it('readTemplate keeps a valid colour and drops a bad one', () => {
    const t = readTemplate({
      format: 'ledat-gis-layer-map',
      version: 1,
      rules: [
        { role: 'qh-sdd', layer: 'a', kind: 'A', color: '#AABBCC', target: LAND_USE, phanLoai: 'x' },
        { role: 'qh-sdd', layer: 'b', kind: 'A', color: 'red', target: LAND_USE, phanLoai: 'y' },
      ],
    });
    expect(t.rules[0].color).toBe('#aabbcc');
    expect(t.rules[1].color).toBeUndefined();
  });
});
