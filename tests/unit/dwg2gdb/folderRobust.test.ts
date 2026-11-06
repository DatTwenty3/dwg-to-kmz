// loadFolder / parseDwg must survive what real dossiers do: a single xref-named file dropped on its own
// ("XRED_GIAO THONG.dwg" → "Không có bản vẽ DWG/DXF nào trong thư mục."), one unreadable file among many, and the
// WASM reader that breaks after a few files ("null function or function signature mismatch").
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import { isWasmTrap } from '@/lib/cad/dwg';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { analyzeDrawings, loadFolder } from '@/lib/dwg2gdb';
import { WASM_DIR } from '../fixtures';

const line = (layer: string): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[0, 0], [1, 1]], closed: false });
const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [1, 1]], warnings: [] });
const input = (name: string, path = name) => ({ id: path, name, path, size: 100, read: async () => new ArrayBuffer(0) });

describe('a drop of xref-named files only', () => {
  it('uses them as the drawings, with the map kind their name says', async () => {
    const folder = await loadFolder([input('XRED_GIAO THONG.dwg')], async () => doc([line('DUONG')]));
    expect(folder.drawings).toHaveLength(1);
    expect(folder.drawings[0].owner).toBeUndefined();
    const a = analyzeDrawings(folder.drawings);
    expect(a.drawings[0].role).toBe('qh-gt');
    expect(a.drawings[0].included).toBe(true);
  });

  it('with a normal drawing next to them they stay xrefs nobody uses', async () => {
    const folder = await loadFolder([input('QH06 GIAO THONG.dwg'), input('XRED_GIAO THONG.dwg')], async () => doc([line('A')]));
    expect(folder.drawings.map((d) => d.name)).toEqual(['QH06 GIAO THONG.dwg']);
    expect(folder.unused.map((u) => u.name)).toEqual(['XRED_GIAO THONG.dwg']);
  });
});

describe('an unreadable file', () => {
  it('is reported and skipped, the other files are still read', async () => {
    const parse = async (f: { name: string }) => {
      if (f.name.startsWith('QH05')) throw new Error('null function or function signature mismatch');
      return doc([line('A')]);
    };
    const folder = await loadFolder([input('QH04 DINH HUONG.dwg'), input('QH05 SU DUNG DAT.dwg'), input('QH06 GIAO THONG.dwg')], parse);
    expect(folder.drawings.map((d) => d.name).sort()).toEqual(['QH04 DINH HUONG.dwg', 'QH06 GIAO THONG.dwg']);
    expect(folder.failed).toHaveLength(1);
    expect(folder.failed[0]).toMatch(/^QH05 SU DUNG DAT\.dwg: .*null function/);
  });

  it('every file unreadable → no drawings, all reported', async () => {
    const folder = await loadFolder([input('QH05.dwg')], async () => {
      throw new Error('hỏng');
    });
    expect(folder.drawings).toHaveLength(0);
    expect(folder.failed).toEqual(['QH05.dwg: hỏng']);
  });
});

describe('WASM traps', () => {
  it('are recognised', () => {
    expect(isWasmTrap(new Error('null function or function signature mismatch'))).toBe(true);
    expect(isWasmTrap(new Error('memory access out of bounds'))).toBe(true);
    expect(isWasmTrap(new Error('Không đọc được file DWG (mã lỗi LibreDWG 255).'))).toBe(false);
  });
});

// The owner's Đôn Châu dossier (not committed): reading all its DWG one after another on one WASM instance used to
// break at XRED_GIAO THONG.dwg with "null function or function signature mismatch".
const DON_CHAU = 'dwg/donchault2';
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
describe.skipIf(!existsSync(DON_CHAU))('Đôn Châu dossier read in one go', () => {
  it('reads every DWG, none lost to a broken WASM instance', async () => {
    const files = walk(DON_CHAU).filter((p) => /\.dwg$/i.test(p));
    expect(files.length).toBeGreaterThan(10);
    for (const p of files) {
      const b = readFileSync(p);
      const d = await parseDwg(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { wasmBaseUrl: WASM_DIR });
      expect(d.entities.length, p).toBeGreaterThan(0);
    }
  }, 300_000);
});
