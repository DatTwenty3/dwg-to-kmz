import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import { VNI_LEFTOVER_RE } from '@/lib/text';
import { dwgToSource, loadLibreDwg, readDwg } from '@/lib/cad/dwg';
import type { SrcDocument } from '@/lib/cad/normalize';
import type { CadDocument, TextEntity } from '@/lib/cad/types';
import { FIXTURE_DWG, WASM_DIR } from '../fixtures';

function fixture(): ArrayBuffer {
  const buf = readFileSync(FIXTURE_DWG);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Leftover VNI marks after decoding (plain Ù/Õ are valid Vietnamese). */
const VNI_LEFTOVER = VNI_LEFTOVER_RE;

describe('DWG adapter on the real fixture (model space only)', () => {
  let src: SrcDocument;
  beforeAll(async () => {
    const lib = await loadLibreDwg(WASM_DIR);
    const r = readDwg(lib, fixture());
    expect(r.errorCode).toBe(68); // non-critical (< 128)
    expect(r.version).toBe('AC1021');
    src = dwgToSource(r.db, r);
  });

  it('keeps only *Model_Space entities (paper space excluded)', () => {
    const count: Record<string, number> = {};
    for (const e of src.entities) {
      const k = e.type === 'unsupported' ? e.name : e.type;
      count[k] = (count[k] ?? 0) + 1;
    }
    // 8643 model-space objects in libredwg: HATCH 1892, LWPOLYLINE 4541 + POLYLINE2D 5, TEXT 707 + MTEXT 7,
    // INSERT 1180 (their 2454 visible ATTRIBs become texts), LINE 111, POINT 93, ARC 79, CIRCLE 25, OLE2FRAME 1, WIPEOUT 2.
    expect(count).toEqual({
      hatch: 1892,
      polyline: 4546,
      text: 707 + 7 + 2454,
      insert: 1180,
      line: 111,
      point: 93,
      arc: 79,
      circle: 25,
      OLE2FRAME: 1,
      WIPEOUT: 2,
    });
    expect(src.warnings.some((w) => w.includes('1301') && w.includes('Paper Space'))).toBe(true);
  });

  it('reads units, layers, blocks and styles', () => {
    expect(src.units).toBe('m');
    expect(src.layers).toHaveLength(366);
    expect(src.layers.map((l) => l.name)).toContain('NKIEU-KT-QHCT_Đất quân sự');
    expect(src.blocks.size).toBe(44);
    expect(src.styles.has('AVO-DAM')).toBe(true);
    expect(src.legacyBytes).toBe(false); // R2007: strings are already Unicode
  });
});

describe('parseDwg on the real fixture', () => {
  let doc: CadDocument;
  let ms = 0;
  beforeAll(async () => {
    await loadLibreDwg(WASM_DIR); // exclude one-time WASM compile from the timing
    const t0 = performance.now();
    doc = await parseDwg(fixture(), { wasmBaseUrl: WASM_DIR });
    ms = performance.now() - t0;
  });

  it('parses + converts within a few seconds', () => {
    expect(ms).toBeLessThan(10_000);
  });

  it('produces drawing-coordinate IR with exploded blocks', () => {
    expect(doc.crs).toBeNull();
    expect(doc.units).toBe('m');
    const kinds: Record<string, number> = {};
    for (const e of doc.entities) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    expect(kinds.polygon).toBeGreaterThanOrEqual(1892);
    expect(kinds.polyline).toBeGreaterThan(4546 + 111 + 79 + 25);
    expect(kinds.text).toBeGreaterThanOrEqual(707 + 7 + 2454);
    expect(kinds.point).toBe(93);
    expect(kinds.table).toBeUndefined();
  });

  it('robust bbox lies in Ninh Kiều (ignores the bogus header extents)', () => {
    const [[x0, y0], [x1, y1]] = doc.bbox;
    expect(x0).toBeGreaterThan(560_000);
    expect(x1).toBeLessThan(590_000);
    expect(y0).toBeGreaterThan(1_090_000);
    expect(y1).toBeLessThan(1_120_000);
    // nothing from paper space (title block near 0,0)
    expect(doc.entities.some((e) => e.kind === 'point' && Math.abs(e.position[0]) < 10_000)).toBe(false);
  });

  it('lists all 366 layers with Unicode names and resolved colours', () => {
    expect(doc.layers.length).toBeGreaterThanOrEqual(366);
    const qs = doc.layers.find((l) => l.name === 'NKIEU-KT-QHCT_Đất quân sự');
    expect(qs?.color).toMatch(/^#[0-9a-f]{6}$/);
    for (const e of doc.entities.slice(0, 500)) expect(e.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('warns about unsupported types and the non-critical libredwg error', () => {
    expect(doc.warnings.some((w) => w.includes('mã lỗi 68'))).toBe(true);
    expect(doc.warnings.some((w) => w.includes('WIPEOUT'))).toBe(true);
    expect(doc.warnings.some((w) => w.includes('OLE2FRAME'))).toBe(true);
  });

  it('decodes Vietnamese text (Unicode MTEXT + VNI TEXT/ATTRIB) with no VNI leftovers', () => {
    const texts = doc.entities.filter((e): e is TextEntity => e.kind === 'text').map((t) => t.text);
    expect(texts.some((t) => t.includes('BẢN ĐỒ QUY HOẠCH'))).toBe(true);
    expect(texts).toContain('ĐẤT TRƯỜNG MẦM NON');
    expect(texts.some((t) => t.includes('THỚI BÌNH'))).toBe(true);
    expect(texts.filter((t) => VNI_LEFTOVER.test(t))).toEqual([]);
    for (const t of texts.slice(0, 200)) expect(t).toBe(t.normalize('NFC'));
  });
});
