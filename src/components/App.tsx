'use client';
import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import ExportPanel, { baseName, buildExport, download } from './ExportPanel';
import { ACCEPTED_EXT } from './FileDropzone';
import FileList, { type FileRowData } from './FileList';
import Landing from './Landing';
import LayerPanel from './LayerPanel';
import MapPanel, { type PanelTab } from './MapPanel';
import type { MapPick } from './MapView';
import { createOpenFile, drawingCrsLabel, type OpenFile } from './openFile';
import ChoiceDialog, { type Choice } from './ChoiceDialog';
import ShareDialog from './ShareDialog';
import { toast, Toaster } from './toast';
import { useIsPhone } from './useIsPhone';
import SearchBox, { type GoTarget } from './SearchBox';
import SketchPanel from './SketchPanel';
import { IconAlert, IconFolderOpen, IconPen, IconPlus, IconSave, IconSpinner, IconUpload, Logo } from './icons';
import { findText } from '@/lib/cad/find';
import { readSession, SESSION_EXT, SessionError, writeSession, type Session, type SessionFile } from '@/lib/cad/session';

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
  return {
    ...DEFAULT_FORM,
    mode: 'vn2000',
    lon0: getProvince(provinceId)?.lon0 ?? 105,
    zone: 3,
  };
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

/**
 * `sharedPayload`: set by the short-link page /s/<id> — the stored map's payload (as in `#m=`), or null when the
 * link does not exist. Left undefined on the normal page.
 */
export default function App({ sharedPayload }: { sharedPayload?: string | null } = {}) {
  const fromShare = openedFromShare() || typeof sharedPayload === 'string';
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
  const [font, setFont] = useState<{ family: string; ready: boolean }>({
    family: DEFAULT_FONT_FAMILY,
    ready: false,
  });
  // The map opens full-screen; the panel stays behind the "Bảng điều khiển" button until asked for.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Phones: the panel is a bottom sheet (MapPanel); it gets out of the way while drawing / editing on the map. */
  const isPhone = useIsPhone();
  /** Search result marker. */
  const [pin, setPin] = useState<{ lngLat: Vec2; label: string } | null>(null);
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
  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  // On the map page the panel is often collapsed, so errors also pop up as a toast.
  useEffect(() => {
    if (globalError && stageRef.current === 'map') toast.error(globalError);
  }, [globalError]);
  const [focusTab, setFocusTab] = useState<{ tab: PanelTab; seq: number }>();
  const [layerCache] = useState(() => createFileLayerCache());
  // ---- sketches (user drawings) ----
  // Restored from this browser; sketches only render on the map page, so the server's empty list never mismatches.
  // A shared link starts empty and is filled by the decoder below (local sketches stay untouched in storage).
  const [sharedView, setSharedView] = useState(fromShare);
  const [sketches, setSketches] = useState<SketchFeature[]>(() => (typeof window === 'undefined' || fromShare ? [] : loadSketches()));
  const [mapMeta, setMapMeta] = useState(() =>
    typeof window === 'undefined' || fromShare ? { title: DEFAULT_MAP_TITLE, description: '' } : loadMeta(),
  );
  const [shareMap, setShareMap] = useState<SharedMap | null>(null);
  /** Decision dialog ("Tạo bản đồ mới" over an existing map, opening a .ldg session…). */
  const [choice, setChoice] = useState<{
    title: string;
    description: ReactNode;
    choices: Choice[];
    hint?: ReactNode;
  } | null>(null);
  const [sessionBusy, setSessionBusy] = useState<'saving' | 'opening' | null>(null);
  const sketchesRef = useRef(sketches);
  /** Session (.ldg) actions, defined further down; refs so earlier callbacks (handleFile) can use them. */
  const openSessionRef = useRef<(file: File) => Promise<void>>(async () => {});
  const saveSessionRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    sketchesRef.current = sketches;
  }, [sketches]);
  const [sketchShown, setSketchShown] = useState(true);
  const [sketchOpacity, setSketchOpacity] = useState(1);
  const [sketchSel, setSketchSel] = useState<string | null>(null);
  const [drawTool, setDrawTool] = useState<SketchKind | null>(null);
  /** Sketch whose shape is being edited on the map. */
  const [editId, setEditId] = useState<string | null>(null);
  // Sketch undo / redo stacks (see recordSketches below).
  const historyRef = useRef<{
    past: SketchFeature[][];
    future: SketchFeature[][];
    key?: string;
    at: number;
  }>({ past: [], future: [], at: 0 });
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const syncHistory = useCallback(() => {
    const h = historyRef.current;
    setHistoryState({
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
    });
  }, []);
  /** Another map was loaded: its changes start a fresh history. */
  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [], at: 0 };
    setEditId(null);
    syncHistory();
  }, [syncHistory]);
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
    // The home page is always plain "/": leaving a shared map (/s/<id>, ?t=…#m=…) must not keep its link in the
    // address bar. (A shared map still on screen stays non-persisted: `sharedView` is unchanged.)
    if (next === 'landing' && (window.location.pathname !== '/' || window.location.search || window.location.hash)) {
      try {
        window.history.replaceState(null, '', '/');
      } catch {
        /* ignore */
      }
    }
    type VT = {
      ready: Promise<unknown>;
      finished: Promise<unknown>;
      updateCallbackDone: Promise<unknown>;
    };
    const d = document as Document & {
      startViewTransition?: (cb: () => void) => VT;
    };
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
      opts: {
        fit: boolean;
        provinceId: string;
        syncForm?: boolean;
        note?: string;
      },
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
    async (
      id: string,
      crs: CrsOptions,
      opts: {
        fit: boolean;
        provinceId: string;
        syncForm?: boolean;
        note?: string;
      },
    ) => {
      try {
        const res = await runTransform(id, crs);
        if (res) commitTransform(id, crs, res, opts);
      } catch (err) {
        patch(id, {
          error: `Lỗi chuyển tọa độ: ${errMsg(err)}`,
          status: 'error',
        });
      }
    },
    [runTransform, commitTransform, patch],
  );

  const autoApply = useCallback(
    async (id: string, raw: CadDocument, prov: string) => {
      const list = suggestCrs(raw, prov || undefined);
      if (list.length > 0) await applyCrs(id, list[0].crs, { fit: true, provinceId: prov });
      else
        patch(id, {
          status: 'ready',
          error: 'Không đoán được hệ tọa độ — hãy thiết lập thủ công.',
        });
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
        } else
          patch(id, {
            status: 'ready',
            error: 'Không đoán được hệ tọa độ — hãy thiết lập thủ công.',
          });
      } catch (err) {
        patch(id, {
          error: `Lỗi chuyển tọa độ: ${errMsg(err)}`,
          status: 'error',
        });
      }
    },
    [runTransform, commitTransform, applyCrs, patch],
  );

  // ---- open / add / remove ----------------------------------------------------------------------

  const dropFileResources = useCallback(
    (id: string) => {
      void pipeline()
        .release(id)
        .catch(() => {});
      layerCache.drop(id);
      styledCache.delete(id);
      transformSeq.current.delete(id);
    },
    [pipeline, layerCache, styledCache],
  );

  /** `replace`: the first file (landing / CRS step) discards everything open; otherwise the file is stacked on top. */
  const handleFile = useCallback(
    async (file: File, opts: { replace?: boolean; provOverride?: string } = {}) => {
      if (file.name.toLowerCase().endsWith(SESSION_EXT)) {
        void openSessionRef.current(file);
        return;
      }
      if (!ACCEPTED_EXT.test(file.name)) {
        setGlobalError('Chỉ hỗ trợ file .dwg, .dxf, .kmz, .kml hoặc phiên làm việc .ldg.');
        return;
      }
      setGlobalError(null);
      const replace = !!opts.replace;
      const prev = filesRef.current;
      const base = replace ? undefined : (prev.find((f) => f.id === activeIdRef.current) ?? prev[0]);
      const id = `f${++idSeq.current}`;
      if (replace) prev.forEach((f) => dropFileResources(f.id));
      const entry = {
        ...createOpenFile(id, file.name, nextTagColor(replace ? [] : prev.map((f) => f.tag))),
        source: file,
      };
      commitFiles(replace ? [entry] : [entry, ...prev]);
      setActive(id);
      setPick(null);
      // A freshly opened drawing starts on its layers (not on a tab left over from an earlier map).
      if (replace) setFocusTab((t) => ({ tab: 'layers', seq: (t?.seq ?? 0) + 1 }));
      // A drawing opened from the home page with no sketches around starts new work: drop the old map name
      // (it would otherwise name this drawing's exports and session).
      if (replace && sketchesRef.current.length === 0) setMapMeta({ title: DEFAULT_MAP_TITLE, description: '' });
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
        patch(id, {
          error: `Không đọc được bản vẽ: ${errMsg(err)}`,
          status: 'error',
          progress: null,
        });
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
        await handleFile(await load(sample), {
          replace: true,
          provOverride: prov,
        });
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

  // Shared map links: #m=… holds the whole map (decoded locally, nothing fetched); a short link /s/<id> hands
  // the stored payload in as a prop.
  const sharedPayloadRef = useRef(sharedPayload);
  useEffect(() => {
    const openShared = async () => {
      const fromProp = sharedPayloadRef.current;
      sharedPayloadRef.current = undefined; // only on first load; later hash changes come from the URL
      if (fromProp === null) {
        // (State already started from this device's own map: `fromShare` is false for a missing link.)
        setGlobalError(
          'Không tìm thấy bản đồ của link chia sẻ này — link có thể sai, hoặc đã hết hạn vì 7 ngày liền không ai mở. Hãy nhờ người gửi chia sẻ lại.',
        );
        window.history.replaceState(null, '', '/');
        return;
      }
      const payload = sharePayloadOf(window.location.hash) ?? fromProp ?? null;
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
      resetHistory();
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
  }, [go, requestFit, resetHistory]);

  // Tab title on the map page: the selected drawing's name while a drawing is open; the map name only for
  // sketch-only maps (new map, shared map). A map name left over from earlier work must not label a new drawing.
  const activeFileName = files.find((f) => f.id === activeId)?.fileName ?? files[0]?.fileName;
  useEffect(() => {
    document.title =
      stage !== 'map' ? 'LEDAT-GIS' : activeFileName ? `${activeFileName} · LEDAT-GIS` : `${mapMeta.title} · LEDAT-GIS`;
  }, [stage, activeFileName, mapMeta.title]);

  /** "Tạo bản đồ mới": a fresh, unnamed map. The map saved on this device is replaced (after confirming). */
  const openBlankMap = () => {
    // While a shared link is shown, the device's own map is still in storage, untouched — that is what is at stake.
    const own = sharedView ? loadSketches() : sketches;
    if (own.length > 0) {
      const title = sharedView ? loadMeta().title : mapMeta.title;
      setChoice({
        title: 'Tạo bản đồ mới?',
        description: (
          <>
            Máy này đang lưu bản đồ <b className="font-semibold text-zinc-800">“{title}”</b> với {own.length} nét vẽ. Mỗi máy lưu một bản đồ — tạo mới
            sẽ thay thế bản đồ này.
          </>
        ),
        choices: [
          {
            key: 'continue',
            tone: 'primary',
            icon: <IconPen width={16} height={16} />,
            title: 'Tiếp tục vẽ',
            subtitle: `Mở lại “${title}” để vẽ tiếp`,
            onSelect: continueOwnMap,
          },
          {
            key: 'overwrite',
            tone: 'danger',
            icon: <IconPlus width={16} height={16} />,
            title: 'Ghi đè — tạo bản đồ mới',
            subtitle: `Xóa ${own.length} nét vẽ hiện có và bắt đầu từ bản đồ trống`,
            onSelect: startBlankMap,
          },
        ],
        hint: 'Muốn giữ bản cũ? Lưu phiên làm việc (.ldg) hoặc xuất KMZ trước khi ghi đè.',
      });
      return;
    }
    startBlankMap();
  };

  const startBlankMap = () => {
    if (sharedView) keepSharedMap();
    resetHistory();
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
      resetHistory();
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
    if (sharedView) toast.success('Bản đồ đã được lưu vào máy này.');
    setSharedView(false);
    try {
      window.history.replaceState(null, '', '/'); // drops /s/<id>, ?t= and #m= of the link
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
    void applyCrs(af.id, crs, {
      fit: !sameBaseCrs(crs, activeCrs),
      provinceId,
    });
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

  // ---- sketch history (Hoàn tác / Làm lại) ----
  // Every sketch change goes through recordSketches; loading another map (shared link, session, new map) resets
  // the history. Rapid repeats of the same change (a slider, typing a label) merge into one step.
  const recordSketches = useCallback(
    (next: SketchFeature[], key?: string) => {
      const h = historyRef.current;
      const now = Date.now();
      if (!(key && h.key === key && now - h.at < 1200)) {
        h.past.push(sketchesRef.current);
        if (h.past.length > 100) h.past.shift();
      }
      h.future = [];
      h.key = key;
      h.at = now;
      sketchesRef.current = next;
      setSketches(next);
      syncHistory();
    },
    [syncHistory],
  );
  const stepHistory = useCallback(
    (dir: 'undo' | 'redo') => {
      const h = historyRef.current;
      const from = dir === 'undo' ? h.past : h.future;
      const to = dir === 'undo' ? h.future : h.past;
      const next = from.pop();
      if (!next) return;
      to.push(sketchesRef.current);
      h.key = undefined;
      sketchesRef.current = next;
      setSketches(next);
      setSketchShown(true);
      setSketchSel((s) => (s && next.some((f) => f.id === s) ? s : null));
      setEditId((e) => (e && next.some((f) => f.id === e) ? e : null));
      syncHistory();
    },
    [syncHistory],
  );
  const undoSketch = useCallback(() => stepHistory('undo'), [stepHistory]);
  const redoSketch = useCallback(() => stepHistory('redo'), [stepHistory]);
  const historyApi = useMemo(() => ({ ...historyState, undo: undoSketch, redo: redoSketch }), [historyState, undoSketch, redoSketch]);
  // Ctrl/⌘+Z, Ctrl+Y / Ctrl+Shift+Z on the map page (not while typing, not while placing vertices: there
  // Backspace removes the last vertex).
  const drawToolRef = useRef(drawTool);
  useEffect(() => {
    drawToolRef.current = drawTool;
  });
  useEffect(() => {
    if (stage !== 'map') return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (drawToolRef.current) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoSketch();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redoSketch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, undoSketch, redoSketch]);

  const commitSketch = useCallback(
    (kind: SketchKind, points: Vec2[]) => {
      const list = sketchesRef.current;
      const f: SketchFeature = {
        id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind,
        name: nextSketchName(
          kind,
          list.map((x) => x.name),
        ),
        points,
        // Thicker than drawing lines by default so sketches stand out on imagery.
        style: {
          color: nextColor,
          ...(kind === 'line' ? { width: 3 } : kind === 'polygon' ? { width: 2, fillOpacity: SKETCH_DEFAULT_FILL } : {}),
        },
      };
      recordSketches([...list, f]);
      setSketchSel(f.id);
      setSketchShown(true);
      setFocusTab((t) => ({ tab: 'draw', seq: (t?.seq ?? 0) + 1 }));
    },
    [nextColor, recordSketches],
  );
  const updateSketch = useCallback(
    (id: string, p: Partial<SketchFeature>) => {
      const list = sketchesRef.current;
      recordSketches(
        list.map((f) => {
          if (f.id !== id) return f;
          const next = { ...f, ...p };
          if (p.name !== undefined)
            next.name = uniqueName(
              p.name,
              list.map((x) => x.name),
              f.name,
            );
          return next;
        }),
        // Same field of the same sketch changed again shortly after (slider, typing): one undo step.
        `${id}:${Object.keys(p).sort().join(',')}`,
      );
    },
    [recordSketches],
  );
  const removeSketch = useCallback(
    (id: string) => {
      recordSketches(sketchesRef.current.filter((f) => f.id !== id));
      setSketchSel((s) => (s === id ? null : s));
      setEditId((e) => (e === id ? null : e));
    },
    [recordSketches],
  );
  /** Shape edited on the map (one finished drag / vertex deletion). */
  const commitEdit = useCallback(
    (points: Vec2[]) => {
      if (!editId) return;
      recordSketches(sketchesRef.current.map((f) => (f.id === editId ? { ...f, points } : f)));
    },
    [editId, recordSketches],
  );
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
    return {
      doc: parts.length ? mergeDocuments(parts) : null,
      files: parts.length - (sketchCount ? 1 : 0),
      sketches: sketchCount,
    };
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
  // CRS of the X/Y readouts (status bar, point tool, search): the drawing's, or the DXF target for KML/KMZ and
  // sketch-only maps. Kept referentially stable (crsFromForm builds a new object every render).
  // No drawing open (new map, shared map): null → each point is read in VN-2000 of its own province instead.
  const readoutKey = af && dxfCrs ? JSON.stringify(dxfCrs) : '';
  const readoutCrs = useMemo(() => (readoutKey ? (JSON.parse(readoutKey) as CrsOptions) : null), [readoutKey]);

  const editSketch = editId && sketchShown ? (sketches.find((f) => f.id === editId && !f.hidden) ?? null) : null;

  /** File name for the session (.ldg): the selected drawing's name, or the map's name for a sketch-only map. */
  const workName = af ? baseName(af.fileName) : fileSafe(mapMeta.title.trim() || DEFAULT_MAP_TITLE);

  // ---- search ----
  const findOnMap = useCallback(
    (q: string) =>
      findText(
        q,
        files.filter((f) => f.shown && f.doc).map((f) => ({ name: f.fileName, doc: f.doc! })),
        sketchShown ? sketches : [],
      ),
    [files, sketches, sketchShown],
  );
  const goTo = (t: GoTarget) => {
    setPin({ lngLat: t.lngLat, label: t.label });
    if (isPhone) setSidebarOpen(false);
    const d = 0.0015; // ~170 m around a point
    requestFit(
      t.bounds ?? [
        [t.lngLat[0] - d, t.lngLat[1] - d],
        [t.lngLat[0] + d, t.lngLat[1] + d],
      ],
    );
    if (t.sketchId) {
      setSketchShown(true);
      setSketchSel(t.sketchId);
    }
  };

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

  // ---- session files (.ldg) ---------------------------------------------------------------------
  // The whole working session in one file: open drawings (original bytes) with their CRS / layers / styles,
  // sketches, map name and basemap. Save it to continue later or send it to someone (src/lib/cad/session.ts).

  const saveSession = async () => {
    const ready = filesRef.current.filter((f) => f.source && f.rawDoc);
    if (ready.length === 0 && sketchesRef.current.length === 0) {
      setGlobalError('Chưa có gì để lưu — hãy mở bản vẽ hoặc vẽ thêm trước.');
      return;
    }
    setSessionBusy('saving');
    try {
      const files: SessionFile[] = await Promise.all(
        ready.map(async (f) => ({
          name: f.fileName,
          bytes: new Uint8Array(await f.source!.arrayBuffer()),
          crs: f.rawDoc?.crs ? null : f.activeCrs, // KML/KMZ are WGS84 already
          provinceId: f.provinceId,
          visible: [...f.visible],
          styles: f.styles,
          opacity: f.opacity,
          shown: f.shown,
        })),
      );
      const title = mapMeta.title.trim() || DEFAULT_MAP_TITLE;
      const blob = await writeSession({
        map: {
          title,
          description: mapMeta.description.trim() || undefined,
          basemap: basemapId,
          features: sketchesRef.current,
        },
        sketchLayer: { shown: sketchShown, opacity: sketchOpacity },
        files,
        active: Math.max(
          0,
          ready.findIndex((f) => f.id === activeIdRef.current),
        ),
        savedAt: new Date().toISOString(),
      });
      download(blob, `${workName}${SESSION_EXT}`);
      toast.success(`Đã lưu phiên làm việc “${workName}${SESSION_EXT}”`);
    } catch (err) {
      setGlobalError(`Không lưu được phiên làm việc: ${errMsg(err)}`);
    } finally {
      setSessionBusy(null);
    }
  };

  /** Re-opens one drawing of a session with its saved CRS, layers and styles (its entry is already listed). */
  const restoreFile = async (id: string, sf: SessionFile, file: File) => {
    try {
      const raw = await pipeline().parse(file, (stage, percent) => patch(id, { progress: { stage, percent } }), id);
      if (!filesRef.current.some((f) => f.id === id)) {
        dropFileResources(id);
        return;
      }
      const names = new Set(raw.layers.map((l) => l.name));
      patch(id, {
        rawDoc: raw,
        visible: new Set(sf.visible.filter((n) => names.has(n))),
        provinceId: sf.provinceId,
        progress: null,
        status: 'transforming',
        ...(raw.crs ? { form: targetFormFor(sf.provinceId) } : {}),
      });
      if (raw.crs) await applyCrs(id, { proj4: raw.crs, swapXY: false, unitScale: 1 }, { fit: false, provinceId: sf.provinceId, syncForm: false });
      else if (sf.crs) await applyCrs(id, sf.crs, { fit: false, provinceId: sf.provinceId });
      else await autoApply(id, raw, sf.provinceId);
    } catch (err) {
      patch(id, {
        error: `Không đọc được bản vẽ: ${errMsg(err)}`,
        status: 'error',
        progress: null,
      });
    }
  };

  const restoreSession = async (session: Session, mode: 'replace' | 'add') => {
    if (mode === 'replace') {
      filesRef.current.forEach((f) => dropFileResources(f.id));
      commitFiles([]);
      setActive(null);
      setPick(null);
      if (sharedView) keepSharedMap();
      resetHistory();
      sketchesRef.current = session.map.features;
      setSketches(session.map.features);
      setMapMeta({
        title: session.map.title,
        description: session.map.description ?? '',
      });
      if (session.map.basemap) setBasemapId(session.map.basemap);
      setSketchShown(session.sketchLayer.shown);
      setSketchOpacity(session.sketchLayer.opacity);
    } else {
      const names = sketchesRef.current.map((f) => f.name);
      const added = session.map.features.map((f) => {
        const name = uniqueName(f.name, names);
        names.push(name);
        return {
          ...f,
          id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
          name,
        };
      });
      recordSketches([...sketchesRef.current, ...added]);
      if (added.length) setSketchShown(true);
    }
    setSketchSel(null);

    // All entries first (the list keeps the saved order: first = on top), then read them one by one.
    const jobs = [...session.files].reverse().map((sf) => {
      const id = `f${++idSeq.current}`;
      const file = new File([sf.bytes as BlobPart], sf.name);
      const entry: OpenFile = {
        ...createOpenFile(id, sf.name, nextTagColor(filesRef.current.map((f) => f.tag))),
        source: file,
        styles: sf.styles,
        opacity: sf.opacity,
        shown: sf.shown,
      };
      commitFiles([entry, ...filesRef.current]);
      return { id, sf, file };
    });
    const ids = jobs.map((j) => j.id).reverse();
    if (ids.length) setActive(ids[session.active] ?? ids[0]);
    go('map');
    setFocusTab((t) => ({
      tab: ids.length ? 'layers' : 'draw',
      seq: (t?.seq ?? 0) + 1,
    }));
    if (!ids.length) requestFit(sketchToDocument(sketchesRef.current).bbox);
    for (const j of jobs) await restoreFile(j.id, j.sf, j.file);
    const failed = jobs.filter((j) => filesRef.current.find((f) => f.id === j.id)?.status === 'error').length;
    if (failed) toast.error(`Mở phiên xong nhưng ${failed} bản vẽ bị lỗi — xem danh sách file.`);
    else toast.success(`Đã mở phiên “${session.map.title}”`);
    if (ids.length) {
      const sk = sketchToDocument(sketchesRef.current);
      requestFit(unionBounds([shownBounds(filesRef.current), sk.layers.length ? sk.bbox : null]));
    }
  };

  const openSession = async (file: File) => {
    setSessionBusy('opening');
    let session: Session;
    try {
      session = await readSession(file);
    } catch (err) {
      setGlobalError(err instanceof SessionError ? err.message : `Không mở được file .ldg: ${errMsg(err)}`);
      return;
    } finally {
      setSessionBusy(null);
    }
    setGlobalError(null);
    if (filesRef.current.length === 0 && sketchesRef.current.length === 0) {
      void restoreSession(session, 'replace');
      return;
    }
    const nFiles = session.files.length;
    const nSketches = session.map.features.length;
    const content = [nFiles ? `${nFiles} bản vẽ` : '', nSketches ? `${nSketches} nét vẽ` : ''].filter(Boolean).join(' và ') || 'không có nội dung';
    setChoice({
      title: `Mở phiên “${session.map.title}”?`,
      description: (
        <>
          Phiên làm việc gồm <b className="font-semibold text-zinc-800">{content}</b>
          {session.savedAt ? `, lưu lúc ${new Date(session.savedAt).toLocaleString('vi-VN')}` : ''}. Bản đồ đang mở có {filesRef.current.length} bản
          vẽ và {sketchesRef.current.length} nét vẽ.
        </>
      ),
      choices: [
        {
          key: 'add',
          tone: 'primary',
          icon: <IconPlus width={16} height={16} />,
          title: 'Thêm vào bản đồ hiện tại',
          subtitle: 'Giữ mọi thứ đang mở, thêm bản vẽ và nét vẽ của phiên',
          onSelect: () => void restoreSession(session, 'add'),
        },
        {
          key: 'replace',
          tone: 'danger',
          icon: <IconFolderOpen width={16} height={16} />,
          title: 'Thay thế bản đồ hiện tại',
          subtitle: 'Đóng bản vẽ đang mở, thay nét vẽ bằng của phiên',
          onSelect: () => void restoreSession(session, 'replace'),
        },
      ],
      hint: 'Muốn giữ bản đồ hiện tại? Lưu phiên làm việc (Ctrl+S) trước.',
    });
  };
  // handleFile (declared above) and the Ctrl+S shortcut reach the latest versions through these refs.
  useEffect(() => {
    openSessionRef.current = openSession;
    saveSessionRef.current = saveSession;
  });

  // Ctrl/⌘+S on the map page saves the session instead of the browser's "save page".
  useEffect(() => {
    if (stage !== 'map') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveSessionRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  const choiceDialog = choice && (
    <ChoiceDialog
      title={choice.title}
      description={choice.description}
      hint={choice.hint}
      choices={choice.choices.map((c) => ({
        ...c,
        onSelect: () => {
          setChoice(null);
          c.onSelect();
        },
      }))}
      onClose={() => setChoice(null)}
    />
  );
  const sessionPill = sessionBusy && (
    <div className="ui-floating ui-fade-up fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-700">
      <IconSpinner className="text-blue-600" />
      {sessionBusy === 'saving' ? 'Đang lưu phiên làm việc…' : 'Đang mở phiên làm việc…'}
    </div>
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
          onResume={
            rawDoc
              ? () => go(files.length > 1 || isGeoSource ? 'map' : 'crs')
              : sketches.length
                ? () => {
                    go('map');
                    requestFit(sketchToDocument(sketches).bbox);
                  }
                : undefined
          }
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
        {choiceDialog}
        {sessionPill}
        <Toaster />
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
          insetLeft={sidebarOpen && !isPhone ? PANEL_INSET : 0}
          // X/Y readouts: the drawing's CRS, or for KML/KMZ and sketch-only maps the VN-2000 target of the DXF export.
          drawingCrs={readoutCrs}
          drawingCrsLabel={drawingCrsLabel(readoutCrs)}
          pin={pin}
          editSketch={editSketch}
          onEditCommit={commitEdit}
          onEditDone={() => setEditId(null)}
          history={historyApi}
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
            onTool={(t) => {
              setDrawTool(t);
              if (t && isPhone) setSidebarOpen(false);
            }}
            nextColor={nextColor}
            onNextColor={setNextColor}
            onUpdate={updateSketch}
            onRemove={removeSketch}
            onClearAll={() => {
              recordSketches([]);
              setSketchSel(null);
              setEditId(null);
              toast.info('Đã xóa tất cả nét vẽ — bấm Hoàn tác (Ctrl+Z) nếu lỡ tay.');
            }}
            editingId={editId}
            onEdit={(id) => {
              if (id) {
                setDrawTool(null);
                setSketchShown(true);
                setSketchSel(id);
                const f = sketchesRef.current.find((x) => x.id === id);
                if (f?.hidden) updateSketch(id, { hidden: false });
                if (isPhone) setSidebarOpen(false);
              }
              setEditId(id);
            }}
            history={historyApi}
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
            noFileHint(
              'Hệ tọa độ chỉ cần khi mở bản vẽ DWG/DXF. Nét vẽ trên bản đồ dùng tọa độ WGS84; khi xuất DXF sẽ tự đổi sang VN-2000 theo tỉnh.',
            )
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
        onSaveSession={() => void saveSession()}
        savingSession={sessionBusy === 'saving'}
        exportTab={
          <>
            <div className="mb-4 flex items-start gap-3 rounded-xl bg-zinc-50 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm ring-1 ring-zinc-900/5">
                <IconSave width={16} height={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-zinc-900">Phiên làm việc (.ldg)</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  Lưu mọi bản vẽ đang mở cùng hệ tọa độ, layer, kiểu nét và nét vẽ vào một file — mở lại sau hoặc gửi cho người khác (kéo thả file
                  .ldg vào trang).
                </p>
                <button
                  className="ui-btn-primary mt-2 !px-3 !py-1.5 !text-xs"
                  onClick={() => void saveSession()}
                  disabled={sessionBusy !== null}
                  title="Ctrl+S"
                >
                  {sessionBusy === 'saving' ? <IconSpinner width={14} height={14} /> : <IconSave width={14} height={14} />}
                  Lưu phiên làm việc
                </button>
              </div>
            </div>
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
              mergedName={!af && sketches.length ? fileSafe(mapMeta.title) : undefined}
              visible={af?.visible ?? new Set()}
              dxfCrs={dxfCrs}
              defaultFormat={isGeoSource ? 'dxf' : 'kmz'}
              merged={mergedExport}
            />
          </>
        }
      />

      {/* Top-left: panel button (when collapsed) + search. With the panel open the search moves right of it. */}
      <div
        className="absolute top-3 z-20 flex items-start gap-2 transition-[left] duration-300 ease-out"
        style={{
          left: sidebarOpen && !isPhone ? 'calc(min(384px, 100% - 24px) + 24px)' : 12,
        }}
      >
        {!sidebarOpen && (
          <button
            className="ui-floating flex h-10 shrink-0 items-center gap-2.5 p-2 text-sm font-medium text-zinc-900 transition hover:bg-white sm:pr-4"
            onClick={() => setSidebarOpen(true)}
            aria-label="Mở bảng điều khiển"
            title="Bảng điều khiển"
          >
            <Logo width={24} height={24} />
            {/* Phones: logo only, so the button stays clear of the basemap pill. */}
            <span className="hidden lg:inline">Bảng điều khiển</span>
          </button>
        )}
        <SearchBox drawingCrs={readoutCrs} find={findOnMap} onGo={goTo} onClear={() => setPin(null)} />
      </div>

      {dragOverlay}

      {shareMap && <ShareDialog map={shareMap} onClose={() => setShareMap(null)} />}
      {choiceDialog}
      {sessionPill}
      <Toaster />

      {/* Status pill */}
      {busyFile && (
        <div className="ui-floating pointer-events-none absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-700">
          <IconSpinner className="text-blue-600" />
          {busyFile.status === 'parsing' ? `${progress?.stage ?? 'Đang đọc'} · ${Math.round(progress?.percent ?? 0)}%` : 'Đang chuyển tọa độ…'}
        </div>
      )}
    </div>
  );
}
