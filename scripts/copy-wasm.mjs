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
