import { describe, expect, it } from 'vitest';
import { findText } from '@/lib/cad/find';
import type { CadDocument, CadEntity } from '@/lib/cad/types';

const text = (t: string, x: number, layer = 'CHU'): CadEntity => ({
  kind: 'text',
  layer,
  color: '#000000',
  text: t,
  position: [x, 10],
  height: 2,
  rotation: 0,
  hAlign: 'left',
  vAlign: 'baseline',
});
const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: 'WGS84', layers: [], entities, bbox: [[0, 0], [1, 1]], warnings: [] });

describe('findText', () => {
  const d = doc([
    text('ĐẤT TRƯỜNG MẦM NON', 105.1),
    text('MẦM NON', 105.2),
    text('ĐẤT TRƯỜNG MẦM NON', 105.1), // same text, same place → once
    text('Đất ở hiện trạng', 105.3),
  ]);

  it('is accent-insensitive and ranks exact > prefix > contains', () => {
    const r = findText('mam non', [{ name: 'ninh-kieu.dwg', doc: d }]);
    expect(r.map((x) => x.text)).toEqual(['MẦM NON', 'ĐẤT TRƯỜNG MẦM NON']);
    expect(r[0]).toMatchObject({ source: 'ninh-kieu.dwg · CHU', position: [105.2, 10] });
  });

  it('finds sketches by name and label', () => {
    const r = findText('tram bom', [], [
      { id: 's1', kind: 'point', name: 'Điểm 1', label: 'Trạm bơm số 1', points: [[105.5, 10.1]], style: { color: '#e11d48' } },
      { id: 's2', kind: 'line', name: 'Trạm bơm – tuyến', points: [[105, 10], [106, 11]], style: { color: '#e11d48' } },
    ]);
    // Both start with the query: the shorter text first.
    expect(r.map((x) => x.sketchId)).toEqual(['s1', 's2']);
    expect(r[0].position).toEqual([105.5, 10.1]);
    expect(r[1].position).toEqual([105.5, 10.5]); // a line is found at its centroid
  });

  it('needs at least 2 characters', () => {
    expect(findText('đ', [{ name: 'a', doc: d }])).toEqual([]);
  });
});
