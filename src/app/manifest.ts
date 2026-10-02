import type { MetadataRoute } from 'next';

// Installable web app (Android "Add to Home screen" / install). Icons are built by scripts/gen-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LEDAT-GIS — Geospatial Solutions',
    short_name: 'LEDAT-GIS',
    description: 'Đưa bản vẽ DWG, DXF, KMZ, KML lên bản đồ, vẽ, đo đạc và chia sẻ.',
    lang: 'vi',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
