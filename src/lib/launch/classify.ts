// The home page takes one drop for every tool: from the relative paths of what was dropped it decides which tool
// opens it. Pure (no DOM).

export type LaunchTool = 'map' | 'check' | 'extract';

export const GDB_MARKER = 'a00000001.gdbtable';

/** Files the map tool opens directly. */
export const MAP_EXT = /\.(dwg|dxf|kmz|kml|ldg)$/i;
const CAD_EXT = /\.(dwg|dxf)$/i;

/**
 * - a folder holding a File Geodatabase (HoSoGIS, X.gdb) or a loose .zip → "Kiểm tra CSDL GIS";
 * - a folder with two or more .dwg/.dxf (a planning dossier with its xrefs) → "Bóc tách DWG";
 * - loose .dwg/.dxf/.kmz/.kml/.ldg (or a folder with a single drawing) → "Bản đồ";
 * - anything else → null.
 */
export function classifyDrop(paths: readonly string[]): LaunchTool | null {
  const p = paths.map((x) => x.replaceAll('\\', '/'));
  const lower = p.map((x) => x.toLowerCase());
  if (lower.some((x) => x === GDB_MARKER || x.endsWith('/' + GDB_MARKER))) return 'check';
  const cad = p.filter((x) => CAD_EXT.test(x));
  const inFolder = cad.filter((x) => x.includes('/'));
  if (inFolder.length >= 2) return 'extract';
  if (p.some((x) => MAP_EXT.test(x))) return 'map';
  if (lower.some((x) => !x.includes('/') && x.endsWith('.zip'))) return 'check';
  return null;
}

/** Which files of a drop the map tool gets: its own formats (a folder with one drawing gives that drawing). */
export const mapFilePaths = (paths: readonly string[]): string[] => paths.filter((x) => MAP_EXT.test(x));
