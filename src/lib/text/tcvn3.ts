// TCVN3 (ABC, TCVN 5712:1993 VN3) → Unicode.
//
// Source of the table: Wikipedia "VSCII" (TCVN 5712), character-set table, VSCII-3 = cells without
// background colour; cross-checked against Ken Lunde, "CJKV Information Processing" 2nd ed.,
// Appendix L "Vietnamese Character Sets" (cited there) and https://vietunicode.sourceforge.net/charset/.
// https://en.wikipedia.org/wiki/VSCII  (fetched 2026-10-01, raw wikitext parsed programmatically)
//
// VN3 keeps ASCII and adds 75 characters in 0xA0..0xFE: NBSP, 7 uppercase letters without tone
// (Ă Â Ê Ô Ơ Ư Đ) and 67 lowercase letters. The positions VN2 uses for extra uppercase letters /
// combining marks (0xAF, 0xB0–0xB4, 0xBA, 0xBF–0xC5, 0xCD, 0xD9–0xDB, 0xE0, 0xF0, 0xFF) are NOT part
// of VN3 and are left untouched.
//
// Toned capitals are written with a separate "uppercase" font (.VnTimeH, .VnArialH … — names ending
// in "H"): same byte codes as the lowercase letters, rendered as capitals → map, then toUpperCase().

/** byte value (as Latin-1 code unit) → Unicode, VN3 only. */
const TCVN3_PAIRS: [number, string][] = [
  [0xa1, 'Ă'], [0xa2, 'Â'], [0xa3, 'Ê'], [0xa4, 'Ô'], [0xa5, 'Ơ'], [0xa6, 'Ư'], [0xa7, 'Đ'],
  [0xa8, 'ă'], [0xa9, 'â'], [0xaa, 'ê'], [0xab, 'ô'], [0xac, 'ơ'], [0xad, 'ư'], [0xae, 'đ'],
  // a
  [0xb5, 'à'], [0xb6, 'ả'], [0xb7, 'ã'], [0xb8, 'á'], [0xb9, 'ạ'],
  // ă
  [0xbb, 'ằ'], [0xbc, 'ẳ'], [0xbd, 'ẵ'], [0xbe, 'ắ'], [0xc6, 'ặ'],
  // â
  [0xc7, 'ầ'], [0xc8, 'ẩ'], [0xc9, 'ẫ'], [0xca, 'ấ'], [0xcb, 'ậ'],
  // e
  [0xcc, 'è'], [0xce, 'ẻ'], [0xcf, 'ẽ'], [0xd0, 'é'], [0xd1, 'ẹ'],
  // ê
  [0xd2, 'ề'], [0xd3, 'ể'], [0xd4, 'ễ'], [0xd5, 'ế'], [0xd6, 'ệ'],
  // i
  [0xd7, 'ì'], [0xd8, 'ỉ'], [0xdc, 'ĩ'], [0xdd, 'í'], [0xde, 'ị'],
  // o
  [0xdf, 'ò'], [0xe1, 'ỏ'], [0xe2, 'õ'], [0xe3, 'ó'], [0xe4, 'ọ'],
  // ô
  [0xe5, 'ồ'], [0xe6, 'ổ'], [0xe7, 'ỗ'], [0xe8, 'ố'], [0xe9, 'ộ'],
  // ơ
  [0xea, 'ờ'], [0xeb, 'ở'], [0xec, 'ỡ'], [0xed, 'ớ'], [0xee, 'ợ'],
  // u
  [0xef, 'ù'], [0xf1, 'ủ'], [0xf2, 'ũ'], [0xf3, 'ú'], [0xf4, 'ụ'],
  // ư
  [0xf5, 'ừ'], [0xf6, 'ử'], [0xf7, 'ữ'], [0xf8, 'ứ'], [0xf9, 'ự'],
  // y
  [0xfa, 'ỳ'], [0xfb, 'ỷ'], [0xfc, 'ỹ'], [0xfd, 'ý'], [0xfe, 'ỵ'],
];

export const TCVN3_TABLE: ReadonlyMap<string, string> = new Map(
  TCVN3_PAIRS.map(([code, uni]) => [String.fromCharCode(code), uni]),
);

/** Font names of the TCVN3 uppercase family: `.VnTimeH`, `.VnArialH`, `.VnAvantH.shx` … */
export function isTcvn3UpperFont(fontName: string | undefined): boolean {
  if (!fontName) return false;
  const base = fontName.trim().replace(/\.(shx|ttf|otf|ttc)$/i, '');
  return /^\.?vn/i.test(base) && !/^vni/i.test(base) && /H$/.test(base);
}

/** Map TCVN3 code units (string read byte-for-byte as Latin-1) to Unicode NFC. */
export function tcvn3ToUnicode(s: string): string {
  let out = '';
  for (const ch of s) out += TCVN3_TABLE.get(ch) ?? ch;
  return out.normalize('NFC');
}

/** TCVN3 text set in an uppercase ("…H") font: every letter renders as a capital. */
export function tcvn3UpperToUnicode(s: string): string {
  return tcvn3ToUnicode(s).toUpperCase().normalize('NFC');
}
