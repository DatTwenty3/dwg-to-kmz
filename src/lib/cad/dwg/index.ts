import type { CadDocument } from '../types';
import { type BuildOptions, buildDocument } from '../normalize/build';
import { dwgToSource } from './convert';
import { loadLibreDwg, readDwg } from './load';

export { dwgToSource } from './convert';
export { loadLibreDwg, readDwg, DWG_ERR_CRITICAL } from './load';

export interface DwgParseOptions extends BuildOptions {
  wasmBaseUrl: string;
}

export async function parseDwgBuffer(data: ArrayBuffer, opts: DwgParseOptions): Promise<CadDocument> {
  opts.onProgress?.('Khởi tạo thư viện DWG', 2);
  const lib = await loadLibreDwg(opts.wasmBaseUrl);
  opts.onProgress?.('Đọc file DWG', 10);
  const { db, errorCode, codepage, version } = readDwg(lib, data);
  opts.onProgress?.('Chuyển đổi dữ liệu DWG', 40);
  const src = dwgToSource(db, { errorCode, codepage, version });
  return buildDocument(src, opts);
}
