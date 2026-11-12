// Rectangles that look like the box of a label but are not the exact boundary of an MTEXT: suspects, only suggested to the user.
import { describe, expect, it } from 'vitest';
import type { CadEntity, Vec2 } from '@/lib/cad/types';
import { findLabelBoxes } from '@/lib/dwg2gdb/labelBox';
import { findSuspectBoxes, findSuspectBoxesAcross } from '@/lib/dwg2gdb/suspectBox';

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const hatch = (ring: Vec2[], layer = 'QHDD_DAT_XD_Dato'): CadEntity => ({ kind: 'polygon', layer, color: '#ffcc00', fillOpacity: 0.5, rings: [ring] });
const text = (t: string, x: number, y: number, height = 8, extra: Partial<Extract<CadEntity, { kind: 'text' }>> = {}): CadEntity => ({
  kind: 'text', layer: 'TEXT', color: '#000000', text: t, position: [x, y], height, rotation: 0, hAlign: 'center', vAlign: 'middle', ...extra,
});
const all = (n: number) => new Uint8Array(n).fill(1);
const parcel = hatch([[0, 0], [400, 0], [400, 300], [0, 300]]);
const keys = (m: Map<number, unknown>) => [...m.keys()].sort((a, b) => a - b);

describe('findSuspectBoxes', () => {
  it('a rectangle holding a text, over a bigger parcel, is a suspect (with the text and the rule)', () => {
    const entities = [parcel, hatch(rect(150, 140, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)];
    const found = findSuspectBoxes({ entities }, all(3));
    expect(keys(found)).toEqual([1]);
    expect(found.get(1)).toMatchObject({ text: 'CHỢ XÃ ĐÔN XUÂN A', why: 'fit' });
    expect(Math.round(found.get(1)!.w)).toBe(110);
  });

  it('a box hugging its text with nothing under it is a suspect; a roomy parcel with a small label is not', () => {
    expect(keys(findSuspectBoxes({ entities: [hatch(rect(0, 0, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 55, 12)] }, all(2)))).toEqual([0]);
    expect(findSuspectBoxes({ entities: [hatch(rect(0, 0, 300, 120)), text('CHỢ XÃ', 150, 60)] }, all(2)).size).toBe(0);
  });

  it('a small real parcel whose name is too long for it (the text sticks out) is not a suspect', () => {
    expect(findSuspectBoxes({ entities: [parcel, hatch(rect(190, 140, 15, 13)), text('NHÀ VĂN HÓA ẤP CHỢ MR 0,0235', 197, 146)] }, all(3)).size).toBe(0);
  });

  it('copies, same-size boxes and boxes stacked under a suspect are suspects too, but a bigger rectangle touching it is not', () => {
    const entities = [
      parcel,
      hatch(rect(100, 140, 200, 30)),
      text('KHU TÁI ĐỊNH CƯ KCN ĐỊNH AN', 200, 155, 8),
      hatch(rect(100, 140, 200, 30)), // a copy
      hatch(rect(150, 108, 100, 28)), // 2 m under
      hatch(rect(180, 76, 60, 28)), // 4 m under the second
      hatch(rect(600, 500, 100, 28)), // same size as the second one, far away
      hatch(rect(0, 150, 400, 150)), // bigger than the suspect and touching it
    ];
    const found = findSuspectBoxes({ entities }, all(entities.length));
    expect(keys(found)).toEqual([1, 3, 4, 5, 6]);
    expect(found.get(3)).toBeDefined(); // the same rectangle: sized for the same text as the first
    expect(found.get(6)!.why).toBe('size');
  });

  it('a strip as tall as the box of a text, drawn far from any text, is a suspect (the same height, one drawing)', () => {
    const entities = [parcel, hatch(rect(100, 100, 150, 32)), text('KHU THƯƠNG MẠI DỊCH VỤ KẾT HỢP', 175, 116, 8), hatch(rect(400, 400, 186, 32)), hatch(rect(400, 300, 186, 90))];
    expect(keys(findSuspectBoxes({ entities }, all(entities.length)))).toEqual([1, 3]);
  });

  it('leaves out the exact boundaries of an MTEXT (already left out) and objects outside the planning boundary', () => {
    const entities = [parcel, hatch(rect(150, 140, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)];
    expect(findSuspectBoxes({ entities }, all(3), new Map([[1, 'x']])).size).toBe(0);
    const inside = all(3);
    inside[1] = 0;
    expect(findSuspectBoxes({ entities }, inside).size).toBe(0);
  });

  it('what the exact rule finds is not a suspect', () => {
    const mtext: CadEntity = text('CHỢ XÃ', 100, 126, 8, { hAlign: 'left', vAlign: 'top', box: { w: 70, h: 26 } });
    const entities = [parcel, hatch(rect(97.5, 95.5, 75, 32.5)), mtext];
    const exact = findLabelBoxes({ entities }, all(3));
    expect(keys(exact)).toEqual([1]);
    expect(findSuspectBoxes({ entities }, all(3), exact).size).toBe(0);
  });

  it('works across a map and its xref (the box of the xref, the text of the map)', () => {
    const map = { doc: { entities: [text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)] }, inside: all(1) };
    const xref = { doc: { entities: [parcel, hatch(rect(150, 140, 110, 24))] }, inside: all(2) };
    const [a, b] = findSuspectBoxesAcross([map, xref], [new Map(), new Map()]);
    expect(a.size).toBe(0);
    expect(keys(b)).toEqual([1]);
  });

  it('stays fast with many rectangles', () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 40000; i++) entities.push(hatch(rect((i % 200) * 30, Math.floor(i / 200) * 30, 25, 25)));
    for (let i = 0; i < 2000; i++) entities.push(text('A', (i % 50) * 120 + 2, Math.floor(i / 50) * 120 + 20));
    const t0 = Date.now();
    findSuspectBoxes({ entities }, all(entities.length));
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});
