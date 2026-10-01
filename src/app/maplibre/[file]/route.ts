// Serves MapLibre GL 6's web-worker modules from the installed package, prerendered at build time.
//
// Why: maplibre-gl 6 is ESM and spawns its worker from `new URL('./maplibre-gl-worker.mjs',
// import.meta.url)`; once bundled by Turbopack that URL points into a chunk folder where the file
// does not exist. MapView calls `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')`, and the worker
// imports './maplibre-gl-shared.mjs' relative to itself — both are served here, always matching the
// installed version (no copy step, nothing in /public).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-static';
export const dynamicParams = false;

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'] as const;

export function generateStaticParams() {
  return FILES.map((file) => ({ file }));
}

export async function GET(_req: Request, ctx: RouteContext<'/maplibre/[file]'>) {
  const { file } = await ctx.params;
  if (!(FILES as readonly string[]).includes(file)) return new Response('Not found', { status: 404 });
  const src = readFileSync(join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', file), 'utf8');
  return new Response(src.replace(/\/\/# sourceMappingURL=.*$/m, ''), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
