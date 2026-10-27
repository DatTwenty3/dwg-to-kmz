// previewSvg draws a text the way its CAD justification says (the picture the person checks is this one).
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { previewSvg } from '@/lib/dwg2gdb';

const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [1000, 1000]], warnings: [] });
const text = (hAlign: 'left' | 'center' | 'right', vAlign: 'baseline' | 'middle' | 'top' | 'bottom'): CadEntity => ({ kind: 'text', layer: '0', color: '#000000', text: 'QL54', position: [500, 500], height: 60, rotation: 0, hAlign, vAlign });

describe('previewSvg text', () => {
  it('a centred text is anchored at its middle, a right-aligned one at its end, a left one at its start', () => {
    expect(previewSvg(doc([text('center', 'baseline')]), { px: 1000 }).svg).toContain('text-anchor="middle"');
    expect(previewSvg(doc([text('right', 'baseline')]), { px: 1000 }).svg).toContain('text-anchor="end"');
    expect(previewSvg(doc([text('left', 'baseline')]), { px: 1000 }).svg).toContain('text-anchor="start"');
  });
  it('the height is the capital height (font size 1/0.716 of it) and a middle-aligned text is lowered by half of it', () => {
    const svg = previewSvg(doc([text('center', 'middle')]), { px: 1000 }).svg;
    const size = Number(/font-size="([\d.]+)"/.exec(svg)![1]);
    expect(size).toBeCloseTo(60 / 0.716, 0);
    expect(Number(/dy="([-\d.]+)"/.exec(svg)![1])).toBeCloseTo(0.358 * size, 0);
    expect(/dy="0.0"/.test(previewSvg(doc([text('center', 'baseline')]), { px: 1000 }).svg)).toBe(true);
  });
});
