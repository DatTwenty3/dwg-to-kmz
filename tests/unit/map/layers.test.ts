import { describe, expect, it } from 'vitest';
import type { PathLayer, TextLayer } from '@deck.gl/layers';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { WGS84_PROJ4 } from '@/lib/geo';
import {
  buildLayers,
  CAP_HEIGHT_RATIO,
  documentBounds,
  hexToRgba,
  pathWidthPx,
  prepareDocument,
  TextSizeCullExtension,
  TileErrorMonitor,
  visibleData,
  type PathItem,
  type TextItem,
} from '@/lib/map';
import { VIETNAMESE_CHARSET } from '@/lib/text';

const LNG = 105.74;
const LAT = 10.01;

function makeDoc(entities: CadEntity[]): CadDocument {
  const layers = [...new Set(entities.map((e) => e.layer))].map((name) => ({ name, color: '#ffffff', visible: true }));
  return {
    units: 'm',
    crs: WGS84_PROJ4,
    layers,
    entities,
    bbox: [
      [LNG - 0.01, LAT - 0.01],
      [LNG + 0.01, LAT + 0.01],
    ],
    warnings: [],
  };
}

const sample = (): CadDocument =>
  makeDoc([
    {
      kind: 'polyline',
      layer: 'Đường',
      color: '#ff0000',
      points: [
        [LNG, LAT],
        [LNG + 0.001, LAT],
        [LNG + 0.001, LAT + 0.001],
      ],
      closed: true,
      handle: 'A1',
    },
    { kind: 'polyline', layer: 'Đường', color: '#00ff00', width: 2, points: [[LNG, LAT], [LNG, LAT + 0.001]], closed: false },
    {
      kind: 'polygon',
      layer: 'Đất ở',
      color: '#ffcc00',
      fillOpacity: 0.5,
      rings: [
        [
          [LNG, LAT],
          [LNG + 0.002, LAT],
          [LNG + 0.002, LAT + 0.002],
        ],
        [
          [LNG + 0.0015, LAT + 0.0003],
          [LNG + 0.0018, LAT + 0.0003],
          [LNG + 0.0018, LAT + 0.0006],
        ],
      ],
      handle: 'B2',
    },
    {
      kind: 'text',
      layer: 'Chữ',
      color: '#ffffff',
      text: 'ĐẤT TRƯỜNG MẦM NON',
      position: [LNG, LAT],
      height: 20,
      rotation: 30,
      hAlign: 'center',
      vAlign: 'middle',
      handle: 'C3',
    },
    {
      kind: 'text',
      layer: 'Chữ',
      color: '#000000',
      text: 'Dòng 1\nDòng 2',
      position: [LNG, LAT],
      height: 5,
      rotation: 0,
      hAlign: 'right',
      vAlign: 'baseline',
    },
    { kind: 'text', layer: 'Chữ', color: '#000000', text: '   ', position: [LNG, LAT], height: 5, rotation: 0, hAlign: 'left', vAlign: 'top' },
    { kind: 'point', layer: 'Điểm', color: '#0000ff', position: [LNG, LAT], handle: 'D4' },
    {
      kind: 'table',
      layer: 'Bảng',
      color: '#ffffff',
      origin: [LNG, LAT],
      rotation: 0,
      rows: 2,
      cols: 3,
      rowHeights: [10, 10],
      colWidths: [20, 30, 40],
      cells: [
        { r: 0, c: 0, rowSpan: 1, colSpan: 2, text: 'Tiêu đề gộp' },
        { r: 0, c: 2, rowSpan: 1, colSpan: 1, text: 'Ấ Ầ Ẩ Ẫ Ậ Ữ' },
        { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: 'a', textHeight: 3 },
      ],
      handle: 'T5',
    },
  ]);

const allVisible = (doc: CadDocument) => new Set(doc.layers.map((l) => l.name));

describe('helpers', () => {
  it('hexToRgba', () => {
    expect(hexToRgba('#ff8000')).toEqual([255, 128, 0, 255]);
    expect(hexToRgba('#ff8000', 128)).toEqual([255, 128, 0, 128]);
    expect(hexToRgba('bad')).toEqual([255, 255, 255, 255]);
  });
  it('pathWidthPx: min 1 px, clamped', () => {
    expect(pathWidthPx(undefined)).toBe(1);
    expect(pathWidthPx(0)).toBe(1);
    expect(pathWidthPx(2)).toBe(3);
    expect(pathWidthPx(100)).toBe(6);
  });
  it('documentBounds rejects non-geographic bbox', () => {
    expect(documentBounds(sample())).toEqual([
      [LNG - 0.01, LAT - 0.01],
      [LNG + 0.01, LAT + 0.01],
    ]);
    const d = sample();
    d.bbox = [
      [580000, 1100000],
      [590000, 1110000],
    ];
    expect(documentBounds(d)).toBeNull();
  });
  it('TileErrorMonitor: > 20 errors in 30 s', () => {
    const m = new TileErrorMonitor();
    let hit = false;
    for (let i = 0; i < 20; i++) hit = m.record(i * 100);
    expect(hit).toBe(false);
    expect(m.record(2100)).toBe(true);
    const m2 = new TileErrorMonitor();
    for (let i = 0; i < 25; i++) hit = m2.record(i * 2000); // spread over 50 s
    expect(hit).toBe(false);
  });
});

describe('prepareDocument', () => {
  it('groups by layer, closes closed polylines, drops empty text', () => {
    const doc = sample();
    const p = prepareDocument(doc);
    expect(p.groups.get('Đường')!.paths).toHaveLength(2);
    const closed = p.groups.get('Đường')!.paths[0];
    expect(closed.path).toHaveLength(4);
    expect(closed.path[3]).toEqual(closed.path[0]);
    expect(closed.width).toBe(1);
    expect(p.groups.get('Đường')!.paths[1].width).toBe(3);
    const g = p.groups.get('Chữ')!;
    expect(g.textsLight).toHaveLength(1);
    expect(g.textsDark).toHaveLength(1);
    expect(p.counts.get('Chữ')).toBe(3);
    expect(prepareDocument(doc)).toBe(p); // cached
  });

  it('maps text alignment, rotation and size (cap height → em)', () => {
    const p = prepareDocument(sample());
    const [t1] = p.groups.get('Chữ')!.textsLight;
    expect(t1.anchor).toBe('middle');
    expect(t1.baseline).toBe('center');
    expect(t1.angle).toBe(30);
    expect(t1.size).toBeCloseTo(20 / CAP_HEIGHT_RATIO);
    expect(t1.text).toBe('ĐẤT TRƯỜNG MẦM NON');
    const [t2] = p.groups.get('Chữ')!.textsDark;
    expect(t2.anchor).toBe('end');
    expect(t2.baseline).toBe('bottom');
    expect(t2.text.split('\n')).toHaveLength(2);
  });

  it('polygon keeps holes and alpha from fillOpacity', () => {
    const [poly] = prepareDocument(sample()).groups.get('Đất ở')!.polygons;
    expect(poly.polygon).toHaveLength(2);
    expect(poly.color[3]).toBe(128);
  });

  it('table → grid rectangles (merged cells) + centred cell texts', () => {
    const g = prepareDocument(sample()).groups.get('Bảng')!;
    // cells: merged (0,0-1), (0,2), (1,0) + uncovered (1,1), (1,2) → 5 rectangles
    expect(g.paths).toHaveLength(5);
    const merged = g.paths.find((p) => p.cell?.text === 'Tiêu đề gộp')!;
    const mpdLng = 111320 * Math.cos((LAT * Math.PI) / 180);
    const widthM = (merged.path[1][0] - merged.path[0][0]) * mpdLng;
    expect(widthM).toBeCloseTo(50, 0);
    // y goes down from the top-left origin
    expect(merged.path[2][1]).toBeLessThan(merged.path[1][1]);
    const texts = [...g.textsLight, ...g.textsDark];
    expect(texts.map((t) => t.text).sort()).toEqual(['a', 'Tiêu đề gộp', 'Ấ Ầ Ẩ Ẫ Ậ Ữ'].sort());
    const a = texts.find((t) => t.text === 'a')!;
    expect(a.size).toBeCloseTo(3 / CAP_HEIGHT_RATIO);
    expect(a.anchor).toBe('middle');
    // centre of cell (1,0): x = 10 m, y = -15 m
    expect((a.position[0] - LNG) * mpdLng).toBeCloseTo(10, 0);
    expect((a.position[1] - LAT) * 110574).toBeCloseTo(-15, 0);
  });

  it('indexes entities by handle for highlight/popup', () => {
    const p = prepareDocument(sample());
    expect(p.byHandle.get('A1')).toHaveLength(1);
    expect(p.byHandle.get('T5')!.length).toBeGreaterThan(5);
  });
});

describe('buildLayers', () => {
  it('creates one layer per kind with stable ids and Vietnamese text settings', () => {
    const doc = sample();
    const layers = buildLayers(doc, { visibleLayers: allVisible(doc) });
    expect(layers.map((l) => l.id)).toEqual(['cad-polygons', 'cad-paths', 'cad-points', 'cad-text-dark', 'cad-text-light']);
    const text = layers.find((l) => l.id === 'cad-text-light') as TextLayer<TextItem>;
    expect(text.props.sizeUnits).toBe('meters');
    expect(text.props.billboard).toBe(false);
    expect(text.props.characterSet).toBe(VIETNAMESE_CHARSET);
    expect(text.props.pickable).toBe(true);
    expect(text.props.extensions[0]).toBeInstanceOf(TextSizeCullExtension);
    const paths = layers.find((l) => l.id === 'cad-paths') as PathLayer<PathItem>;
    expect(paths.props.widthUnits).toBe('pixels');
    expect(paths.props.widthMinPixels).toBe(1);
  });

  it('every Vietnamese character of the sample is in the charset', () => {
    const set = new Set(VIETNAMESE_CHARSET);
    for (const ch of 'ĐẤT TRƯỜNG MẦM NON Ấ Ầ Ẩ Ẫ Ậ Ữ Tiêu đề gộp Dòng') expect(set.has(ch)).toBe(true);
  });

  it('returns identical data arrays for the same visibility (no rebuild on pan/zoom)', () => {
    const doc = sample();
    const vis = allVisible(doc);
    const a = buildLayers(doc, { visibleLayers: vis });
    const b = buildLayers(doc, { visibleLayers: new Set(vis) });
    for (let i = 0; i < a.length; i++) {
      expect(b[i].id).toBe(a[i].id);
      expect(b[i].props.data).toBe(a[i].props.data);
    }
  });

  it('respects visibility and keeps unaffected kinds identical', () => {
    const doc = sample();
    const before = visibleData(doc, allVisible(doc));
    const vis = allVisible(doc);
    vis.delete('Chữ');
    const after = visibleData(doc, vis);
    expect(after.textsDark).toHaveLength(0);
    expect(after.paths).toBe(before.paths);
    const layers = buildLayers(doc, { visibleLayers: vis });
    expect(layers.map((l) => l.id)).not.toContain('cad-text-dark');
    expect(buildLayers(doc, { visibleLayers: new Set() })).toHaveLength(0);
  });

  it('showText=false omits text layers; highlight adds overlay layers', () => {
    const doc = sample();
    const vis = allVisible(doc);
    expect(buildLayers(doc, { visibleLayers: vis, showText: false }).some((l) => l.id.startsWith('cad-text'))).toBe(false);
    const ids = buildLayers(doc, { visibleLayers: vis, highlightHandle: 'C3' }).map((l) => l.id);
    expect(ids).toContain('cad-highlight-points');
    const ids2 = buildLayers(doc, { visibleLayers: vis, highlightHandle: 'B2' }).map((l) => l.id);
    expect(ids2).toContain('cad-highlight-paths');
  });

  it('cull extension injects a size test into the glyph vertex shader', () => {
    const ext = new TextSizeCullExtension({ minEmPixels: 5.714 });
    const shaders = ext.getShaders.call({} as never, ext) as { inject: Record<string, string> };
    expect(shaders.inject['vs:#main-end']).toContain('sizePixels < 5.714');
  });
});
