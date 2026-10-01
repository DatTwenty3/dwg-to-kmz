// VNI (VNI Windows, fonts VNI-Times, VNI-Helve …) → Unicode.
//
// VNI writes a base letter followed by a "modifier" byte that the font draws as a diacritic over
// the previous glyph. We turn every modifier that follows a vowel into Unicode combining marks and
// let NFC compose them. A handful of bytes are complete letters on their own (Đ Ơ Ư Ị Ĩ Ỉ Ỵ).

const ACUTE = '́';
const GRAVE = '̀';
const HOOK = '̉';
const TILDE = '̃';
const DOT = '̣';
const CIRC = '̂';
const BREVE = '̆';

const TONE_MARKS = new Set([ACUTE, GRAVE, HOOK, TILDE, DOT]);

interface Modifier {
  /** circumflex / breve, applied before the tone. */
  shape?: string;
  tone?: string;
}

/** Keys are lowercase; uppercase modifiers (0xC0–0xDF) are looked up via toLowerCase(). */
const MODIFIERS: ReadonlyMap<string, Modifier> = new Map<string, Modifier>([
  ['ù', { tone: ACUTE }],
  ['ø', { tone: GRAVE }],
  ['û', { tone: HOOK }],
  ['õ', { tone: TILDE }],
  ['ï', { tone: DOT }],
  ['â', { shape: CIRC }],
  ['á', { shape: CIRC, tone: ACUTE }],
  ['à', { shape: CIRC, tone: GRAVE }],
  ['å', { shape: CIRC, tone: HOOK }],
  ['ã', { shape: CIRC, tone: TILDE }],
  ['ä', { shape: CIRC, tone: DOT }],
  ['ê', { shape: BREVE }],
  ['é', { shape: BREVE, tone: ACUTE }],
  ['è', { shape: BREVE, tone: GRAVE }],
  ['ú', { shape: BREVE, tone: HOOK }],
  ['ü', { shape: BREVE, tone: TILDE }],
  ['ë', { shape: BREVE, tone: DOT }],
]);

/** Single-byte VNI letters. */
const STANDALONE: ReadonlyMap<string, string> = new Map([
  ['Ñ', 'Đ'], ['ñ', 'đ'],
  ['Ô', 'Ơ'], ['ô', 'ơ'],
  ['Ö', 'Ư'], ['ö', 'ư'],
  ['Ò', 'Ị'], ['ò', 'ị'],
  ['Ó', 'Ĩ'], ['ó', 'ĩ'],
  ['Æ', 'Ỉ'], ['æ', 'ỉ'],
  ['Î', 'Ỵ'], ['î', 'ỵ'],
]);

/** Characters that only make sense as VNI modifiers / VNI letters (used by detection). */
export const VNI_MODIFIER_CHARS: ReadonlySet<string> = new Set(
  [...MODIFIERS.keys()].flatMap((k) => [k, k.toUpperCase()]),
);
export const VNI_STANDALONE_CHARS: ReadonlySet<string> = new Set(STANDALONE.keys());

const TONE_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y', 'ơ', 'ư']);

/**
 * Can `mod` be applied to the cluster `cluster` (base char + combining marks already attached)?
 * The test runs on the already-converted base, so ơ/ư produced from Ô/Ö count as vowels.
 */
function canApply(cluster: string, mod: Modifier): boolean {
  const base = cluster[0].toLowerCase();
  const marks = cluster.slice(1);
  if (!TONE_VOWELS.has(base)) return false;
  if (mod.tone && [...marks].some((m) => TONE_MARKS.has(m))) return false;
  if (mod.shape) {
    if (marks.includes(CIRC) || marks.includes(BREVE)) return false;
    if (mod.shape === CIRC && base !== 'a' && base !== 'e' && base !== 'o') return false;
    if (mod.shape === BREVE && base !== 'a') return false;
  }
  return true;
}

/** Convert a VNI string (code units = bytes, read as Latin-1) to Unicode NFC. */
export function vniToUnicode(s: string): string {
  const clusters: string[] = [];
  for (const ch of s) {
    const single = STANDALONE.get(ch);
    if (single !== undefined) {
      clusters.push(single);
      continue;
    }
    const mod = MODIFIERS.get(ch.toLowerCase());
    if (mod && clusters.length > 0 && canApply(clusters[clusters.length - 1], mod)) {
      clusters[clusters.length - 1] += (mod.shape ?? '') + (mod.tone ?? '');
      continue;
    }
    clusters.push(ch);
  }
  return clusters.join('').normalize('NFC');
}
