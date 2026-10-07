'use client';
// Map next to the Thông tư 16 check: the geodatabase on Google satellite (same MapView as the main map).
// All classes of the geodatabase in view are drawn; the selected class is drawn on top at full strength and the
// rest dimmed. Clicking a feature shows its attributes and selects its class in the tree.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { robustBBox } from '@/lib/cad/normalize/bbox';
import type { CadDocument, Vec2 } from '@/lib/cad/types';
import { buildLayers, DEFAULT_BASEMAP_ID, DEFAULT_FONT_FAMILY, documentBounds } from '@/lib/map';
import EntityPopup from './EntityPopup';
import { IconSpinner } from './icons';
import { loadTextFont } from './mapFont';
import type { MapPick } from './MapView';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="ui-skeleton h-full w-full" aria-busy />,
});

const SEP = ' · ';

export default function GdbMap({
  doc,
  gdbName,
  focusClass,
  onSelectClass,
  loading,
  error,
}: {
  /** WGS84 document of every uploaded geodatabase (layers "<gdb> · <class>" when several). */
  doc: CadDocument | null;
  /** Geodatabase shown (its tab), e.g. "HienTrang.gdb". */
  gdbName: string;
  /** Class to bring forward and zoom to (real class name); null = the whole geodatabase. */
  focusClass: string | null;
  onSelectClass: (className: string) => void;
  loading: boolean;
  error?: string | null;
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

  const base = gdbName.replace(/\.gdb$/i, '');
  const multi = !!doc?.layers.some((l) => l.name.includes(SEP));
  const classOf = (layer: string) => (layer.includes(SEP) ? layer.slice(layer.indexOf(SEP) + SEP.length) : layer);
  const own = useMemo(
    () => new Set((doc?.layers ?? []).map((l) => l.name).filter((n) => (multi ? n.startsWith(base + SEP) : true))),
    [doc, multi, base],
  );
  const focusLayer = focusClass ? [...own].find((n) => classOf(n).toLowerCase() === focusClass.toLowerCase()) ?? null : null;

  const layers = useMemo(() => {
    if (!doc) return [];
    const opts = { fontFamily: font.family, showText: font.ready, highlightHandle: pick?.ref.entity.handle };
    const all = buildLayers(doc, { ...opts, visibleLayers: own, idPrefix: 'all:', opacity: focusLayer ? 0.3 : 1 });
    return focusLayer ? [...all, ...buildLayers(doc, { ...opts, visibleLayers: new Set([focusLayer]), idPrefix: 'focus:' })] : all;
  }, [doc, own, focusLayer, font, pick]);

  // Zoom to the geodatabase, then to the selected class (`seq` changes with what is in view → MapView refits).
  const fit = useMemo(() => {
    if (!doc) return undefined;
    const keep = focusLayer ? new Set([focusLayer]) : own;
    const entities = doc.entities.filter((e) => keep.has(e.layer));
    // documentBounds reads doc.bbox: recompute it for the subset in view.
    const bounds = entities.length ? documentBounds({ ...doc, entities, bbox: robustBBox(entities) }) : null;
    const key = `${doc.entities.length}|${base}|${focusLayer ?? ''}`;
    let seq = 0;
    for (let i = 0; i < key.length; i++) seq = (seq * 31 + key.charCodeAt(i)) | 0;
    return bounds ? { bounds: bounds as [Vec2, Vec2], seq } : undefined;
  }, [doc, own, focusLayer, base]);

  const popup = pick
    ? { lngLat: pick.lngLat, content: <EntityPopup pick={pick.ref} onClose={() => setPick(null)} /> }
    : null;

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
          if (p) onSelectClass(classOf(p.ref.layer));
        }}
      />
      {(loading || error || (doc && own.size === 0)) && (
        <div className="pointer-events-none absolute inset-x-3 top-14 z-10 flex justify-center">
          <span className="ui-floating flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-700">
            {loading && <IconSpinner width={14} height={14} className="text-blue-600" />}
            {loading ? 'Đang vẽ geodatabase lên bản đồ…' : error ? `Không vẽ được: ${error}` : 'Geodatabase này không có đối tượng có hình học.'}
          </span>
        </div>
      )}
    </div>
  );
}
