// Vietnamese text decoding for CAD strings. Owned by agent `vietnamese-text`.
//
// Pipeline for one string (decodeCadText):
//   bytes? → Latin-1 view (keeps TCVN3/VNI bytes) or $DWGCODEPAGE decode
//   → TEXT %% codes / MTEXT formatting codes split into runs (per inline font)
//   → per font group: content scoring (primary) → style vote → font hint
//   → TCVN3 / VNI → Unicode → NFC.

import { bytesToLatin1, codepageLabel, decodeCodepage } from './codepage';
import {
  detectEncodingFromContent,
  detectEncodingFromFont,
  looksLikeUpperTcvn3,
  resolveEncoding,
  scoreContent,
  type ConcreteEncoding,
  type VnEncoding,
} from './detect';
import { parseMText, parseText, stripMText, type TextPiece } from './mtext';
import { isTcvn3UpperFont, tcvn3ToUnicode, tcvn3UpperToUnicode } from './tcvn3';
import { vniToUnicode } from './vni';

export type { VnEncoding } from './detect';
export { detectEncodingFromFont, detectEncodingFromContent, decodeCodepage, tcvn3ToUnicode, vniToUnicode, stripMText };
export { tcvn3UpperToUnicode, isTcvn3UpperFont } from './tcvn3';
export { VIETNAMESE_CHARSET, VIETNAMESE_LETTERS } from './charset';

export interface DecodeInput {
  raw: string | Uint8Array;
  /** Font file / style name hint, may be empty. */
  styleFont?: string;
  /** $DWGCODEPAGE, e.g. 'ANSI_1258'. */
  codepage?: string;
  isMText: boolean;
  /** Encoding chosen for the whole style by majority vote (see decodeStyleBatch). */
  styleEncoding?: VnEncoding;
}

export interface DecodeResult {
  /** Unicode NFC, formatting codes removed, lines separated by "\n". */
  text: string;
  encoding: VnEncoding;
  warnings: string[];
}

const ASCII_RE = /^[\x00-\x7f]*$/;
export const VNI_LEFTOVER_RE = /[ÑÖÛÏñöûï]|[AEIOUYĂÂÊÔƠƯaeiouyăâêôơư][ÙÕØùõø]/u;
const SINGLE_BYTE_LABELS = new Set(['windows-1252', 'windows-1258']);

function convert(text: string, enc: ConcreteEncoding, upper: boolean): string {
  if (enc === 'vni') return vniToUnicode(text);
  if (enc === 'tcvn3') return upper ? tcvn3UpperToUnicode(text) : tcvn3ToUnicode(text);
  return text.normalize('NFC');
}

interface GroupResult {
  encoding: VnEncoding;
  weight: number;
}

function decodePieces(
  pieces: TextPiece[],
  styleFont: string | undefined,
  styleEncoding: VnEncoding | undefined,
): { text: string; encoding: VnEncoding } {
  const groups = new Map<string, TextPiece[]>();
  for (const p of pieces) {
    if (p.literal) continue;
    const key = p.font ?? '';
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }

  const decoded = new Map<TextPiece, string>();
  let main: GroupResult = { encoding: 'unknown', weight: -1 };
  for (const [key, group] of groups) {
    const sample = group.map((p) => p.text).join(' ');
    const score = scoreContent(sample);
    const fontHint = detectEncodingFromFont(key || styleFont);
    const hints = key ? [fontHint, styleEncoding] : [styleEncoding, fontHint];
    const enc = resolveEncoding(score.plausible, hints);
    const upper = enc === 'tcvn3' && (isTcvn3UpperFont(key || styleFont) || looksLikeUpperTcvn3(sample));
    for (const p of group) decoded.set(p, convert(p.text, enc, upper));

    // Which encoding to report: the group with the most non-ASCII material.
    const informative = score.plausible.length === 1 || hints.some((h) => h && h !== 'unknown' && score.plausible.includes(h));
    const weight = ASCII_RE.test(sample) ? 0 : sample.length;
    const reported: VnEncoding = informative || weight > 0 ? enc : 'unknown';
    if (weight > main.weight || (weight === main.weight && main.encoding === 'unknown')) {
      main = { encoding: reported, weight };
    }
  }

  const text = pieces.map((p) => (p.literal ? p.text : decoded.get(p) ?? p.text)).join('');
  return { text: text.normalize('NFC'), encoding: main.encoding };
}

function decodeString(s: string, input: DecodeInput, warnings: string[]): { text: string; encoding: VnEncoding } {
  const parsed = input.isMText ? parseMText(s) : parseText(s);
  warnings.push(...parsed.warnings);
  return decodePieces(parsed.pieces, input.styleFont, input.styleEncoding);
}

/** Decode one TEXT / ATTRIB / MTEXT string to clean Unicode NFC. */
export function decodeCadText(input: DecodeInput): DecodeResult {
  const warnings: string[] = [];
  let result: { text: string; encoding: VnEncoding };

  if (typeof input.raw === 'string') {
    result = decodeString(input.raw, input, warnings);
  } else {
    const label = codepageLabel(input.codepage);
    if (SINGLE_BYTE_LABELS.has(label)) {
      // Legacy 8-bit text: look at the raw bytes first (TCVN3/VNI live there); only if the
      // content is not legacy-encoded decode it through the declared codepage.
      const legacyWarnings: string[] = [];
      const legacy = decodeString(bytesToLatin1(input.raw), input, legacyWarnings);
      if (legacy.encoding === 'vni' || legacy.encoding === 'tcvn3') {
        warnings.push(...legacyWarnings);
        result = legacy;
      } else {
        result = decodeString(decodeCodepage(input.raw, input.codepage), input, warnings);
      }
    } else {
      result = decodeString(decodeCodepage(input.raw, input.codepage), input, warnings);
    }
  }

  if (result.text.includes('�') && !warnings.some((w) => w.includes('�'))) {
    warnings.push('Chuỗi chứa ký tự không giải mã được (�) — kiểm tra bảng mã của bản vẽ.');
  }
  // Leftover VNI markers only. Plain Ù/Õ are real letters (CHÙA, VÕ) and a lone Ø is the
  // diameter sign (%%c), so those count only right after a vowel.
  if (result.encoding === 'vni' && VNI_LEFTOVER_RE.test(result.text)) {
    warnings.push(`Chuỗi VNI có thể giải mã chưa trọn: "${result.text}"`);
  }
  return { text: result.text, encoding: result.encoding, warnings };
}

/** Plain text used to judge a string's encoding (formatting codes removed, default font only). */
function detectionSample(raw: string, isMText: boolean | undefined): string {
  const mtext = isMText ?? /\\[PfFHWACpLlOoSU~]|[{}]/.test(raw);
  const pieces = (mtext ? parseMText(raw) : parseText(raw)).pieces;
  return pieces
    .filter((p) => !p.literal && p.font === undefined)
    .map((p) => p.text)
    .join(' ');
}

/** Majority vote per style: returns the encoding to use for ambiguous strings of each style. */
export function decodeStyleBatch(items: { style: string; raw: string; isMText?: boolean }[]): Map<string, VnEncoding> {
  const counts = new Map<string, Record<ConcreteEncoding, number>>();
  for (const item of items) {
    let c = counts.get(item.style);
    if (!c) {
      c = { unicode: 0, vni: 0, tcvn3: 0 };
      counts.set(item.style, c);
    }
    const score = scoreContent(detectionSample(item.raw, item.isMText));
    if (score.best !== 'unknown') c[score.best]++;
  }
  const out = new Map<string, VnEncoding>();
  for (const [style, c] of counts) {
    const ranked = (Object.entries(c) as [ConcreteEncoding, number][]).sort((a, b) => b[1] - a[1]);
    out.set(style, ranked[0][1] > 0 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : 'unknown');
  }
  return out;
}
