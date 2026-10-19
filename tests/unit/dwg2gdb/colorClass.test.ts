import { describe, expect, it } from 'vitest';
import { colorKey, colorSuggestion, describeColorKey } from '@/lib/dwg2gdb/colorClass';
import { aciHex } from '@/lib/dwg2gdb/color';

const hatch = (color: string) => ({ kind: 'polygon' as const, color });

describe('colorKey', () => {
  const ctx = { section: 3, role: 'qh-sdd' as const };
  it('one group per classified colour of a hatch', () => {
    expect(colorKey(hatch(aciHex(24)), ctx)).toBe('c' + aciHex(24).slice(1));
    expect(colorKey(hatch('#7f007f'), ctx)).toBe(''); // unknown colour
    expect(colorKey(hatch('#808080'), ctx)).toBe(''); // neutral
  });
  it('is off for other geometry, other maps, no section', () => {
    expect(colorKey({ kind: 'polyline', color: aciHex(24) }, ctx)).toBe('');
    expect(colorKey(hatch(aciHex(24)), { section: 3, role: 'qh-gt' })).toBe('');
    expect(colorKey(hatch(aciHex(24)), { section: null, role: 'qh-sdd' })).toBe('');
  });
});

describe('describeColorKey / colorSuggestion', () => {
  it('exact → Số N and the land use class of the drawing database', () => {
    const info = describeColorKey('c' + aciHex(24).slice(1), 3);
    expect(info).toMatchObject({ level: 'exact', aci: 24, landUse: 'Đất giáo dục' });
    expect(info?.reason).toBe('Màu số 24 — Đất giáo dục');
    expect(colorSuggestion(info, 'qh-sdd')).toMatchObject({ target: 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A', phanLoai: 'Đất giáo dục' });
    expect(colorSuggestion(info, 'ht-sdd')?.target).toBe('HienTrang/HienTrangSuDungDat/ChucNangSuDungDat_A');
  });
  it('shared colour → needs a decision', () => {
    const info = describeColorKey('c' + aciHex(94).slice(1), 2);
    expect(info?.level).toBe('ambiguous');
    expect(info?.alt).toBeDefined();
    expect(colorSuggestion(info, 'qh-sdd')).toMatchObject({ target: null, unknown: true });
  });
  it('unknown key gives nothing', () => {
    expect(describeColorKey('', 3)).toBeNull();
    expect(colorSuggestion(null, 'qh-sdd')).toBeNull();
  });
});
