import { describe, expect, it } from 'vitest';
import { LAND_USE_LABELS } from '@/lib/dwg2gdb/suggest';
import { SECTION_TITLES, symbolsOfSection, TT16_SYMBOLS } from '@/lib/dwg2gdb/tt16Symbols';
import { TARGETS } from '@/lib/dwg2gdb/template';

const acisOf = (layer: string) => [...new Set(TT16_SYMBOLS.filter((s) => s.layer === layer).map((s) => s.aci))];

describe('TT16 colour table (Phụ lục I)', () => {
  it('every land use is a known label and every target a real class', () => {
    const classes = new Set(TARGETS.map((t) => t.cls));
    for (const s of TT16_SYMBOLS) {
      if (s.landUse) expect(LAND_USE_LABELS.has(s.landUse), `${s.layer ?? s.name}: ${s.landUse}`).toBe(true);
      if (s.target) expect(classes.has(s.target), `${s.layer ?? s.name}: ${s.target}`).toBe(true);
      expect(s.aci).toBeGreaterThanOrEqual(1);
      expect(s.aci).toBeLessThanOrEqual(255);
    }
  });

  it('a layer has one colour only', () => {
    for (const layer of new Set(TT16_SYMBOLS.map((s) => s.layer).filter(Boolean) as string[])) expect(acisOf(layer), layer).toHaveLength(1);
  });

  it('every land-use section lists its hatch symbols', () => {
    for (const n of [2, 3, 4, 5, 6]) expect(symbolsOfSection(n).filter((s) => s.kind === 'A').length, SECTION_TITLES[n]).toBeGreaterThanOrEqual(24);
    // Mục 7 has no layer names: 8 nông nghiệp + 7 xây dựng + 7 hạ tầng / khác.
    expect(symbolsOfSection(7)).toHaveLength(22);
    expect(symbolsOfSection(7).every((s) => s.layer === null)).toBe(true);
  });

  it('keeps the colours shared by two symbols of one section', () => {
    const shared = (section: number, aci: number) => symbolsOfSection(section).filter((s) => s.aci === aci && s.kind === 'A').length;
    expect(shared(2, 94)).toBe(2); // cây xanh SDHC ↔ văn hóa thể thao
    expect(shared(2, 152)).toBe(2); // sông suối ↔ mặt nước biển
    expect(shared(4, 251)).toBe(2); // đường giao thông ↔ nghĩa trang
    expect(shared(5, 12)).toBe(2); // thương mại dịch vụ ↔ dịch vụ
  });

  it('known colours', () => {
    expect(acisOf('DAT_DD_Honhop_Nhomo')).toEqual([22]);
    expect(acisOf('DAT_DD_TruongTHPT')).toEqual([24]);
    expect(acisOf('DAT_DD_Truonghoc')).toEqual([15]);
    expect(acisOf('BV_Rg_lapquyhoach')).toEqual([1]);
    expect(acisOf('BV_Rg_capcoso')).toEqual([14]);
    expect(acisOf('DAT_NNK_Rungdacdung')).toEqual([148]);
    expect(acisOf('DAT_KXD_Congnghiep')).toEqual([192]);
    const lua = symbolsOfSection(7).find((s) => s.name === 'Đất trồng lúa');
    expect(lua).toMatchObject({ aci: 3, landUse: 'Đất trồng lúa' });
    expect(symbolsOfSection(7).find((s) => s.name === 'Đất ở')?.aci).toBe(57);
  });
});
