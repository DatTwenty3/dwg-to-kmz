'use client';
// MapLibre (raster basemap) + deck.gl overlay. Client-only: load with dynamic(..., { ssr: false }).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AttributionControl,
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Vec2 } from '@/lib/cad/types';
import {
  BASEMAPS,
  FALLBACK_BASEMAP_ID,
  getBasemap,
  isGoogleBasemap,
  TileErrorMonitor,
  type Basemap,
  type PickRef,
} from '@/lib/map';

// See src/app/maplibre/[file]/route.ts.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const VIETNAM_CENTER: [number, number] = [106.3, 16.2];
const VIETNAM_ZOOM = 4.8;

function styleFor(b: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}

export interface MapPick {
  ref: PickRef;
  lngLat: Vec2;
}

export interface MapViewProps {
  basemapId: string;
  onBasemapChange: (id: string) => void;
  layers: Layer[];
  /** Fit the map to these bounds whenever `seq` changes. */
  fit?: { bounds: [Vec2, Vec2]; seq: number };
  onPick: (pick: MapPick | null) => void;
  /** Popup anchored at a map coordinate. */
  popup?: { lngLat: Vec2; content: ReactNode } | null;
  /** Pixels covered by the floating panel on the left; fitBounds keeps the drawing clear of it. */
  insetLeft?: number;
}

/** Short labels for the basemap switcher. */
const SHORT_LABEL: Record<string, string> = {
  'google-hybrid': 'Hybrid',
  'google-satellite': 'Vệ tinh',
  'google-roadmap': 'Đường phố',
  'esri-imagery': 'Esri',
};

export default function MapView({ basemapId, onBasemapChange, layers, fit, onPick, popup, insetLeft = 0 }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const basemapRef = useRef(basemapId);
  const onPickRef = useRef(onPick);
  const onBasemapRef = useRef(onBasemapChange);
  const monitorRef = useRef(new TileErrorMonitor(20, 30_000));
  const [notice, setNotice] = useState<string | null>(null);
  const [popupXY, setPopupXY] = useState<[number, number] | null>(null);
  const insetRef = useRef(insetLeft);

  useEffect(() => {
    onPickRef.current = onPick;
    onBasemapRef.current = onBasemapChange;
    insetRef.current = insetLeft;
  });

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MlMap({
      container: containerRef.current,
      style: styleFor(getBasemap(basemapRef.current)),
      center: VIETNAM_CENTER,
      zoom: VIETNAM_ZOOM,
      maxZoom: 22,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    });
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('error', (ev) => {
      const sourceId = (ev as unknown as { sourceId?: string }).sourceId;
      if (sourceId !== 'basemap' || !isGoogleBasemap(basemapRef.current)) return;
      if (monitorRef.current.record(Date.now())) {
        monitorRef.current.reset();
        setNotice('Không tải được ảnh nền Google (lỗi liên tục) — đã tự chuyển sang nền Esri Vệ tinh.');
        onBasemapRef.current(FALLBACK_BASEMAP_ID);
      }
    });

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      pickingRadius: 4,
      onClick: (info: PickingInfo) => {
        const ref = info.object as PickRef | undefined;
        if (ref && ref.entity && info.coordinate) {
          onPickRef.current({ ref, lngLat: [info.coordinate[0], info.coordinate[1]] });
        } else onPickRef.current(null);
      },
      onHover: (info: PickingInfo) => {
        map.getCanvas().style.cursor = info.object ? 'pointer' : '';
      },
    });
    map.addControl(overlay);
    mapRef.current = map;
    overlayRef.current = overlay;
    // Debug hook for automated verification (not in production builds).
    if (process.env.NODE_ENV !== 'production') (window as unknown as Record<string, unknown>).__dwgMap = map;
    return () => {
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Basemap switch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapRef.current === basemapId) return;
    basemapRef.current = basemapId;
    monitorRef.current.reset();
    map.setStyle(styleFor(getBasemap(basemapId)));
  }, [basemapId]);

  // deck.gl layers.
  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  // Fit to drawing.
  const fitSeq = fit?.seq;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fit) return;
    const [[w, s], [e, n]] = fit.bounds;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: { top: 48, bottom: 48, right: 48, left: 48 + insetRef.current }, duration: 600, maxZoom: 19 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSeq]);

  // Keep the popup anchored to its coordinate while the map moves.
  const popupLng = popup?.lngLat[0];
  const popupLat = popup?.lngLat[1];
  useEffect(() => {
    const map = mapRef.current;
    if (!map || popupLng === undefined || popupLat === undefined) {
      setPopupXY(null);
      return;
    }
    const update = () => {
      const p = map.project([popupLng, popupLat]);
      setPopupXY([p.x, p.y]);
    };
    update();
    map.on('move', update);
    return () => {
      map.off('move', update);
    };
  }, [popupLng, popupLat]);

  return (
    <div className="relative h-full w-full">
      {/* maplibre's CSS forces position:relative on the container, so size it with h/w-full. */}
      <div ref={containerRef} className="h-full w-full" />

      <div className="ui-floating absolute right-3 top-3 z-10 rounded-xl p-1">
        <div className="flex gap-0.5" role="group" aria-label="Chọn bản đồ nền">
          {BASEMAPS.map((b) => {
            const active = b.id === basemapId;
            return (
              <button
                key={b.id}
                title={b.label}
                aria-pressed={active}
                onClick={() => {
                  setNotice(null);
                  onBasemapChange(b.id);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                {SHORT_LABEL[b.id] ?? b.label}
              </button>
            );
          })}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="ui-floating absolute left-1/2 top-16 z-20 flex max-w-[90%] -translate-x-1/2 items-start gap-3 px-4 py-3 text-sm text-zinc-700"
        >
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span>{notice}</span>
          <button className="text-zinc-400 transition hover:text-zinc-900" aria-label="Đóng thông báo" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {popup && popupXY && (
        <div
          className="pointer-events-auto absolute z-20 w-72 max-w-[80vw] -translate-x-1/2 -translate-y-full pb-3"
          style={{ left: popupXY[0], top: popupXY[1] }}
        >
          {popup.content}
        </div>
      )}
    </div>
  );
}
