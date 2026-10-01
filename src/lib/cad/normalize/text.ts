// Bridge to the Vietnamese text module. Parsers never decode text themselves (CLAUDE.md §1).
import { decodeCadText, decodeStyleBatch } from '@/lib/text';
import type { DecodeInput, DecodeResult, VnEncoding } from '@/lib/text';

export interface TextDecoderApi {
  decodeStyleBatch(items: { style: string; raw: string; isMText?: boolean }[]): Map<string, VnEncoding>;
  decodeCadText(input: DecodeInput): DecodeResult;
}

export const defaultTextDecoder: TextDecoderApi = { decodeStyleBatch, decodeCadText };

export interface PendingText {
  /** Unicode string, or a "byte string" (every char < U+0100 is one raw byte) when `legacyBytes`. */
  raw: string;
  style: string;
  isMText: boolean;
  apply(text: string): void;
}

/** Text-module warnings shown verbatim; the rest are summarised in one line. */
const MAX_TEXT_WARNINGS = 5;

/** Byte string → bytes, or null if it holds characters above U+00FF. */
function byteStringToBytes(s: string): Uint8Array | null {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return null;
    out[i] = c;
  }
  return out;
}

/**
 * Decode all collected strings: majority vote per style first, then each distinct
 * (style, isMText, raw) once. If the text module fails, keep the raw string (NFC) and warn once.
 */
export function decodeAll(
  pending: PendingText[],
  styleFonts: Map<string, string>,
  codepage: string | undefined,
  decoder: TextDecoderApi,
  warnings: string[],
  legacyBytes = false,
): void {
  if (pending.length === 0) return;
  let styleEnc: Map<string, VnEncoding> = new Map();
  try {
    styleEnc = decoder.decodeStyleBatch(pending.map((p) => ({ style: p.style, raw: p.raw, isMText: p.isMText })));
  } catch (err) {
    warnings.push(`Không chạy được bước nhận diện bảng mã theo style: ${errMsg(err)}`);
  }
  const cache = new Map<string, string>();
  const textWarnings = new Set<string>();
  let failed = 0;
  let firstError = '';
  for (const p of pending) {
    const key = `${p.isMText ? 'M' : 'T'}\u0000${p.style}\u0000${p.raw}`;
    let text = cache.get(key);
    if (text === undefined) {
      try {
        // Pre-R2007 8-bit text goes to the text module as raw bytes + codepage (it detects
        // TCVN3/VNI on the bytes before applying the codepage).
        const bytes = legacyBytes ? byteStringToBytes(p.raw) : null;
        const res = decoder.decodeCadText({
          raw: bytes ?? p.raw,
          styleFont: styleFonts.get(p.style) || p.style,
          codepage,
          isMText: p.isMText,
          styleEncoding: styleEnc.get(p.style),
        });
        text = res.text;
        for (const w of res.warnings) textWarnings.add(w);
      } catch (err) {
        failed++;
        if (!firstError) firstError = errMsg(err);
        text = p.raw.normalize('NFC');
      }
      cache.set(key, text);
    }
    p.apply(text);
  }
  const tw = [...textWarnings];
  warnings.push(...tw.slice(0, MAX_TEXT_WARNINGS));
  if (tw.length > MAX_TEXT_WARNINGS) {
    warnings.push(`… và ${tw.length - MAX_TEXT_WARNINGS} cảnh báo giải mã chữ khác.`);
  }
  if (failed > 0) {
    warnings.push(`Chưa giải mã được ${failed} chuỗi chữ (giữ nguyên chuỗi gốc): ${firstError}`);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
