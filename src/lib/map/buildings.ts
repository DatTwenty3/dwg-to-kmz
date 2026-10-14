// 3D buildings: footprints of Google Open Buildings for Vĩnh Long, as PMTiles vector tiles served from public/
// (built once by scripts/buildings-to-pmtiles.ps1; layer "nha", attribute `a` = footprint area in m²).
// The data has no heights: the number of floors is estimated from the footprint area.
import type { LayerSpecification, SourceSpecification } from 'maplibre-gl';

export const BUILDINGS_URL = '/data/nha-vinh-long.pmtiles';
export const BUILDINGS_ATTRIBUTION =
  '<a href="https://sites.research.google/open-buildings/" target="_blank" rel="noopener">Nhà: Google Open Buildings</a> (CC BY 4.0)';
/** Tiles exist from this zoom (smaller zooms show nothing: a house is 2–3 px there). */
export const BUILDINGS_MIN_ZOOM = 13;
/** Area covered by the data (extent of the source shapefile, plus a margin): [west, south, east, north]. */
export const BUILDINGS_BOUNDS: [number, number, number, number] = [105.67, 9.51, 106.55, 10.23];

/** Storey height, metres. */
export const FLOOR_HEIGHT = 3.6;

/** Floors estimated from the footprint area (m²): < 80 → 1, 80–200 → 2, > 200 → 3. */
export function floorsForArea(area: number): number {
  return area < 80 ? 1 : area <= 200 ? 2 : 3;
}

/** Extruded height (m) of a building with this footprint area (roof slab included). */
export function heightForArea(area: number): number {
  return floorsForArea(area) * FLOOR_HEIGHT + 0.4;
}

/** The same rule as a MapLibre expression on the tile attribute `a`. */
const heightExpr = [
  'step',
  ['coalesce', ['get', 'a'], 0],
  heightForArea(0),
  80,
  heightForArea(80),
  200.5,
  heightForArea(201),
] as unknown as number;

export function buildingSource(origin: string): SourceSpecification {
  return {
    type: 'vector',
    url: `pmtiles://${origin}${BUILDINGS_URL}`,
    attribution: BUILDINGS_ATTRIBUTION,
  };
}

export const BUILDING_LAYER: LayerSpecification = {
  id: 'buildings-3d',
  type: 'fill-extrusion',
  source: 'buildings',
  'source-layer': 'nha',
  minzoom: BUILDINGS_MIN_ZOOM,
  paint: {
    // Warm off-white walls, slightly darker for taller (bigger) buildings, so blocks read apart.
    'fill-extrusion-color': ['step', ['coalesce', ['get', 'a'], 0], '#f3ede4', 80, '#e9dfd0', 200.5, '#ddd0bd'] as unknown as string,
    'fill-extrusion-height': heightExpr,
    'fill-extrusion-base': 0,
    'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MIN_ZOOM, 0, BUILDINGS_MIN_ZOOM + 0.6, 0.92] as unknown as number,
  },
};

/** True when the view [west, south, east, north] overlaps the area that has building data. */
export function viewHasBuildings(view: [number, number, number, number]): boolean {
  const [w, s, e, n] = BUILDINGS_BOUNDS;
  return view[0] < e && view[2] > w && view[1] < n && view[3] > s;
}
