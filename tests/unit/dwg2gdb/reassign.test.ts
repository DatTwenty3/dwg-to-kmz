// "Đổi lớp": the user sends chosen CAD objects to another feature class, one by one.
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity } from '@/lib/cad/types';
import { buildFeatures, coverageReport, entryFor, reassignKey, rowKey, summaryDocument, type MappingEntry, type ReassignEntry } from '@/lib/dwg2gdb';

const road = 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L';
const bridge = 'QuyHoach/QuyHoachGiaoThong/CongTrinhGiaoThong_L';
const land = 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A';
const line = (y: number): CadEntity => ({ kind: 'polyline', layer: 'DUONG', color: '#ffffff', points: [[0, y], [100, y]], closed: false });
const square: CadEntity = { kind: 'polyline', layer: 'DUONG', color: '#ffffff', points: [[0, 50], [10, 50], [10, 60], [0, 60]], closed: true };
const doc = (entities: CadEntity[]): CadDocument => ({ units: 'm', crs: null, layers: [], entities, bbox: [[0, 0], [100, 100]], warnings: [] });
const input = (id: string, d: CadDocument) => ({ id, name: `${id}.dwg`, doc: d, inside: new Uint8Array(d.entities.length).fill(1) });
const mapping = new Map<string, MappingEntry>([[rowKey('a', 'DUONG', 'L'), { target: road, phanLoai: 'Đường nhựa' }]]);
const opts = { boundary: null, sourceInGhiChu: false };

describe('entryFor', () => {
  it('an object\'s own choice wins over its layer row; no phanLoai keeps the row\'s', () => {
    const re = new Map<string, ReassignEntry>([[reassignKey('a', 1), { target: bridge, phanLoai: null }], [reassignKey('a', 2), { target: bridge, phanLoai: 'Cầu bê tông' }]]);
    const key = rowKey('a', 'DUONG', 'L');
    expect(entryFor(mapping, re, 'a', 0, key)).toEqual({ target: road, phanLoai: 'Đường nhựa' });
    expect(entryFor(mapping, re, 'a', 1, key)).toEqual({ target: bridge, phanLoai: 'Đường nhựa' });
    expect(entryFor(mapping, re, 'a', 2, key)).toEqual({ target: bridge, phanLoai: 'Cầu bê tông' });
    expect(entryFor(mapping, undefined, 'a', 1, key)).toEqual({ target: road, phanLoai: 'Đường nhựa' });
  });
});

describe('buildFeatures with reassignments', () => {
  const d = doc([line(0), line(10), line(20)]);
  const get = (built: ReturnType<typeof buildFeatures>, t: string) => built.classes.find((c) => c.target === t)?.features ?? [];

  it('only the chosen object moves; the others stay in the class of their row', () => {
    const re = new Map<string, ReassignEntry>([[reassignKey('a', 1), { target: bridge, phanLoai: 'Cầu' }]]);
    const built = buildFeatures([input('a', d)], mapping, { ...opts, reassign: re });
    expect(get(built, road)).toHaveLength(2);
    expect(get(built, bridge)).toHaveLength(1);
    expect(get(built, bridge)[0].phanLoai).toBe('Cầu');
    expect(get(built, bridge)[0].refs).toEqual([[['a', 1]]]);
    // without reassignment nothing changes
    expect(get(buildFeatures([input('a', d)], mapping, opts), road)).toHaveLength(3);
  });

  it('a closed outline sent to an area class becomes an area', () => {
    const d2 = doc([line(0), square]);
    const re = new Map<string, ReassignEntry>([[reassignKey('a', 1), { target: land, phanLoai: 'Đất ở' }]]);
    const built = buildFeatures([input('a', d2)], mapping, { ...opts, reassign: re });
    expect(get(built, road)).toHaveLength(1);
    expect(get(built, land)).toHaveLength(1);
    expect(get(built, land)[0].geometry.type).toBe('MultiPolygon');
  });

  it('the copies of an object on several maps move together (all its refs are reassigned)', () => {
    const d2 = doc([line(0)]);
    const m2 = new Map(mapping).set(rowKey('b', 'DUONG', 'L'), { target: road, phanLoai: 'Đường nhựa' });
    const re = new Map<string, ReassignEntry>([[reassignKey('a', 0), { target: bridge, phanLoai: null }], [reassignKey('b', 0), { target: bridge, phanLoai: null }]]);
    const built = buildFeatures([input('a', d2), input('b', d2)], m2, { ...opts, reassign: re });
    expect(get(built, road)).toHaveLength(0);
    expect(get(built, bridge)).toHaveLength(1);
    expect(get(built, bridge)[0].refs).toHaveLength(2);
  });
});

describe('other outputs follow', () => {
  const d = doc([line(0), line(10)]);
  const re = new Map<string, ReassignEntry>([[reassignKey('a', 1), { target: bridge, phanLoai: 'Cầu' }]]);
  it('the summary drawing names the layer of the new class', () => {
    const sum = summaryDocument([{ ...input('a', d), role: 'qh-gt' }], mapping, { boundary: null, texts: false, reassign: re });
    const names = sum.layers.map((l) => l.name);
    expect(names.some((n) => /CongTrinhGiaoThong_L_Cầu/.test(n))).toBe(true);
    expect(names.some((n) => /MangLuoiGiaoThongDuongBo_L_Đường nhựa/.test(n))).toBe(true);
  });
  it('the coverage counts the moved object as in the GIS', () => {
    const inputs = [{ ...input('a', d), role: 'qh-gt' as const }];
    const built = buildFeatures(inputs, mapping, { ...opts, reassign: re });
    expect(coverageReport(inputs, mapping, built.classes, re)).toMatchObject({ total: 2, covered: 2, attention: 0 });
  });
});
