// $DWGCODEPAGE → TextDecoder label. Works in browsers, Web Workers and Node (full ICU).

const CODEPAGE_LABELS: Record<string, string> = {
  ANSI_874: 'windows-874',
  ANSI_932: 'shift_jis',
  ANSI_936: 'gbk',
  ANSI_949: 'euc-kr',
  ANSI_950: 'big5',
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
  DOS866: 'ibm866',
  UTF8: 'utf-8',
  'UTF-8': 'utf-8',
  UTF16: 'utf-16le',
  'UTF-16': 'utf-16le',
};

/** Normalise "ansi_1258", "ANSI-1258", "1258", "cp1258", "windows-1258" … to a TextDecoder label. */
export function codepageLabel(dwgCodepage: string | undefined): string {
  if (!dwgCodepage) return 'windows-1252';
  const key = dwgCodepage.trim().toUpperCase().replace(/-/g, '_');
  const direct = CODEPAGE_LABELS[key] ?? CODEPAGE_LABELS[dwgCodepage.trim().toUpperCase()];
  if (direct) return direct;
  const num = key.match(/^(?:ANSI_|CP|WINDOWS_)?(\d{3,4})$/);
  if (num) return CODEPAGE_LABELS[`ANSI_${num[1]}`] ?? `windows-${num[1]}`;
  return dwgCodepage.trim().toLowerCase();
}

/** Read bytes 1:1 as Latin-1 code units — keeps TCVN3/VNI bytes intact for later mapping. */
export function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x2000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** Decode a legacy (< R2007) DWG/DXF string according to $DWGCODEPAGE. Unknown labels fall back to windows-1252. */
export function decodeCodepage(bytes: Uint8Array, dwgCodepage?: string): string {
  const label = codepageLabel(dwgCodepage);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return bytesToLatin1(bytes);
    }
  }
}
