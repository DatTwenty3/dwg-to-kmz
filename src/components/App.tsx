'use client';
import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CadDocument, CrsOptions, LayerStyle, Vec2 } from '@/lib/cad/types';
import { applyLayerStyles, isEmptyStyle, type LayerStyles } from '@/lib/cad/style';
import { mergeDocuments, type MergePart } from '@/lib/cad/merge';
import {
  nextSketchName,
  parseSketchJson,
  SKETCH_DEFAULT_COLOR,
  SKETCH_DEFAULT_FILL,
  sketchToDocument,
  uniqueName,
  type SketchFeature,
  type SketchKind,
} from '@/lib/cad/sketch';
import { buildVn2000, checkLocation, getProvince, PROVINCES, suggestCrs } from '@/lib/geo';
import { decodeSharedMap, sharePayloadOf, type SharedMap } from '@/lib/cad/share';
import {
  createFileLayerCache,
  DEFAULT_BASEMAP_ID,
  DEFAULT_FONT_FAMILY,
  documentBounds,
  guessProvinceFromText,
  moveById,
  nextTagColor,
  orderFileLayers,
  shownBounds,
  unionBounds,
  type FileRender,
} from '@/lib/map';
import { CadPipeline } from '@/lib/pipeline';
import { VIETNAMESE_CHARSET } from '@/lib/text';
import CrsPanel from './CrsPanel';
import CrsStep from './CrsStep';
import { DEFAULT_FORM, crsFromForm, formFromCrs, sameBaseCrs, type CrsForm } from './crsForm';
import EntityPopup from './EntityPopup';
import ExportPanel, { baseName, buildExport } from './ExportPanel';
import { ACCEPTED_EXT } from './FileDropzone';
import FileList, { type FileRowData } from './FileList';
import Landing from './Landing';
import LayerPanel from './LayerPanel';
import MapPanel, { type PanelTab } from './MapPanel';
import type { MapPick } from './MapView';
import { createOpenFile, drawingCrsLabel, type OpenFile } from './openFile';
import NewMapDialog from './NewMapDialog';
import ShareDialog from './ShareDialog';
import SketchPanel from './SketchPanel';
import { IconAlert, IconSpinner, IconUpload, Logo } from './icons';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="ui-skeleton relative h-full w-full" aria-busy>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="ui-floating flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-600">
          <IconSpinner className="text-blue-600" />
          Đang tải bản đồ…
        </span>
      </div>
    </div>
  ),
});

/** landing → (CAD) crs → map; KML/KMZ sources go straight to the map. */
type Stage = 'landing' | 'crs' | 'map';

/** Width of the floating panel plus margins, so fitBounds keeps the drawing clear of it. */
const PANEL_INSET = 400;

/** Default DXF target for KML/KMZ sources: VN-2000, the province's central meridian, 3° zone, metres. */
function targetFormFor(provinceId: string): CrsForm {
  return { ...DEFAULT_FORM, mode: 'vn2000', lon0: getProvince(provinceId)?.lon0 ?? 105, zone: 3 };
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** Resolve the real (hashed) family name next/font gives Roboto and wait until its glyphs are loaded. */
async function loadTextFont(): Promise<string> {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-roboto').trim();
  const family = v || 'Roboto';
  try {
    // Requesting the Vietnamese characters forces the unicode-range subsets to download.
    await document.fonts.load(`500 64px ${family}`, VIETNAMESE_CHARSET.join(''));
    await document.fonts.ready;
  } catch {
    /* fall back to whatever is available */
  }
  return v ? `${v}, Arial, sans-serif` : DEFAULT_FONT_FAMILY;
}

/** Pseudo file id of the sketch layer (deck layer-id prefix, pick routing). */
const SKETCH_ID = 'sketch';
const SKETCH_STORAGE_KEY = 'ledat-gis:sketches:v1';

const META_STORAGE_KEY = 'ledat-gis:map-meta:v1';
const DEFAULT_MAP_TITLE = 'Bản đồ chưa đặt tên';

function loadMeta(): { title: string; description: string } {
  try {
    const m = JSON.parse(window.localStorage.getItem(META_STORAGE_KEY) ?? 'null') as { title?: unknown; description?: unknown } | null;
    return {
      title: typeof m?.title === 'string' && m.title.trim() ? m.title : DEFAULT_MAP_TITLE,
      description: typeof m?.description === 'string' ? m.description : '',
    };
  } catch {
    return { title: DEFAULT_MAP_TITLE, description: '' };
  }
}

/** The page was opened from a shared link (`#m=…`). */
const openedFromShare = () => typeof window !== 'undefined' && sharePayloadOf(window.location.hash) !== null;

/** File-system friendly name from a map title. */
const fileSafe = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'ban-do';

/** VN-2000 (3° zone) of the province containing a point, for DXF export of sketches when no drawing is open. */
function vn2000Around(lng: number, lat: number): CrsOptions {
  const p = PROVINCES.find((x) => lng >= x.bbox[0] && lat >= x.bbox[1] && lng <= x.bbox[2] && lat <= x.bbox[3]);
  return { proj4: buildVn2000(p?.lon0 ?? 105, 3), swapXY: false, unitScale: 1 };
}

function loadSketches(): SketchFeature[] {
  try {
    return parseSketchJson(window.localStorage.getItem(SKETCH_STORAGE_KEY));
  } catch {
    return [];
  }
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function App() {
  const pipelineRef = useRef<CadPipeline | null>(null);
  const transformSeq = useRef(new Map<string, number>());
  const idSeq = useRef(0);
  // Source of truth for async code (state is a render snapshot of it).
  const filesRef = useRef<OpenFile[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP_ID);
  const [fit, setFit] = useState<{ bounds: [Vec2, Vec2]; seq: number }>();
  const [pick, setPick] = useState<MapPick | null>(null);
  const [font, setFont] = useState<{ family: string; ready: boolean }>({ family: DEFAULT_FONT_FAMILY, ready: false });
  // The map opens full-screen; the panel stays behind the "Bảng điều khiển" button until asked for.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  // Safety net for the drag overlay: any drop, a drag that leaves the window, or a cancelled drag (Esc) resets it.
  useEffect(() => {
    const reset = () => setDragDepth(0);
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) reset();
    };
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    window.addEventListener('dragleave', onLeave, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('dragend', reset, true);
      window.removeEventListener('dragleave', onLeave, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  const [stage, setStage] = useState<Stage>('landing');
  const [focusTab, setFocusTab] = useState<{ tab: PanelTab; seq: number }>();
  const [layerCache] = useState(() => createFileLayerCache());
  // ---- sketches (user drawings) ----
  // Restored from this browser; sketches only render on the map page, so the server's empty list never mismatches.
  // A shared link starts empty and is filled by the decoder below (local sketches stay untouched in storage).
  const [sharedView, setSharedView] = useState(openedFromShare);
  const [sketches, setSketches] = useState<SketchFeature[]>(() => (typeof window === 'undefined' || openedFromShare() ? [] : loadSketches()));
  const [mapMeta, setMapMeta] = useState(() =>
    typeof window === 'undefined' || openedFromShare() ? { title: DEFAULT_MAP_TITLE, description: '' } : loadMeta(),
  );
  const [shareMap, setShareMap] = useState<SharedMap | null>(null);
  /** "Tạo bản đồ mới" while this device already holds a map: ask continue / overwrite / cancel. */
  const [newMapPrompt, setNewMapPrompt] = useState<{ title: string; count: number } | null>(null);
  const sketchesRef = useRef(sketches);
  useEffect(() => {
    sketchesRef.current = sketches;
  }, [sketches]);
  const [sketchShown, setSketchShown] = useState(true);
  const [sketchOpacity, setSketchOpacity] = useState(1);
  const [sketchSel, setSketchSel] = useState<string | null>(null);
  const [drawTool, setDrawTool] = useState<SketchKind | null>(null);
  const [nextColor, setNextColor] = useState(SKETCH_DEFAULT_COLOR);
  useEffect(() => {
    if (sharedView) return; // viewing someone's link: never overwrite this device's own map
    try {
      window.localStorage.setItem(SKETCH_STORAGE_KEY, JSON.stringify(sketches));
      window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(mapMeta));
    } catch {
      /* storage full / disabled: sketches still live for this session */
    }
  }, [sketches, mapMeta, sharedView]);
  const [styledCache] = useState(() => new Map<string, { doc: CadDocument; styles: LayerStyles; out: CadDocument }>());

  const commitFiles = useCallback((next: OpenFile[]) => {
    filesRef.current = next;
    setFiles(next);
  }, []);
  const patch = useCallback(
    (id: string, p: Partial<OpenFile>) => {
      if (!filesRef.current.some((f) => f.id === id)) return;
      commitFiles(filesRef.current.map((f) => (f.id === id ? { ...f, ...p } : f)));
    },
    [commitFiles],
  );
  const setActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);
  const requestFit = useCallback((bounds: [Vec2, Vec2] | null) => {
    if (bounds) setFit((f) => ({ bounds, seq: (f?.seq ?? 0) + 1 }));
  }, []);

  /** Page change wrapped in a View Transition (cross-fade + hero morph) where the browser supports it. */
  const go = useCallback((next: Stage) => {
    type VT = { ready: Promise<unknown>; finished: Promise<unknown>; updateCallbackDone: Promise<unknown> };
    const d = document as Document & { startViewTransition?: (cb: () => void) => VT };
    if (!d.startViewTransition || document.visibilityState !== 'visible') {
      setStage(next);
      return;
    }
    const vt = d.startViewTransition(() => flushSync(() => setStage(next)));
    // The browser may skip the animation (e.g. tab not rendering); the page still changes — ignore the rejection.
    const ignore = () => {};
    vt.ready.catch(ignore);
    vt.finished.catch(ignore);
    vt.updateCallbackDone.catch(ignore);
  }, []);

  const pipeline = useCallback(() => (pipelineRef.current ??= new CadPipeline()), []);
  useEffect(() => () => pipelineRef.current?.dispose(), []);

  useEffect(() => {
    let alive = true;
    loadTextFont().then((family) => alive && setFont({ family, ready: true }));
    return () => {
      alive = false;
    };
  }, []);

  const af = files.find((f) => f.id === activeId) ?? files[0] ?? null;
  const rawDoc = af?.rawDoc ?? null;
  const doc = af?.doc ?? null;
  const provinceId = af?.provinceId ?? '';
  const activeCrs = af?.activeCrs ?? null;
  const form = af?.form ?? DEFAULT_FORM;

  // ---- transform -------------------------------------------------------------------------------

  const runTransform = useCallback(
    async (id: string, crs: CrsOptions) => {
      const seq = (transformSeq.current.get(id) ?? 0) + 1;
      transformSeq.current.set(id, seq);
      patch(id, { status: 'transforming', error: null });
      const t0 = performance.now();
      const out = await pipeline().transform(crs, id);
      if (transformSeq.current.get(id) !== seq) return null;
      return { out, ms: performance.now() - t0 };
    },
    [patch, pipeline],
  );

  const commitTransform = useCallback(
    (
      id: string,
      crs: CrsOptions,
      res: { out: CadDocument; ms: number },
      opts: { fit: boolean; provinceId: string; syncForm?: boolean; note?: string },
    ) => {
      const cur = filesRef.current.find((f) => f.id === id);
      if (!cur) return;
      patch(id, {
        doc: res.out,
        activeCrs: crs,
        form: opts.syncForm === false ? cur.form : formFromCrs(crs),
        check: checkLocation(res.out, opts.provinceId || undefined),
        timing: { ...cur.timing, transform: res.ms },
        status: 'ready',
        error: null,
        needsConfirm: !!opts.note,
        crsNote: opts.note ?? null,
      });
      setPick(null);
      if (opts.fit) requestFit(documentBounds(res.out));
      if (opts.note) setFocusTab((t) => ({ tab: 'crs', seq: (t?.seq ?? 0) + 1 }));
    },
    [patch, requestFit],
  );

  const applyCrs = useCallback(
    async (id: string, crs: CrsOptions, opts: { fit: boolean; provinceId: string; syncForm?: boolean; note?: string }) => {
      try {
        const res = await runTransform(id, crs);
        if (res) commitTransform(id, crs, res, opts);
      } catch (err) {
        patch(id, { error: `Lỗi chuyển tọa độ: ${errMsg(err)}`, status: 'error' });
      }
    },
    [runTransform, commitTransform, patch],
  );

  const autoApply = useCallback(
    async (id: string, raw: CadDocument, prov: string) => {
      const list = suggestCrs(raw, prov || undefined);
      if (list.length > 0) await applyCrs(id, list[0].crs, { fit: true, provinceId: prov });
      else patch(id, { status: 'ready', error: 'Không đoán được hệ tọa độ — hãy thiết lập thủ công.' });
    },
    [applyCrs, patch],
  );

  /** A CAD file added on top of others: reuse the active file's CRS when it lands in Vietnam / the same province. */
  const addCad = useCallback(
    async (id: string, raw: CadDocument, prov: string, base: OpenFile | undefined) => {
      const baseCrs = base && !base.rawDoc?.crs ? base.activeCrs : null;
      try {
        if (baseCrs && base) {
          const res = await runTransform(id, baseCrs);
          if (!res) return;
          if (checkLocation(res.out, prov || undefined).ok) {
            commitTransform(id, baseCrs, res, {
              fit: true,
              provinceId: prov,
              note: `Dùng hệ tọa độ của "${base.fileName}" (vị trí hợp lý).`,
            });
            return;
          }
        }
        const list = suggestCrs(raw, prov || undefined);
        if (list.length > 0) {
          await applyCrs(id, list[0].crs, {
            fit: true,
            provinceId: prov,
            note: `${baseCrs && base ? `Hệ tọa độ của "${base.fileName}" không khớp vị trí file này. ` : ''}Tự đoán: ${list[0].label}.`,
          });
        } else patch(id, { status: 'ready', error: 'Không đoán được hệ tọa độ — hãy thiết lập thủ công.' });
      } catch (err) {
        patch(id, { error: `Lỗi chuyển tọa độ: ${errMsg(err)}`, status: 'error' });
      }
    },
    [runTransform, commitTransform, applyCrs, patch],
  );

  // ---- open / add / remove ----------------------------------------------------------------------

  const dropFileResources = useCallback(
    (id: string) => {
      void pipeline().release(id).catch(() => {});
      layerCache.drop(id);
      styledCache.delete(id);
      transformSeq.current.delete(id);
    },
    [pipeline, layerCache, styledCache],
  );

  /** `replace`: the first file (landing / CRS step) discards everything open; otherwise the file is stacked on top. */
  const handleFile = useCallback(
    async (file: File, opts: { replace?: boolean; provOverride?: string } = {}) => {
      if (!ACCEPTED_EXT.test(file.name)) {
        setGlobalError('Chỉ hỗ trợ file .dwg, .dxf, .kmz hoặc .kml.');
        return;
      }
      setGlobalError(null);
      const replace = !!opts.replace;
      const prev = filesRef.current;
      const base = replace ? undefined : (prev.find((f) => f.id === activeIdRef.current) ?? prev[0]);
      const id = `f${++idSeq.current}`;
      if (replace) prev.forEach((f) => dropFileResources(f.id));
      const entry = createOpenFile(id, file.name, nextTagColor(replace ? [] : prev.map((f) => f.tag)));
      commitFiles(replace ? [entry] : [entry, ...prev]);
      setActive(id);
      setPick(null);
      // A freshly opened drawing starts on its layers (not on a tab left over from an earlier map).
      if (replace) setFocusTab((t) => ({ tab: 'layers', seq: (t?.seq ?? 0) + 1 }));
      const t0 = performance.now();
      try {
        const raw = await pipeline().parse(file, (stage, percent) => patch(id, { progress: { stage, percent } }), id);
        if (!filesRef.current.some((f) => f.id === id)) {
          dropFileResources(id); // removed while parsing
          return;
        }
        let prov = opts.provOverride ?? (replace ? (prev.find((f) => f.id === activeIdRef.current)?.provinceId ?? '') : (base?.provinceId ?? ''));
        let guess = null;
        if (!prov) {
          // No province chosen: every KTT lands in *some* province, so read it from the drawing's text.
          guess = guessProvinceFromText(raw);
          if (guess) prov = guess.id;
        }
        patch(id, {
          rawDoc: raw,
          visible: new Set(raw.layers.filter((l) => l.visible).map((l) => l.name)),
          timing: { parse: performance.now() - t0 },
          provinceId: prov,
          provinceGuess: guess,
          progress: null,
          status: 'transforming',
          ...(raw.crs ? { form: targetFormFor(prov) } : {}),
        });
        if (raw.crs) {
          // KML/KMZ: already WGS84 → show as is; the form becomes the DXF target CRS.
          const p = applyCrs(id, { proj4: raw.crs, swapXY: false, unitScale: 1 }, { fit: true, provinceId: prov, syncForm: false });
          if (replace) go('map');
          await p;
        } else if (replace) {
          const p = autoApply(id, raw, prov);
          go('crs');
          await p;
        } else await addCad(id, raw, prov, base);
      } catch (err) {
        patch(id, { error: `Không đọc được bản vẽ: ${errMsg(err)}`, status: 'error', progress: null });
      }
    },
    [pipeline, patch, commitFiles, setActive, dropFileResources, applyCrs, autoApply, addCad, go],
  );

  const addFiles = useCallback(
    async (list: File[]) => {
      for (const f of list) await handleFile(f);
    },
    [handleFile],
  );

  const removeFile = useCallback(
    (id: string) => {
      const rest = filesRef.current.filter((f) => f.id !== id);
      commitFiles(rest);
      dropFileResources(id);
      if (activeIdRef.current === id) setActive(rest[0]?.id ?? null);
      setPick((p) => (p?.fileId === id ? null : p));
      if (rest.length === 0 && sketchesRef.current.length === 0) go('landing');
    },
    [commitFiles, dropFileResources, setActive, go],
  );

  // Dev/verification convenience: /?sample=/samples/x.dwg[&province=can-tho][&add=/samples/y.kmz,...] loads same-origin files.
  const sampleLoaded = useRef(false);
  useEffect(() => {
    if (sampleLoaded.current) return;
    sampleLoaded.current = true;
    const params = new URLSearchParams(window.location.search);
    const sample = params.get('sample');
    if (!sample || !sample.startsWith('/') || sample.startsWith('//')) return;
    const prov = params.get('province') ?? undefined;
    const adds = (params.get('add') ?? '').split(',').filter((u) => u.startsWith('/') && !u.startsWith('//'));
    const load = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new File([await res.arrayBuffer()], decodeURIComponent(url.split('/').pop() || 'sample.dwg'));
    };
    (async () => {
      try {
        await handleFile(await load(sample), { replace: true, provOverride: prov });
        for (const u of adds) {
          if (filesRef.current[0]?.status === 'error') break;
          go('map');
          await handleFile(await load(u));
        }
      } catch (err) {
        setGlobalError(`Không tải được file mẫu: ${errMsg(err)}`);
      }
    })();
  }, [handleFile, go]);

  // Shared map links: #m=… holds the whole map (decoded locally, nothing fetched).
  useEffect(() => {
    const openShared = async () => {
      const payload = sharePayloadOf(window.location.hash);
      if (payload === null) return;
      const m = await decodeSharedMap(payload);
      if (!m) {
        setGlobalError('Link chia sẻ bị hỏng hoặc không đầy đủ (có thể đã bị cắt khi gửi). Hãy nhờ người gửi chép lại link.');
        // Opened straight from a broken link: fall back to this device's own map. While another shared map is
        // on screen, keep the shared (non-persisting) mode so it never overwrites the local one.
        if (sketchesRef.current.length === 0) {
          const own = loadSketches();
          sketchesRef.current = own;
          setSketches(own);
          setMapMeta(loadMeta());
          setSharedView(false);
        }
        return;
      }
      setSharedView(true);
      sketchesRef.current = m.features;
      setSketches(m.features);
      setMapMeta({ title: m.title, description: m.description ?? '' });
      if (m.basemap) setBasemapId(m.basemap);
      setSketchShown(true);
      setSketchSel(null);
      go('map');
      requestFit(sketchToDocument(m.features).bbox);
      setFocusTab((t) => ({ tab: 'draw', seq: (t?.seq ?? 0) + 1 }));
    };
    void openShared();
    window.addEventListener('hashchange', openShared);
    return () => window.removeEventListener('hashchange', openShared);
  }, [go, requestFit]);

  // Tab title follows the map name on the map page.
  useEffect(() => {
    const named = stage === 'map' && (sketches.length > 0 || sharedView || files.length === 0);
    document.title = named ? `${mapMeta.title} · LEDAT-GIS` : 'LEDAT-GIS';
  }, [stage, sketches.length, sharedView, files.length, mapMeta.title]);

  /** "Tạo bản đồ mới": a fresh, unnamed map. The map saved on this device is replaced (after confirming). */
  const openBlankMap = () => {
    // While a shared link is shown, the device's own map is still in storage, untouched — that is what is at stake.
    const own = sharedView ? loadSketches() : sketches;
    if (own.length > 0) {
      setNewMapPrompt({ title: sharedView ? loadMeta().title : mapMeta.title, count: own.length });
      return;
    }
    startBlankMap();
  };

  const startBlankMap = () => {
    if (sharedView) keepSharedMap();
    sketchesRef.current = [];
    setSketches([]);
    setMapMeta({ title: DEFAULT_MAP_TITLE, description: '' });
    setSketchSel(null);
    setSketchShown(true);
    go('map');
    setFocusTab((t) => ({ tab: 'draw', seq: (t?.seq ?? 0) + 1 }));
  };

  /** "Tiếp tục vẽ": back to the map saved on this device (leaving a shared link that may be on screen). */
  const continueOwnMap = () => {
    if (sharedView) {
      const own = loadSketches();
      keepSharedMap();
      sketchesRef.current = own;
      setSketches(own);
      setMapMeta(loadMeta());
      setSketchSel(null);
    }
    setSketchShown(true);
    go('map');
    requestFit(sketchToDocument(sketchesRef.current).bbox);
    setFocusTab((t) => ({ tab: 'draw', seq: (t?.seq ?? 0) + 1 }));
  };

  const keepSharedMap = () => {
    // Becomes this device's own map: persisted from now on, and the link is dropped from the address bar.
    setSharedView(false);
    try {
      window.history.replaceState(null, '', window.location.pathname); // drops ?t= and #m= of the link
    } catch {
      /* ignore */
    }
  };

  // ---- active-file actions ------------------------------------------------------------------------

  /** Province picked from the list: VN-2000 with that (former) province's KTT, 3° zone, keeping units / axis swap. */
  const onPickUnit = (id: string, lon0: number) => {
    if (!af) return;
    patch(af.id, { provinceId: id, provinceGuess: null });
    if (rawDoc?.crs) {
      // KML/KMZ: this only sets the DXF target CRS.
      patch(af.id, { form: { ...targetFormFor(id), lon0 } });
      if (doc) patch(af.id, { check: checkLocation(doc, id || undefined) });
    } else if (rawDoc) {
      const crs: CrsOptions = {
        proj4: buildVn2000(lon0, 3),
        swapXY: activeCrs?.swapXY ?? false,
        unitScale: activeCrs?.unitScale ?? 1,
      };
      void applyCrs(af.id, crs, { fit: true, provinceId: id });
    }
  };

  const onApplyForm = () => {
    if (!af) return;
    const crs = crsFromForm(form);
    if (!crs.proj4) return;
    // Only a fine offset changed → keep the view so the user can compare with the imagery.
    void applyCrs(af.id, crs, { fit: !sameBaseCrs(crs, activeCrs), provinceId });
  };

  const { counts, kinds } = useMemo(() => {
    const m = new Map<string, number>();
    const k = new Map<string, { line: boolean; fill: boolean }>();
    for (const e of rawDoc?.entities ?? []) {
      m.set(e.layer, (m.get(e.layer) ?? 0) + 1);
      let f = k.get(e.layer);
      if (!f) k.set(e.layer, (f = { line: false, fill: false }));
      if (e.kind === 'polyline' || e.kind === 'table') f.line = true;
      else if (e.kind === 'polygon') f.fill = true;
    }
    return { counts: m, kinds: k };
  }, [rawDoc]);

  /** Patch (or clear, with null) the style of several layers at once. Styles outlive CRS changes and visibility toggles. */
  const onStyle = useCallback(
    (names: string[], patchStyle: LayerStyle | null) => {
      const id = activeIdRef.current ?? filesRef.current[0]?.id;
      const cur = filesRef.current.find((f) => f.id === id);
      if (!cur) return;
      const next = { ...cur.styles };
      for (const n of names) {
        if (patchStyle === null) delete next[n];
        else {
          const merged = { ...cur.styles[n], ...patchStyle };
          if (isEmptyStyle(merged)) delete next[n];
          else next[n] = merged;
        }
      }
      patch(cur.id, { styles: next });
    },
    [patch],
  );
  const setVisible = useCallback(
    (v: Set<string>) => {
      const id = activeIdRef.current ?? filesRef.current[0]?.id;
      if (id) patch(id, { visible: v });
    },
    [patch],
  );

  // ---- sketch actions -----------------------------------------------------------------------------

  const commitSketch = useCallback(
    (kind: SketchKind, points: Vec2[]) => {
      const list = sketchesRef.current;
      const f: SketchFeature = {
        id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind,
        name: nextSketchName(kind, list.map((x) => x.name)),
        points,
        // Thicker than drawing lines by default so sketches stand out on imagery.
        style: { color: nextColor, ...(kind === 'line' ? { width: 3 } : kind === 'polygon' ? { width: 2, fillOpacity: SKETCH_DEFAULT_FILL } : {}) },
      };
      sketchesRef.current = [...list, f];
      setSketches(sketchesRef.current);
      setSketchSel(f.id);
      setSketchShown(true);
      setFocusTab((t) => ({ tab: 'draw', seq: (t?.seq ?? 0) + 1 }));
    },
    [nextColor],
  );
  const updateSketch = useCallback((id: string, p: Partial<SketchFeature>) => {
    setSketches((list) =>
      list.map((f) => {
        if (f.id !== id) return f;
        const next = { ...f, ...p };
        if (p.name !== undefined) next.name = uniqueName(p.name, list.map((x) => x.name), f.name);
        return next;
      }),
    );
  }, []);
  const removeSketch = useCallback((id: string) => {
    setSketches((list) => list.filter((f) => f.id !== id));
    setSketchSel((s) => (s === id ? null : s));
  }, []);
  const zoomToSketch = useCallback(
    (id: string) => {
      const f = sketches.find((x) => x.id === id);
      if (!f) return;
      const xs = f.points.map((q) => q[0]);
      const ys = f.points.map((q) => q[1]);
      // Pad single points / tiny features so the map does not zoom in to the max.
      const pad = 0.0008;
      requestFit([
        [Math.min(...xs) - pad, Math.min(...ys) - pad],
        [Math.max(...xs) + pad, Math.max(...ys) + pad],
      ]);
    },
    [sketches, requestFit],
  );
  const sketchDoc = useMemo(() => sketchToDocument(sketches), [sketches]);
  const sketchVisible = useMemo(() => new Set(sketchDoc.layers.map((l) => l.name)), [sketchDoc]);

  /** Map clicks: a sketch is selected in the "Vẽ" tab; anything else opens the entity popup. */
  const onMapPick = useCallback((p: MapPick | null) => {
    if (p?.fileId === SKETCH_ID) {
      setSketchSel(p.ref.entity.handle ?? null);
      setFocusTab((t) => ({ tab: 'draw', seq: (t?.seq ?? 0) + 1 }));
      setPick(null);
      return;
    }
    setPick(p);
  }, []);

  // ---- rendering ----------------------------------------------------------------------------------

  // Dragging a slider fires many updates: restyling runs at lower priority so the UI stays responsive.
  // Opacity / order / visibility come from the live list, documents + styles from the deferred one.
  const deferredFiles = useDeferredValue(files);
  const highlightFileId = pick?.fileId ?? null;
  const highlightHandle = pick?.ref.entity.handle;
  const renderList: FileRender[] = useMemo(() => {
    const byId = new Map(deferredFiles.map((f) => [f.id, f]));
    return files.map((f) => {
      const d = byId.get(f.id) ?? f;
      let styled: CadDocument | null = null;
      if (d.doc) {
        const hit = styledCache.get(f.id);
        if (hit && hit.doc === d.doc && hit.styles === d.styles) styled = hit.out;
        else {
          styled = applyLayerStyles(d.doc, d.styles);
          styledCache.set(f.id, { doc: d.doc, styles: d.styles, out: styled });
        }
      }
      return {
        id: f.id,
        doc: styled,
        visibleLayers: d.visible,
        opacity: f.opacity,
        shown: f.shown,
        highlightHandle: highlightFileId === f.id ? highlightHandle : undefined,
      };
    });
  }, [files, deferredFiles, highlightFileId, highlightHandle, styledCache]);

  const sketchRender: FileRender = useMemo(
    () => ({
      id: SKETCH_ID,
      doc: sketchDoc.layers.length ? sketchDoc : null,
      visibleLayers: sketchVisible,
      opacity: sketchOpacity,
      shown: sketchShown,
      highlightHandle: sketchSel ?? undefined,
    }),
    [sketchDoc, sketchVisible, sketchOpacity, sketchShown, sketchSel],
  );
  const layers = useMemo(
    () => orderFileLayers([sketchRender, ...renderList], (f) => layerCache.get(f, { fontFamily: font.family, showText: font.ready })),
    [sketchRender, renderList, font, layerCache],
  );

  /** Everything shown on the map as one document, for the "Gộp tất cả" export. */
  const mergedExport = useMemo(() => {
    const parts: MergePart[] = [];
    const used: string[] = [];
    for (const r of renderList) {
      const f = files.find((x) => x.id === r.id);
      if (!f || !r.doc || !r.shown) continue;
      const name = uniqueName(baseName(f.fileName), used);
      used.push(name);
      parts.push({ name, doc: r.doc, visibleLayers: r.visibleLayers });
    }
    const sketchCount = sketchShown ? sketchDoc.layers.length : 0;
    if (sketchCount) parts.push({ name: uniqueName('Nét vẽ', used), doc: sketchDoc });
    return { doc: parts.length ? mergeDocuments(parts) : null, files: parts.length - (sketchCount ? 1 : 0), sketches: sketchCount };
  }, [renderList, files, sketchDoc, sketchShown]);
  const styledActive = renderList.find((r) => r.id === af?.id)?.doc ?? null;
  const styledRef = useRef(styledActive);
  useEffect(() => {
    styledRef.current = styledActive;
  }, [styledActive]);

  // Debug hook for automated verification (not in production builds).
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__dwgApp = {
      getDoc: () => docRef.current,
      getFiles: () => filesRef.current,
      buildExport,
      setVisible: (names: string[]) => setVisible(new Set(names)),
      setStyle: (names: string[], p: LayerStyle | null) => onStyle(names, p),
      getStyledDoc: () => styledRef.current,
    };
  }, [setVisible, onStyle]);

  const popup = useMemo(() => {
    if (!pick) return null;
    const f = files.find((x) => x.id === pick.fileId);
    return {
      lngLat: pick.lngLat,
      content: (
        <EntityPopup pick={pick.ref} file={files.length > 1 && f ? { name: f.fileName, tag: f.tag } : undefined} onClose={() => setPick(null)} />
      ),
    };
  }, [pick, files]);

  const busyFile = files.find((f) => f.status === 'parsing' || f.status === 'transforming');
  const busy = !!busyFile;
  const afBusy = af ? af.status === 'parsing' || af.status === 'transforming' : false;
  const progress = busyFile?.progress ?? null;
  /** Source already in WGS84 (KML/KMZ): step 2 picks the DXF target CRS instead of the drawing CRS. */
  const isGeoSource = !!rawDoc?.crs;
  const sketchCenter: Vec2 = [(sketchDoc.bbox[0][0] + sketchDoc.bbox[1][0]) / 2, (sketchDoc.bbox[0][1] + sketchDoc.bbox[1][1]) / 2];
  const dxfCrs = !af
    ? sketchDoc.layers.length
      ? vn2000Around(sketchCenter[0], sketchCenter[1])
      : null
    : isGeoSource
      ? crsFromForm(form).proj4
        ? crsFromForm(form)
        : null
      : activeCrs;
  const warnings = doc?.warnings ?? rawDoc?.warnings ?? [];
  const stats = rawDoc
    ? [
        `${rawDoc.entities.length.toLocaleString('vi-VN')} đối tượng`,
        `${rawDoc.layers.length} layer`,
        ...(af?.timing.parse ? [`đọc ${fmtMs(af.timing.parse)}`] : []),
      ]
    : undefined;

  const zoomToFile = (id: string) => {
    const d = filesRef.current.find((f) => f.id === id)?.doc;
    if (d) requestFit(documentBounds(d));
  };
  const zoomToDrawing = doc ? () => requestFit(documentBounds(doc)) : undefined;

  // Drop a file anywhere: on the map page files are ADDED on top; elsewhere the dropped file replaces the current one.
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) setDragDepth((d) => d + 1);
    },
    onDragLeave: () => setDragDepth((d) => Math.max(0, d - 1)),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    // Capture phase: runs even when a child drop zone (Landing, CRS step) handles the drop and stops propagation.
    onDropCapture: () => setDragDepth(0),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragDepth(0);
      const list = Array.from(e.dataTransfer.files ?? []);
      if (list.length === 0) return;
      if (stage === 'map') void addFiles(list);
      else if (!busy) void handleFile(list[0], { replace: true });
    },
  };

  const dragOverlay = dragDepth > 0 && (
    <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-[2px]">
      <div className="ui-floating flex items-center gap-3 px-5 py-4 text-sm font-medium text-zinc-900">
        <IconUpload className="text-blue-600" width={20} height={20} />
        {stage === 'map' ? 'Thả để thêm file chồng lên bản đồ' : 'Thả để mở file'}
      </div>
    </div>
  );

  const crsPanel = (onStepPage: boolean) => (
    <CrsPanel
      provinceId={provinceId}
      hint={
        af?.provinceGuess
          ? `Tự nhận từ chữ trong bản vẽ (${af.provinceGuess.hits} chuỗi nhắc tới ${af.provinceGuess.name}). Đổi nếu chưa đúng.`
          : rawDoc && !provinceId
            ? 'Hãy chọn tỉnh: nhiều kinh tuyến trục đều cho vị trí hợp lệ.'
            : undefined
      }
      onPickUnit={onPickUnit}
      activeCrs={activeCrs}
      form={form}
      onFormChange={(f) => af && patch(af.id, { form: f })}
      onApplyForm={onApplyForm}
      onCheck={() => doc && af && patch(af.id, { check: checkLocation(doc, provinceId || undefined) })}
      onZoom={zoomToDrawing}
      showZoom={!onStepPage}
      target={isGeoSource}
      check={af?.check ?? null}
      busy={afBusy}
      disabled={!rawDoc}
    />
  );

  // Landing and the CRS step share one <Landing> so the hero (and its animation) stays put.
  if (stage === 'landing' || stage === 'crs') {
    return (
      <div className="relative" {...dropHandlers}>
        <Landing
          onFile={(f) => void handleFile(f, { replace: true })}
          busy={af?.status === 'parsing'}
          progress={af?.progress ?? null}
          error={stage === 'landing' ? (globalError ?? af?.error ?? null) : null}
          resumeName={rawDoc ? af?.fileName : sketches.length ? mapMeta.title : undefined}
          onResume={rawDoc ? () => go(files.length > 1 || isGeoSource ? 'map' : 'crs') : sketches.length ? () => go('map') : undefined}
          onBlankMap={openBlankMap}
          panel={
            stage === 'crs' ? (
              <CrsStep
                fileName={af?.fileName}
                stats={stats}
                error={af?.error ?? globalError}
                busy={afBusy}
                canContinue={!!doc && af?.status === 'ready'}
                onBack={() => go('landing')}
                onContinue={() => {
                  requestFit(doc && documentBounds(doc));
                  go('map');
                }}
              >
                {crsPanel(true)}
              </CrsStep>
            ) : undefined
          }
        />
        {stage === 'crs' && af?.status === 'parsing' && (
          <div className="ui-floating ui-fade-up fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-700">
            <IconSpinner className="text-blue-600" />
            {`${af.progress?.stage ?? 'Đang đọc'} · ${Math.round(af.progress?.percent ?? 0)}%`}
          </div>
        )}
        {dragOverlay}
        {newMapPrompt && (
          <NewMapDialog
            title={newMapPrompt.title}
            count={newMapPrompt.count}
            onContinue={() => {
              setNewMapPrompt(null);
              continueOwnMap();
            }}
            onOverwrite={() => {
              setNewMapPrompt(null);
              startBlankMap();
            }}
            onClose={() => setNewMapPrompt(null)}
          />
        )}
      </div>
    );
  }

  const rows: FileRowData[] = files.map((f) => ({
    id: f.id,
    name: f.fileName,
    tag: f.tag,
    status: f.status,
    progress: f.progress,
    shown: f.shown,
    opacity: f.opacity,
    needsConfirm: f.needsConfirm,
    subtitle:
      f.status === 'error'
        ? (f.error ?? 'Lỗi')
        : f.rawDoc
          ? `${f.rawDoc.entities.length.toLocaleString('vi-VN')} đối tượng · ${f.rawDoc.layers.length} layer`
          : undefined,
  }));

  const noFileHint = (text: string) => (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-xs leading-relaxed text-zinc-400">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <IconUpload width={18} height={18} />
      </span>
      <p className="max-w-[16rem]">{text}</p>
      <p>
        Bấm <b className="font-medium text-zinc-600">+ Thêm file</b> ở trên hoặc kéo thả file vào bản đồ.
      </p>
    </div>
  );

  const filesSection = (
    <FileList
      rows={rows}
      activeId={af?.id ?? null}
      busy={busy}
      onSelect={setActive}
      onToggle={(id) => patch(id, { shown: !filesRef.current.find((f) => f.id === id)?.shown })}
      onOpacity={(id, v) => patch(id, { opacity: v })}
      onZoom={zoomToFile}
      onMove={(id, dir) => commitFiles(moveById(filesRef.current, id, dir))}
      onRemove={removeFile}
      onAdd={(list) => void addFiles(list)}
      onFitAll={() => requestFit(unionBounds([shownBounds(filesRef.current), sketchShown && sketchDoc.layers.length ? sketchDoc.bbox : null]))}
    />
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-zinc-100" {...dropHandlers}>
      <main className="absolute inset-0">
        <MapView
          basemapId={basemapId}
          onBasemapChange={setBasemapId}
          layers={layers}
          fit={fit}
          onPick={onMapPick}
          popup={popup}
          insetLeft={sidebarOpen ? PANEL_INSET : 0}
          drawingCrs={isGeoSource ? null : activeCrs}
          drawingCrsLabel={drawingCrsLabel(isGeoSource ? null : activeCrs)}
          fontFamily={font.family}
          loading={busy}
          drawTool={drawTool}
          onDrawToolChange={setDrawTool}
          onSketchCommit={commitSketch}
        />
      </main>

      <MapPanel
        open={sidebarOpen}
        onCollapse={() => setSidebarOpen(false)}
        onHome={() => go('landing')}
        fileName={af?.fileName}
        stats={stats}
        busy={afBusy}
        progress={af?.progress ?? null}
        error={af?.error ?? globalError}
        filesSection={filesSection}
        focusTab={focusTab}
        warnings={warnings}
        layersTab={
          rawDoc && af ? (
            <LayerPanel
              key={af.id}
              layers={rawDoc.layers}
              counts={counts}
              kinds={kinds}
              visible={af.visible}
              onChange={setVisible}
              styles={af.styles}
              onStyle={onStyle}
            />
          ) : !af ? (
            noFileHint('Chưa mở bản vẽ nào — các layer của file DWG/DXF/KMZ sẽ hiện ở đây.')
          ) : (
            <div className="space-y-2 pt-1" aria-busy>
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="ui-skeleton h-8 rounded-lg" style={{ opacity: 1 - i * 0.1 }} />
              ))}
            </div>
          )
        }
        drawTab={
          <SketchPanel
            features={sketches}
            selectedId={sketchSel}
            onSelect={setSketchSel}
            tool={drawTool}
            onTool={setDrawTool}
            nextColor={nextColor}
            onNextColor={setNextColor}
            onUpdate={updateSketch}
            onRemove={removeSketch}
            onClearAll={() => {
              setSketches([]);
              setSketchSel(null);
            }}
            shown={sketchShown}
            onToggleShown={() => setSketchShown((v) => !v)}
            opacity={sketchOpacity}
            onOpacity={setSketchOpacity}
            onZoom={zoomToSketch}
            title={mapMeta.title}
            description={mapMeta.description}
            onTitle={(title) => setMapMeta((m) => ({ ...m, title }))}
            onDescription={(description) => setMapMeta((m) => ({ ...m, description }))}
            onShare={() =>
              setShareMap({
                title: mapMeta.title.trim() || DEFAULT_MAP_TITLE,
                description: mapMeta.description.trim() || undefined,
                basemap: basemapId,
                features: sketches,
              })
            }
            sharedView={sharedView}
            onKeepShared={keepSharedMap}
          />
        }
        crsTab={
          !af ? (
            noFileHint('Hệ tọa độ chỉ cần khi mở bản vẽ DWG/DXF. Nét vẽ trên bản đồ dùng tọa độ WGS84; khi xuất DXF sẽ tự đổi sang VN-2000 theo tỉnh.')
          ) : (
          <>
            {af?.needsConfirm && (
              <div className="ui-pop-in mb-3 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                <IconAlert className="mt-0.5 shrink-0" width={14} height={14} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">File mới thêm — hãy xem lại hệ tọa độ.</p>
                  <p>{af.crsNote}</p>
                  <button className="ui-btn mt-2 !px-2.5 !py-1 !text-xs" onClick={() => patch(af.id, { needsConfirm: false })}>
                    Giữ nguyên
                  </button>
                </div>
              </div>
            )}
            {isGeoSource && <p className="mb-3 text-xs text-zinc-500">Hệ tọa độ đích khi xuất DXF.</p>}
            {crsPanel(false)}
          </>
          )
        }
        exportTab={
          <>
            {af && files.length > 1 && mergedExport.sketches === 0 && (
              <p className="mb-3 flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: af.tag }} />
                <span className="min-w-0 truncate">
                  Xuất file đang chọn: <b className="font-medium text-zinc-900">{af.fileName}</b>
                </span>
              </p>
            )}
            <ExportPanel
              key={`${af?.id}-${isGeoSource ? 'geo' : 'cad'}`}
              doc={styledActive}
              sourceFileName={af?.fileName ?? fileSafe(mapMeta.title)}
              mergedName={sketches.length ? fileSafe(mapMeta.title) : undefined}
              visible={af?.visible ?? new Set()}
              dxfCrs={dxfCrs}
              defaultFormat={isGeoSource ? 'dxf' : 'kmz'}
              merged={mergedExport}
            />
          </>
        }
      />

      {!sidebarOpen && (
        <button
          className="ui-floating absolute left-3 top-3 z-30 flex items-center gap-2.5 p-2 text-sm font-medium text-zinc-900 transition hover:bg-white sm:pr-4"
          onClick={() => setSidebarOpen(true)}
          aria-label="Mở bảng điều khiển"
          title="Bảng điều khiển"
        >
          <Logo width={24} height={24} />
          {/* Phones: logo only, so the button stays clear of the basemap pill. */}
          <span className="hidden sm:inline">Bảng điều khiển</span>
        </button>
      )}

      {dragOverlay}

      {shareMap && <ShareDialog map={shareMap} onClose={() => setShareMap(null)} />}

      {/* Status pill */}
      {busyFile && (
        <div className="ui-floating pointer-events-none absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-700">
          <IconSpinner className="text-blue-600" />
          {busyFile.status === 'parsing'
            ? `${progress?.stage ?? 'Đang đọc'} · ${Math.round(progress?.percent ?? 0)}%`
            : 'Đang chuyển tọa độ…'}
        </div>
      )}
    </div>
  );
}
