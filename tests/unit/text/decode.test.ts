import { describe, expect, it } from 'vitest';
import {
  decodeCadText,
  decodeCodepage,
  decodeStyleBatch,
  detectEncodingFromContent,
  detectEncodingFromFont,
  VIETNAMESE_CHARSET,
} from '@/lib/text';
import { toTcvn3, toTcvn3Upper, toVni } from './encoders';
import { SENTENCES } from './sentences';

const text = (raw: string, extra: Partial<Parameters<typeof decodeCadText>[0]> = {}) =>
  decodeCadText({ raw, isMText: false, ...extra }).text;

describe('detectEncodingFromFont', () => {
  it.each([
    ['.VnTime', 'tcvn3'],
    ['.VnTimeH', 'tcvn3'],
    ['.VnArial', 'tcvn3'],
    ['VnTime.shx', 'tcvn3'],
    ['VNI-Times', 'vni'],
    ['VNI-Helve', 'vni'],
    ['vni-times.ttf', 'vni'],
    ['Arial', 'unicode'],
    ['Times New Roman', 'unicode'],
    ['txt.shx', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ])('%s → %s', (font, enc) => {
    expect(detectEncodingFromFont(font)).toBe(enc);
  });
});

describe('detectEncodingFromContent', () => {
  it('wide chars ⇒ Unicode', () => {
    expect(detectEncodingFromContent('CÔNG TRÌNH ĐƯỜNG')).toBe('unicode');
    expect(detectEncodingFromContent('Trạm biến áp')).toBe('unicode');
  });
  it('ASCII ⇒ unknown', () => {
    expect(detectEncodingFromContent('LO A-12')).toBe('unknown');
  });
  it('fixture VNI strings ⇒ vni', () => {
    for (const s of ['ÑAÁT TRÖÔØNG MAÀM NON', 'P. THÔÙI BÌNH', 'HOÃN HÔÏP', 'ÑAÁT DU LÒCH', 'MAÏC ÑÓNH CHI']) {
      expect(detectEncodingFromContent(s)).toBe('vni');
    }
  });
  it('TCVN3 strings ⇒ tcvn3', () => {
    for (const s of ['Tr¹m biÕn ¸p', '§­êng d©y 22kV', 'Cao ®é', 'Hµ Néi']) {
      expect(detectEncodingFromContent(s)).toBe('tcvn3');
    }
  });
  it('genuinely ambiguous strings ⇒ unknown', () => {
    expect(detectEncodingFromContent('CÔNG')).toBe('unknown'); // Unicode "CÔNG" or VNI "CƠNG"
    expect(detectEncodingFromContent('VEÕ')).toBe('unknown'); // Latin-1 or VNI "VẼ"
  });
});

describe('decodeCadText — TEXT', () => {
  it('Unicode strings are left alone (CÔNG must not become CƠNG)', () => {
    expect(text('CÔNG TRÌNH ĐƯỜNG')).toBe('CÔNG TRÌNH ĐƯỜNG');
    expect(text('CÔNG', { styleEncoding: 'unknown' })).toBe('CÔNG');
    expect(text('Bản đồ quy hoạch')).toBe('Bản đồ quy hoạch');
  });

  it('Unicode in a VNI-majority style still unchanged when it has wide chars', () => {
    expect(text('CÔNG TY ĐIỆN LỰC', { styleEncoding: 'vni' })).toBe('CÔNG TY ĐIỆN LỰC');
  });

  it('fixture VNI strings', () => {
    expect(text('ÑAÁT TRÖÔØNG MAÀM NON')).toBe('ĐẤT TRƯỜNG MẦM NON');
    expect(text('%%UGHI CHUÙ:')).toBe('GHI CHÚ:');
    expect(text('P. THÔÙI BÌNH')).toBe('P. THỚI BÌNH');
  });

  it('ambiguous strings follow the style vote', () => {
    expect(text('VEÕ', { styleEncoding: 'vni' })).toBe('VẼ');
    expect(text('VEÕ')).toBe('VEÕ');
  });

  it('%% codes (case-insensitive)', () => {
    expect(text('%%uGạch chân%%U %%oTrên%%O')).toBe('Gạch chân Trên');
    expect(text('Ống cấp nước %%c110')).toBe('Ống cấp nước Ø110');
    expect(text('Cao độ %%p0.00')).toBe('Cao độ ±0.00');
    expect(text('Góc 45%%d')).toBe('Góc 45°');
    expect(text('100%%%')).toBe('100%');
    expect(text('%%C200 %%D %%P')).toBe('Ø200 ° ±');
  });

  it('%%nnn character codes are decoded with the text (fixture: "h%%182i" = TCVN3 "hải")', () => {
    expect(text('h%%182i')).toBe('hải');
  });

  it('%% codes inside TCVN3 / VNI text', () => {
    expect(text('èng cÊp n­íc %%c110')).toBe('ống cấp nước Ø110');
    expect(text('Cao ®é %%p0.00')).toBe('Cao độ ±0.00');
    expect(text('OÁNG CAÁP NÖÔÙC %%C110')).toBe('ỐNG CẤP NƯỚC Ø110');
  });

  it('TCVN3 uppercase via font hint', () => {
    expect(text('THUYÕT MINH', { styleFont: '.VnTimeH' })).toBe('THUYẾT MINH');
    expect(text('VIÖT NAM')).toBe('VIỆT NAM');
  });

  it('font hint decides TCVN3 vs VNI only when content is ambiguous', () => {
    // content is clearly VNI even though the style font claims TCVN3 (fixture: style "Vn.Times")
    expect(text('ÑAÁT TRÖÔØNG', { styleFont: 'Vn.Times' })).toBe('ĐẤT TRƯỜNG');
  });

  it.each(SENTENCES.map((s) => [s]))('VNI "%s" decodes without hints', (s) => {
    expect(text(toVni(s))).toBe(s);
    expect(text(toVni(s.toUpperCase()))).toBe(s.toUpperCase());
  });

  it.each(SENTENCES.map((s) => [s.toLowerCase()]))('TCVN3 "%s" decodes without hints', (s) => {
    expect(text(toTcvn3(s))).toBe(s);
  });

  it.each(SENTENCES.map((s) => [s.toUpperCase()]))('TCVN3 .VnTimeH "%s" decodes with font hint', (s) => {
    expect(text(toTcvn3Upper(s), { styleFont: '.VnTimeH' })).toBe(s);
  });

  it('result is always NFC', () => {
    const r = decodeCadText({ raw: 'Tiếng Việt', isMText: false });
    expect(r.text).toBe('Tiếng Việt');
    expect(r.encoding).toBe('unicode');
  });
});

describe('decodeCadText — bytes', () => {
  const bytes = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

  it('VNI bytes in an ANSI_1258 drawing', () => {
    const r = decodeCadText({ raw: bytes('ÑAÁT TRÖÔØNG'), codepage: 'ANSI_1258', isMText: false });
    expect(r.text).toBe('ĐẤT TRƯỜNG');
    expect(r.encoding).toBe('vni');
  });

  it('TCVN3 bytes in an ANSI_1252 drawing', () => {
    expect(decodeCadText({ raw: bytes('Tr¹m biÕn ¸p'), codepage: 'ANSI_1252', isMText: false }).text).toBe('Trạm biến áp');
  });

  it('genuine windows-1258 Vietnamese', () => {
    // "Tiếng Việt" in cp1258: ê + 0xEC (combining acute), ê + 0xF2 (combining dot below)
    const raw = Uint8Array.from([0x54, 0x69, 0xea, 0xec, 0x6e, 0x67, 0x20, 0x56, 0x69, 0xea, 0xf2, 0x74]);
    expect(decodeCadText({ raw, codepage: 'ANSI_1258', isMText: false }).text).toBe('Tiếng Việt');
  });

  it('UTF-8 bytes', () => {
    const raw = new TextEncoder().encode('Đường dây 22kV');
    expect(decodeCadText({ raw, codepage: 'UTF-8', isMText: false }).text).toBe('Đường dây 22kV');
  });
});

describe('decodeCodepage', () => {
  it('windows-1258', () => {
    expect(decodeCodepage(Uint8Array.from([0xd0, 0xf5, 0x6e]), 'ANSI_1258')).toBe('Đơn');
  });
  it('windows-1252 default', () => {
    expect(decodeCodepage(Uint8Array.from([0xd1, 0x80]))).toBe('Ñ€');
  });
  it('accepts loose labels', () => {
    expect(decodeCodepage(Uint8Array.from([0xd0]), 'ansi_1258')).toBe('Đ');
    expect(decodeCodepage(Uint8Array.from([0xd0]), '1258')).toBe('Đ');
  });
  it('unknown label falls back', () => {
    expect(decodeCodepage(Uint8Array.from([0x41]), 'NOPE_42')).toBe('A');
  });
});

describe('decodeStyleBatch', () => {
  it('majority vote per style', () => {
    const votes = decodeStyleBatch([
      { style: 'Vn.Times', raw: 'ÑAÁT TRÖÔØNG MAÀM NON' },
      { style: 'Vn.Times', raw: 'HOÃN HÔÏP' },
      { style: 'Vn.Times', raw: 'P. THÔÙI BÌNH' },
      { style: 'Vn.Times', raw: 'VEÕ' }, // ambiguous — does not vote
      { style: 'Arial', raw: 'Bản đồ' },
      { style: 'Arial', raw: 'CÔNG' },
      { style: 'abc', raw: 'Tr¹m biÕn ¸p' },
      { style: 'ascii', raw: 'LO A-12' },
      { style: 'MT', raw: '{\\fArial;BẢN ĐỒ}', isMText: true },
    ]);
    expect(votes.get('Vn.Times')).toBe('vni');
    expect(votes.get('Arial')).toBe('unicode');
    expect(votes.get('abc')).toBe('tcvn3');
    expect(votes.get('ascii')).toBe('unknown');
    expect(votes.has('MT')).toBe(true);
  });

  it('vote resolves ambiguous strings in decodeCadText', () => {
    const items = [
      { style: 'S', raw: 'ÑAÁT TRÖÔØNG' },
      { style: 'S', raw: 'CAÙI KHEÁ' },
      { style: 'S', raw: 'SOÂNG' },
      { style: 'S', raw: 'TÒNH' },
    ];
    const vote = decodeStyleBatch(items);
    expect(vote.get('S')).toBe('vni');
    expect(text('TÒNH', { styleEncoding: vote.get('S') })).toBe('TỊNH');
  });

  it('ties give unknown', () => {
    const v = decodeStyleBatch([
      { style: 'X', raw: 'ÑAÁT' },
      { style: 'X', raw: 'Tr¹m' },
    ]);
    expect(v.get('X')).toBe('unknown');
  });
});

describe('VIETNAMESE_CHARSET', () => {
  it('has no duplicates', () => {
    expect(new Set(VIETNAMESE_CHARSET).size).toBe(VIETNAMESE_CHARSET.length);
  });
  it('contains printable ASCII', () => {
    for (let c = 0x20; c <= 0x7e; c++) expect(VIETNAMESE_CHARSET).toContain(String.fromCharCode(c));
  });
  it('contains every Vietnamese letter in both cases and every tone', () => {
    const all = SENTENCES.join(' ') + ' ẮẰẲẴẶắằẳẵặ ỨỪỬỮỰứừửữự ỲÝỶỸỴỳýỷỹỵ ĐđƠơƯư';
    for (const ch of new Set(all + all.toUpperCase() + all.toLowerCase())) {
      expect(VIETNAMESE_CHARSET).toContain(ch);
    }
    // 12 vowels × 6 tones × 2 cases + Đ/đ, all distinct non-ASCII except the 12 plain ASCII vowels
    expect(VIETNAMESE_CHARSET.filter((c) => c.charCodeAt(0) > 0x7f && c !== c.toLowerCase()).length).toBeGreaterThanOrEqual(67);
  });
  it('contains CAD symbols and NBSP', () => {
    for (const ch of ['Ø', '°', '±', '×', ' ']) expect(VIETNAMESE_CHARSET).toContain(ch);
  });
  it('is NFC', () => {
    for (const ch of VIETNAMESE_CHARSET) expect(ch).toBe(ch.normalize('NFC'));
  });
});
