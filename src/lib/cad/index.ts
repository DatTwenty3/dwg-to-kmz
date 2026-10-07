// CAD file readers. Owned by agent `cad-parser`.
// Parsers return drawing coordinates (crs = null) with text already decoded via '@/lib/text'.
import type { CadDocument, InputFormat } from './types';

export interface ParseOptions {
  /** Base URL of libredwg-web.wasm (served from public/wasm). */
  wasmBaseUrl: string;
  onProgress?: (stage: string, percent: number) => void;
}

export function detectFormat(fileName: string, data: ArrayBuffer): InputFormat {
  const head = new TextDecoder('ascii').decode(new Uint8Array(data, 0, Math.min(6, data.byteLength)));
  const name = fileName.toLowerCase();
  if (head.startsWith('AC10')) return 'dwg';
  // A .zip holding Esri File Geodatabase folders (file names are stored in plain text in a zip).
  if (head.startsWith('PK') && !name.endsWith('.kmz') && zipHasName(data, 'a00000001.gdbtable')) return 'gdb';
  if (head.startsWith('PK') || name.endsWith('.kmz')) return 'kmz';
  if (name.endsWith('.kml')) return 'kml';
  if (name.endsWith('.dwg')) return 'dwg';
  if (name.endsWith('.dxf')) return 'dxf';
  // Unknown extension: sniff for XML / KML text.
  const text = new TextDecoder('utf-8').decode(new Uint8Array(data, 0, Math.min(512, data.byteLength)));
  return /<kml[\s>]/i.test(text) ? 'kml' : 'dxf';
}

/** Whether a zip's bytes contain a file name (case-insensitive ASCII search). */
function zipHasName(data: ArrayBuffer, name: string): boolean {
  const b = new Uint8Array(data);
  const n = [...name.toLowerCase()].map((c) => c.charCodeAt(0));
  const first = n[0];
  outer: for (let i = 0; i + n.length <= b.length; i++) {
    if ((b[i] | 0x20) !== first) continue;
    for (let k = 1; k < n.length; k++) {
      const c = b[i + k];
      if ((c >= 65 && c <= 90 ? c | 0x20 : c) !== n[k]) continue outer;
    }
    return true;
  }
  return false;
}

export async function parseDwg(data: ArrayBuffer, opts: ParseOptions): Promise<CadDocument> {
  const { parseDwgBuffer } = await import('./dwg');
  return parseDwgBuffer(data, opts);
}

export async function parseDxf(data: ArrayBuffer, opts: ParseOptions): Promise<CadDocument> {
  const { parseDxfBuffer } = await import('./dxf');
  return parseDxfBuffer(data, { onProgress: opts.onProgress });
}
