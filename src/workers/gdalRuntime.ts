/// <reference lib="webworker" />
// GDAL (gdal3.js, ~40 MB wasm/data served from /gdal/, loaded on first use) for the workers that write File
// Geodatabases ("Chuẩn hóa TT16", "Bóc tách DWG → TT16"). Initialised once per worker: initialising again in
// the same worker breaks its virtual file system. Outputs stay in /output across runs, hence a prefix per run.
//
// gdal3.js assigns the global `onmessage` when it is evaluated inside a worker (its own worker protocol): a
// worker importing this module must install its own handler after the imports.
import initGdalJs from 'gdal3.js';
import JSZip from 'jszip';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type { GdbEntry } from '@/lib/gdb';
import { schemaKey } from '@/lib/gdb/normalize';
import { buildSchemaGpkg } from '@/lib/gdb/schemaGpkg';

export type Gdal = Awaited<ReturnType<typeof initGdalJs>>;

let gdalPromise: Promise<Gdal> | null = null;
export const gdalErrors: string[] = [];

export const gdal = () =>
  (gdalPromise ??= initGdalJs({
    path: '/gdal',
    useWorker: false,
    logHandler: () => {},
    errorHandler: (m: string) => {
      gdalErrors.push(m);
      if (gdalErrors.length > 50) gdalErrors.shift();
    },
  }));

let run = 0;
/** A fresh output prefix ("run3_"). */
export const nextPrefix = (tag = '') => `run${++run}${tag}_`;

/** The error of a failed step with the last GDAL messages. */
export function gdalFailure(e: unknown): Error {
  const detail = gdalErrors.slice(-3).join(' | ');
  return new Error(`${e instanceof Error ? e.message : String(e)}${detail ? ` (GDAL: ${detail})` : ''}`);
}

/** Opens files (an array of File works at runtime; the typings only list FileList / string[]). */
export async function openAll(Gdal: Gdal, files: File[], vfs: string[] = []) {
  const opened = await Gdal.open(files as unknown as FileList, [], vfs);
  if (opened.errors.length) throw new Error(`GDAL không mở được dữ liệu: ${opened.errors.join('; ')}`);
  return opened;
}

/** Files written under /output/<prefix>… as entries renamed `rename(relative path without prefix)`. */
export async function outputEntries(Gdal: Gdal, prefix: string, rename: (rel: string) => string): Promise<(GdbEntry & { bytes: Uint8Array })[]> {
  const out: (GdbEntry & { bytes: Uint8Array })[] = [];
  for (const f of await Gdal.getOutputFiles()) {
    const rel = f.path.replace(/^\/output\//, '');
    if (!rel.startsWith(prefix)) continue;
    const bytes = await Gdal.getFileBytes(f.path);
    out.push({ path: rename(rel.slice(prefix.length)), read: async () => bytes, bytes });
  }
  return out;
}

/** A stored zip of one geodatabase folder (GDAL reads it through /vsizip/). */
export async function gdbZipFile(key: string, name: string, files: Map<string, GdbEntry>): Promise<File> {
  const zip = new JSZip();
  for (const [file, e] of files) zip.file(`${name}/${file}`, await e.read());
  return new File([await zip.generateAsync({ type: 'blob', compression: 'STORE' })], `${key}.gdb.zip`);
}

/** HoSoGIS.zip from output entries. */
export async function zipEntries(entries: { path: string; bytes: Uint8Array }[]): Promise<Blob> {
  const out = new JSZip();
  for (const e of entries) out.file(e.path, e.bytes);
  return out.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

/**
 * The schema GeoPackages of the template geodatabases a plan creates (schemaGpkg.ts), as stored zips named
 * `<schemaKey(db)>.gpkg.zip` so they open with the source zips in the same GDAL `open` (one call: each call
 * unmounts the previous inputs).
 */
export async function schemaFiles(dbs: string[]): Promise<File[]> {
  if (!dbs.length) return [];
  const SQL = await (sqlPromise ??= initSqlJs({ locateFile: (f: string) => `/sqljs/${f}` }));
  const files: File[] = [];
  for (const db of dbs) {
    const zip = new JSZip();
    zip.file(`${schemaKey(db)}.gpkg`, buildSchemaGpkg(SQL, db));
    files.push(new File([await zip.generateAsync({ type: 'blob', compression: 'STORE' })], `${schemaKey(db)}.gpkg.zip`));
  }
  return files;
}

/** Dataset key of an opened file: "s0.gdb.zip" → "s0", "tt16schemaHienTrang.gpkg.zip" → "tt16schemaHienTrang". */
export const datasetKey = (path: string) => path.replace(/^.*\//, '').replace(/\.(gdb|gpkg)\.zip$/i, '');
