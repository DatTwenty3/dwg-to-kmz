// End-to-end over the real fixture: DWG → IR → CRS suggestion → WGS84 → KML/KMZ.
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import type { CadDocument, TextEntity } from '@/lib/cad/types';
import { toKml, toKmzBytes } from '@/lib/export';
import { checkLocation, suggestCrs, transformDocument } from '@/lib/geo';
import { VNI_LEFTOVER_RE } from '@/lib/text';
import { FIXTURE_DWG, WASM_DIR } from './fixtures';

describe('pipeline on the Ninh Kiều fixture', () => {
  let raw: CadDocument;
  let wgs: CadDocument;

  beforeAll(async () => {
    const buf = readFileSync(FIXTURE_DWG);
    raw = await parseDwg(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { wasmBaseUrl: WASM_DIR });
    const [best] = suggestCrs(raw, 'can-tho');
    wgs = transformDocument(raw, best.crs);
  });

  it('auto-selects VN-2000 KTT 105° and lands in Ninh Kiều', () => {
    const [best] = suggestCrs(raw, 'can-tho');
    expect(best.crs.proj4).toContain('+lon_0=105 ');
    const [[x0, y0], [x1, y1]] = wgs.bbox;
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    expect(cx).toBeGreaterThan(105.68);
    expect(cx).toBeLessThan(105.82);
    expect(cy).toBeGreaterThan(9.97);
    expect(cy).toBeLessThan(10.08);
    expect(checkLocation(wgs, 'can-tho').ok).toBe(true);
  });

  it('has no false "VNI chưa trọn" warnings and no leftover VNI text', () => {
    expect(wgs.warnings.filter((w) => w.includes('chưa trọn'))).toEqual([]);
    const texts = wgs.entities.filter((e): e is TextEntity => e.kind === 'text').map((t) => t.text);
    expect(texts.filter((t) => VNI_LEFTOVER_RE.test(t))).toEqual([]);
    expect(texts).toContain('ĐẤT TRƯỜNG MẦM NON');
  });

  it('exports KMZ with Vietnamese labels and layer folders', async () => {
    const opts = { name: 'Ninh Kiều', textAsLabels: true, tableAsHtml: true };
    const kml = toKml(wgs, opts);
    expect(kml).toContain('ĐẤT TRƯỜNG MẦM NON');
    expect(kml).toContain('<name>NKIEU-KT-QHCT_Đất quân sự</name>');
    const zip = await JSZip.loadAsync(await toKmzBytes(wgs, opts));
    expect(await zip.file('doc.kml')!.async('string')).toBe(kml);
  });
});
