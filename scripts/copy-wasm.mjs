// Copy LibreDWG's WASM binary into public/ so the worker can fetch it at /wasm/libredwg-web.wasm.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mlightcad', 'libredwg-web', 'wasm', 'libredwg-web.wasm');
const destDir = join(root, 'public', 'wasm');
mkdirSync(destDir, { recursive: true });
copyFileSync(src, join(destDir, 'libredwg-web.wasm'));
console.log('copied libredwg-web.wasm -> public/wasm/');

// GDAL (gdal3.js) for "Chuẩn hóa TT16": wasm + data loaded by the normalize worker from /gdal/ on demand.
const gdalSrc = join(root, 'node_modules', 'gdal3.js', 'dist', 'package');
const gdalDest = join(root, 'public', 'gdal');
mkdirSync(gdalDest, { recursive: true });
for (const f of ['gdal3WebAssembly.wasm', 'gdal3WebAssembly.data']) copyFileSync(join(gdalSrc, f), join(gdalDest, f));
console.log('copied gdal3.js wasm/data -> public/gdal/');
