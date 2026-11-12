// The boundary of an MTEXT inside a hatch: a rectangle holding the text block of an MTEXT with a small margin. Nothing else is a label box.
import { describe, expect, it } from 'vitest';
import type { CadEntity, Vec2 } from '@/lib/cad/types';
import { findLabelBoxes, findLabelBoxesAcross, rectangleOf } from '@/lib/dwg2gdb/labelBox';

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const hatch = (ring: Vec2[], layer = 'QHDD_DAT_XD_Dato'): CadEntity => ({ kind: 'polygon', layer, color: '#ffcc00', fillOpacity: 0.5, rings: [ring] });
const outline = (ring: Vec2[], layer = 'QHDD_DAT_XD_Dato'): CadEntity => ({ kind: 'polyline', layer, color: '#ffcc00', points: ring, closed: true });
/** An MTEXT of the given block size, anchored top-left (attachment 1) like the labels of the real drawings. */
const mtext = (t: string, x: number, y: number, box: { w: number; h: number }, height = 8, extra: Partial<Extract<CadEntity, { kind: 'text' }>> = {}): CadEntity => ({
  kind: 'text', layer: 'TEXT', color: '#000000', text: t, position: [x, y], height, rotation: 0, hAlign: 'left', vAlign: 'top', box, ...extra,
});
const all = (n: number) => new Uint8Array(n).fill(1);
// The block of the text: x 100…170, y 100…126 (top-left anchor at (100, 126)); AutoCAD's margins: 2,5 left/right, 4,5 bottom, 2 top.
const block = { w: 70, h: 26 };
const boundary = rect(97.5, 95.5, 75, 32.5);

describe('findLabelBoxes (the boundary of an MTEXT)', () => {
  it('flags the rectangle that is the text block plus a small margin', () => {
    const entities = [hatch(boundary), mtext('TRƯỜNG TH ĐÔN XUÂN A', 100, 126, block)];
    const found = findLabelBoxes({ entities }, all(2));
    expect([...found.keys()]).toEqual([0]);
    expect(found.get(0)).toBe('TRƯỜNG TH ĐÔN XUÂN A');
  });

  it('also a closed outline of 4 corners, and one closed by repeating the first vertex', () => {
    expect([...findLabelBoxes({ entities: [outline(boundary), mtext('CHỢ', 100, 126, block)] }, all(2)).keys()]).toEqual([0]);
    const closedByPoint: CadEntity = { kind: 'polyline', layer: 'X', color: '#fff', points: [...boundary, boundary[0]], closed: false };
    expect([...findLabelBoxes({ entities: [closedByPoint, mtext('CHỢ', 100, 126, block)] }, all(2)).keys()]).toEqual([0]);
  });

  it('follows the anchor of the text: a centred text, and a rectangle turned with a rotated text', () => {
    const centred = [hatch(rect(95, 95, 80, 36)), mtext('CHỢ', 135, 113, block, 8, { hAlign: 'center', vAlign: 'middle' })];
    expect([...findLabelBoxes({ entities: centred }, all(2)).keys()]).toEqual([0]);
    const turned = [hatch([[0, 0], [30, 0], [30, 80], [0, 80]]), mtext('CHỢ', 2.5, 5, block, 8, { rotation: 90 })];
    expect([...findLabelBoxes({ entities: turned }, all(2)).keys()]).toEqual([0]);
  });

  it('does not flag a rectangle much bigger than the text block, or one that does not hold it', () => {
    expect(findLabelBoxes({ entities: [hatch(rect(60, 60, 200, 120)), mtext('CHỢ', 100, 126, block)] }, all(2)).size).toBe(0);
    expect(findLabelBoxes({ entities: [hatch(rect(300, 300, 75, 33)), mtext('CHỢ', 100, 126, block)] }, all(2)).size).toBe(0);
  });

  it('does not flag a rectangle that cuts the text block (the text sticks out of it)', () => {
    expect(findLabelBoxes({ entities: [hatch(rect(110, 100, 75, 26)), mtext('CHỢ', 100, 126, block)] }, all(2)).size).toBe(0);
  });

  it('only an MTEXT counts: a text without its block size frames nothing, and nothing is guessed from the look of the drawing', () => {
    const plain = mtext('CHỢ', 100, 126, block);
    delete (plain as { box?: unknown }).box;
    expect(findLabelBoxes({ entities: [hatch(boundary), plain] }, all(2)).size).toBe(0);
    // no text at all near the same rectangle: a parcel
    expect(findLabelBoxes({ entities: [hatch(boundary)] }, all(1)).size).toBe(0);
    // a real parcel over a bigger one, with a name beside it, is not a box
    const parcel = hatch([[0, 0], [900, 0], [900, 600], [0, 600]]);
    expect(findLabelBoxes({ entities: [parcel, hatch(rect(300, 300, 120, 24)), mtext('NHÀ VĂN HÓA', 305, 360, block)] }, all(3)).size).toBe(0);
  });

  it('ignores objects outside the planning boundary', () => {
    const inside = all(2);
    inside[0] = 0;
    expect(findLabelBoxes({ entities: [hatch(boundary), mtext('CHỢ', 100, 126, block)] }, inside).size).toBe(0);
  });

  it('finds the box of an xref by the text of the map that loads it', () => {
    const map = { doc: { entities: [mtext('CHỢ', 100, 126, block)] }, inside: all(1) };
    const xref = { doc: { entities: [hatch(boundary)] }, inside: all(1) };
    const [a, b] = findLabelBoxesAcross([map, xref]);
    expect(a.size).toBe(0);
    expect([...b.keys()]).toEqual([0]);
  });
});

describe('rectangleOf', () => {
  it('accepts right angles and rejects parallelograms', () => {
    expect(rectangleOf(rect(0, 0, 10, 5))).not.toBeNull();
    expect(rectangleOf([[0, 0], [10, 0], [12, 5], [2, 5]])).toBeNull();
    expect(rectangleOf([[0, 0], [10, 0], [10, 5]])).toBeNull();
  });
});

describe('speed', () => {
  it('stays fast with many rectangles and texts', () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 40000; i++) entities.push(hatch(rect((i % 200) * 30, Math.floor(i / 200) * 30, 25, 25)));
    for (let i = 0; i < 2000; i++) entities.push(mtext('A', (i % 50) * 120 + 2, Math.floor(i / 50) * 120 + 20, { w: 20, h: 12 }));
    const t0 = Date.now();
    findLabelBoxes({ entities }, all(entities.length));
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
