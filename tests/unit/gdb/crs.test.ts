import { describe, expect, it } from 'vitest';
import { assessCrs, provinceForCode, unionExtent, type Extent } from '@/lib/gdb/crs';

// Extent of the Xã Nhị Long sample (VN-2000, KTT 105°30', 3° zone) — Trà Vinh, now part of Vĩnh Long (code 86).
const NHI_LONG: Extent = [578404.25, 1102658.62, 589679.76, 1115014.27];
const sr = (lon0: number, zone: 3 | 6 = 3) => ({ name: 'VN_2000', vn2000: true, lon0, zone });

describe('assessCrs', () => {
  it('with the province code: right KTT ok, wrong KTT named', () => {
    expect(provinceForCode('86')?.name).toBe('Vĩnh Long');
    const ok = assessCrs(sr(105.5), NHI_LONG, '86');
    expect(ok.status).toBe('ok');
    expect(ok.text).toMatch(/105°30'.*Vĩnh Long/);
    expect(ok.center!.lat).toBeGreaterThan(9.9);
    expect(ok.center!.lat).toBeLessThan(10.1);
    const wrong = assessCrs(sr(105), NHI_LONG, '86');
    expect(wrong.status).toBe('error');
    expect(wrong.text).toMatch(/phải dùng KTT 105°30'/);
  });

  it('flags data that is not in the province of the code', () => {
    const c = assessCrs(sr(105.5), NHI_LONG, '01');
    expect(c.status).toBe('error');
    expect(c.text).toMatch(/không nằm trong TP. Hà Nội/);
  });

  it('without a province: KTT 105° (Cần Thơ) and 105°30\' (Trà Vinh) both fit this extent → cannot decide', () => {
    const a = assessCrs(sr(105.5), NHI_LONG);
    const b = assessCrs(sr(105), NHI_LONG);
    expect(a.status).toBe('warn');
    expect(b.status).toBe('warn');
    expect(a.expectedLon0).toEqual(expect.arrayContaining([105, 105.5]));
    expect(a.text).toMatch(/chọn tỉnh/);
    // A KTT that fits no province at all is plainly wrong.
    expect(assessCrs(sr(107.75), NHI_LONG).status).toBe('error');
  });

  it('handles missing / non VN-2000 / empty data', () => {
    expect(assessCrs(null, NHI_LONG).status).toBe('warn');
    expect(assessCrs({ name: 'WGS_1984_UTM_Zone_48N', vn2000: false, lon0: 105, zone: null }, NHI_LONG).status).toBe('error');
    expect(assessCrs(sr(105.5), null).text).toMatch(/Chưa có dữ liệu/);
    expect(assessCrs(sr(105.5, 6), NHI_LONG).status).toBe('warn');
    expect(unionExtent([null, [1, 2, 3, 4], [0, 5, 2, 6]])).toEqual([0, 2, 3, 6]);
  });
});

describe('suggestProvince', () => {
  it('prefers the planning code, then the data location', async () => {
    const { suggestProvince, codeForProvince, assessCrs } = await import('@/lib/gdb/crs');
    const { getProvince } = await import('@/lib/geo/provinces');
    expect(codeForProvince(getProvince('vinh-long')!)).toBe('86');
    expect(codeForProvince(getProvince('ho-chi-minh')!)).toBe('79');
    expect(suggestProvince([{ province: { code: '92', source: 'maHoSoQH' }, crs: null }])).toEqual({ code: '92', source: 'maHoSoQH' });
    const crs = assessCrs({ name: 'VN_2000', vn2000: true, lon0: 105.5, zone: 3 }, [578404, 1102658, 589679, 1115014]);
    expect(suggestProvince([{ province: null, crs }])).toEqual({ code: '86', source: 'location' });
  });
});
