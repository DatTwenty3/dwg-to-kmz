import type { CadDocument } from '../types';
import { type BuildOptions, buildDocument } from '../normalize/build';
import { dwgToSource } from './convert';
import { isWasmTrap, loadLibreDwg, readDwg, releaseLibreDwg } from './load';

export { dwgToSource } from './convert';
export { isWasmTrap, loadLibreDwg, readDwg, releaseLibreDwg, DWG_ERR_CRITICAL } from './load';

export interface DwgParseOptions extends BuildOptions {
  wasmBaseUrl: string;
}

export async function parseDwgBuffer(data: ArrayBuffer, opts: DwgParseOptions): Promise<CadDocument> {
  opts.onProgress?.('Khởi tạo thư viện DWG', 2);
  opts.onProgress?.('Đọc file DWG', 10);
  let read;
  try {
    read = readDwg(await loadLibreDwg(opts.wasmBaseUrl), data);
  } catch (e) {
    // After a few files one WASM instance can end up in a broken state ("null function or function signature
    // mismatch", out-of-bounds…) although every one of those files reads fine on a fresh instance: start over once.
    if (!isWasmTrap(e)) throw e;
    releaseLibreDwg();
    read = readDwg(await loadLibreDwg(opts.wasmBaseUrl), data);
  }
  const { db, errorCode, codepage, version } = read;
  opts.onProgress?.('Chuyển đổi dữ liệu DWG', 40);
  const src = dwgToSource(db, { errorCode, codepage, version });
  return buildDocument(src, opts);
}
