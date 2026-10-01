// KMZ = ZIP with `doc.kml` at the root (DEFLATE).
import JSZip from 'jszip';
import type { CadDocument } from '@/lib/cad/types';
import { toKml, type ExportOptions } from './kml';

export const KMZ_MIME = 'application/vnd.google-earth.kmz';

/** Zip an already-built KML string. Works in Node and browsers. */
export async function kmlToKmzBytes(kml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function toKmzBytes(doc: CadDocument, opts: ExportOptions): Promise<Uint8Array> {
  return kmlToKmzBytes(toKml(doc, opts));
}

export async function toKmz(doc: CadDocument, opts: ExportOptions): Promise<Blob> {
  const bytes = await toKmzBytes(doc, opts);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: KMZ_MIME });
}
