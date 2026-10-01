import { describe, expect, it } from 'vitest';
import { applyLayerStyles } from '@/lib/cad/style';
import type { CadDocument } from '@/lib/cad/types';

const doc: CadDocument = {
  units: 'm',
  crs: null,
  layers: [
    { name: 'Đường', color: '#ff0000', visible: true },
    { name: 'Đất ở', color: '#00ff00', visible: true },
  ],
  entities: [
    { kind: 'polyline', layer: 'Đường', color: '#ff0000', points: [[0, 0], [1, 1]], closed: false },
    { kind: 'polygon', layer: 'Đất ở', color: '#00ff00', fillOpacity: 0.35, rings: [[[0, 0], [1, 0], [1, 1]]] },
    { kind: 'text', layer: 'Đất ở', color: '#123456', text: 'ĐẤT Ở', position: [0, 0], height: 3, rotation: 0, hAlign: 'left', vAlign: 'baseline' },
  ],
  bbox: [[0, 0], [1, 1]],
  warnings: [],
};

describe('applyLayerStyles', () => {
  it('returns the same document when nothing is styled', () => {
    expect(applyLayerStyles(doc, {})).toBe(doc);
    expect(applyLayerStyles(doc, { 'Đường': {} })).toBe(doc);
  });

  it('recolours every entity of the layer, sets fill opacity and carries width/dash on the layer', () => {
    const out = applyLayerStyles(doc, { 'Đất ở': { color: '#0000ff', fillOpacity: 0.8, width: 3, dash: 'dashed' } });
    const layer = out.layers.find((l) => l.name === 'Đất ở')!;
    expect(layer.color).toBe('#0000ff');
    expect(layer.style).toEqual({ color: '#0000ff', fillOpacity: 0.8, width: 3, dash: 'dashed' });
    expect(out.entities[1]).toMatchObject({ color: '#0000ff', fillOpacity: 0.8 });
    expect(out.entities[2]).toMatchObject({ color: '#0000ff' });
    // Untouched layer keeps identity.
    expect(out.entities[0]).toBe(doc.entities[0]);
    expect(out.layers[0]).toBe(doc.layers[0]);
    // Input not mutated.
    expect(doc.entities[1]).toMatchObject({ color: '#00ff00', fillOpacity: 0.35 });
  });
});
