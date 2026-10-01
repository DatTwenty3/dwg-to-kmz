import { describe, expect, it } from 'vitest';
import { vniToUnicode } from '@/lib/text';
import { toVni } from './encoders';
import { SENTENCES } from './sentences';

describe('vniToUnicode — fixture strings', () => {
  const cases: [string, string][] = [
    ['ÑAÁT TRÖÔØNG MAÀM NON', 'ĐẤT TRƯỜNG MẦM NON'],
    ['TRÖÔØNG TIEÅU HOÏC CAÙI KHEÁ 1', 'TRƯỜNG TIỂU HỌC CÁI KHẾ 1'],
    ['ÑAÁT TRÖÔØNG ÑAÏI HOÏC, CAO ÑAÚNG', 'ĐẤT TRƯỜNG ĐẠI HỌC, CAO ĐẲNG'],
    ['HOÃN HÔÏP', 'HỖN HỢP'],
    ['MAÏC ÑÓNH CHI', 'MẠC ĐĨNH CHI'],
    ['ÑAÁT DU LÒCH', 'ĐẤT DU LỊCH'],
    ['P. THÔÙI BÌNH', 'P. THỚI BÌNH'],
    ['PHÖÔØNG AN BÌNH', 'PHƯỜNG AN BÌNH'],
    ['TEÂN BAÛN VEÕ: BAÛN ÑOÀ QUY HOAÏCH SÖÛ DUÏNG ÑAÁT ', 'TÊN BẢN VẼ: BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT '],
    ['GHI CHUÙ:', 'GHI CHÚ:'],
  ];
  it.each(cases)('%s → %s', (vni, uni) => {
    expect(vniToUnicode(vni)).toBe(uni);
  });

  it('handles every modifier in lowercase', () => {
    expect(vniToUnicode('aù aø aû aõ aï')).toBe('á à ả ã ạ');
    expect(vniToUnicode('aâ aá aà aå aã aä')).toBe('â ấ ầ ẩ ẫ ậ');
    expect(vniToUnicode('aê aé aè aú aü aë')).toBe('ă ắ ằ ẳ ẵ ặ');
    expect(vniToUnicode('eâ eá oâ oä')).toBe('ê ế ô ộ');
    expect(vniToUnicode('ñ ô ö ò ó æ î')).toBe('đ ơ ư ị ĩ ỉ ỵ');
    expect(vniToUnicode('ôù öø ôû öõ ôï')).toBe('ớ ừ ở ữ ợ');
  });

  it('handles every modifier in uppercase', () => {
    expect(vniToUnicode('AÙ AØ AÛ AÕ AÏ')).toBe('Á À Ả Ã Ạ');
    expect(vniToUnicode('AÂ AÁ AÀ AÅ AÃ AÄ')).toBe('Â Ấ Ầ Ẩ Ẫ Ậ');
    expect(vniToUnicode('AÊ AÉ AÈ AÚ AÜ AË')).toBe('Ă Ắ Ằ Ẳ Ẵ Ặ');
    expect(vniToUnicode('Ñ Ô Ö Ò Ó Æ Î')).toBe('Đ Ơ Ư Ị Ĩ Ỉ Ỵ');
  });

  it('keeps modifiers that do not follow a vowel', () => {
    expect(vniToUnicode('Ø110')).toBe('Ø110');
    expect(vniToUnicode('D Ø300')).toBe('D Ø300');
    // circumflex/breve only on a/e/o, breve only on a
    expect(vniToUnicode('iâ')).toBe('iâ');
    expect(vniToUnicode('eê')).toBe('eê');
  });

  it('output is NFC', () => {
    const out = vniToUnicode('Ñöôøng daây');
    expect(out).toBe('Đường dây');
    expect(out).toBe(out.normalize('NFC'));
  });

  it.each(SENTENCES.map((s) => [s]))('round-trips "%s" (lower/upper)', (s) => {
    expect(vniToUnicode(toVni(s))).toBe(s);
    expect(vniToUnicode(toVni(s.toUpperCase()))).toBe(s.toUpperCase());
  });
});
