// Fixes of the File Geodatabases GDAL 3.8 (gdal3.js) writes, applied to the output files before they are zipped:
// GDB_Items says `esriGeometryLine` for polyline classes, which ArcGIS shows as an unknown shape type — the
// template (and ArcGIS) write `esriGeometryPolyline`. The table is rewritten with rewriteTextField; its .freelist
// would then point at stale space, so it is dropped (ArcGIS rebuilds it).
import { rewriteTextField } from './filegdb';

const ITEMS = 'a00000004';

export function fixGdalOutput<E extends { path: string; bytes: Uint8Array }>(entries: E[]): { path: string; bytes: Uint8Array; read: () => Promise<Uint8Array> }[] {
  const byPath = new Map(entries.map((e) => [e.path, e.bytes]));
  const drop = new Set<string>();
  for (const e of entries) {
    if (!e.path.endsWith(`/${ITEMS}.gdbtable`)) continue;
    const dir = e.path.slice(0, -`${ITEMS}.gdbtable`.length);
    const tablx = byPath.get(`${dir}${ITEMS}.gdbtablx`);
    if (!tablx) continue;
    const fixed = rewriteTextField(e.bytes, tablx, 'Definition', (v) =>
      v.includes('<ShapeType>esriGeometryLine</ShapeType>') ? v.replace(/<ShapeType>esriGeometryLine<\/ShapeType>/g, '<ShapeType>esriGeometryPolyline</ShapeType>') : null,
    );
    if (!fixed) continue;
    byPath.set(e.path, fixed.table);
    byPath.set(`${dir}${ITEMS}.gdbtablx`, fixed.tablx);
    drop.add(`${dir}${ITEMS}.freelist`);
  }
  return entries
    .filter((e) => !drop.has(e.path))
    .map((e) => {
      const bytes = byPath.get(e.path)!;
      return { path: e.path, bytes, read: async () => bytes };
    });
}
