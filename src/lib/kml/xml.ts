// Small, tolerant XML reader (no DOMParser: must run in Web Workers and Node).
// Supports elements, attributes, text, CDATA, comments, processing instructions, DOCTYPE, the five named
// entities and numeric `&#N;` / `&#xH;`. Namespace prefixes (`gx:`, `kml:`) are dropped from names.
// Whitespace-only text between elements is ignored. Malformed input never throws: stray closing tags are
// skipped and unclosed elements are closed at EOF.

export interface XmlNode {
  /** Local name (prefix removed). The synthetic root is `#root`. */
  name: string;
  attrs: Record<string, string> | null;
  children: XmlNode[];
  /** Concatenated character data (entities decoded, CDATA verbatim); whitespace-only runs omitted. */
  text: string;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const cp = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88 ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return m;
      return String.fromCodePoint(cp);
    }
    return NAMED[body] ?? m;
  });
}

const localName = (n: string): string => {
  const i = n.indexOf(':');
  return i < 0 ? n : n.slice(i + 1);
};

const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const NON_WS = /\S/;

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: null, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let cur = root;
  const n = src.length;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const t = src.slice(i);
      if (NON_WS.test(t)) cur.text += decodeEntities(t);
      break;
    }
    if (lt > i) {
      const t = src.slice(i, lt);
      if (NON_WS.test(t)) cur.text += decodeEntities(t);
    }
    const c = src.charCodeAt(lt + 1);

    if (c === 33 /* ! */) {
      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        i = end < 0 ? n : end + 3;
      } else if (src.startsWith('<![CDATA[', lt)) {
        const end = src.indexOf(']]>', lt + 9);
        cur.text += src.slice(lt + 9, end < 0 ? n : end);
        i = end < 0 ? n : end + 3;
      } else {
        // <!DOCTYPE ... [ ... ]>
        let depth = 0;
        let j = lt + 2;
        for (; j < n; j++) {
          const ch = src.charCodeAt(j);
          if (ch === 91) depth++;
          else if (ch === 93) depth--;
          else if (ch === 62 && depth <= 0) break;
        }
        i = j + 1;
      }
      continue;
    }
    if (c === 63 /* ? */) {
      const end = src.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === 47 /* / */) {
      const end = src.indexOf('>', lt + 2);
      const stop = end < 0 ? n : end;
      const name = localName(src.slice(lt + 2, stop).trim());
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          cur = stack[k - 1];
          break;
        }
      }
      i = stop + 1;
      continue;
    }

    // Opening tag: find its '>' (quote aware only when the tag contains quotes).
    let gt = src.indexOf('>', lt + 1);
    if (gt < 0) break;
    if (/["']/.test(src.slice(lt + 1, gt))) {
      let quote = 0;
      let j = lt + 1;
      for (; j < n; j++) {
        const ch = src.charCodeAt(j);
        if (quote) {
          if (ch === quote) quote = 0;
        } else if (ch === 34 || ch === 39) quote = ch;
        else if (ch === 62) break;
      }
      gt = j;
    }
    let inner = src.slice(lt + 1, gt);
    const selfClose = inner.charCodeAt(inner.length - 1) === 47;
    if (selfClose) inner = inner.slice(0, -1);
    let sp = 0;
    while (sp < inner.length && !/\s/.test(inner[sp])) sp++;
    const node: XmlNode = { name: localName(inner.slice(0, sp)), attrs: null, children: [], text: '' };
    if (sp < inner.length && inner.indexOf('=', sp) >= 0) {
      const attrs: Record<string, string> = {};
      ATTR_RE.lastIndex = sp;
      let m: RegExpExecArray | null;
      while ((m = ATTR_RE.exec(inner))) {
        const k = localName(m[1]);
        if (!(k in attrs)) attrs[k] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      node.attrs = attrs;
    }
    cur.children.push(node);
    if (!selfClose) {
      stack.push(node);
      cur = node;
    }
    i = gt + 1;
  }
  return root;
}

/** First direct child with the given local name. */
export function child(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) if (c.name === name) return c;
  return undefined;
}

/** Trimmed text of the first direct child with the given name ('' when absent). */
export function childText(node: XmlNode, name: string): string {
  const c = child(node, name);
  return c ? c.text.trim() : '';
}
