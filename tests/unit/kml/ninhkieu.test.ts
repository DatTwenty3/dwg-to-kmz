// Real fixture: DWG → IR → KML → IR (import) and DWG → IR → DXF → IR (re-parse).
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg, parseDxf } from '@/lib/cad';
import type { CadDocument, TextEntity } from '@/lib/cad/types';
import { buildKml, toDxf } from '@/lib/export';
import { suggestCrs, transformDocument } from '@/lib/geo';
import { parseKmlString } from '@/lib/kml';
import { FIXTURE_DWG, WASM_DIR } from '../fixtures';

describe('Ninh Kiều fixture', () => {
  let raw: CadDocument;
  let wgs: CadDocument;

  beforeAll(async () => {
    const buf = readFileSync(FIXTURE_DWG);
    raw = await parseDwg(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { wasmBaseUrl: WASM_DIR });
    wgs = transformDocument(raw, suggestCrs(raw, 'can-tho')[0].crs);
  });

  it('KML export re-imports quickly with the same placemark count', () => {
    const { kml, placemarks } = buildKml(wgs, { name: 'Ninh Kiều', textAsLabels: true, tableAsHtml: true });
    const t0 = performance.now();
    const back = parseKmlString(kml);
    const ms = performance.now() - t0;
    console.log(`KML ${(kml.length / 1e6).toFixed(1)} MB, ${placemarks} placemarks, parse ${ms.toFixed(0)} ms, ${back.entities.length} entities`);
    // texts + points (+ polygons / polylines) all come back; named point placemarks make at most 1 entity each.
    expect(back.entities.length).toBeGreaterThanOrEqual(placemarks - 5);
    expect(ms).toBeLessThan(1500);
    const texts = back.entities.filter((e): e is TextEntity => e.kind === 'text').map((t) => t.text);
    expect(texts).toContain('ĐẤT TRƯỜNG MẦM NON');
    expect(back.layers.some((l) => l.name === 'NKIEU-KT-QHCT_Đất quân sự')).toBe(true);
  });

  it('DXF export re-parses with our reader (entity counts preserved)', async () => {
    const t0 = performance.now();
    const dxf = toDxf(raw, { units: 'm', layers: raw.layers.map((l) => l.name) });
    const ms = performance.now() - t0;
    if (process.env.KEEP_DXF) writeFileSync(process.env.KEEP_DXF, dxf, 'utf8');
    const bytes = new TextEncoder().encode(dxf);
    console.log(`DXF ${(bytes.length / 1e6).toFixed(1)} MB written in ${ms.toFixed(0)} ms`);
    const back = await parseDxf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { wasmBaseUrl: '' });
    const count = (d: CadDocument, k: string): number => d.entities.filter((e) => e.kind === k).length;
    expect(count(back, 'polygon')).toBe(count(raw, 'polygon'));
    expect(count(back, 'point')).toBe(count(raw, 'point'));
    expect(count(back, 'text')).toBe(count(raw, 'text'));
    expect(count(back, 'polyline')).toBe(count(raw, 'polyline'));
    const rawTexts = new Set(raw.entities.filter((e): e is TextEntity => e.kind === 'text').map((t) => t.text.replace(/\s*\n\s*/g, ' ').trim()));
    const backTexts = back.entities.filter((e): e is TextEntity => e.kind === 'text').map((t) => t.text.replace(/\s*\n\s*/g, ' ').trim());
    expect(backTexts.filter((t) => !rawTexts.has(t)).slice(0, 5)).toEqual([]);
  });
});
