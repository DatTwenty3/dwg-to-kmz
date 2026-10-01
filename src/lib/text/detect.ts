// Encoding detection: font-name hint (weak) and content scoring (primary).

import { CAD_SYMBOLS, VIETNAMESE_LETTER_SET } from './charset';
import { tcvn3ToUnicode, tcvn3UpperToUnicode } from './tcvn3';
import { vniToUnicode } from './vni';

export type VnEncoding = 'unicode' | 'tcvn3' | 'vni' | 'unknown';
export type ConcreteEncoding = Exclude<VnEncoding, 'unknown'>;

/** Font families that carry real Unicode Vietnamese. */
const UNICODE_FONT_PREFIXES = [
  'arial', 'times new roman', 'tahoma', 'verdana', 'calibri', 'cambria', 'segoe', 'roboto',
  'courier new', 'consolas', 'georgia', 'microsoft sans serif', 'palatino linotype', 'noto ',
  'noto-', 'open sans', 'source sans', 'helvetica neue', 'dejavu', 'liberation',
];

/** Strip directory and font-file extension: "C:\\Fonts\\.VnTimeH.shx" → ".VnTimeH". */
export function fontBaseName(fontName: string): string {
  const file = fontName.trim().split(/[\\/]/).pop() ?? '';
  return file.replace(/\.(shx|ttf|otf|ttc|fon|pfb)$/i, '').trim();
}

/**
 * Weak hint from a font / style name. ".VnTime", ".VnArialH", "VnTime" → tcvn3; "VNI-Times",
 * "VNI-Helve" → vni; Arial / Times New Roman … → unicode. Style names are known to lie
 * (fixture: style "Vn.Times" holds VNI), so callers must prefer content detection.
 */
export function detectEncodingFromFont(fontName: string | undefined): VnEncoding {
  if (!fontName) return 'unknown';
  const l = fontBaseName(fontName).toLowerCase();
  if (!l) return 'unknown';
  if (l.startsWith('vni')) return 'vni';
  if (/^\.?vn/.test(l)) return 'tcvn3';
  if (UNICODE_FONT_PREFIXES.some((p) => l.startsWith(p))) return 'unicode';
  return 'unknown';
}

// ---------------------------------------------------------------- content scoring

const SYMBOLS = new Set(CAD_SYMBOLS);
/** Symbols that are TCVN3 letter codes; suspicious when written inside a word. */
const GLUE_SUSPECT = new Set(['©', '®', '§', '¶', '«', '»', '¢', '£', '¥', '¼', '½', '¾', '·', '÷', '¹']);
const TONE_MARKS = new Set(['\u0300', '\u0301', '\u0303', '\u0309', '\u0323']);
const SHAPE_MARKS = new Set(['\u0302', '\u0306', '\u031b']);
const VOWEL_KEYS = new Set(['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y']);

/** Vowel nuclei allowed in Vietnamese syllables (after removing the "qu"/"gi" onset letter). */
const VALID_NUCLEI = new Set([
  'a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y',
  'ai', 'ao', 'au', 'ay', 'âu', 'ây', 'eo', 'êu', 'ia', 'iê', 'iu', 'oa', 'oă', 'oe', 'oi', 'ôi',
  'ơi', 'oo', 'ua', 'uâ', 'uê', 'ui', 'uô', 'uơ', 'uy', 'ưa', 'ưi', 'ươ', 'ưu', 'yê',
  'iêu', 'yêu', 'oai', 'oay', 'oao', 'oeo', 'uây', 'uôi', 'ươi', 'ươu', 'uya', 'uyê', 'uyu',
]);

const LETTER_RE = /\p{L}/u;
const ASCII_RE = /^[\x00-\x7f]*$/;

function vowelKey(base: string, shape: string): string | null {
  if (!shape) return VOWEL_KEYS.has(base) ? base : null;
  const k = (base + shape).normalize('NFC');
  return VOWEL_KEYS.has(k) ? k : 'X'; // a shape mark on an impossible base → invalid vowel
}

/** Orthographic implausibility of one word (only called for words with non-ASCII letters). */
function wordPenalty(word: string): number {
  let p = 0;
  const nfd = word.normalize('NFD');
  const letters: { base: string; shape: string }[] = [];
  let tones = 0;
  for (const c of nfd) {
    if (TONE_MARKS.has(c)) {
      tones++;
      const last = letters[letters.length - 1];
      if (!last || vowelKey(last.base, last.shape) === null) p += 1; // tone on a consonant
      continue;
    }
    if (SHAPE_MARKS.has(c)) {
      const last = letters[letters.length - 1];
      if (last) last.shape += c;
      continue;
    }
    if (/\p{M}/u.test(c)) continue;
    letters.push({ base: c.toLowerCase(), shape: '' });
  }
  if (tones > 1) p += 1;

  // vowel clusters
  let i = 0;
  while (i < letters.length) {
    const k = vowelKey(letters[i].base, letters[i].shape);
    if (k === null) {
      i++;
      continue;
    }
    const start = i;
    const keys: string[] = [];
    while (i < letters.length) {
      const kk = vowelKey(letters[i].base, letters[i].shape);
      if (kk === null) break;
      keys.push(kk);
      i++;
    }
    const prev = start > 0 ? letters[start - 1].base : '';
    if (keys.length > 1 && ((prev === 'q' && keys[0] === 'u') || (prev === 'g' && keys[0] === 'i'))) {
      keys.shift();
    }
    if (!VALID_NUCLEI.has(keys.join(''))) p += 1;
  }

  // case consistency: UPPER, lower or Capitalised words only
  const cased = [...word].filter((c) => LETTER_RE.test(c));
  const isUp = cased.map((c) => c !== c.toLowerCase());
  const isLow = cased.map((c) => c !== c.toUpperCase());
  const allUp = isUp.every((u, j) => u || !isLow[j]);
  const allLow = isLow.every((l, j) => l || !isUp[j]);
  const capitalised = isUp[0] && isLow.slice(1).every((l, j) => l || !isUp[j + 1]);
  if (!allUp && !allLow && !capitalised) p += 0.5;
  return p;
}

/** How implausible `text` (already decoded to Unicode) is as Vietnamese / CAD text. */
export function implausibility(text: string): number {
  let p = 0;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch.charCodeAt(0) < 0x80) continue;
    if (VIETNAMESE_LETTER_SET.has(ch)) continue;
    if (ch === 'Ø' || ch === 'ø') {
      // diameter sign is fine on its own, but not glued after a letter (that is a VNI grave mark)
      if (i > 0 && LETTER_RE.test(chars[i - 1])) p += 1;
      continue;
    }
    if (SYMBOLS.has(ch)) {
      // ® © § … glued to a letter are TCVN3 letters (đ â Đ …), not symbols
      if (GLUE_SUSPECT.has(ch) && (LETTER_RE.test(chars[i - 1] ?? '') || LETTER_RE.test(chars[i + 1] ?? ''))) p += 1;
      continue;
    }
    p += 1;
  }
  for (const word of text.split(/[^\p{L}\p{M}]+/u)) {
    if (!word || ASCII_RE.test(word)) continue;
    p += wordPenalty(word);
  }
  return p;
}

/** TCVN3 typed in a normal font cannot show toned capitals; ALL-CAPS ASCII + lowercase TCVN3 letters ⇒ "…H" font. */
export function looksLikeUpperTcvn3(sample: string): boolean {
  const ascii = sample.match(/[A-Za-z]/g) ?? [];
  if (ascii.length < 2 || ascii.some((c) => c >= 'a')) return false;
  const decoded = tcvn3ToUnicode(sample);
  return [...decoded].some((c) => c.charCodeAt(0) >= 0x80 && c !== c.toUpperCase());
}

export interface ContentScore {
  /** Single winner, or 'unknown' when several encodings are equally plausible / string is ASCII. */
  best: VnEncoding;
  /** Encodings tied for the lowest implausibility (never contains 'unknown'). */
  plausible: ConcreteEncoding[];
  penalties: Partial<Record<ConcreteEncoding, number>>;
}

const ALL: ConcreteEncoding[] = ['unicode', 'vni', 'tcvn3'];

/** True when the string contains a code point ≥ U+0100 — it cannot be 8-bit TCVN3/VNI data. */
export function hasWideChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return true;
  return false;
}

export function scoreContent(s: string): ContentScore {
  if (hasWideChars(s)) return { best: 'unicode', plausible: ['unicode'], penalties: {} };
  if (ASCII_RE.test(s)) return { best: 'unknown', plausible: [...ALL], penalties: {} };
  const penalties: Record<ConcreteEncoding, number> = {
    unicode: implausibility(s),
    vni: implausibility(vniToUnicode(s)),
    tcvn3: implausibility(tcvn3ToUnicode(s)),
  };
  // TCVN3 set in an uppercase "…H" font: lowercase codes render as capitals.
  if (looksLikeUpperTcvn3(s)) penalties.tcvn3 = Math.min(penalties.tcvn3, implausibility(tcvn3UpperToUnicode(s)));
  const min = Math.min(penalties.unicode, penalties.vni, penalties.tcvn3);
  const plausible = ALL.filter((e) => penalties[e] === min);
  return { best: plausible.length === 1 ? plausible[0] : 'unknown', plausible, penalties };
}

/**
 * Content-based detection (primary signal). Strings with a code point ≥ U+0100 are Unicode;
 * pure ASCII and genuinely ambiguous strings return 'unknown' (resolve with decodeStyleBatch).
 */
export function detectEncodingFromContent(s: string): VnEncoding {
  return scoreContent(s).best;
}

/** Pick one encoding: unique content winner, else the first hint that content allows. */
export function resolveEncoding(
  plausible: readonly ConcreteEncoding[],
  hints: readonly (VnEncoding | undefined)[],
): ConcreteEncoding {
  if (plausible.length === 1) return plausible[0];
  for (const h of hints) {
    if (h && h !== 'unknown' && plausible.includes(h)) return h;
  }
  if (plausible.includes('unicode')) return 'unicode';
  return plausible[0] ?? 'unicode';
}
