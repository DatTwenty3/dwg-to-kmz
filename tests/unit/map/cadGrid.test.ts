import { describe, expect, it } from 'vitest';
import { BASEMAPS, basemapPaper, buildLayers, drawGridTile, inkForPaper, parseGridUrl } from '@/lib/map';
import type { CadDocument } from '@/lib/cad/types';
import { WGS84_PROJ4 } from '@/lib/geo';
import { GRID_DIVISIONS, GRID_THEMES, gridTileUrl, type GridCanvas } from '@/lib/map/cadGrid';

/** Records what is drawn on a fake canvas. */
function fakeCanvas() {
  const ops: string[] = [];
  const ctx: GridCanvas = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: (x, y, w, h) => ops.push(`fill ${String(ctx.fillStyle)} ${x},${y},${w},${h}`),
    beginPath: () => ops.push('begin'),
    moveTo: () => ops.push('move'),
    lineTo: () => ops.push('line'),
    stroke: () => ops.push(`stroke ${String(ctx.strokeStyle)} ${ctx.lineWidth}`),
  };
  return { ctx, ops };
}

describe('CAD grid sheets', () => {
  it('are listed as basemaps with their paper', () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(expect.arrayContaining(['cad-dark', 'cad-light']));
    expect(basemapPaper('cad-dark')).toBe('dark');
    expect(basemapPaper('cad-light')).toBe('light');
    expect(basemapPaper('google-hybrid')).toBeUndefined();
    expect(parseGridUrl(gridTileUrl('light').replace('{z}/{x}/{y}', '12/3/4'))).toBe('light');
    expect(parseGridUrl('https://mt0.google.com/vt')).toBeNull();
  });

  it('draws the background, 9 minor lines each way and the major edge', () => {
    const { ctx, ops } = fakeCanvas();
    drawGridTile(ctx, 256, 'dark');
    expect(ops[0]).toBe(`fill ${GRID_THEMES.dark.background} 0,0,256,256`);
    expect(ops.filter((o) => o === 'move').length).toBe(2 * (GRID_DIVISIONS - 1) + 2);
    expect(ops).toContain(`stroke ${GRID_THEMES.dark.minor} 1`);
    expect(ops).toContain(`stroke ${GRID_THEMES.dark.major} 1.5`);
  });

  it('draws white objects dark on the white sheet only (like AutoCAD colour 7)', () => {
    expect(inkForPaper([255, 255, 255, 255], 'light')).toEqual([24, 24, 27, 255]);
    expect(inkForPaper([235, 235, 235, 90], 'light')).toEqual([24, 24, 27, 90]);
    // Pale land-use tints keep their colour.
    expect(inkForPaper([255, 255, 153, 90], 'light')).toEqual([255, 255, 153, 90]);
    expect(inkForPaper([255, 204, 230, 90], 'light')).toEqual([255, 204, 230, 90]);
    expect(inkForPaper([255, 0, 0, 255], 'light')).toEqual([255, 0, 0, 255]);
    expect(inkForPaper([255, 255, 255, 255], 'dark')).toEqual([255, 255, 255, 255]);
    expect(inkForPaper([255, 255, 255, 255], undefined)).toEqual([255, 255, 255, 255]);
  });

  it('buildLayers recolours white lines on the white sheet', () => {
    const doc: CadDocument = {
      units: 'm',
      crs: WGS84_PROJ4,
      layers: [{ name: 'L', color: '#ffffff', visible: true }],
      entities: [{ kind: 'polyline', layer: 'L', color: '#ffffff', points: [[105.7, 10], [105.71, 10]], closed: false }],
      bbox: [[105.7, 10], [105.71, 10.01]],
      warnings: [],
    };
    const colorOf = (paper?: 'light' | 'dark') => {
      const layer = buildLayers(doc, { visibleLayers: new Set(['L']), paper }).find((l) => l.id === 'cad-paths')!;
      const props = layer.props as unknown as { data: { color: number[] }[]; getColor: (d: unknown) => number[] };
      return props.getColor(props.data[0]);
    };
    expect(colorOf('light')).toEqual([24, 24, 27, 255]);
    expect(colorOf('dark')).toEqual([255, 255, 255, 255]);
  });
});
