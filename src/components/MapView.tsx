'use client';
// MapLibre (raster basemap) + deck.gl overlay. Client-only: load with dynamic(..., { ssr: false }).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AttributionControl,
  GeolocateControl,
  Map as MlMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { CrsOptions, Vec2 } from '@/lib/cad/types';
import type { SketchFeature, SketchKind } from '@/lib/cad/sketch';
import { IconRedo, IconUndo } from './icons';
import { createSurveyPointTransformer, formatDegMin, vn2000At, type InversePointTransformer } from '@/lib/geo';
import { headingConeElement, startHeading } from './heading';
import BasemapPicker from './BasemapPicker';
import { toast } from './toast';
import { useIsPhone } from './useIsPhone';
import { useEditSketch } from './useEditSketch';
import {
  BASEMAPS,
  FALLBACK_BASEMAP_ID,
  fileIdOfLayerId,
  getBasemap,
  isGoogleBasemap,
  TileErrorMonitor,
  type Basemap,
  type PickRef,
} from '@/lib/map';
import MeasureCard from './MeasureCard';
import MeasureToolbar from './MeasureToolbar';
import { useMeasure } from './useMeasure';
import { useDraw } from './useDraw';

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
  /** Id of the open file the picked object belongs to. */
  fileId: string | null;
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
  /** Drawing CRS (not WGS84): when set, the status bar also shows the cursor in drawing coordinates. */
  drawingCrs?: CrsOptions | null;
  /** A document is being parsed / transformed: show the indeterminate load bar. */
  loading?: boolean;
  /** Font family of the map text (also used by measurement labels). */
  fontFamily?: string;
  /** Short name of the drawing CRS for the planar measurement rows, e.g. "VN-2000". */
  drawingCrsLabel?: string;
  /** Active sketch tool (controlled by the panel's "Vẽ" tab); null = not drawing. */
  drawTool?: SketchKind | null;
  onDrawToolChange?: (t: SketchKind | null) => void;
  /** A sketch was finished on the map ([lng, lat] vertices). */
  onSketchCommit?: (kind: SketchKind, points: Vec2[]) => void;
  /** Search result marker (a pin with its label). */
  pin?: { lngLat: Vec2; label: string } | null;
  /** Sketch whose shape is being edited on the map (vertex handles); null = not editing. */
  editSketch?: SketchFeature | null;
  /** A drag / vertex deletion finished: the new vertices of `editSketch`. */
  onEditCommit?: (points: Vec2[]) => void;
  /** Leave edit mode ("Xong", Esc, or another tool started). */
  onEditDone?: () => void;
  /** Sketch history (shown in the edit bar). */
  history?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
}

const DRAW_LABEL: Record<SketchKind, string> = { line: 'đường', polygon: 'vùng', point: 'điểm' };

/**
 * fitBounds padding. MapLibre refuses to fit at all when padding leaves no room, so on small screens the
 * margins shrink and the panel inset is dropped (there the panel covers the whole map anyway).
 */
function fitPadding(width: number, height: number, inset: number) {
  const m = Math.min(48, Math.round(Math.min(width, height) * 0.08));
  const left = width - inset - 2 * m >= 240 ? m + inset : m;
  return { top: m, bottom: m, right: m, left };
}

/** Short labels for the basemap switcher. */
const SHORT_LABEL: Record<string, string> = {
  'google-hybrid': 'Hybrid',
  'google-satellite': 'Vệ tinh',
  'google-roadmap': 'Đường phố',
  'esri-imagery': 'Esri',
};

export default function MapView({ basemapId, onBasemapChange, layers, fit, onPick, popup, insetLeft = 0, drawingCrs = null,
  loading = false,
  fontFamily,
  drawingCrsLabel = 'hệ bản vẽ',
  drawTool = null,
  onDrawToolChange,
  onSketchCommit,
  pin = null,
  editSketch = null,
  onEditCommit,
  onEditDone,
  history,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const basemapRef = useRef(basemapId);
  const onPickRef = useRef(onPick);
  const onBasemapRef = useRef(onBasemapChange);
  const monitorRef = useRef(new TileErrorMonitor(20, 30_000));
  const [popupXY, setPopupXY] = useState<[number, number] | null>(null);
  /** Phones: centre crosshair readout, basemap button, bottom info card. */
  const phone = useIsPhone();
  const phoneRef = useRef(phone);
  useEffect(() => {
    phoneRef.current = phone;
  });
  const insetRef = useRef(insetLeft);
  const firstFitRef = useRef(true);
  const llRef = useRef<HTMLSpanElement>(null);
  const xyRef = useRef<HTMLSpanElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const [revealKey, setRevealKey] = useState(0);
  const hadLayers = useRef(false);
  const inverse = useMemo(() => {
    if (!drawingCrs) return null;
    try {
      // Map convention (X = Bắc, Y = Đông, metres), not the CAD file's own axis order.
      return createSurveyPointTransformer(drawingCrs);
    } catch {
      return null;
    }
  }, [drawingCrs]);
  const inverseRef = useRef(inverse);
  const measure = useMeasure(mapRef, overlayRef, fontFamily);
  const draw = useDraw(
    mapRef,
    overlayRef,
    fontFamily,
    drawTool,
    (kind, pts) => onSketchCommit?.(kind, pts),
    () => onDrawToolChange?.(null),
  );
  const edit = useEditSketch(mapRef, overlayRef, editSketch, (pts) => onEditCommit?.(pts));
  // While measuring, drawing or editing, clicks belong to the tool (no entity popups / hover cursor).
  const measureActiveRef = useRef(false);
  const toolActive = measure.active || drawTool !== null || editSketch !== null;
  useEffect(() => {
    measureActiveRef.current = toolActive;
    if (toolActive) onPickRef.current(null);
  }, [toolActive]);
  // Measuring and drawing are exclusive: starting one stops the other.
  const setMeasureTool = measure.setTool;
  useEffect(() => {
    if (drawTool) setMeasureTool(null);
  }, [drawTool, setMeasureTool]);
  // Editing a shape is exclusive with measuring / drawing too.
  const editing = editSketch !== null;
  const onEditDoneRef = useRef(onEditDone);
  useEffect(() => {
    onEditDoneRef.current = onEditDone;
  });
  useEffect(() => {
    if (editing && (measure.active || drawTool)) onEditDoneRef.current?.();
  }, [editing, measure.active, drawTool]);
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'Escape' || e.key === 'Enter') onEditDoneRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);
  useEffect(() => {
    inverseRef.current = inverse;
  }, [inverse]);

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
      locale: {
        'GeolocateControl.FindMyLocation': 'Vị trí của tôi',
        'GeolocateControl.LocationNotAvailable': 'Không xác định được vị trí',
        'NavigationControl.ZoomIn': 'Phóng to',
        'NavigationControl.ZoomOut': 'Thu nhỏ',
        'NavigationControl.ResetBearing': 'Kéo để xoay bản đồ, bấm để quay về hướng Bắc',
      },
      canvasContextAttributes: { antialias: true },
    });
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right');
    // Live position: one small button above the zoom buttons. First press follows the user (blue dot +
    // accuracy circle, updated as they move); panning stops following, pressing again resumes / turns it off.
    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      trackUserLocation: true,
      showAccuracyCircle: true,
      fitBoundsOptions: { maxZoom: 17 },
    });
    geolocate.on('error', (e) => {
      toast.error(
        e.code === 1
          ? 'Trình duyệt chưa cho phép truy cập vị trí — hãy bật quyền Vị trí cho trang này rồi thử lại.'
          : e.code === 3
            ? 'Quá thời gian chờ tín hiệu vị trí — hãy thử lại ở nơi thoáng hoặc bật GPS.'
            : 'Không xác định được vị trí hiện tại trên thiết bị này.',
      );
    });
    map.addControl(geolocate, 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');

    // Phones: a direction cone under the position dot, turned by the compass (like Google Maps). Started from
    // the geolocate button press (iOS asks for motion permission then); hidden when location is turned off.
    let cone: Marker | null = null;
    let stopHeading: (() => void) | null = null;
    let lastPos: [number, number] | null = null;
    let heading: number | null = null;
    let coneRaf = 0;
    const locating = () => (geolocate as unknown as { _watchState?: string })._watchState !== 'OFF';
    const updateCone = () => {
      coneRaf = 0;
      if (!lastPos || heading === null || !locating()) {
        cone?.remove();
        cone = null;
        return;
      }
      if (!cone) {
        cone = new Marker({ element: headingConeElement(), anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' })
          .setLngLat(lastPos)
          .addTo(map);
      }
      cone.setLngLat(lastPos).setRotation(heading);
    };
    const scheduleCone = () => {
      if (!coneRaf) coneRaf = requestAnimationFrame(updateCone);
    };
    geolocate.on('trackuserlocationstart', () => {
      if (stopHeading || !window.matchMedia('(pointer: coarse)').matches) return;
      stopHeading = startHeading(
        (deg) => {
          if (heading !== null && Math.abs(((deg - heading + 540) % 360) - 180) < 1.5) return; // ignore jitter
          heading = deg;
          scheduleCone();
        },
        () => toast.info('Chưa có quyền la bàn nên không hiện hướng — bật "Chuyển động & hướng" cho trình duyệt nếu cần.'),
      );
    });
    geolocate.on('geolocate', (p) => {
      lastPos = [p.coords.longitude, p.coords.latitude];
      scheduleCone();
    });
    geolocate.on('trackuserlocationend', scheduleCone);

    map.on('error', (ev) => {
      const sourceId = (ev as unknown as { sourceId?: string }).sourceId;
      if (sourceId !== 'basemap' || !isGoogleBasemap(basemapRef.current)) return;
      if (monitorRef.current.record(Date.now())) {
        monitorRef.current.reset();
        toast.info('Không tải được ảnh nền Google (lỗi liên tục) — đã tự chuyển sang nền Esri Vệ tinh.', 7000);
        onBasemapRef.current(FALLBACK_BASEMAP_ID);
      }
    });

    // Live cursor readout: written straight to the DOM (no React re-render per mouse move).
    // Without a drawing CRS the X/Y are VN-2000 of the province under the cursor (transformers cached per KTT).
    const autoByLon0 = new Map<number, InversePointTransformer | null>();
    const autoXY = (lng: number, lat: number): { xy: [number, number]; lon0: number } | null => {
      const at = vn2000At(lng, lat);
      if (!at) return null;
      if (!autoByLon0.has(at.lon0)) autoByLon0.set(at.lon0, createSurveyPointTransformer({ proj4: at.proj4, swapXY: false, unitScale: 1 }));
      const xy = autoByLon0.get(at.lon0)?.(lng, lat);
      return xy ? { xy, lon0: at.lon0 } : null;
    };
    let raf = 0;
    let last: { lng: number; lat: number } | null = null;
    const paint = () => {
      raf = 0;
      if (zoomRef.current) zoomRef.current.textContent = map.getZoom().toFixed(1);
      if (!last) return;
      const { lng, lat } = last;
      if (llRef.current) llRef.current.textContent = `${Math.abs(lat).toFixed(6)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(6)}°${lng >= 0 ? 'E' : 'W'}`;
      const fixed = inverseRef.current;
      const auto = fixed ? null : autoXY(lng, lat);
      const xy = fixed ? fixed(lng, lat) : (auto?.xy ?? null);
      if (xyRef.current) {
        xyRef.current.textContent = xy
          ? `X ${xy[0].toLocaleString('vi-VN', { maximumFractionDigits: 2 })}  Y ${xy[1].toLocaleString('vi-VN', { maximumFractionDigits: 2 })}${
              auto ? `  (KTT ${formatDegMin(auto.lon0)})` : ''
            }`
          : '';
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    map.on('mousemove', (e) => {
      if (phoneRef.current) return;
      last = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      schedule();
    });
    // Phones have no cursor: read the centre of the map (under the crosshair) while it moves.
    const readCentre = () => {
      if (!phoneRef.current) return;
      const c = map.getCenter();
      last = { lng: c.lng, lat: c.lat };
      schedule();
    };
    map.on('move', readCentre);
    map.on('load', readCentre);
    map.on('zoom', schedule);
    map.on('load', schedule);

    // Middle-button (wheel) drag pans the map, like in CAD — also while a draw / measure tool owns left clicks.
    const surface = map.getCanvasContainer();
    let midDrag: { x: number; y: number; cursor: string } | null = null;
    const onMidDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault(); // no browser auto-scroll
      map.stop();
      midDrag = { x: e.clientX, y: e.clientY, cursor: map.getCanvas().style.cursor };
      map.getCanvas().style.cursor = 'grabbing';
      window.addEventListener('mousemove', onMidMove);
      window.addEventListener('mouseup', onMidUp);
    };
    const onMidMove = (e: MouseEvent) => {
      if (!midDrag) return;
      const dx = e.clientX - midDrag.x;
      const dy = e.clientY - midDrag.y;
      midDrag.x = e.clientX;
      midDrag.y = e.clientY;
      if (dx || dy) map.panBy([-dx, -dy], { duration: 0 });
    };
    const onMidUp = (e: MouseEvent) => {
      if (e.button !== 1 || !midDrag) return;
      map.getCanvas().style.cursor = midDrag.cursor;
      midDrag = null;
      window.removeEventListener('mousemove', onMidMove);
      window.removeEventListener('mouseup', onMidUp);
    };
    // Some browsers open links / paste on middle click: swallow it over the map.
    const onAux = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    surface.addEventListener('mousedown', onMidDown);
    surface.addEventListener('auxclick', onAux);

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      pickingRadius: 4,
      onClick: (info: PickingInfo) => {
        if (measureActiveRef.current) return;
        const ref = info.object as PickRef | undefined;
        if (ref && ref.entity && info.coordinate) {
          onPickRef.current({
            ref,
            fileId: fileIdOfLayerId(info.layer?.id),
            lngLat: [info.coordinate[0], info.coordinate[1]],
          });
        } else onPickRef.current(null);
      },
      onHover: (info: PickingInfo) => {
        if (measureActiveRef.current) return;
        map.getCanvas().style.cursor = info.object ? 'pointer' : '';
      },
    });
    map.addControl(overlay);
    mapRef.current = map;
    overlayRef.current = overlay;
    // Debug hook for automated verification (not in production builds).
    if (process.env.NODE_ENV !== 'production') (window as unknown as Record<string, unknown>).__dwgMap = map;
    return () => {
      stopHeading?.();
      if (coneRaf) cancelAnimationFrame(coneRaf);
      cone?.remove();
      overlayRef.current = null;
      mapRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      surface.removeEventListener('mousedown', onMidDown);
      surface.removeEventListener('auxclick', onAux);
      window.removeEventListener('mousemove', onMidMove);
      window.removeEventListener('mouseup', onMidUp);
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
  const measureLayers = measure.layers;
  const drawLayers = draw.layers;
  const editLayers = edit.layers;
  useEffect(() => {
    const extra = [...editLayers, ...measureLayers, ...drawLayers];
    overlayRef.current?.setProps({ layers: extra.length ? [...layers, ...extra] : layers });
  }, [layers, measureLayers, drawLayers, editLayers]);
  useEffect(() => {
    // The drawing fades in each time a document first appears (and again after the next file is opened).
    if (layers.length > 0 && !hadLayers.current) {
      hadLayers.current = true;
      setRevealKey((k) => k + 1);
    } else if (layers.length === 0 && loading) hadLayers.current = false;
  }, [layers, loading]);

  // Replay the reveal animation on deck.gl's canvas.
  useEffect(() => {
    if (!revealKey) return;
    const canvas = containerRef.current?.parentElement?.querySelector<HTMLCanvasElement>('canvas:not(.maplibregl-canvas)');
    if (!canvas) return;
    canvas.classList.remove('ui-reveal');
    void canvas.offsetWidth;
    canvas.classList.add('ui-reveal');
  }, [revealKey]);

  // Search result pin (a DOM marker, so it stays crisp and above the drawing).
  const pinLng = pin?.lngLat[0];
  const pinLat = pin?.lngLat[1];
  const pinLabel = pin?.label;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || pinLng === undefined || pinLat === undefined) return;
    // MapLibre positions the marker element with `transform`, so the drop animation lives on an inner node.
    const el = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = 'ui-search-pin';
    el.appendChild(inner);
    inner.innerHTML =
      '<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37s12-12.6 12-22A12 12 0 0 0 3 15c0 9.4 12 22 12 22z" fill="#0e1f3b" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="4.5" fill="#fff"/></svg>';
    if (pinLabel) {
      const tag = document.createElement('span');
      tag.textContent = pinLabel;
      inner.appendChild(tag);
    }
    const marker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([pinLng, pinLat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [pinLng, pinLat, pinLabel]);

  // Fit to drawing.
  const fitSeq = fit?.seq;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fit) return;
    const [[w, s], [e, n]] = fit.bounds;
    const first = firstFitRef.current;
    firstFitRef.current = false;
    const run = () =>
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        {
          padding: fitPadding(map.getContainer().clientWidth, map.getContainer().clientHeight, insetRef.current),
          maxZoom: 19,
          // First fit after the map opens: a slow fly-in from the Vietnam overview; later fits are quick.
          duration: first ? 2600 : 700,
          curve: 1.5,
          // MapLibre skips non-essential animations under prefers-reduced-motion; this one is the intended entrance.
          essential: true,
        },
      );
    // Let the page transition settle before the fly-in starts.
    if (!first) return void run();
    const t = setTimeout(run, 450);
    return () => clearTimeout(t);
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

      {phone && (
        <BasemapPicker
          basemapId={basemapId}
          onChange={onBasemapChange}
          view={() => {
            const m = mapRef.current;
            if (!m) return null;
            const c = m.getCenter();
            return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
          }}
        />
      )}
      <div
        className={`ui-floating ui-drop-in ui-scroll absolute right-3 top-3 z-10 overflow-x-auto rounded-xl p-1 ${phone ? 'hidden' : ''}`}
        style={{ animationDelay: '0.3s' }}
      >
        <div className="flex gap-0.5" role="group" aria-label="Chọn bản đồ nền">
          {BASEMAPS.map((b) => {
            const active = b.id === basemapId;
            return (
              <button
                key={b.id}
                title={b.label}
                aria-pressed={active}
                onClick={() => {
                  onBasemapChange(b.id);
                }}
                className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                  active ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                {SHORT_LABEL[b.id] ?? b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Measurement tools sit under the basemap pill; the result card hangs below them. */}
      <div className="absolute right-3 top-[58px] z-10 flex flex-col items-end gap-2">
        <MeasureToolbar
          tool={measure.tool}
          onTool={(t) => {
            if (t) onDrawToolChange?.(null);
            measure.setTool(t);
          }}
          hasMeasurements={measure.finished.length > 0}
          onClear={measure.clear}
        />
        {measure.current && (
          <MeasureCard
            key={measure.current.kind}
            current={measure.current}
            drawingCrs={drawingCrs}
            crsLabel={drawingCrsLabel}
            onClose={measure.dismiss}
          />
        )}
      </div>

      {drawTool && (
        <div
          key={drawTool}
          className="ui-floating ui-pop-in absolute bottom-14 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-xs text-zinc-600"
          style={{ left: `calc(${insetLeft}px + (100% - ${insetLeft}px) / 2)`, maxWidth: `calc(100% - ${insetLeft + 24}px)` }}
          role="status"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500" />
          <span className="truncate">
            <b className="font-semibold text-zinc-900">Đang vẽ {DRAW_LABEL[drawTool]}</b>
            {drawTool === 'point'
              ? ' · nhấp lên bản đồ để đặt điểm'
              : ` · ${draw.points.length} điểm · nhấp đúp hoặc Enter để xong · Backspace xóa điểm · Esc hủy`}
          </span>
          {drawTool !== 'point' && draw.points.length >= (drawTool === 'polygon' ? 3 : 2) && (
            <button className="ui-btn-primary !rounded-full !px-3 !py-1 !text-xs" onClick={draw.finish}>
              Xong
            </button>
          )}
          <button className="ui-btn !rounded-full !px-3 !py-1 !text-xs" onClick={() => onDrawToolChange?.(null)}>
            Thoát
          </button>
        </div>
      )}

      {editSketch && (
        <div
          className="ui-floating ui-pop-in absolute bottom-14 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-xs text-zinc-600"
          style={{ left: `calc(${insetLeft}px + (100% - ${insetLeft}px) / 2)`, maxWidth: `calc(100% - ${insetLeft + 24}px)` }}
          role="status"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-600" />
          <span className="min-w-0 truncate">
            <b className="font-semibold text-zinc-900">Đang sửa “{editSketch.name}”</b>
            <span className="hidden sm:inline">
              {editSketch.kind === 'point'
                ? ' · kéo điểm để di chuyển'
                : ' · kéo đỉnh để di chuyển · kéo điểm giữa cạnh để thêm đỉnh · chuột phải xóa đỉnh · kéo hình để dời'}
            </span>
          </span>
          {history && (
            <>
              <button
                className="ui-icon-btn !h-7 !w-7 shrink-0"
                onClick={history.undo}
                disabled={!history.canUndo}
                aria-label="Hoàn tác"
                title="Hoàn tác (Ctrl+Z)"
              >
                <IconUndo width={15} height={15} />
              </button>
              <button
                className="ui-icon-btn !h-7 !w-7 shrink-0"
                onClick={history.redo}
                disabled={!history.canRedo}
                aria-label="Làm lại"
                title="Làm lại (Ctrl+Y)"
              >
                <IconRedo width={15} height={15} />
              </button>
            </>
          )}
          <button className="ui-btn-primary shrink-0 !rounded-full !px-3 !py-1 !text-xs" onClick={() => onEditDone?.()}>
            Xong
          </button>
        </div>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-blue-600/10" role="progressbar" aria-label="Đang xử lý">
          <div className="ui-loadbar h-full w-1/4 rounded-full bg-blue-600" />
        </div>
      )}

      {phone && (
        // Centre crosshair: the status bar shows the coordinates of this point.
        <svg
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 drop-shadow"
          width="26"
          height="26"
          viewBox="0 0 26 26"
          aria-hidden
        >
          <path d="M13 2v8M13 16v8M2 13h8M16 13h8" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
          <path d="M13 2v8M13 16v8M2 13h8M16 13h8" stroke="#0e1f3b" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}

      {/* Cursor (phones: map centre) / zoom status pill */}
      <div
        className={`ui-floating ui-fade-up absolute bottom-3 z-10 flex items-center overflow-hidden whitespace-nowrap font-mono tabular-nums text-zinc-600 transition-[left] duration-300 ease-out ${
          phone
            ? 'pointer-events-auto cursor-pointer flex-wrap gap-x-3 gap-y-0.5 rounded-2xl px-3.5 py-1.5 text-[11.5px] active:bg-zinc-50'
            : 'pointer-events-none gap-3 rounded-full px-4 py-1.5 text-[11px]'
        }`}
        style={{ left: insetLeft + 12, maxWidth: `calc(100% - ${insetLeft + 12 + 72}px)` }}
        aria-label={phone ? 'Tọa độ tâm bản đồ — chạm để chép' : 'Tọa độ con trỏ'}
        role={phone ? 'button' : undefined}
        onClick={
          phone
            ? async () => {
                const text = [llRef.current?.textContent, xyRef.current?.textContent].filter(Boolean).join('\n');
                try {
                  await navigator.clipboard.writeText(text);
                  toast.success('Đã chép tọa độ tâm bản đồ');
                } catch {
                  toast.error('Trình duyệt không cho chép — hãy chụp màn hình tọa độ.');
                }
              }
            : undefined
        }
      >
        <span ref={llRef} className="min-w-[17ch] text-zinc-800">
          {phone ? 'Kéo bản đồ để đọc tọa độ' : 'Di chuột lên bản đồ'}
        </span>
        <span ref={xyRef} className={`truncate empty:hidden ${phone ? 'order-last basis-full text-zinc-500' : 'max-[1100px]:hidden'}`} />
        <span className="flex items-center gap-1 border-l border-zinc-200 pl-3 text-zinc-400">
          z<span ref={zoomRef} className="text-zinc-700">
            {VIETNAM_ZOOM.toFixed(1)}
          </span>
        </span>
      </div>


      {popup && phone && (
        // Phones: a card along the bottom edge instead of a small popup that can be cut off.
        <div className="ui-pop-in pointer-events-auto fixed inset-x-3 bottom-3 z-40 max-h-[55dvh] overflow-y-auto rounded-2xl">
          {popup.content}
        </div>
      )}
      {popup && !phone && popupXY && (
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
