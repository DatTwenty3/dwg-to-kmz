'use client';
// Map of "Bóc tách DWG → TT16": one drawing (inside the planning boundary, already in WGS84) on Google satellite.
// Layers that go to the geodatabase are drawn normally, the others dimmed, the layer selected in the mapping table
// on top; clicking an object selects its layer in the table. The red outline is the planning boundary.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { robustBBox } from '@/lib/cad/normalize/bbox';
import type { CadDocument, Vec2 } from '@/lib/cad/types';
import { BOUNDARY_LAYER } from '@/lib/dwg2gdb/inventory';
import { buildLayers, DEFAULT_BASEMAP_ID, DEFAULT_FONT_FAMILY, documentBounds } from '@/lib/map';
import EntityPopup from './EntityPopup';
import { IconSpinner } from './icons';
import { loadTextFont } from './mapFont';
import type { MapPick } from './MapView';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="ui-skeleton h-full w-full" aria-busy />,
});

export default function DwgPreviewMap({
  doc,
  used,
  focusLayer,
  onPickLayer,
  loading,
  note,
}: {
  doc: CadDocument | null;
  /** Layers that go to the geodatabase (drawn at full strength). */
  used: Set<string>;
  /** Layer selected in the table: drawn on top and zoomed to. */
  focusLayer: string | null;
  onPickLayer: (layer: string) => void;
  loading: boolean;
  /** Message over the map (error, "only mapped layers shown"…). */
  note?: string | null;
}) {
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP_ID);
  const [font, setFont] = useState({ family: DEFAULT_FONT_FAMILY, ready: false });
  const [pick, setPick] = useState<MapPick | null>(null);
  useEffect(() => {
    let alive = true;
    loadTextFont().then((family) => alive && setFont({ family, ready: true }));
    return () => {
      alive = false;
    };
  }, []);

  const layers = useMemo(() => {
    if (!doc) return [];
    const opts = { fontFamily: font.family, showText: font.ready, highlightHandle: pick?.ref.entity.handle };
    const all = doc.layers.map((l) => l.name);
    const strong = new Set(all.filter((n) => used.has(n) || n === BOUNDARY_LAYER));
    const weak = new Set(all.filter((n) => !strong.has(n)));
    return [
      ...buildLayers(doc, { ...opts, visibleLayers: weak, idPrefix: 'weak:', opacity: 0.25 }),
      ...buildLayers(doc, { ...opts, visibleLayers: strong, idPrefix: 'used:', opacity: focusLayer ? 0.55 : 1 }),
      ...(focusLayer ? buildLayers(doc, { ...opts, visibleLayers: new Set([focusLayer]), idPrefix: 'focus:' }) : []),
    ];
  }, [doc, used, focusLayer, font, pick]);

  // Zoom to the drawing, then to the selected layer.
  const fit = useMemo(() => {
    if (!doc) return undefined;
    const entities = focusLayer ? doc.entities.filter((e) => e.layer === focusLayer) : doc.entities;
    const bounds = entities.length ? documentBounds({ ...doc, entities, bbox: robustBBox(entities) }) : null;
    const key = `${doc.entities.length}|${doc.bbox.flat().join(',')}|${focusLayer ?? ''}`;
    let seq = 0;
    for (let i = 0; i < key.length; i++) seq = (seq * 31 + key.charCodeAt(i)) | 0;
    return bounds ? { bounds: bounds as [Vec2, Vec2], seq } : undefined;
  }, [doc, focusLayer]);

  const popup = pick ? { lngLat: pick.lngLat, content: <EntityPopup pick={pick.ref} onClose={() => setPick(null)} /> } : null;

  return (
    <div className="relative h-full w-full bg-zinc-200">
      <MapView
        basemapId={basemapId}
        onBasemapChange={setBasemapId}
        layers={layers}
        fit={fit}
        fontFamily={font.family}
        loading={loading}
        popup={popup}
        compact
        onPick={(p) => {
          setPick(p);
          if (p && p.ref.layer !== BOUNDARY_LAYER) onPickLayer(p.ref.layer);
        }}
      />
      {(loading || note) && (
        <div className="pointer-events-none absolute inset-x-3 top-14 z-10 flex justify-center">
          <span className="ui-floating flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-700">
            {loading && <IconSpinner width={14} height={14} className="text-blue-600" />}
            {loading ? 'Đang vẽ bản vẽ lên bản đồ…' : note}
          </span>
        </div>
      )}
    </div>
  );
}
