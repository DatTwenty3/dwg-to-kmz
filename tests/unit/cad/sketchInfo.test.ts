import { describe, expect, it } from 'vitest';
import type { SketchFeature } from '@/lib/cad/sketch';
import { sketchInfoRows } from '@/lib/cad/sketchInfo';

const base = { id: 'a', style: { color: '#e11d48' } };

describe('sketchInfoRows', () => {
  it('line: name, ground length, vertices, label', () => {
    const f: SketchFeature = { ...base, kind: 'line', name: 'Đường 1', label: 'Kênh', points: [[105.7, 10], [105.7, 10.001]] };
    const rows = Object.fromEntries(sketchInfoRows(f));
    expect(rows['Tên']).toBe('Đường 1');
    expect(rows['Chiều dài']).toMatch(/11\d[,.]\d+ m|11\d m/);
    expect(rows['Số đỉnh']).toBe('2');
    expect(rows['Nhãn']).toBe('Kênh');
  });
  it('area: area, perimeter', () => {
    const f: SketchFeature = { ...base, kind: 'polygon', name: 'Vùng 1', points: [[105.7, 10], [105.701, 10], [105.701, 10.001], [105.7, 10.001]] };
    const rows = Object.fromEntries(sketchInfoRows(f));
    expect(rows['Diện tích']).toBeTruthy();
    expect(rows['Chu vi']).toBeTruthy();
    expect(rows['Số đỉnh']).toBe('4');
  });
  it('point: latitude and longitude', () => {
    const f: SketchFeature = { ...base, kind: 'point', name: 'Điểm 1', points: [[105.7402, 10.0129]] };
    const rows = Object.fromEntries(sketchInfoRows(f));
    expect(rows['Vĩ độ']).toBe('10.0129000');
    expect(rows['Kinh độ']).toBe('105.7402000');
  });
});
