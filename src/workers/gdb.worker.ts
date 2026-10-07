/// <reference lib="webworker" />
// Thông tư 16 checker off the main thread: reads the picked files lazily (only the catalog and feature-class
// tables are opened), expands .zip archives, checks every geodatabase found. The entries are kept so the same
// data can be re-checked with another province (for the KTT check) without picking the files again.
import { entriesFromZip, runCheck, type GdbEntry, type SubmissionReport } from '@/lib/gdb';

declare const self: DedicatedWorkerGlobalScope;

export type GdbWorkerRequest = { type: 'check'; files: { path: string; file: File }[]; provinceCode?: string | null } | { type: 'recheck'; provinceCode: string | null };
export type GdbWorkerResponse =
  | { type: 'progress'; done: number; total: number; name: string }
  | { type: 'done'; report: SubmissionReport; zipCount: number }
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
          const inner = await entriesFromZip(await file.arrayBuffer());
          // A zip made from inside the .gdb folder has the tables at its root → use the zip name as the folder.
          const flat = inner.some((e) => e.path.toLowerCase() === 'a00000001.gdbtable');
          const base = path.replace(/\.zip$/i, '');
          for (const e of inner) entries.push({ ...e, path: flat ? `${base}/${e.path}` : e.path });
        } else {
          entries.push({ path, read: async () => new Uint8Array(await file.arrayBuffer()) });
        }
      }
    }
    const report = await runCheck(entries, (done, total, name) => post({ type: 'progress', done, total, name }), {
      provinceCode: req.provinceCode ?? null,
    });
    post({ type: 'done', report, zipCount });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
