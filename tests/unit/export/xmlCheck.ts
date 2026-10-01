// Tiny XML well-formedness checker for tests (no DOMParser in Node, no extra deps).
// Checks: prolog, tag balance, single root, attribute syntax, entity references,
// CDATA/comment termination, and no raw '<' / '&' in text.

const NAME = /^[A-Za-z_][\w.:-]*$/;
const ATTRS = /^(\s+[A-Za-z_][\w.:-]*\s*=\s*("[^"<]*"|'[^'<]*'))*\s*$/;
const ENTITY = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

export function checkXml(xml: string): void {
  let i = 0;
  if (xml.startsWith('<?xml')) {
    const end = xml.indexOf('?>');
    if (end < 0) throw new Error('unterminated prolog');
    i = end + 2;
  }
  const stack: string[] = [];
  let roots = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = lt < 0 ? xml.slice(i) : xml.slice(i, lt);
    if (ENTITY.test(text)) throw new Error(`bad entity near ${i}: ${text.slice(0, 60)}`);
    if (text.includes('>') && /\]\]>/.test(text)) throw new Error(`stray ]]> near ${i}`);
    if (stack.length === 0 && text.trim() !== '') throw new Error(`text outside root at ${i}`);
    if (lt < 0) break;
    if (xml.startsWith('<![CDATA[', lt)) {
      if (stack.length === 0) throw new Error('CDATA outside root');
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new Error('unterminated CDATA');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 3;
      continue;
    }
    const gt = xml.indexOf('>', lt);
    if (gt < 0) throw new Error('unterminated tag');
    const raw = xml.slice(lt + 1, gt);
    if (raw.includes('<')) throw new Error(`'<' inside tag at ${lt}`);
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (open !== name) throw new Error(`mismatched </${name}>, expected </${open}> at ${lt}`);
    } else {
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const m = /^([^\s]+)([\s\S]*)$/.exec(body);
      if (!m || !NAME.test(m[1])) throw new Error(`bad tag name at ${lt}: ${raw.slice(0, 40)}`);
      if (!ATTRS.test(m[2])) throw new Error(`bad attributes at ${lt}: ${raw.slice(0, 80)}`);
      if (ENTITY.test(m[2])) throw new Error(`bad entity in attribute at ${lt}`);
      if (stack.length === 0) {
        roots++;
        if (roots > 1) throw new Error('multiple roots');
      }
      if (!selfClose) stack.push(m[1]);
    }
    i = gt + 1;
  }
  if (stack.length) throw new Error(`unclosed tags: ${stack.join(' > ')}`);
  if (roots !== 1) throw new Error('no root element');
}

/** Decode the five predefined XML entities. */
export function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n] as string,
  );
}
