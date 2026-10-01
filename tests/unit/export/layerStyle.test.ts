import { describe, expect, it } from 'vitest';
import { parseDxf } from '@/lib/cad';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { buildKml, pxToLineweight, toDxf, toKml, type ExportOptions } from '@/lib/export';
import { WASM_DIR } from '../fixtures';
import { checkXml } from './xmlCheck';

const OPTS: ExportOptions = { name: 't', textAsLabels: true, tableAsHtml: false };
const line = (layer: string, color = '#ff0000'): CadEntity => ({
  kind: 'polyline',
  layer,
  color,
  points: [[105.7, 10], [105.71, 10.01]],
  closed: false,
});

function kmlDoc(): CadDocument {
  return {
    units: 'm',
    crs: 'x',
    layers: [
      { name: 'A', color: '#ff0000', visible: true, style: { width: 3.26, dash: 'dashed' } },
      { name: 'B', color: '#ff0000', visible: true, style: { width: 3.2 } },
      { name: 'C', color: '#ff0000', visible: true, style: { width: 99, dash: 'dotted' } },
      { name: 'D', color: '#ff0000', visible: true },
    ],
    entities: [
      line('A'),
      line('B'),
      line('C'),
      line('D'),
      { kind: 'polygon', layer: 'A', color: '#00ff00', fillOpacity: 0.5, rings: [[[105.7, 10], [105.71, 10], [105.71, 10.01]]] },
    ],
    bbox: [[105.7, 10], [105.71, 10.01]],
    warnings: [],
  };
}

describe('KML layer style', () => {
  it('uses style.width (clamped, 1 decimal), dedupes shared styles, notes dashes', () => {
    const r = buildKml(kmlDoc(), OPTS);
    checkXml(r.kml);
    const widths = [...r.kml.matchAll(/<LineStyle><color>[0-9a-f]{8}<\/color><width>([\d.]+)<\/width>/g)].map((m) => m[1]);
    // A: 3.3, B: 3.2, C: clamp 20, D: default 1; polygon outline in A: 3.3 (new style)
    expect(new Set(widths)).toEqual(new Set(['3.3', '3.2', '20', '1']));
    // A line and B line differ; the style for A line is shared, so only 1 LineStyle with 3.3 + red
    expect(widths.filter((w) => w === '3.3').length).toBe(2); // line style + polygon style
    expect(r.notes).toEqual(['KML không hỗ trợ nét đứt — 2 layer xuất thành nét liền']);
  });

  it('is unchanged without styles and has no notes', () => {
    const doc = kmlDoc();
    doc.layers = doc.layers.map((l) => ({ name: l.name, color: l.color, visible: l.visible }));
    const r = buildKml(doc, OPTS);
    expect(r.notes).toEqual([]);
    expect(toKml(doc, OPTS)).toBe(r.kml);
    expect(r.kml).not.toContain('<width>3');
  });
});

function dxfDoc(styled: boolean): CadDocument {
  const st = (s: object) => (styled ? { style: s } : {});
  return {
    units: 'm',
    crs: null,
    layers: [
      { name: 'L-DASH', color: '#ff0000', visible: true, ...st({ dash: 'dashed', width: 2 }) },
      { name: 'L-DOT', color: '#00ff00', visible: true, ...st({ dash: 'dotted' }) },
      { name: 'L-DD', color: '#0000ff', visible: true, ...st({ dash: 'dashdot', width: 0.5 }) },
      { name: 'L-SOL', color: '#ffff00', visible: true, ...st({ dash: 'solid', width: 20 }) },
    ],
    entities: ['L-DASH', 'L-DOT', 'L-DD', 'L-SOL'].map((l, i) => ({
      kind: 'polyline' as const,
      layer: l,
      color: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'][i],
      points: [[580000, 1100000 + i * 10], [580100, 1100000 + i * 10]] as [number, number][],
      closed: false,
    })),
    bbox: [[580000, 1100000], [580100, 1100030]],
    warnings: [],
  };
}

/** Parse the LAYER table into name → { ltype (6), weight (370) }. */
function layerRecords(dxf: string): Map<string, { ltype: string; weight: string }> {
  const lines = dxf.split(/\r?\n/);
  const out = new Map<string, { ltype: string; weight: string }>();
  let cur: { name: string; ltype: string; weight: string } | null = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    const val = lines[i + 1].trim();
    if (code === '0') {
      if (cur) out.set(cur.name, cur);
      cur = val === 'LAYER' ? { name: '', ltype: '', weight: '' } : null;
    } else if (cur) {
      if (code === '2') cur.name = val;
      if (code === '6') cur.ltype = val;
      if (code === '370') cur.weight = val;
    }
  }
  return out;
}

describe('DXF layer style', () => {
  it('maps px to the nearest standard lineweight', () => {
    expect(pxToLineweight(1)).toBe(25);
    expect(pxToLineweight(2)).toBe(50);
    expect(pxToLineweight(0.5)).toBe(13);
    expect(pxToLineweight(20)).toBe(211);
    expect(pxToLineweight(0)).toBeUndefined();
    expect(pxToLineweight(undefined)).toBeUndefined();
  });

  it('writes LTYPE records and layer 6 / 370', () => {
    const dxf = toDxf(dxfDoc(true));
    for (const n of ['DASHED', 'DOT', 'DASHDOT']) expect(dxf).toContain(`AcDbLinetypeTableRecord\n2\n${n}\n`);
    const recs = layerRecords(dxf);
    expect(recs.get('L-DASH')).toMatchObject({ ltype: 'DASHED', weight: '50' });
    expect(recs.get('L-DOT')).toMatchObject({ ltype: 'DOT', weight: '0' });
    expect(recs.get('L-DD')).toMatchObject({ ltype: 'DASHDOT', weight: '13' });
    expect(recs.get('L-SOL')).toMatchObject({ ltype: 'Continuous', weight: '211' });
    expect(dxf).toContain('$LWDISPLAY');
  });

  it('scales dash patterns by drawing units', () => {
    const d = dxfDoc(true);
    d.units = 'mm';
    expect(toDxf(d, { units: 'mm' })).toContain('\n49\n2000\n');
  });

  it('re-parses, and unstyled output has no extra linetypes / weights', async () => {
    const dxf = toDxf(dxfDoc(true));
    const back = await parseDxf(new TextEncoder().encode(dxf).buffer as ArrayBuffer, { wasmBaseUrl: WASM_DIR });
    expect(back.entities.filter((e) => e.kind === 'polyline')).toHaveLength(4);
    const plain = toDxf(dxfDoc(false));
    expect(plain).not.toMatch(/DASHED|DASHDOT|\$LWDISPLAY/);
    const recs = layerRecords(plain);
    for (const n of ['L-DASH', 'L-DOT', 'L-DD', 'L-SOL']) expect(recs.get(n)).toMatchObject({ ltype: 'Continuous', weight: '0' });
  });
});
