// "Bản vẽ CAD" of the QGIS project: the summary drawing as GeoPackage layers + their symbology.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildQgs, cadLayerData, inkOnWhite, labelQuadrant, planCadGpkg } from '@/lib/dwg2gdb';
import type { ClassData } from '@/lib/dwg2gdb/features';
import type { CadDocument, CadEntity } from '@/lib/cad/types';

const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [100, 100]], warnings: [] });
const poly = (layer: string, over: Partial<Extract<CadEntity, { kind: 'polyline' }>> = {}): CadEntity => ({
  kind: 'polyline',
  layer,
  color: '#ff0000',
  points: [[0, 0], [10, 0]],
  closed: false,
  ...over,
});
const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('cadLayerData', () => {
  it('lines keep their colour and width in metres; a closed polyline gets its first point again', () => {
    const d = cadLayerData(doc([poly('QH_MangLuoiGiaoThongDuongBo_L_x', { width: 5 }), poly('QH_Nha_A_x', { points: square, closed: true })]));
    expect(d.counts).toMatchObject({ lines: 2, areas: 0, texts: 0 });
    const f = JSON.parse(d.json.lines!).features;
    expect(f[0].properties).toMatchObject({ mau: '#ff0000', rong: 5 });
    expect(f[0].geometry.coordinates).toHaveLength(2);
    expect(f[1].properties.rong).toBe(0);
    expect(f[1].geometry.coordinates).toHaveLength(5);
    expect(f[1].geometry.coordinates[4]).toEqual(f[1].geometry.coordinates[0]);
  });

  it('leaves out the land-use hatches (the geodatabase layers draw them) and keeps the other areas', () => {
    const area = (layer: string): CadEntity => ({ kind: 'polygon', layer, color: '#00ff00', fillOpacity: 0.5, rings: [square] });
    const d = cadLayerData(doc([area('QH_ChucNangSuDungDat_A_Đất ở'), area('HT_ChucNangSuDungDat_A_Đất ở'), area('QH_CongTrinhCBKT_P_Hố ga')]));
    expect(d.counts.areas).toBe(1);
    expect(JSON.parse(d.json.areas!).features[0].properties).toMatchObject({ lop: 'QH_CongTrinhCBKT_P_Hố ga', cach: 0 });
  });

  it('a pattern hatch gives its angle and spacing across the lines, and its colour is listed', () => {
    const e: CadEntity = {
      kind: 'polygon',
      layer: 'QH_x',
      color: '#00ff00',
      fillOpacity: 0.35,
      rings: [square],
      hatch: { angle: 45, scale: 1, double: false, type: 1, lines: [{ angle: 45, base: [0, 0], offset: [0, 2], dashes: [] }] },
    };
    const d = cadLayerData(doc([e, e]));
    const p = JSON.parse(d.json.areas!).features[0].properties;
    expect(p.goc).toBe(45);
    // offset (0, 2) measured across lines at 45°: 2·cos 45°
    expect(p.cach).toBeCloseTo(1.414, 2);
    expect(d.patternColors).toEqual(['#00ff00']);
  });

  it('texts carry height, rotation and the label quadrant of their alignment', () => {
    const t: CadEntity = { kind: 'text', layer: 'QH_Chu_x', color: '#00ffff', text: 'kênh', position: [5, 5], height: 3, rotation: 15, hAlign: 'left', vAlign: 'baseline' };
    const d = cadLayerData(doc([t, { ...t, text: '  ' }]));
    expect(d.counts.texts).toBe(1);
    expect(JSON.parse(d.json.texts!).features[0].properties).toMatchObject({ chu: 'kênh', cao: 3, goc: 15, canh: 2, mau: '#00ffff' });
    expect(labelQuadrant('center', 'middle')).toBe(4);
    expect(labelQuadrant('right', 'top')).toBe(6);
  });

  it('white and near-white greys are black on the white sheet; other colours stay', () => {
    expect(inkOnWhite('#ffffff')).toBe('#18181b');
    expect(inkOnWhite('#fafafa')).toMatch(/^#18/);
    expect(inkOnWhite('#ffdf7f')).toBe('#ffdf7f');
    expect(inkOnWhite('#ff0000')).toBe('#ff0000');
  });

  it('the plan writes one GPKG table per layer, the first creating the file', () => {
    const d = cadLayerData(doc([poly('a'), { kind: 'point', layer: 'p', color: '#000000', position: [1, 1] }]));
    const plan = planCadGpkg(d, 'WKT');
    expect(plan.steps.map((s) => s.args[s.args.indexOf('-nln') + 1])).toEqual(['cad_duong', 'cad_diem']);
    expect(plan.steps[0].args).not.toContain('-update');
    expect(plan.steps[1].args).toContain('-update');
    expect(plan.steps.every((s) => s.out === 'BanVeCAD' && s.args.includes('GPKG'))).toBe(true);
  });
});

describe('the project with the CAD drawing', () => {
  const feature = { tenDoiTuong: 'x', phanLoai: 'x', ghiChu: null, refs: [], geometry: { type: 'Point', coordinates: [0, 0] } } as never;
  const cls = (over: Partial<ClassData>): ClassData => ({ target: 'QuyHoach/d/c', db: 'QuyHoach', dataset: 'd', cls: 'c', geom: 'A', features: [feature], styles: [], ...over });
  const classes = [cls({ cls: 'ChucNangSuDungDat_A' }), cls({ cls: 'MangLuoiGiaoThongDuongBo_L', geom: 'L' }), cls({ cls: 'CaoDoNen_P', geom: 'P' })];
  const base = { name: 'T', title: 'T', classes, lon0: 105.5, zone: 3 as const, extent: [0, 0, 1, 1] as [number, number, number, number] };
  const cad = { counts: { lines: 3, areas: 2, texts: 5, points: 0 }, patternColors: ['#00ff00', '#112233'] };

  it('adds the group on top with data-defined symbology, and unchecks the layers it repeats', () => {
    const qgs = buildQgs({ ...base, cad });
    createRequire(import.meta.url)('sax').parser(true).write(qgs).close();
    expect(qgs).toContain('layer-tree-group name="Bản vẽ CAD"');
    expect(qgs).toContain('./BanVeCAD.gpkg|layername=cad_duong');
    expect(qgs).toContain('./BanVeCAD.gpkg|layername=cad_chu');
    expect(qgs).not.toContain('layername=cad_diem'); // no points: no layer
    // Width in map units from the field, colour from the field.
    expect(qgs).toMatch(/name="outlineWidth" type="Map"><Option name="active" value="true" type="bool"\/><Option name="field" value="rong"/);
    // One pattern rule per colour, with a fixed line colour.
    expect(qgs).toContain('&quot;cach&quot; &gt; 0 AND &quot;mau&quot; = &apos;#00ff00&apos;');
    expect(qgs).toContain('&quot;cach&quot; &gt; 0 AND &quot;mau&quot; = &apos;#112233&apos;');
    // Texts: size from the height, rotation, alignment.
    expect(qgs).toContain('&quot;cao&quot; * 1.4');
    expect(qgs).toContain('name="LabelRotation"');
    expect(qgs).toContain('name="OffsetQuad"');
    // Land use stays on; the line layer and the labelled point layer are unchecked.
    expect(qgs).toMatch(/id="QuyHoach_ChucNangSuDungDat_A_d"[^>]*checked="Qt::Checked"/);
    expect(qgs).toMatch(/id="QuyHoach_MangLuoiGiaoThongDuongBo_L_d"[^>]*checked="Qt::Unchecked"/);
    expect(qgs).toMatch(/id="QuyHoach_CaoDoNen_P_d"[^>]*checked="Qt::Unchecked"/);
  });

  it('without the CAD drawing the project is as before', () => {
    const qgs = buildQgs(base);
    expect(qgs).not.toContain('BanVeCAD');
    expect(qgs).toMatch(/id="QuyHoach_MangLuoiGiaoThongDuongBo_L_d"[^>]*checked="Qt::Checked"/);
  });
});
