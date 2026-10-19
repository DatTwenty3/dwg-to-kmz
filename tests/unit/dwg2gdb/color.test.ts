import { describe, expect, it } from 'vitest';
import { aciHex, deltaE, hexToAcis, isNeutral, matchColor, toLab } from '@/lib/dwg2gdb/color';
import { symbolsOfSection } from '@/lib/dwg2gdb/tt16Symbols';

const mix = (a: string, b: string) => {
  const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
  const ch = (s: number) => Math.round((((x >> s) & 255) + ((y >> s) & 255)) / 2);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
};
const shift = (hex: string, d: number) => {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, v + d)).toString(16).padStart(2, '0')).join('');
};

describe('hexToAcis', () => {
  it('returns every index with that colour', () => {
    expect(hexToAcis('#ff0000')).toEqual([1, 10]);
    expect(hexToAcis('#ffffff')).toEqual([7, 255]);
    expect(hexToAcis(aciHex(22))).toContain(22);
    expect(hexToAcis('#123456')).toEqual([]);
  });
});

describe('isNeutral', () => {
  it('grey, white and black have no hue', () => {
    for (const h of ['#808080', '#ffffff', '#000000', '#5b5b5b', '#f0f0f2']) expect(isNeutral(h), h).toBe(true);
    for (const h of ['#ff0000', aciHex(22), aciHex(94)]) expect(isNeutral(h), h).toBe(false);
  });
});

describe('deltaE', () => {
  it('is 0 for equal colours and grows with the difference', () => {
    expect(deltaE('#336699', '#336699')).toBe(0);
    expect(deltaE(aciHex(22), shift(aciHex(22), 3))).toBeLessThan(2);
    expect(deltaE(aciHex(22), aciHex(24))).toBeGreaterThan(15);
    expect(toLab('#ffffff')[0]).toBeCloseTo(100, 0);
  });
});

describe('matchColor', () => {
  const s3 = symbolsOfSection(3);
  const s7 = symbolsOfSection(7);

  it('exact: the colour of a symbol', () => {
    const m = matchColor(aciHex(22), s3, 'A');
    expect(m.level).toBe('exact');
    expect(m.best?.layer).toBe('DAT_DD_Honhop_Nhomo');
    expect(matchColor(aciHex(24), s3, 'A').best?.layer).toBe('DAT_DD_TruongTHPT');
    expect(matchColor(aciHex(57), s7, 'A').best?.name).toBe('Đất ở');
  });

  it('exact: the same land use under two layer names is not a conflict', () => {
    const m = matchColor(aciHex(152), symbolsOfSection(2), 'A');
    expect(m.level).toBe('exact');
    expect(m.best?.landUse).toBe('Đất sông, ngòi, kênh, rạch, suối, mặt nước');
  });

  it('ambiguous: a colour shared by two land uses', () => {
    const m = matchColor(aciHex(94), symbolsOfSection(2), 'A');
    expect(m.level).toBe('ambiguous');
    expect([m.best?.layer, m.alt?.layer].sort()).toEqual(['DAT_NDD_CayxanhSDHC', 'DAT_NDD_Vanhoathethao']);
    expect(matchColor(aciHex(251), symbolsOfSection(4), 'A').level).toBe('ambiguous');
  });

  it('near: a few units off a symbol colour', () => {
    const m = matchColor(shift(aciHex(22), 3), s3, 'A');
    expect(m.level).toBe('near');
    expect(m.best?.layer).toBe('DAT_DD_Honhop_Nhomo');
    expect(m.dE).toBeLessThan(2);
  });

  it('ambiguous: between two symbol colours', () => {
    const m = matchColor(mix(aciHex(22), aciHex(24)), s3, 'A');
    expect(m.level).toBe('ambiguous');
    expect([m.best?.layer, m.alt?.layer].sort()).toEqual(['DAT_DD_Honhop_Nhomo', 'DAT_DD_TruongTHPT']);
  });

  it('none: far from every symbol, or no symbol of that kind', () => {
    expect(matchColor('#7f007f', s3, 'A').level).toBe('none');
    expect(matchColor(aciHex(22), s3, 'P').level).toBe('none');
  });

  it('the same colour means the same land use in the sections that share it', () => {
    for (const n of [2, 3, 4, 5, 6, 7]) expect(matchColor(aciHex(192), symbolsOfSection(n), 'A').best?.landUse).toBe('Đất công nghiệp, tiểu thủ công nghiệp');
  });
});
