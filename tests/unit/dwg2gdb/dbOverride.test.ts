// The user can write a drawing's data to another geodatabase than the one its map kind feeds.
import { describe, expect, it } from 'vitest';
import { analysisRows, initialMapping, resolveRow, retarget, retargetState, suggestRow, templateDecisions, templateLookup, type MappingState } from '@/lib/dwg2gdb';
import type { CadDocument, CadEntity } from '@/lib/cad/types';

describe('retarget', () => {
  it('the same class in the paired dataset of the other database', () => {
    expect(retarget('QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L', 'HienTrang')).toBe('HienTrang/HienTrangGiaoThong/MangLuoiGiaoThongDuongBo_L');
    expect(retarget('HienTrang/HienTrangSuDungDat/ChucNangSuDungDat_A', 'QuyHoach')).toBe('QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A');
    expect(retarget('QuyHoach/QuyHoachGiaoThong/CongTrinhGiaoThong_L', 'QuyHoach')).toBe('QuyHoach/QuyHoachGiaoThong/CongTrinhGiaoThong_L');
  });
  it('the boundaries belong to both; a class the other database lacks has no counterpart', () => {
    expect(retarget('QuyHoach/ViTriRanhGioi/RanhGioiQuyHoach_A', 'HienTrang')).toBe('QuyHoach/ViTriRanhGioi/RanhGioiQuyHoach_A');
    expect(retarget('QuyHoach/QuyHoachSuDungDat/PhanKhuQuyHoach_A', 'HienTrang')).toBeUndefined();
  });
});

describe('retargetState', () => {
  const s: MappingState = { target: 'QuyHoach/QuyHoachGiaoThong/MangLuoiGiaoThongDuongBo_L', phanLoai: 'Đường nhựa', source: 'auto', reason: 'Tên layer' };
  it('moves a decision to the other geodatabase and says so', () => {
    const r = retargetState(s, 'HienTrang');
    expect(r.target).toBe('HienTrang/HienTrangGiaoThong/MangLuoiGiaoThongDuongBo_L');
    expect(r.reason).toMatch(/HienTrang\.gdb/);
    expect(r.phanLoai).toBe('Đường nhựa');
  });
  it('asks for a class when the other database has none', () => {
    const r = retargetState({ ...s, target: 'QuyHoach/QuyHoachSuDungDat/PhanKhuQuyHoach_A' }, 'HienTrang');
    expect(r).toMatchObject({ target: null, unknown: true });
  });
  it('leaves an unmapped row alone', () => {
    expect(retargetState({ ...s, target: null }, 'HienTrang').target).toBeNull();
  });
});

describe('a drawing written to the other geodatabase', () => {
  const road: CadEntity = { kind: 'polyline', layer: 'DUONG_NHUA', color: '#ffffff', points: [[0, 0], [100, 0]], closed: false };
  const doc: CadDocument = { units: 'm', crs: null, layers: [], entities: [road], bbox: [[0, 0], [100, 0]], warnings: [] };
  const flags = new Uint8Array([1]);
  const rows = analysisRows([{ id: 'a', name: 'QH_07 giao thong.dwg', doc } as never], { drawings: [{ id: 'a', role: 'qh-gt' }] as never, inside: new Map([['a', flags]]), section: null });
  const lookup = templateLookup(null);

  it('resolveRow with a db retargets the suggestion; without it nothing changes', () => {
    const plain = resolveRow(rows[0], 'qh-gt', lookup, rows);
    expect(plain.target).toMatch(/^QuyHoach\//);
    expect(resolveRow(rows[0], 'qh-gt', lookup, rows, 'HienTrang').target).toMatch(/^HienTrang\/HienTrangGiaoThong\//);
    expect(resolveRow(rows[0], 'qh-gt', lookup, rows, 'QuyHoach').target).toBe(plain.target);
    expect(suggestRow(rows[0], 'qh-gt', rows).target).toBe(plain.target);
  });

  it('initialMapping follows the drawing\'s choice, and the choice is not learnt into the template', () => {
    const drawings = [{ id: 'a', role: 'qh-gt', dbOverride: 'HienTrang' }] as never;
    const m = initialMapping({ drawings, rows }, null);
    expect(m.get(rows[0].key)?.target).toMatch(/^HienTrang\//);
    expect(templateDecisions(drawings, rows, m)).toEqual([]);
    expect(templateDecisions([{ id: 'a', role: 'qh-gt' }] as never, rows, resolveAll(rows)).length).toBe(1);
  });
  const resolveAll = (rs: typeof rows) => new Map(rs.map((r) => [r.key, resolveRow(r, 'qh-gt', lookup, rs)]));
});
