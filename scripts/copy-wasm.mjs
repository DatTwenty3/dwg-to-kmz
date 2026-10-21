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

// sql.js (SQLite) for the TT16 schema GeoPackage built in the browser before GDAL writes the geodatabases.
const sqlDest = join(root, 'public', 'sqljs');
mkdirSync(sqlDest, { recursive: true });
// The browser build (package "exports" → sql-wasm-browser.js) loads sql-wasm-browser.wasm.
copyFileSync(join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm-browser.wasm'), join(sqlDest, 'sql-wasm-browser.wasm'));
console.log('copied sql.js wasm -> public/sqljs/');

// SVG symbols of Phụ lục I (tt16-hatch-svg/, tt16-point-svg/ at the project root) for the QGIS project of "Bóc tách DWG":
// the worker reads index.json and fetches the SVG files it embeds from /tt16-svg/hatch|point/.
import { copyFileSync as cp, existsSync, mkdirSync as mk, readdirSync } from 'node:fs';
for (const [from, to] of [
  ['tt16-hatch-svg', 'hatch'],
  ['tt16-point-svg', 'point'],
]) {
  const dir = join(root, from);
  if (!existsSync(dir)) continue;
  const out = join(root, 'public', 'tt16-svg', to);
  mk(out, { recursive: true });
  for (const f of readdirSync(dir)) if (/\.svg$/i.test(f) || f === 'index.json') cp(join(dir, f), join(out, f));
  console.log(`copied ${from} -> public/tt16-svg/${to}/`);
}
