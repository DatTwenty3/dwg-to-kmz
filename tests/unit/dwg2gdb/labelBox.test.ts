// Hình chữ nhật người vẽ khoanh quanh một nhãn tên (không phải thửa đất).
import { describe, expect, it } from 'vitest';
import type { CadEntity, Vec2 } from '@/lib/cad/types';
import { findLabelBoxes, rectangleOf } from '@/lib/dwg2gdb/labelBox';

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const hatch = (ring: Vec2[], layer = 'QHDD_DAT_XD_Dato'): CadEntity => ({ kind: 'polygon', layer, color: '#ffcc00', fillOpacity: 0.5, rings: [ring] });
const outline = (ring: Vec2[], layer = 'QHDD_DAT_XD_Dato'): CadEntity => ({ kind: 'polyline', layer, color: '#ffcc00', points: ring, closed: true });
const text = (t: string, x: number, y: number, height = 8, extra: Partial<Extract<CadEntity, { kind: 'text' }>> = {}): CadEntity => ({
  kind: 'text', layer: 'TEXT', color: '#000000', text: t, position: [x, y], height, rotation: 0, hAlign: 'center', vAlign: 'middle', ...extra,
});
const all = (n: number) => new Uint8Array(n).fill(1);

describe('findLabelBoxes', () => {
  // A 400 × 300 parcel with a small box (110 × 24) holding its name.
  const parcel = hatch([[0, 0], [400, 0], [400, 300], [0, 300]]);

  it('flags a rectangle holding a text that lies over a bigger parcel', () => {
    const entities = [parcel, hatch(rect(150, 140, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)];
    const found = findLabelBoxes({ entities }, all(entities.length));
    expect([...found.keys()]).toEqual([1]);
    expect(found.get(1)).toBe('CHỢ XÃ ĐÔN XUÂN A');
  });

  it('also flags a closed outline of 4 corners (and one closed by repeating the first vertex)', () => {
    const entities = [parcel, outline(rect(150, 140, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)];
    expect([...findLabelBoxes({ entities }, all(3)).keys()]).toEqual([1]);
    const closedByPoint: CadEntity = { kind: 'polyline', layer: 'X', color: '#fff', points: [...rect(150, 140, 110, 24), [150, 140]], closed: false };
    expect([...findLabelBoxes({ entities: [parcel, closedByPoint, text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)] }, all(3)).keys()]).toEqual([1]);
  });

  it('follows a left-aligned text and a rotated box', () => {
    const entities = [parcel, hatch(rect(150, 140, 110, 24)), text('TRƯỜNG TH ĐÔN XUÂN', 154, 146, 8, { hAlign: 'left', vAlign: 'baseline' })];
    expect([...findLabelBoxes({ entities }, all(3)).keys()]).toEqual([1]);
  });

  it('flags a box hugging its text even when nothing lies under it, but not a roomy parcel with a small label', () => {
    expect([...findLabelBoxes({ entities: [hatch(rect(0, 0, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 55, 12)] }, all(2)).keys()]).toEqual([0]);
    expect(findLabelBoxes({ entities: [hatch(rect(0, 0, 300, 120)), text('CHỢ XÃ', 150, 60)] }, all(2)).size).toBe(0);
  });

  it('does not flag a small real parcel whose name is too long for it (the text sticks out)', () => {
    expect(findLabelBoxes({ entities: [parcel, hatch(rect(190, 140, 15, 13)), text('NHÀ VĂN HÓA ẤP CHỢ MR 0,0235', 197, 146)] }, all(3)).size).toBe(0);
  });

  it('flags a copy of a box (same corners, no text of its own), and a text offset from the box centre', () => {
    const entities = [parcel, hatch(rect(150, 140, 110, 24)), hatch(rect(150, 140, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 160, 152, 8, { hAlign: 'left' })];
    expect([...findLabelBoxes({ entities }, all(4)).keys()].sort()).toEqual([1, 2]);
  });

  it('flags the rectangles stacked under a box (touching or a few metres apart, not bigger), and its same-size copies elsewhere', () => {
    const entities = [
      parcel,
      hatch(rect(100, 140, 200, 30)),
      text('KHU TÁI ĐỊNH CƯ KCN ĐỊNH AN', 200, 155, 8),
      hatch(rect(150, 108, 100, 28)), // 2 m under the first box
      hatch(rect(180, 76, 60, 28)), // 4 m under the second
      hatch(rect(500, 500, 100, 28)), // same size as the second, far away (parcel outside)
    ];
    expect([...findLabelBoxes({ entities }, all(entities.length)).keys()].sort()).toEqual([1, 3, 4, 5]);
  });

  it('does not flag a big parcel with a small text in it (the text does not fill the box)', () => {
    const entities = [hatch(rect(100, 100, 200, 120)), parcel, text('P', 200, 160)];
    expect(findLabelBoxes({ entities }, all(3)).size).toBe(0);
  });

  it('does not flag a box without text, or a box that is not a rectangle', () => {
    const skew = hatch([[150, 140], [260, 140], [280, 164], [150, 164]]);
    expect(findLabelBoxes({ entities: [parcel, hatch(rect(150, 140, 110, 24))] }, all(2)).size).toBe(0);
    expect(findLabelBoxes({ entities: [parcel, skew, text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)] }, all(3)).size).toBe(0);
  });

  it('ignores objects outside the planning boundary', () => {
    const entities = [parcel, hatch(rect(150, 140, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 205, 152)];
    const inside = all(3);
    inside[1] = 0;
    expect(findLabelBoxes({ entities }, inside).size).toBe(0);
  });
});

describe('rectangleOf', () => {
  it('accepts right angles and rejects parallelograms', () => {
    expect(rectangleOf(rect(0, 0, 10, 5))).not.toBeNull();
    expect(rectangleOf([[0, 0], [10, 0], [12, 5], [2, 5]])).toBeNull();
    expect(rectangleOf([[0, 0], [10, 0], [10, 5]])).toBeNull();
  });
});

describe('strip boxes of one height', () => {
  it('flags a strip with the short side of a box (same direction, same layer) even when no text lies near it', () => {
    const parcel = hatch([[0, 0], [900, 0], [900, 600], [0, 600]]);
    const entities = [
      parcel,
      hatch(rect(100, 100, 150, 32)),
      text('KHU THƯƠNG MẠI DỊCH VỤ KẾT HỢP', 175, 132, 8, { vAlign: 'top' }),
      hatch(rect(400, 400, 186, 32)), // far from any text, 32 m high like the box above
      hatch(rect(400, 300, 186, 90)), // not a strip: a real parcel
    ];
    expect([...findLabelBoxes({ entities }, all(entities.length)).keys()].sort()).toEqual([1, 3]);
  });
});

describe('findLabelBoxes on a survey base', () => {
  // A base of tens of thousands of rectangles (houses) with a couple of thousand labelled boxes on the same layer: the "copies / stacked
  // boxes" pass must look only at the neighbours of a rectangle (it took minutes when it compared every rectangle with every box).
  it('stays fast with many rectangles and many boxes on one layer', () => {
    const entities: CadEntity[] = [];
    for (let k = 0; k < 2000; k++) {
      const x = (k % 50) * 400;
      const y = Math.floor(k / 50) * 400;
      entities.push(hatch(rect(x, y, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', x + 55, y + 12));
    }
    for (let k = 0; k < 30000; k++) entities.push(hatch(rect((k % 200) * 90 + 50000, Math.floor(k / 200) * 90, 20 + (k % 7), 15 + (k % 5))));
    const t0 = Date.now();
    const found = findLabelBoxes({ entities }, all(entities.length));
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(found.size).toBeGreaterThanOrEqual(2000);
  });

  it('a stacked box touching a labelled box is still found through the grid', () => {
    const entities = [hatch(rect(0, 0, 110, 24)), text('CHỢ XÃ ĐÔN XUÂN A', 55, 12), hatch(rect(110, 0, 40, 24)), hatch(rect(900, 900, 60, 70))];
    expect([...findLabelBoxes({ entities }, all(entities.length)).keys()].sort()).toEqual([0, 2]);
  });
});

