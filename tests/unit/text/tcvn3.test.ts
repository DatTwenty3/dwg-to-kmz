import { describe, expect, it } from 'vitest';
import { isTcvn3UpperFont, tcvn3ToUnicode, tcvn3UpperToUnicode } from '@/lib/text';
import { TCVN3_TABLE } from '@/lib/text/tcvn3';
import { toTcvn3, toTcvn3Upper } from './encoders';
import { SENTENCES } from './sentences';

describe('TCVN3 table', () => {
  it('has exactly the 74 VN3 letters (7 capitals + 67 lowercase), all distinct', () => {
    expect(TCVN3_TABLE.size).toBe(74);
    expect(new Set(TCVN3_TABLE.values()).size).toBe(74);
  });

  it('spot-checks codes against VSCII-3', () => {
    const at = (b: number) => tcvn3ToUnicode(String.fromCharCode(b));
    expect(at(0xa1)).toBe('Ă');
    expect(at(0xa7)).toBe('Đ');
    expect(at(0xae)).toBe('đ');
    expect(at(0xb5)).toBe('à');
    expect(at(0xb8)).toBe('á');
    expect(at(0xc6)).toBe('ặ');
    expect(at(0xca)).toBe('ấ');
    expect(at(0xd5)).toBe('ế');
    expect(at(0xdc)).toBe('ĩ');
    expect(at(0xed)).toBe('ớ');
    expect(at(0xf9)).toBe('ự');
    expect(at(0xfd)).toBe('ý');
    expect(at(0xfe)).toBe('ỵ');
    // VN2-only positions are not part of TCVN3/ABC → untouched
    expect(at(0xc1)).toBe('Á');
    expect(at(0xb0)).toBe('°');
  });
});

describe('tcvn3ToUnicode', () => {
  it.each([
    ['Tr¹m biÕn ¸p', 'Trạm biến áp'],
    ['§­êng d©y 22kV', 'Đường dây 22kV'],
    ['èng cÊp n­íc', 'ống cấp nước'],
    ['Cao ®é', 'Cao độ'],
    ['Hµ Néi', 'Hà Nội'],
    ['¡n ¢u £m ¤ng ¥i ¦u §i', 'Ăn Âu Êm Ông Ơi Ưu Đi'],
  ])('%s → %s', (raw, uni) => {
    expect(tcvn3ToUnicode(raw)).toBe(uni);
  });

  it.each(SENTENCES.map((s) => [s.toLowerCase()]))('round-trips "%s"', (s) => {
    expect(tcvn3ToUnicode(toTcvn3(s))).toBe(s);
  });
});

describe('TCVN3 uppercase fonts (.VnTimeH …)', () => {
  it('recognises uppercase font names', () => {
    expect(isTcvn3UpperFont('.VnTimeH')).toBe(true);
    expect(isTcvn3UpperFont('.VnArialH')).toBe(true);
    expect(isTcvn3UpperFont('.VnAvantH.shx')).toBe(true);
    expect(isTcvn3UpperFont('.VnTime')).toBe(false);
    expect(isTcvn3UpperFont('VNI-Helve')).toBe(false);
    expect(isTcvn3UpperFont(undefined)).toBe(false);
  });

  it('THUYẾT MINH typed in .VnTimeH', () => {
    expect(tcvn3UpperToUnicode('THUYÕT MINH')).toBe('THUYẾT MINH');
    expect(tcvn3UpperToUnicode('thuyÕt minh')).toBe('THUYẾT MINH');
  });

  it.each(SENTENCES.map((s) => [s.toUpperCase()]))('round-trips "%s"', (s) => {
    expect(tcvn3UpperToUnicode(toTcvn3Upper(s))).toBe(s);
  });
});
