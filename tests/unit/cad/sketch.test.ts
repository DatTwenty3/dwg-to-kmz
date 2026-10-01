import { describe, expect, it } from 'vitest';
import { mergeDocuments, MERGE_SEP } from '@/lib/cad/merge';
import {
  nextSketchName,
  parseSketchJson,
  sketchToDocument,
  uniqueName,
  WGS84_CRS,
  type SketchFeature,
} from '@/lib/cad/sketch';
import type { CadDocument, PolygonEntity, TextEntity } from '@/lib/cad/types';
import { toDxf, toKml } from '@/lib/export';
import { buildVn2000, projectDocument } from '@/lib/geo';

const line: SketchFeature = {
  id: 's1',
  kind: 'line',
  name: 'Tuyến cấp nước',
  points: [
    [105.74, 10.01],
    [105.75, 10.01],
    [105.75, 10.02],
  ],
  style: { color: '#2563eb', width: 3, dash: 'dashed' },
  label: 'Ống HDPE Ø110',
};
const area: SketchFeature = {
  id: 's2',
  kind: 'polygon',
  name: 'Khu đất đề xuất',
  points: [
    [105.74, 10.0],
    [105.745, 10.0],
    [105.745, 10.005],
    [105.74, 10.005],
  ],
  style: { color: '#e11d48', fillOpacity: 0.4 },
  label: 'ĐẤT Ở MỚI',
};
const pt: SketchFeature = {
  id: 's3',
  kind: 'point',
  name: 'Mốc 1',
  points: [[105.742, 10.003]],
  style: { color: '#16a34a' },
  label: 'Cọc mốc GPS',
};

describe('sketch naming', () => {
  it('numbers new features per kind and keeps names unique', () => {
    expect(nextSketchName('line', ['Đường 1', 'Vùng 1'])).toBe('Đường 2');
    expect(nextSketchName('point', [])).toBe('Điểm 1');
    expect(uniqueName('Mốc', ['Mốc', 'Mốc (2)'])).toBe('Mốc (3)');
    expect(uniqueName('Mốc', ['Mốc'], 'Mốc')).toBe('Mốc');
    expect(uniqueName('  ', [])).toBe('Nét vẽ');
  });
});

describe('sketchToDocument', () => {
  const doc = sketchToDocument([line, area, pt, { ...pt, id: 'x', name: 'Ẩn', hidden: true }]);

  it('makes one styled layer per visible feature, in WGS84', () => {
    expect(doc.crs).toBe(WGS84_CRS);
    expect(doc.layers.map((l) => l.name)).toEqual(['Tuyến cấp nước', 'Khu đất đề xuất', 'Mốc 1']);
    expect(doc.layers[0].style).toMatchObject({ color: '#2563eb', width: 3, dash: 'dashed' });
    expect(doc.bbox[0][0]).toBeCloseTo(105.74);
    expect(doc.bbox[1][1]).toBeCloseTo(10.02);
  });

  it('emits polygon + outline for areas and Vietnamese labels as text', () => {
    const poly = doc.entities.find((e): e is PolygonEntity => e.kind === 'polygon')!;
    expect(poly.fillOpacity).toBe(0.4);
    expect(doc.entities.filter((e) => e.layer === 'Khu đất đề xuất').map((e) => e.kind)).toEqual(['polygon', 'polyline', 'text']);
    const texts = doc.entities.filter((e): e is TextEntity => e.kind === 'text').map((t) => t.text);
    expect(texts).toEqual(['Ống HDPE Ø110', 'ĐẤT Ở MỚI', 'Cọc mốc GPS']);
  });

  it('round-trips through storage JSON and rejects junk', () => {
    expect(parseSketchJson(JSON.stringify([line, area, pt]))).toHaveLength(3);
    expect(parseSketchJson('{bad')).toEqual([]);
    expect(parseSketchJson(JSON.stringify([{ id: 1 }, { ...line, points: [[1, 2]] }]))).toEqual([]);
  });
});

describe('mergeDocuments + export', () => {
  const fileDoc: CadDocument = {
    units: 'deg',
    crs: WGS84_CRS,
    layers: [
      { name: 'Đường', color: '#ff0000', visible: true },
      { name: 'Ẩn đi', color: '#00ff00', visible: true },
    ],
    entities: [
      { kind: 'polyline', layer: 'Đường', color: '#ff0000', points: [[105.73, 10.0], [105.76, 10.03]], closed: false, handle: 'A1' },
      { kind: 'point', layer: 'Ẩn đi', color: '#00ff00', position: [105.7, 10.0], handle: 'B1' },
    ],
    bbox: [[105.7, 10.0], [105.76, 10.03]],
    warnings: ['1 OLE2FRAME bị bỏ qua'],
  };
  const merged = mergeDocuments([
    { name: 'ninh-kieu', doc: fileDoc, visibleLayers: new Set(['Đường']) },
    { name: 'Nét vẽ', doc: sketchToDocument([line, area, pt]) },
  ]);

  it('prefixes layer names per part, keeps only visible layers and styles', () => {
    expect(merged.layers.map((l) => l.name)).toEqual([
      `ninh-kieu${MERGE_SEP}Đường`,
      `Nét vẽ${MERGE_SEP}Tuyến cấp nước`,
      `Nét vẽ${MERGE_SEP}Khu đất đề xuất`,
      `Nét vẽ${MERGE_SEP}Mốc 1`,
    ]);
    expect(merged.layers[1].style?.dash).toBe('dashed');
    expect(merged.entities.some((e) => e.layer.endsWith('Ẩn đi'))).toBe(false);
    expect(merged.entities[0].handle).toBe('0:A1');
    expect(merged.warnings).toEqual(['ninh-kieu: 1 OLE2FRAME bị bỏ qua']);
    expect(merged.bbox[1][0]).toBeCloseTo(105.76);
  });

  it('exports sketches together with the file to KML and DXF (VN-2000)', () => {
    const kml = toKml(merged, { name: 'Gộp', textAsLabels: true, tableAsHtml: false });
    for (const s of ['ninh-kieu – Đường', 'Nét vẽ – Tuyến cấp nước', 'Ống HDPE Ø110', 'ĐẤT Ở MỚI', 'Cọc mốc GPS']) expect(kml).toContain(s);
    const dxf = toDxf(projectDocument(merged, { proj4: buildVn2000(105, 3), swapXY: false, unitScale: 1 }), { units: 'm' });
    expect(dxf).toContain('Cọc mốc GPS');
    expect(dxf).toContain('DASHED');
  });

  it('skips parts in another CRS with a warning', () => {
    const out = mergeDocuments([
      { name: 'a', doc: fileDoc },
      { name: 'b', doc: { ...fileDoc, crs: null } },
    ]);
    expect(out.layers).toHaveLength(2);
    expect(out.warnings.some((w) => w.includes('"b"'))).toBe(true);
  });
});
