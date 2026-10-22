// "Đối chiếu CAD ↔ GIS": what did not reach the geodatabases.
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { buildFeatures, coverageReport, rowKey, type MappingEntry } from '@/lib/dwg2gdb';

const line = (layer: string, y: number, extra: Partial<Extract<CadEntity, { kind: 'polyline' }>> = {}): CadEntity => ({ kind: 'polyline', layer, color: '#ffffff', points: [[0, y], [100, y]], closed: false, ...extra });
const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [100, 100]], warnings: [] });
const input = (id: string, d: CadDocument, role: 'qh-gt' | 'qh-sdd' = 'qh-gt') => ({ id, name: `${id}.dwg`, doc: d, inside: new Uint8Array(d.entities.length).fill(1), role });
const road = 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L';

describe('coverageReport', () => {
  it('counts what is in the GIS, separates the layers left out on purpose from those worth a look', () => {
    const d = doc([line('DUONG_NHUA', 0), line('DUONG_NHUA', 10), line('KHUNG', 20), line('LAYER_LA', 30)]);
    const m = new Map<string, MappingEntry>([[rowKey('a', 'DUONG_NHUA', 'L'), { target: road, phanLoai: 'Đường nhựa' }]]);
    const inputs = [input('a', d)];
    const built = buildFeatures(inputs, m, { boundary: null, sourceInGhiChu: false });
    const r = coverageReport(inputs, m, built.classes);
    expect(r).toMatchObject({ total: 4, covered: 2, onPurpose: 1, attention: 1 });
    expect(r.groups[0]).toMatchObject({ layer: 'LAYER_LA', attention: true, why: 'Chưa ghép vào lớp dữ liệu' });
    expect(r.groups[1]).toMatchObject({ layer: 'KHUNG', attention: false });
  });

  it('a copy on another map of an object that is in the GIS is not missing', () => {
    const a = input('a', doc([line('DUONG_NHUA', 0)]));
    const b = input('b', doc([line('LAYER_LA', 0)])); // the same road, drawn on a map where its layer is not mapped
    const m = new Map<string, MappingEntry>([[rowKey('a', 'DUONG_NHUA', 'L'), { target: road, phanLoai: 'x' }]]);
    const built = buildFeatures([a, b], m, { boundary: null, sourceInGhiChu: false });
    const r = coverageReport([a, b], m, built.classes);
    expect(r).toMatchObject({ total: 2, covered: 2, attention: 0 });
  });

  it('an outline that cannot be closed into the area class it was mapped to is reported', () => {
    const d = doc([line('NHA', 0)]);
    const m = new Map<string, MappingEntry>([[rowKey('a', 'NHA', 'L'), { target: 'QuyHoach/QuyHoachKhongGianKienTrucCanhQuan/CongTrinh_A', phanLoai: 'Nhà' }]]);
    const inputs = [input('a', d, 'qh-sdd')];
    const built = buildFeatures(inputs, m, { boundary: null, sourceInGhiChu: false });
    const r = coverageReport(inputs, m, built.classes);
    expect(r.groups[0]).toMatchObject({ layer: 'NHA', why: 'Đường hở không khép kín được thành vùng', attention: true });
  });

  it('objects removed on the map (inside flag 0) are not counted', () => {
    const d = doc([line('DUONG_NHUA', 0), line('LAYER_LA', 10)]);
    const i = input('a', d);
    i.inside[1] = 0;
    const m = new Map<string, MappingEntry>([[rowKey('a', 'DUONG_NHUA', 'L'), { target: road, phanLoai: 'x' }]]);
    const built = buildFeatures([i], m, { boundary: null, sourceInGhiChu: false });
    expect(coverageReport([i], m, built.classes)).toMatchObject({ total: 1, covered: 1, attention: 0 });
  });
});
