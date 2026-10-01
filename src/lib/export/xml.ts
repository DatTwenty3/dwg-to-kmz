// XML string helpers for the KML writer.

// Characters not allowed in XML 1.0 (C0 controls except TAB/LF/CR, lone surrogates, U+FFFE/FFFF).
// Valid surrogate pairs are matched first (and kept) so only lone surrogates are dropped.
const NONCHARS = String.fromCharCode(0xfffe, 0xffff);
const INVALID_XML = new RegExp(
  '[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uD800-\\uDFFF' + NONCHARS + ']',
  'g',
);
const keepPairs = (m: string): string => (m.length === 2 ? m : '');
const NEEDS_ESCAPE = /[&<>"']/;
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** NFC-normalise and drop characters that are illegal in XML 1.0. */
export function cleanText(s: string): string {
  return s.normalize('NFC').replace(INVALID_XML, keepPairs);
}

/** Full XML escaping (`& < > " '`) of an NFC-normalised, XML-legal string. */
export function escapeXml(s: string): string {
  const t = cleanText(s);
  return NEEDS_ESCAPE.test(t) ? t.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]) : t;
}

/** HTML escaping for text placed inside an HTML description. */
export const escapeHtml = escapeXml;

/** Wrap content in CDATA, splitting any `]]>` so the section cannot be terminated early. */
export function cdata(s: string): string {
  return '<![CDATA[' + cleanText(s).split(']]>').join(']]]]><![CDATA[>') + ']]>';
}
