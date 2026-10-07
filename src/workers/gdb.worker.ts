/// <reference lib="webworker" />
// Thông tư 16 checker off the main thread: reads the picked files lazily (only the catalog and feature-class
// tables are opened), expands .zip archives, checks every geodatabase found. The entries are kept so the same
// data can be re-checked with another province (for the KTT check) without picking the files again.
// After the report, the geometries are decoded and sent as a WGS84 document for the map next to the report.
import type { CadDocument } from '@/lib/cad/types';
import { gdbEntriesFromZip, runCheck, type GdbEntry, type SubmissionReport } from '@/lib/gdb';
import { gdbToCad } from '@/lib/gdb/toCad';
import { WGS84_PROJ4 } from '@/lib/geo/crs';
import { transformDocument } from '@/lib/geo/transform';

declare const self: DedicatedWorkerGlobalScope;

export type GdbWorkerRequest = { type: 'check'; files: { path: string; file: File }[]; provinceCode?: string | null } | { type: 'recheck'; provinceCode: string | null };
export type GdbWorkerResponse =
  | { type: 'progress'; done: number; total: number; name: string }
  | { type: 'done'; report: SubmissionReport; zipCount: number }
  | { type: 'map'; doc: CadDocument | null; error?: string }
  | { type: 'error'; message: string };

const post = (m: GdbWorkerResponse) => self.postMessage(m);

let entries: GdbEntry[] = [];
let zipCount = 0;

self.onmessage = async (ev: MessageEvent<GdbWorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'check') {
      entries = [];
      zipCount = 0;
      for (const { path, file } of req.files) {
        if (/\.zip$/i.test(path)) {
          zipCount++;
          entries.push(...(await gdbEntriesFromZip(await file.arrayBuffer(), path)));
        } else {
          entries.push({ path, read: async () => new Uint8Array(await file.arrayBuffer()) });
        }
      }
    }
    const report = await runCheck(entries, (done, total, name) => post({ type: 'progress', done, total, name }), {
      provinceCode: req.provinceCode ?? null,
    });
    post({ type: 'done', report, zipCount });
    // The map only depends on the files, not on the province: built once per upload.
    if (req.type === 'check' && report.gdbs.length) {
      try {
        const raw = await gdbToCad(entries);
        const doc = raw.crs && raw.crs !== WGS84_PROJ4 ? transformDocument(raw, { proj4: raw.crs, swapXY: false, unitScale: 1 }) : raw;
        post({ type: 'map', doc });
      } catch (e) {
        post({ type: 'map', doc: null, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
