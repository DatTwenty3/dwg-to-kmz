// Basemap definitions. All tile URLs live here (see CLAUDE.md), nowhere else.

export interface Basemap {
  id: string;
  label: string;
  tiles: string[];
  attribution: string;
  maxzoom: number;
}

const googleTiles = (lyrs: string) =>
  [0, 1, 2, 3].map((n) => `https://mt${n}.google.com/vt/lyrs=${lyrs}&hl=vi&x={x}&y={y}&z={z}`);

// Direct XYZ tiles (no API key) — project owner's decision, see CLAUDE.md.
// CORS verified 2026-10-01: both hosts return Access-Control-Allow-Origin: *.
export const BASEMAPS: Basemap[] = [
  { id: 'google-hybrid', label: 'Google Hybrid', tiles: googleTiles('y'), attribution: '© Google', maxzoom: 21 },
  { id: 'google-satellite', label: 'Google Vệ tinh', tiles: googleTiles('s'), attribution: '© Google', maxzoom: 21 },
  { id: 'google-roadmap', label: 'Google Đường phố', tiles: googleTiles('m'), attribution: '© Google', maxzoom: 21 },
  {
    id: 'esri-imagery',
    label: 'Esri Vệ tinh (dự phòng)',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
];

export const DEFAULT_BASEMAP_ID = 'google-hybrid';
export const FALLBACK_BASEMAP_ID = 'esri-imagery';

export function getBasemap(id: string): Basemap {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

/** One tile image of `b` around [lng, lat] at zoom `z` — a thumbnail for the basemap picker. */
export function basemapThumbUrl(b: Basemap, lng: number, lat: number, z: number): string {
  const zz = Math.max(0, Math.min(Math.round(z), b.maxzoom));
  const n = 2 ** zz;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
  const latR = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n)));
  return b.tiles[(x + y) % b.tiles.length]
    .replace('{z}', String(zz))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/** True for basemaps served by Google (subject to auto-fallback). */
export function isGoogleBasemap(id: string): boolean {
  return id.startsWith('google-');
}

/**
 * Sliding-window error counter used for the Google → Esri auto-fallback
 * (default: more than 20 tile errors within 30 s).
 */
export class TileErrorMonitor {
  private times: number[] = [];
  constructor(
    private readonly limit = 20,
    private readonly windowMs = 30_000,
  ) {}

  /** Record one error at `now` (ms); returns true when the threshold is exceeded. */
  record(now: number): boolean {
    this.times.push(now);
    const cutoff = now - this.windowMs;
    while (this.times.length > 0 && this.times[0] < cutoff) this.times.shift();
    return this.times.length > this.limit;
  }

  reset() {
    this.times = [];
  }
}
