// Test-only encoders Unicode → legacy (independent of the decoders under test).

import { TCVN3_TABLE } from '@/lib/text/tcvn3';

const TCVN3_REVERSE = new Map([...TCVN3_TABLE].map(([code, uni]) => [uni, code]));

/** Unicode → TCVN3 (normal font). Toned capitals do not exist in VN3 → throws. */
export function toTcvn3(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (ch.charCodeAt(0) < 0x80) out += ch;
    else {
      const code = TCVN3_REVERSE.get(ch);
      if (code === undefined) throw new Error(`no TCVN3 code for ${ch}`);
      out += code;
    }
  }
  return out;
}

/** Unicode capitals → TCVN3 as typed with an uppercase "…H" font (lowercase codes). */
export function toTcvn3Upper(s: string): string {
  return toTcvn3(s.normalize('NFC').toLowerCase()).replace(/[a-z]/g, (c) => c.toUpperCase());
}

const TONE_TO_VNI: Record<string, string> = { '́': 'ù', '̀': 'ø', '̉': 'û', '̃': 'õ', '̣': 'ï' };
const CIRC_TO_VNI: Record<string, string> = { '': 'â', '́': 'á', '̀': 'à', '̉': 'å', '̃': 'ã', '̣': 'ä' };
const BREVE_TO_VNI: Record<string, string> = { '': 'ê', '́': 'é', '̀': 'è', '̉': 'ú', '̃': 'ü', '̣': 'ë' };
const VNI_SINGLE: Record<string, string> = { 'đ': 'ñ', 'ị': 'ò', 'ĩ': 'ó', 'ỉ': 'æ', 'ỵ': 'î' };

/** Unicode → VNI Windows (as read byte-for-byte into Latin-1 code units). */
export function toVni(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const lower = ch.toLowerCase();
    const upper = ch !== lower;
    const fix = (t: string) => (upper ? t.toUpperCase() : t);
    if (VNI_SINGLE[lower]) {
      out += fix(VNI_SINGLE[lower]);
      continue;
    }
    if (ch.charCodeAt(0) < 0x80) {
      out += ch;
      continue;
    }
    const d = lower.normalize('NFD');
    let base = d[0];
    let horn = false;
    let shape = '';
    let tone = '';
    for (const m of d.slice(1)) {
      if (m === '̛') horn = true;
      else if (m === '̂' || m === '̆') shape = m;
      else tone = m;
    }
    if (horn) base = base === 'o' ? 'ô' : 'ö';
    let enc = base;
    if (shape === '̂') enc += CIRC_TO_VNI[tone];
    else if (shape === '̆') enc += BREVE_TO_VNI[tone];
    else if (tone) enc += TONE_TO_VNI[tone];
    out += fix(enc);
  }
  return out;
}
