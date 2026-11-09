// A DWG that opens fine in AutoCAD must not be unreadable here because libredwg returned a damaged entity.
// An Phú Tân (QH02): one hatch had 256 undefined entries in its edge list → "Cannot read properties of undefined (reading 'type')".
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DwgDatabase } from '@mlightcad/libredwg-web';
import { parseDwg } from '@/lib/cad';
import { dwgToSource } from '@/lib/cad/dwg';
import { WASM_DIR } from '../fixtures';

const line = { type: 1, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
const fakeDb = (entities: unknown[]): DwgDatabase =>
  ({
    header: {},
    tables: {
      BLOCK_RECORD: { entries: [{ name: '*Model_Space', handle: 1, entities }] },
      LAYER: { entries: [] },
      STYLE: { entries: [] },
    },
    entities,
  }) as unknown as DwgDatabase;
const hatch = (boundaryPaths: unknown[]) => ({ type: 'HATCH', layer: '0', handle: 5, solidFill: 1, patternName: '', boundaryPaths });
const meta = { errorCode: 0, codepage: undefined, version: 'AC1021' };

describe('dwgToSource with damaged entities', () => {
  it('skips undefined edges and paths of a hatch instead of throwing', () => {
    const src = dwgToSource(fakeDb([hatch([{ edges: [line, undefined, null, { ...line, end: { x: 10, y: 10 } }] }, undefined])]), meta);
    const h = src.entities.find((e) => e.type === 'hatch');
    expect(h && h.type === 'hatch' ? h.loops.length : -1).toBe(1);
  });

  it('a hatch whose every edge is unreadable is dropped with a warning, the rest is kept', () => {
    const src = dwgToSource(fakeDb([hatch([{ edges: [undefined, undefined] }]), { type: 'POINT', layer: '0', handle: 6, position: { x: 1, y: 2, z: 0 } }]), meta);
    expect(src.warnings.join('\n')).toMatch(/1 hatch có đường biên/);
    expect(src.entities.some((e) => e.type === 'point')).toBe(true);
  });

  it('an entity that throws is skipped and counted, not fatal', () => {
    const bad = { type: 'LINE', layer: '0', handle: 7, get startPoint(): never { throw new Error('boom'); }, endPoint: { x: 0, y: 0 } };
    const src = dwgToSource(fakeDb([bad, { type: 'POINT', layer: '0', handle: 8, position: { x: 1, y: 2, z: 0 } }]), meta);
    expect(src.warnings.join('\n')).toMatch(/Không chuyển đổi được 1 đối tượng \(LINE ×1\)/);
    expect(src.entities.some((e) => e.type === 'point')).toBe(true);
  });
});

const AN_PHU_TAN = 'dwg/QH02-BAN VE HIEN TRANG SU DUNG DAT AN PHU TAN.dwg';
describe.skipIf(!existsSync(AN_PHU_TAN))('An Phú Tân QH02 (owner file, not committed)', () => {
  it('reads', async () => {
    const b = readFileSync(AN_PHU_TAN);
    const d = await parseDwg(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { wasmBaseUrl: WASM_DIR });
    expect(d.entities.length).toBeGreaterThan(30000);
    expect(d.entities.filter((e) => e.kind === 'polygon').length).toBeGreaterThan(13000);
  });
});
