// loadFolder: a file that is not named like an xref but is loaded as one by another drawing is an xref too
// (synthetic drawings), and the owner's Đôn Châu dossier (not committed — skipped without it).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import type { CadDocument, CadEntity, XrefInsert } from '@/lib/cad/types';
import { analyzeDrawings, loadFolder } from '@/lib/dwg2gdb';
import { WASM_DIR } from '../fixtures';

const line = (layer: string): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[0, 0], [1, 1]], closed: false });
const doc = (entities: CadEntity[], xrefs?: XrefInsert[]): CadDocument => ({
  units: 'm',
  crs: null,
  layers: [],
  entities,
  bbox: [[0, 0], [1, 1]],
  warnings: [],
  ...(xrefs ? { xrefs } : {}),
});
const ins = (name: string): XrefInsert => ({ name, position: [0, 0], scale: [1, 1], rotation: 0 });
const input = (name: string, path = name) => ({ id: path, name, path, size: 100, read: async () => new ArrayBuffer(0) });

describe('xrefs that are not named like xrefs', () => {
  const docs = new Map<string, CadDocument>([
    ['QH05 BAN DO QUY HOACH SU DUNG DAT.dwg', doc([line('A')], [ins('NEN EXREF'), ins('RANH AP XREF')])],
    ['NEN EXREF.dwg', doc([line('NEN'), line('NEN')])],
    ['RANH AP XREF.dwg', doc([line('RANH')])],
  ]);
  const parse = async (f: { name: string }) => docs.get(f.name)!;

  it('become the xrefs of the drawing that loads them', async () => {
    const folder = await loadFolder([input('QH05 BAN DO QUY HOACH SU DUNG DAT.dwg'), input('NEN EXREF.dwg'), input('RANH AP XREF.dwg')], parse);
    expect(folder.drawings.map((d) => `${d.name}|${d.owner?.name ?? '-'}`).sort()).toEqual([
      'NEN EXREF.dwg|QH05 BAN DO QUY HOACH SU DUNG DAT.dwg',
      'QH05 BAN DO QUY HOACH SU DUNG DAT.dwg|-',
      'RANH AP XREF.dwg|QH05 BAN DO QUY HOACH SU DUNG DAT.dwg',
    ]);
    // Their objects take the map kind of the owner and are used with it.
    const a = analyzeDrawings(folder.drawings);
    const used = a.drawings.filter((d) => d.included).map((d) => d.name);
    expect(used).toEqual(expect.arrayContaining(['NEN EXREF.dwg', 'RANH AP XREF.dwg']));
  });

  it('two drawings loading each other are both kept as they are', async () => {
    const both = new Map<string, CadDocument>([
      ['A.dwg', doc([line('A')], [ins('B')])],
      ['B.dwg', doc([line('B')], [ins('A')])],
    ]);
    const folder = await loadFolder([input('A.dwg'), input('B.dwg')], async (f) => both.get(f.name)!);
    expect(folder.drawings.every((d) => !d.owner)).toBe(true);
  });

  it('a referenced drawing that has a map kind of its own stays a drawing', async () => {
    const maps = new Map<string, CadDocument>([
      ['QH02 BAN DO HIEN TRANG.dwg', doc([line('H')])],
      ['QH05 BAN DO QUY HOACH SU DUNG DAT.dwg', doc([line('Q')], [ins('QH02 BAN DO HIEN TRANG')])],
    ]);
    const folder = await loadFolder([input('QH02 BAN DO HIEN TRANG.dwg'), input('QH05 BAN DO QUY HOACH SU DUNG DAT.dwg')], async (f) => maps.get(f.name)!);
    expect(folder.drawings.every((d) => !d.owner)).toBe(true);
  });
});

describe('a development-direction map that holds the land use of a plan without a land-use map', () => {
  const ring = (i: number): [number, number][] => [[i * 10, 0], [i * 10 + 8, 0], [i * 10 + 8, 8], [i * 10, 8]];
  const hatch = (layer: string, i: number): CadEntity => ({ kind: 'polygon', layer, color: '#00ff00', rings: [ring(i)], fillOpacity: 0.5 });
  const title = (t: string): CadEntity => ({ kind: 'text', layer: 'T', color: '#000000', text: t, position: [0, -20], height: 8, rotation: 0, hAlign: 'left', vAlign: 'baseline' });
  const landUse = (n: number) => Array.from({ length: n }, (_, i) => hatch('QHDD_DAT_NN_Tronglua', i));
  const parsed = (name: string, d: CadDocument, id = name) => ({ id, name, path: name, doc: d });

  it('is read as the land-use map (its hatches are land use)', () => {
    const d = doc([title('BẢN ĐỒ ĐỊNH HƯỚNG PHÁT TRIỂN KHÔNG GIAN'), ...landUse(30)]);
    const a = analyzeDrawings([parsed('QH04.dwg', d)]);
    expect(a.drawings[0].role).toBe('qh-sdd');
  });
  it('stays as it is when the dossier has a land-use map of its own, or its hatches are not land use', () => {
    const ktcq = doc([title('BẢN ĐỒ ĐỊNH HƯỚNG PHÁT TRIỂN KHÔNG GIAN'), ...landUse(30)]);
    const sdd = doc([title('BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT ĐẾN NĂM 2050'), ...landUse(30)]);
    expect(analyzeDrawings([parsed('QH04.dwg', ktcq), parsed('QH05.dwg', sdd)]).drawings.find((d) => d.name === 'QH04.dwg')!.role).toBe('qh-ktcq');
    const other = doc([title('BẢN ĐỒ ĐỊNH HƯỚNG PHÁT TRIỂN KHÔNG GIAN'), ...Array.from({ length: 30 }, (_, i) => hatch('TRUC_KHONGGIAN', i))]);
    expect(analyzeDrawings([parsed('QH04.dwg', other)]).drawings[0].role).toBe('qh-ktcq');
  });
  it('its xrefs follow', () => {
    const d = doc([title('BẢN ĐỒ ĐỊNH HƯỚNG PHÁT TRIỂN KHÔNG GIAN'), ...landUse(30)]);
    const x = { ...parsed('NEN.dwg', doc([line('NEN')])), owner: { id: 'QH04.dwg', name: 'QH04.dwg', role: 'qh-ktcq' as const } };
    const a = analyzeDrawings([parsed('QH04.dwg', d), x]);
    expect(a.drawings.map((r) => r.role)).toEqual(['qh-sdd', 'qh-sdd']);
  });
});

const DON_CHAU = 'dwg_to_gdb/DON CHAU';
describe.skipIf(!existsSync(DON_CHAU))('Đôn Châu dossier (real files)', () => {
  it('QH04 loads NEN EXREF and RANH AP XREF as its xrefs', async () => {
    const files = readdirSync(DON_CHAU)
      .filter((n) => /\.dwg$/i.test(n))
      .map((n) => {
        const f = join(DON_CHAU, n);
        return {
          id: n,
          name: n,
          path: n,
          size: statSync(f).size,
          read: async () => {
            const b = readFileSync(f);
            return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
          },
        };
      });
    const folder = await loadFolder(files, (_f, data) => parseDwg(data, { wasmBaseUrl: WASM_DIR }));
    const byName = new Map(folder.drawings.map((d) => [d.name, d]));
    expect(byName.get('NEN EXREF.dwg')?.owner?.name).toBe('QH04 DINHHUONGPHATTRIENDONCHAU.dwg');
    expect(byName.get('RANH AP XREF.dwg')?.owner?.name).toBe('QH04 DINHHUONGPHATTRIENDONCHAU.dwg');
    expect(byName.get('QH04 DINHHUONGPHATTRIENDONCHAU.dwg')?.owner).toBeUndefined();
    const a = analyzeDrawings(folder.drawings);
    expect(a.drawings.filter((d) => d.included)).toHaveLength(3);
    // The only map of the dossier holds the land use of the plan: its hatches are land use, and the xrefs follow.
    expect(a.drawings.map((d) => d.role)).toEqual(['qh-sdd', 'qh-sdd', 'qh-sdd']);
  }, 120_000);
});
