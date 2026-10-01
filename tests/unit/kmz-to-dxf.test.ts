// Reverse pipeline on the real fixture: DWG → KMZ → (read KMZ) → VN-2000 → DXF → (read DXF),
// checking that coordinates come back where the original drawing had them.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg, parseDxf } from '@/lib/cad';
import type { CadDocument, CrsOptions, TextEntity } from '@/lib/cad/types';
import { toDxf, toKmzBytes } from '@/lib/export';
import { buildVn2000, projectDocument, transformDocument } from '@/lib/geo';
import { parseKmlFile } from '@/lib/kml';
import { VNI_LEFTOVER_RE } from '@/lib/text';
import { FIXTURE_DWG, WASM_DIR } from './fixtures';

const VN105: CrsOptions = { proj4: buildVn2000(105, 3), swapXY: false, unitScale: 1 };
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('KMZ → DXF on the Ninh Kiều fixture', () => {
  let raw: CadDocument;
  let back: CadDocument;
  let dxf: string;

  beforeAll(async () => {
    raw = await parseDwg(ab(readFileSync(FIXTURE_DWG)), { wasmBaseUrl: WASM_DIR });
    const kmz = await toKmzBytes(transformDocument(raw, VN105), { name: 'Ninh Kiều', textAsLabels: true, tableAsHtml: true });
    writeFileSync(join(tmpdir(), 'ninh-kieu.kmz'), kmz);
    const fromKmz = await parseKmlFile(ab(kmz), 'ninh-kieu.kmz');
    dxf = toDxf(projectDocument(fromKmz, VN105), { units: 'm' });
    // Kept for manual checks with scripts/verify-dxf-autocad.ps1.
    writeFileSync(join(tmpdir(), 'ninh-kieu-from-kmz.dxf'), dxf, 'utf8');
    back = await parseDxf(ab(Buffer.from(dxf, 'utf8')), { wasmBaseUrl: WASM_DIR });
  });

  it('lands back on the original VN-2000 coordinates (KML keeps 8 decimals ≈ 1 mm)', () => {
    const [[ox0, oy0], [ox1, oy1]] = raw.bbox;
    const [[bx0, by0], [bx1, by1]] = back.bbox;
    expect(Math.max(Math.abs(ox0 - bx0), Math.abs(oy0 - by0), Math.abs(ox1 - bx1), Math.abs(oy1 - by1))).toBeLessThan(1);
    const label = (d: CadDocument) => d.entities.find((e): e is TextEntity => e.kind === 'text' && e.text === 'ĐẤT TRƯỜNG MẦM NON');
    const t0 = label(raw)!;
    const t1 = label(back)!;
    expect(Math.hypot(t0.position[0] - t1.position[0], t0.position[1] - t1.position[1])).toBeLessThan(0.01);
  });

  it('keeps Vietnamese text and layer names, with no VNI leftovers', () => {
    const texts = back.entities.filter((e): e is TextEntity => e.kind === 'text').map((t) => t.text);
    expect(texts).toContain('ĐẤT TRƯỜNG MẦM NON');
    expect(texts.filter((t) => VNI_LEFTOVER_RE.test(t))).toEqual([]);
    expect(back.layers.map((l) => l.name)).toContain('NKIEU-KT-QHCT_Đất quân sự');
    expect(dxf).toContain('arial.ttf');
  });

  it('keeps the drawing\'s own layer "0" as "0" (not renamed to "0_2")', () => {
    const names = back.layers.map((l) => l.name);
    expect(names).toContain('0');
    expect(names).not.toContain('0_2');
    expect(back.entities.some((e) => e.layer === '0')).toBe(true);
  });
});
