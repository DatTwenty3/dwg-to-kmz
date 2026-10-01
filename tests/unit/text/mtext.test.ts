import { describe, expect, it } from 'vitest';
import { decodeCadText, stripMText } from '@/lib/text';

const plain = (raw: string) => stripMText(raw).segments.map((s) => s.text).join('');
const mtext = (raw: string, styleFont?: string) => decodeCadText({ raw, isMText: true, styleFont }).text;

describe('stripMText', () => {
  it('fixture title block (Unicode, Arial)', () => {
    const r = stripMText('{\\fArial|b0|i0|c0|p34;BẢN ĐỒ QUY HOẠCH }');
    expect(r.segments).toEqual([{ text: 'BẢN ĐỒ QUY HOẠCH ', font: 'Arial' }]);
    expect(plain('\\pi8.33789;{\\fArial|b1|i0|c0|p34;\\W0.9;BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT}')).toBe(
      'BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT',
    );
  });

  it('paragraphs, NBSP and escapes', () => {
    expect(plain('Dòng 1\\PDòng 2')).toBe('Dòng 1\nDòng 2');
    expect(plain('a\\~b')).toBe('a\u00a0b');
    expect(plain('\\\\ \\{x\\}')).toBe('\\ {x}');
  });

  it('removes height/width/oblique/tracking/align/colour/paragraph codes', () => {
    expect(plain('\\H2.5;\\W0.8;\\Q15;\\T1.1;\\A1;\\C1;\\c255;\\pxqc;Text')).toBe('Text');
    expect(plain('\\H2.5x;Cao')).toBe('Cao');
  });

  it('removes underline/overline/strike toggles', () => {
    expect(plain('\\LGạch\\l \\OTrên\\o \\KXóa\\k')).toBe('Gạch Trên Xóa');
  });

  it('stacked fractions', () => {
    expect(plain('1\\S1^2;')).toBe('11/2');
    expect(plain('\\S3/4;')).toBe('3/4');
    expect(plain('\\S1#8;')).toBe('1/8');
    expect(plain('m\\S2^;')).toBe('m2');
  });

  it('\\U+XXXX', () => {
    expect(plain('Tr\\U+1EA1m bi\\U+1EBFn \\U+00E1p')).toBe('Trạm biến áp');
  });

  it('%% codes in MTEXT', () => {
    expect(plain('%%c110 %%d %%p0.00 100%%%')).toBe('Ø110 ° ±0.00 100%');
  });

  it('font runs with nested braces restore the outer font', () => {
    const r = stripMText('{\\fArial;A{\\fVNI-Times;B}C}D');
    expect(r.segments).toEqual([
      { text: 'A', font: 'Arial' },
      { text: 'B', font: 'VNI-Times' },
      { text: 'C', font: 'Arial' },
      { text: 'D' },
    ]);
  });

  it('\\F shx fonts', () => {
    expect(stripMText('{\\F.VnTime.shx|c0;x}').segments).toEqual([{ text: 'x', font: '.VnTime.shx' }]);
  });
});

describe('decodeCadText — MTEXT', () => {
  it('Unicode title block is unchanged', () => {
    expect(mtext('\\pi8.33789;{\\fArial|b1|i0|c0|p34;\\W0.9;BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT}')).toBe(
      'BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT',
    );
  });

  it('decodes each font run with its own encoding (TCVN3 + VNI + Unicode)', () => {
    const raw = '{\\f.VnTime|b0;Tr¹m biÕn ¸p}\\P{\\fVNI-Times|b0;Ñöôøng daây}\\P{\\fArial;Cống Ø}';
    const r = decodeCadText({ raw, isMText: true });
    expect(r.text).toBe('Trạm biến áp\nĐường dây\nCống Ø');
  });

  it('TCVN3 uppercase font run', () => {
    expect(mtext('{\\f.VnTimeH|b1;THUYÕT MINH}')).toBe('THUYẾT MINH');
  });

  it('VNI paragraph text with formatting', () => {
    expect(mtext('\\A1;{\\H3;ÑAÁT}\\PTRÖÔØNG MAÀM NON')).toBe('ĐẤT\nTRƯỜNG MẦM NON');
  });

  it('\\U+ characters are not re-decoded as VNI', () => {
    // \U+00D1 is a real Ñ — must stay Ñ even though the rest is VNI
    expect(mtext('ÑAÁT \\U+00D1')).toBe('ĐẤT Ñ');
  });

  it('%%c inside VNI text stays a diameter sign', () => {
    expect(mtext('OÁNG NÖÔÙC %%c110')).toBe('ỐNG NƯỚC Ø110');
  });

  it('unknown \\M+ multibyte code produces a warning', () => {
    const r = decodeCadText({ raw: 'x\\M+9ABCD', isMText: true });
    expect(r.text).toContain('\ufffd');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
