// Browser stub for Node's built-in `module`. libredwg-web's Emscripten glue contains
// `if (ENVIRONMENT_IS_NODE) { const { createRequire } = await import('module') … }`; the branch
// never runs in the browser/worker, but Turbopack still has to resolve the specifier.
// Aliased in next.config.ts (turbopack.resolveAlias, browser condition only).
export function createRequire(): never {
  throw new Error('createRequire is not available in the browser');
}
const nodeModule = { createRequire };
export default nodeModule;
