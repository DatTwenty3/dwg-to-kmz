// buildLayers + province guess on the real Ninh Kiều drawing.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import type { CadDocument } from '@/lib/cad/types';
import { suggestCrs, transformDocument } from '@/lib/geo';
import { buildLayers, documentBounds, guessProvinceFromText, prepareDocument, visibleData } from '@/lib/map';
import { VIETNAMESE_CHARSET } from '@/lib/text';
import { FIXTURE_DWG, WASM_DIR } from '../fixtures';

describe('map layers on the Ninh Kiều fixture', () => {
  let raw: CadDocument;
  let wgs: CadDocument;

  beforeAll(async () => {
    const buf = readFileSync(FIXTURE_DWG);
    raw = await parseDwg(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { wasmBaseUrl: WASM_DIR });
    wgs = transformDocument(raw, suggestCrs(raw, 'can-tho')[0].crs);
  });

  it('guesses Cần Thơ from the drawing text', () => {
    expect(guessProvinceFromText(raw)?.id).toBe('can-tho');
    // and with that province the top candidate is KTT 105° 3° zone
    expect(suggestCrs(raw, guessProvinceFromText(raw)!.id)[0].crs.proj4).toMatch(/\+lon_0=105 .*\+k=0\.9999/);
  });

  it('builds all kinds, bounded in Ninh Kiều', () => {
    const vis = new Set(wgs.layers.filter((l) => l.visible).map((l) => l.name));
    const t0 = performance.now();
    const layers = buildLayers(wgs, { visibleLayers: vis });
    const ms = performance.now() - t0;
    expect(layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(['cad-polygons', 'cad-paths', 'cad-points', 'cad-text-light']),
    );
    const data = visibleData(wgs, vis);
    expect(data.paths.length).toBeGreaterThan(8500);
    expect(data.polygons.length).toBeGreaterThan(2800); // solid + pattern hatches (tinted)
    expect(data.textsLight.length + data.textsDark.length).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(2000);
    const b = documentBounds(wgs)!;
    expect(b[0][0]).toBeGreaterThan(105.5);
    expect(b[1][1]).toBeLessThan(10.2);
  });

  it('every rendered character is in the TextLayer character set', () => {
    const set = new Set(VIETNAMESE_CHARSET);
    const missing = new Set<string>();
    for (const g of prepareDocument(wgs).groups.values())
      for (const t of [...g.textsLight, ...g.textsDark]) for (const ch of t.text) if (ch !== '\n' && !set.has(ch)) missing.add(ch);
    expect([...missing]).toEqual([]);
  });
});
