import JSZip from 'jszip';
import { collectGdbs, readCatalog, type GdbEntry } from './catalog';
import { checkGdb, checkSubmission, type CheckOptions, type GdbReport, type SubmissionReport } from './check';

export * from './catalog';
export * from './check';
export { readTable, tableFileName, GdbFormatError, type GdbField, type GdbFieldType, type GdbValue } from './filegdb';
export * from './tt16';

/** Files inside a .zip (folders flattened to paths). Nested .zip files are not opened. */
export async function entriesFromZip(data: ArrayBuffer | Uint8Array, prefix = ''): Promise<GdbEntry[]> {
  const zip = await JSZip.loadAsync(data);
  const out: GdbEntry[] = [];
  zip.forEach((path, f) => {
    if (!f.dir) out.push({ path: prefix + path, read: () => f.async('uint8array') });
  });
  return out;
}

/** Checks every geodatabase found in the entries. `onProgress` gets (done, total, current name). */
export async function runCheck(
  entries: GdbEntry[],
  onProgress?: (done: number, total: number, name: string) => void,
  opts: CheckOptions = {},
): Promise<SubmissionReport> {
  const { gdbs, others } = collectGdbs(entries);
  const reports: GdbReport[] = [];
  for (let i = 0; i < gdbs.length; i++) {
    const g = gdbs[i];
    onProgress?.(i, gdbs.length, g.name);
    try {
      reports.push(checkGdb(g, await readCatalog(g), opts));
    } catch (e) {
      reports.push({
        fileName: g.name,
        dir: g.dir,
        database: null,
        databaseTitle: null,
        nameStatus: 'error',
        datasets: [],
        rootClasses: [],
        issues: [{ level: 'error', text: `Không đọc được geodatabase: ${e instanceof Error ? e.message : String(e)}` }],
        counts: { datasets: { expected: 0, present: 0 }, classes: { reference: 0, present: 0, extra: 0 }, errors: 1, warnings: 0 },
        maHoSo: [],
        maThongTin: [],
        srNames: [],
        crs: null,
        province: null,
      });
    }
  }
  onProgress?.(gdbs.length, gdbs.length, '');
  return checkSubmission(reports, gdbs, others);
}
