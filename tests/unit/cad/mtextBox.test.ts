// An MTEXT carries the size of its text block (DWG extentsWidth/extentsHeight, DXF groups 42/43): the IR keeps it as `box`.
import { describe, expect, it } from 'vitest';
import type { DwgDatabase } from '@mlightcad/libredwg-web';
import { buildDocument } from '@/lib/cad/normalize/build';
import { dwgToSource } from '@/lib/cad/dwg';
import type { TextEntity } from '@/lib/cad/types';

const fakeDb = (entities: unknown[], blocks: unknown[] = []): DwgDatabase =>
  ({ header: {}, tables: { BLOCK_RECORD: { entries: [{ name: '*Model_Space', handle: 1, entities }, ...blocks] }, LAYER: { entries: [] }, STYLE: { entries: [] } }, entities }) as unknown as DwgDatabase;
const meta = { errorCode: 0, codepage: undefined, version: 'AC1021' };
const mtext = (extra: Record<string, unknown> = {}) => ({
  type: 'MTEXT', layer: '0', handle: 5, text: 'KHU TÁI ĐỊNH CƯ', styleName: 'Standard', insertionPoint: { x: 100, y: 200, z: 0 }, textHeight: 20, attachmentPoint: 1, rectWidth: 332, ...extra,
});
const textsOf = async (db: DwgDatabase) => (await buildDocument(dwgToSource(db, meta), {})).entities.filter((e): e is TextEntity => e.kind === 'text');

describe('MTEXT block size', () => {
  it('DWG: extentsWidth × extentsHeight become `box` (not the wrapping width)', async () => {
    const [t] = await textsOf(fakeDb([mtext({ extentsWidth: 300.5, extentsHeight: 62.9 })]));
    expect(t.box).toEqual({ w: 300.5, h: 62.9 });
  });

  it('no extents in the file: no box (the size is estimated from the height)', async () => {
    const [t] = await textsOf(fakeDb([mtext()]));
    expect(t.box).toBeUndefined();
  });

  it('the block size is scaled with the INSERT that holds the text', async () => {
    const block = { name: 'B', handle: 9, entities: [mtext({ extentsWidth: 100, extentsHeight: 40 })] };
    const ins = { type: 'INSERT', layer: '0', handle: 7, name: 'B', insertionPoint: { x: 0, y: 0, z: 0 }, xScale: 2, yScale: 2, rotation: 0, columnCount: 1, rowCount: 1 };
    const [t] = await textsOf(fakeDb([ins], [block]));
    expect(t.box).toEqual({ w: 200, h: 80 });
  });
});
