// Vietnamese letter inventory + the deck.gl TextLayer character set.

const BASE_VOWELS = ['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y'];
const TONES = ['', '̀', '́', '̉', '̃', '̣'];

function buildLetters(): string[] {
  const lower: string[] = [];
  for (const v of BASE_VOWELS) for (const t of TONES) lower.push((v + t).normalize('NFC'));
  lower.push('đ');
  return [...lower, ...lower.map((c) => c.toUpperCase())];
}

/** 12 vowels × 6 tones + đ, both cases = 146 letters (includes the plain ASCII vowels). */
export const VIETNAMESE_LETTERS: readonly string[] = buildLetters();
export const VIETNAMESE_LETTER_SET: ReadonlySet<string> = new Set(VIETNAMESE_LETTERS);

/** Non-letter symbols that legitimately appear in CAD text. */
export const CAD_SYMBOLS: readonly string[] = [
  ' ', // NBSP (MTEXT \~)
  'Ø', 'ø', '°', '±', '×', '÷', '²', '³', '¹', 'µ', '·', '¼', '½', '¾', '©', '®', '§', '¶', '«', '»',
  '¢', '£', '¥', '€', '–', '—', '‘', '’', '“', '”', '…', '•', '′', '″', '≤', '≥', '≈', '≠', '∞',
  '√', 'Δ', 'Φ', '⌀', '№',
];

function buildCharset(): string[] {
  const out = new Set<string>();
  for (let c = 0x20; c <= 0x7e; c++) out.add(String.fromCharCode(c));
  for (const l of VIETNAMESE_LETTERS) out.add(l);
  for (const s of CAD_SYMBOLS) out.add(s);
  return [...out];
}

/** Every character deck.gl's TextLayer must rasterize (ASCII + Vietnamese + CAD symbols Ø ° ± ×). */
export const VIETNAMESE_CHARSET: string[] = buildCharset();
