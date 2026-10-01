// TEXT special codes (%%c, %%d, %%u …) and MTEXT inline formatting codes.

/** One run of text. `literal` runs are already Unicode (\U+XXXX, %%d …) and must not be re-decoded. */
export interface TextPiece {
  text: string;
  /** Inline font switched on by \f / \F (MTEXT only); undefined = the entity's style font. */
  font?: string;
  literal: boolean;
}

export interface ParsedText {
  pieces: TextPiece[];
  warnings: string[];
}

const NBSP = ' ';

/** \M+nXXXX: n = AutoCAD multibyte codepage index. */
const MBCS_LABELS: Record<string, string> = { '1': 'shift_jis', '2': 'big5', '3': 'euc-kr', '5': 'gbk' };

class PieceBuilder {
  pieces: TextPiece[] = [];
  push(text: string, font: string | undefined, literal: boolean): void {
    if (!text) return;
    const last = this.pieces[this.pieces.length - 1];
    if (last && last.font === font && last.literal === literal) last.text += text;
    else this.pieces.push({ text, font, literal });
  }
}

interface PercentCode {
  length: number;
  text: string;
  literal: boolean;
}

/** AutoCAD "%%" control codes, case-insensitive. Returns null when `raw[i..]` is not one. */
function readPercent(raw: string, i: number): PercentCode | null {
  if (raw[i] !== '%' || raw[i + 1] !== '%' || i + 2 >= raw.length) return null;
  const c = raw[i + 2];
  switch (c.toLowerCase()) {
    case 'c':
      return { length: 3, text: 'Ø', literal: true };
    case 'd':
      return { length: 3, text: '°', literal: true };
    case 'p':
      return { length: 3, text: '±', literal: true };
    case '%':
      return { length: 3, text: '%', literal: true };
    case 'u': // underline toggle
    case 'o': // overline toggle
    case 'k': // strike-through toggle
      return { length: 3, text: '', literal: true };
  }
  const num = /^\d{3}/.exec(raw.slice(i + 2, i + 5));
  if (num) {
    // %%nnn = character code nnn in the font's encoding → keep as a decodable code unit
    return { length: 5, text: String.fromCharCode(Number(num[0]) & 0xff), literal: false };
  }
  return null;
}

/** Parse single-line TEXT / ATTRIB content (only %% codes are special). */
export function parseText(raw: string): ParsedText {
  const b = new PieceBuilder();
  let buf = '';
  for (let i = 0; i < raw.length; ) {
    const pc = readPercent(raw, i);
    if (pc) {
      if (pc.literal) {
        b.push(buf, undefined, false);
        buf = '';
        b.push(pc.text, undefined, true);
      } else {
        buf += pc.text;
      }
      i += pc.length;
      continue;
    }
    buf += raw[i];
    i++;
  }
  b.push(buf, undefined, false);
  return { pieces: b.pieces, warnings: [] };
}

/** Index of the next unescaped ';' at or after `from` (or the string end). */
function findSemicolon(raw: string, from: number): number {
  for (let j = from; j < raw.length; j++) {
    if (raw[j] === '\\') {
      j++;
      continue;
    }
    if (raw[j] === ';') return j;
  }
  return raw.length;
}

function cleanFontName(spec: string): string | undefined {
  const name = spec.split('|')[0].trim();
  return name || undefined;
}

/** Parse MTEXT content into font runs, removing every formatting code. */
export function parseMText(raw: string): ParsedText {
  const b = new PieceBuilder();
  const warnings: string[] = [];
  const fontStack: (string | undefined)[] = [];
  let font: string | undefined;
  let buf = '';
  const flush = () => {
    b.push(buf, font, false);
    buf = '';
  };
  const literal = (t: string) => {
    flush();
    b.push(t, font, true);
  };

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const code = raw[i + 1];
      switch (code) {
        case 'P':
        case 'X':
        case 'N':
          literal('\n');
          i += 2;
          continue;
        case '~':
          literal(NBSP);
          i += 2;
          continue;
        case '\\':
        case '{':
        case '}':
          literal(code);
          i += 2;
          continue;
        case 'U':
        case 'u': {
          const m = /^[Uu]\+([0-9A-Fa-f]{4})/.exec(raw.slice(i + 1, i + 7));
          if (m) {
            literal(String.fromCharCode(parseInt(m[1], 16)));
            i += 7;
            continue;
          }
          break;
        }
        case 'M':
        case 'm': {
          const m = /^[Mm]\+([0-9])([0-9A-Fa-f]{4})/.exec(raw.slice(i + 1, i + 8));
          if (m) {
            const label = MBCS_LABELS[m[1]];
            const bytes = new Uint8Array([parseInt(m[2].slice(0, 2), 16), parseInt(m[2].slice(2), 16)]);
            let decoded = '�';
            try {
              if (label) decoded = new TextDecoder(label, { fatal: true }).decode(bytes);
            } catch {
              decoded = '�';
            }
            if (decoded.includes('�')) {
              warnings.push(`Không giải mã được ký tự MTEXT \\M+${m[1]}${m[2]} — thay bằng "�".`);
            }
            literal(decoded);
            i += 8;
            continue;
          }
          break;
        }
        case 'f':
        case 'F': {
          const end = findSemicolon(raw, i + 2);
          flush();
          font = cleanFontName(raw.slice(i + 2, end));
          i = end + 1;
          continue;
        }
        case 'H':
        case 'W':
        case 'Q':
        case 'T':
        case 'A':
        case 'C':
        case 'c':
        case 'p': {
          i = findSemicolon(raw, i + 2) + 1;
          continue;
        }
        case 'L':
        case 'l':
        case 'O':
        case 'o':
        case 'K':
        case 'k':
          i += 2;
          continue;
        case 'S': {
          const end = findSemicolon(raw, i + 2);
          const body = raw.slice(i + 2, end).replace(/\\(.)/g, '$1');
          const sep = body.search(/[\^/#]/);
          let out = body;
          if (sep >= 0) {
            const a = body.slice(0, sep).trim();
            const c = body.slice(sep + 1).trim();
            out = a && c ? `${a}/${c}` : a || c;
          }
          buf += out;
          i = end + 1;
          continue;
        }
      }
      // unknown escape: keep the escaped character
      buf += code;
      i += 2;
      continue;
    }
    if (ch === '{') {
      flush();
      fontStack.push(font);
      i++;
      continue;
    }
    if (ch === '}') {
      flush();
      if (fontStack.length) font = fontStack.pop();
      i++;
      continue;
    }
    if (ch === '%') {
      const pc = readPercent(raw, i);
      if (pc) {
        if (pc.literal) literal(pc.text);
        else buf += pc.text;
        i += pc.length;
        continue;
      }
    }
    if (ch === '^' && i + 1 < raw.length) {
      const n = raw[i + 1];
      if (n === 'I') {
        literal('\t');
        i += 2;
        continue;
      }
      if (n === 'J') {
        literal('\n');
        i += 2;
        continue;
      }
      if (n === 'M') {
        i += 2;
        continue;
      }
      if (n === ' ') {
        buf += '^';
        i += 2;
        continue;
      }
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return { pieces: b.pieces, warnings };
}

/** Remove MTEXT formatting; returns runs of plain text with the inline font each run uses. */
export function stripMText(raw: string): { segments: { text: string; font?: string }[] } {
  const segments: { text: string; font?: string }[] = [];
  for (const p of parseMText(raw).pieces) {
    const last = segments[segments.length - 1];
    if (last && last.font === p.font) last.text += p.text;
    else segments.push(p.font === undefined ? { text: p.text } : { text: p.text, font: p.font });
  }
  return { segments };
}
