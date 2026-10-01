// libredwg-web (WASM) loader + raw read. Works in a Web Worker (URL base) and in Node (directory path).
// The package is imported dynamically so the DXF path / main bundle never pulls in the WASM glue.
import type { DwgDatabase, LibreDwgEx } from '@mlightcad/libredwg-web';

/** DWG_ERR_CRITICAL in LibreDWG: codes below are recoverable warnings. */
export const DWG_ERR_CRITICAL = 128;

const instances = new Map<string, Promise<LibreDwgEx>>();

/** Initialise the WASM module once per base URL / directory. */
export function loadLibreDwg(wasmBaseUrl: string): Promise<LibreDwgEx> {
  const base = wasmBaseUrl.replace(/[\\/]+$/, '');
  let p = instances.get(base);
  if (!p) {
    p = import('@mlightcad/libredwg-web').then((m) => m.LibreDwg.create(base));
    // Do not cache failures (e.g. transient fetch error) — allow a retry.
    p.catch(() => instances.delete(base));
    instances.set(base, p);
  }
  return p;
}

export interface DwgReadResult {
  db: DwgDatabase;
  /** LibreDWG error bitmask (0 = clean). */
  errorCode: number;
  /** Dwg_Code_Page enum value. */
  codepage: number | undefined;
  /** Version tag, e.g. 'AC1021'. */
  version: string | undefined;
}

let fileCounter = 0;

interface RawReadResult {
  error: number;
  data: number;
}

/** Read + convert a DWG buffer; frees the native Dwg_Data before returning. */
export function readDwg(lib: LibreDwgEx, data: ArrayBuffer): DwgReadResult {
  const fileName = `/in_${++fileCounter}.dwg`;
  let errorCode = 0;
  let ptr: number | undefined;
  const fs = lib.FS;
  try {
    fs.writeFile(fileName, new Uint8Array(data));
    const res = lib.dwg_read_file(fileName) as RawReadResult;
    errorCode = Number(res?.error ?? 0);
    ptr = res?.data;
  } finally {
    try {
      if (fs.analyzePath(fileName, false).exists) fs.unlink(fileName);
    } catch {
      /* ignore */
    }
  }
  if (errorCode >= DWG_ERR_CRITICAL || !ptr) {
    if (ptr) {
      try {
        lib.dwg_free(ptr);
      } catch {
        /* ignore */
      }
    }
    throw new Error(
      `Không đọc được file DWG (mã lỗi LibreDWG ${errorCode}). File có thể hỏng hoặc phiên bản DWG chưa được hỗ trợ.`,
    );
  }
  try {
    let codepage: number | undefined;
    try {
      codepage = lib.dwg_get_codepage(ptr);
    } catch {
      codepage = undefined;
    }
    let version: string | undefined;
    try {
      version = lib.dwg_get_version_type(ptr)?.hdr;
    } catch {
      version = undefined;
    }
    const db = lib.convert(ptr);
    return { db, errorCode, codepage, version };
  } finally {
    lib.dwg_free(ptr);
  }
}
