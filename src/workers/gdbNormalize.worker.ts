/// <reference lib="webworker" />
// "Chuẩn hóa TT16" off the main thread: GDAL (gdalRuntime.ts) rebuilds the uploaded geodatabases following the
// plan of src/lib/gdb/normalize.ts, then the result is zipped as HoSoGIS.zip (HoSoGIS/<CSDL>.gdb/…) and checked
// again. Nothing leaves the browser.
import { collectGdbs, gdbEntriesFromZip, readCatalog, runCheck, type GdbEntry, type SubmissionReport } from '@/lib/gdb';
import { executePlan, planNormalization, type NormalizeOptions, type NormalizeSource } from '@/lib/gdb/normalize';
import { gdal, gdalFailure, gdbZipFile, nextPrefix, openAll, outputEntries, zipEntries } from './gdalRuntime';

declare const self: DedicatedWorkerGlobalScope;

export type NormalizeRequest = {
  files: { path: string; file: File }[];
  options: NormalizeOptions;
  /** Geodatabase folder (report `dir`) → TT16 database found by the check. */
  databases: Record<string, string | null>;
  /** Province code for the check of the result. */
  provinceCode: string | null;
};
export type NormalizeResponse =
  | { type: 'progress'; stage: string; done: number; total: number }
  | { type: 'done'; zip: Blob; fileName: string; notes: string[]; report: SubmissionReport; outputs: string[]; ms: number }
  | { type: 'error'; message: string };

const post = (m: NormalizeResponse) => self.postMessage(m);

async function normalize(req: NormalizeRequest) {
  const t0 = performance.now();
  // 1. Files → geodatabase folders.
  const entries: GdbEntry[] = [];
  for (const { path, file } of req.files) {
    if (/\.zip$/i.test(path)) entries.push(...(await gdbEntriesFromZip(await file.arrayBuffer(), path)));
    else entries.push({ path, read: async () => new Uint8Array(await file.arrayBuffer()) });
  }
  const { gdbs } = collectGdbs(entries);
  if (!gdbs.length) throw new Error('Không có geodatabase nào để chuẩn hóa.');

  // 2. One stored zip per geodatabase (GDAL reads it through /vsizip/) + its catalog for the plan.
  post({ type: 'progress', stage: 'Chuẩn bị dữ liệu', done: 0, total: 1 });
  const zips: File[] = [];
  const sources: NormalizeSource[] = [];
  for (let i = 0; i < gdbs.length; i++) {
    const g = gdbs[i];
    zips.push(await gdbZipFile(`s${i}`, g.name, g.files));
    sources.push({ key: `s${i}`, name: g.name, database: req.databases[g.dir] ?? null, catalog: await readCatalog(g) });
  }
  const plan = planNormalization(sources, req.options);

  // 3. GDAL.
  post({ type: 'progress', stage: 'Tải thư viện GDAL (lần đầu khoảng 40 MB)', done: 0, total: 1 });
  const Gdal = await gdal();
  const opened = await openAll(Gdal, zips, ['vsizip']);
  const datasets = new Map(opened.datasets.map((d) => [d.path.replace(/\.gdb\.zip$/i, ''), d]));
  const prefix = nextPrefix();
  try {
    await executePlan(Gdal, datasets, plan, prefix, (done, total, label) =>
      post({ type: 'progress', stage: label ? `Ghi ${label}` : 'Hoàn tất ghi', done, total }),
    );
  } catch (e) {
    throw gdalFailure(e);
  } finally {
    for (const d of opened.datasets) await Gdal.close(d).catch(() => {});
  }

  // 4. Collect /output/<prefix><CSDL>.gdb/* → HoSoGIS/<CSDL>.gdb/*, zip, check with the same rules.
  post({ type: 'progress', stage: 'Đóng gói kết quả', done: 0, total: 1 });
  const outEntries = await outputEntries(Gdal, prefix, (rel) => `HoSoGIS/${rel}`);
  const zip = await zipEntries(outEntries);
  post({ type: 'progress', stage: 'Kiểm tra lại bản chuẩn hóa', done: 0, total: 1 });
  const report = await runCheck(outEntries, undefined, { provinceCode: req.provinceCode });
  post({ type: 'done', zip, fileName: 'HoSoGIS.zip', notes: plan.notes, report, outputs: plan.outputs, ms: performance.now() - t0 });
}

self.onmessage = (ev: MessageEvent<NormalizeRequest>) => {
  normalize(ev.data).catch((e) => post({ type: 'error', message: e instanceof Error ? e.message : String(e) }));
};
