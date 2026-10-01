// DXF bytes → string. R2007+ (AC1021+) DXF is UTF-8. Older files are 8-bit in $DWGCODEPAGE:
// those are kept as a "byte string" (one char per byte) so the text module receives raw bytes.

export interface DecodedDxf {
  text: string;
  /** e.g. 'AC1015' */
  version?: string;
  /** e.g. 'ANSI_1258' */
  codepage?: string;
  /** true → `text` is a byte string (chars U+0000–U+00FF = raw bytes). */
  legacyBytes: boolean;
}

/** Raw bytes → byte string (each byte becomes the char with the same code). */
export function bytesToByteString(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))));
  }
  return parts.join('');
}

function headerVar(head: string, name: string): string | undefined {
  const re = new RegExp(`\\$${name}\\s*\\r?\\n\\s*\\d+\\s*\\r?\\n([^\\r\\n]*)`);
  const m = re.exec(head);
  return m ? m[1].trim() : undefined;
}

/** $DWGCODEPAGE (ANSI_1258, ansi_1252, …) → WHATWG encoding label, if it is a single-byte Windows codepage. */
export function codepageToEncoding(cp: string | undefined): string | undefined {
  if (!cp) return undefined;
  const m = /^ANSI_(\d+)$/i.exec(cp.trim());
  if (!m) return undefined;
  const label = m[1] === '874' ? 'windows-874' : `windows-${m[1]}`;
  try {
    new TextDecoder(label);
    return label;
  } catch {
    return undefined;
  }
}

export function decodeDxfBytes(data: ArrayBuffer): DecodedDxf {
  const bytes = new Uint8Array(data);
  const sig = bytesToByteString(bytes.subarray(0, 22));
  if (sig.startsWith('AutoCAD Binary DXF')) {
    throw new Error('File DXF dạng nhị phân (Binary DXF) chưa được hỗ trợ — hãy lưu lại dưới dạng DXF ASCII.');
  }
  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = new TextDecoder('utf-8').decode(bytes.subarray(3));
    return { text, legacyBytes: false, version: headerVar(text.slice(0, 200000), 'ACADVER'), codepage: headerVar(text.slice(0, 200000), 'DWGCODEPAGE') };
  }
  const head = bytesToByteString(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
  const version = headerVar(head, 'ACADVER');
  const codepage = headerVar(head, 'DWGCODEPAGE');
  if (version && version >= 'AC1021') {
    return { text: new TextDecoder('utf-8').decode(bytes), version, codepage, legacyBytes: false };
  }
  if (!version) {
    // No header: accept valid UTF-8, otherwise treat as legacy 8-bit.
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), codepage, legacyBytes: false };
    } catch {
      /* fall through */
    }
  }
  return { text: bytesToByteString(bytes), version, codepage, legacyBytes: true };
}
