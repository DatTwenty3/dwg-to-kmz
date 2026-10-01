'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CadDocument, CrsOptions, Vec2 } from '@/lib/cad/types';
import { buildVn2000, checkLocation, getProvince, suggestCrs, type LocationCheck } from '@/lib/geo';
import {
  buildLayers,
  DEFAULT_BASEMAP_ID,
  DEFAULT_FONT_FAMILY,
  documentBounds,
  guessProvinceFromText,
  type ProvinceGuess,
} from '@/lib/map';
import { CadPipeline } from '@/lib/pipeline';
import { VIETNAMESE_CHARSET } from '@/lib/text';
import CrsPanel from './CrsPanel';
import CrsStep from './CrsStep';
import { DEFAULT_FORM, crsFromForm, formFromCrs, sameBaseCrs, type CrsForm } from './crsForm';
import EntityPopup from './EntityPopup';
import ExportPanel, { buildExport } from './ExportPanel';
import FileDropzone, { ACCEPTED_EXT } from './FileDropzone';
import Landing from './Landing';
import LayerPanel from './LayerPanel';
import type { MapPick } from './MapView';
import { IconAlert, IconPanel, IconSpinner, IconUpload, Logo } from './icons';
import Section from './Section';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-zinc-400">Đang tải bản đồ…</div>,
});

type Status = 'idle' | 'parsing' | 'transforming' | 'ready' | 'error';
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

export default function App() {
  const pipelineRef = useRef<CadPipeline | null>(null);
  const transformSeq = useRef(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [fileName, setFileName] = useState<string>();
  const [rawDoc, setRawDoc] = useState<CadDocument | null>(null);
  const [doc, setDoc] = useState<CadDocument | null>(null);
  const [timing, setTiming] = useState<{ parse?: number; transform?: number }>({});
  const [provinceId, setProvinceId] = useState('');
  const [provinceGuess, setProvinceGuess] = useState<ProvinceGuess | null>(null);
  const [activeCrs, setActiveCrs] = useState<CrsOptions | null>(null);
  const [form, setForm] = useState<CrsForm>(DEFAULT_FORM);
  const [check, setCheck] = useState<LocationCheck | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP_ID);
  const [fit, setFit] = useState<{ bounds: [Vec2, Vec2]; seq: number }>();
  const [pick, setPick] = useState<MapPick | null>(null);
  const [font, setFont] = useState<{ family: string; ready: boolean }>({ family: DEFAULT_FONT_FAMILY, ready: false });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dragDepth, setDragDepth] = useState(0);
  const [stage, setStage] = useState<Stage>('landing');

  const pipeline = useCallback(() => (pipelineRef.current ??= new CadPipeline()), []);
  useEffect(() => () => pipelineRef.current?.dispose(), []);

  useEffect(() => {
    let alive = true;
    loadTextFont().then((family) => alive && setFont({ family, ready: true }));
    return () => {
      alive = false;
    };
  }, []);

  const applyCrs = useCallback(
    async (crs: CrsOptions, opts: { fit: boolean; provinceId: string; syncForm?: boolean }) => {
      const seq = ++transformSeq.current;
      setStatus('transforming');
      setError(null);
      const t0 = performance.now();
      try {
        const out = await pipeline().transform(crs);
        if (seq !== transformSeq.current) return;
        setTiming((t) => ({ ...t, transform: performance.now() - t0 }));
        setDoc(out);
        setActiveCrs(crs);
        if (opts.syncForm !== false) setForm(formFromCrs(crs));
        setCheck(checkLocation(out, opts.provinceId || undefined));
        setPick(null);
        const bounds = documentBounds(out);
        if (opts.fit && bounds) setFit((f) => ({ bounds, seq: (f?.seq ?? 0) + 1 }));
        setStatus('ready');
      } catch (err) {
        if (seq !== transformSeq.current) return;
        setError(`Lỗi chuyển tọa độ: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('error');
      }
    },
    [pipeline],
  );

  const autoApply = useCallback(
    (raw: CadDocument, prov: string) => {
      const list = suggestCrs(raw, prov || undefined);
      if (list.length > 0) void applyCrs(list[0].crs, { fit: true, provinceId: prov });
      else {
        setStatus('ready');
        setError('Không đoán được hệ tọa độ — hãy thiết lập thủ công.');
      }
    },
    [applyCrs],
  );

  const handleFile = useCallback(
    async (file: File, provOverride?: string) => {
      if (!ACCEPTED_EXT.test(file.name)) {
        setError('Chỉ hỗ trợ file .dwg, .dxf, .kmz hoặc .kml.');
        return;
      }
      setFileName(file.name);
      setStatus('parsing');
      setError(null);
      setProgress({ stage: 'Đọc file', percent: 0 });
      setDoc(null);
      setRawDoc(null);
      setCheck(null);
      setPick(null);
      transformSeq.current++;
      const t0 = performance.now();
      try {
        const raw = await pipeline().parse(file, (stage, percent) => setProgress({ stage, percent }));
        setTiming({ parse: performance.now() - t0 });
        setRawDoc(raw);
        setVisible(new Set(raw.layers.filter((l) => l.visible).map((l) => l.name)));
        let prov = provOverride ?? provinceId;
        setProvinceGuess(null);
        if (!prov) {
          // No province chosen: every KTT lands in *some* province, so read it from the drawing's text.
          const guess = guessProvinceFromText(raw);
          if (guess) {
            prov = guess.id;
            setProvinceGuess(guess);
          }
        }
        setProvinceId(prov);
        if (raw.crs) {
          // KML/KMZ: already WGS84 → show as is; the form becomes the DXF target CRS.
          setForm(targetFormFor(prov));
          void applyCrs({ proj4: raw.crs, swapXY: false, unitScale: 1 }, { fit: true, provinceId: prov, syncForm: false });
          setStage('map');
        } else {
          autoApply(raw, prov);
          setStage('crs');
        }
      } catch (err) {
        setError(`Không đọc được bản vẽ: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('error');
      } finally {
        setProgress(null);
      }
    },
    [pipeline, provinceId, autoApply, applyCrs],
  );

  // Dev/verification convenience: /?sample=/samples/x.dwg[&province=can-tho] loads a same-origin file.
  const sampleLoaded = useRef(false);
  useEffect(() => {
    if (sampleLoaded.current) return;
    sampleLoaded.current = true;
    const params = new URLSearchParams(window.location.search);
    const sample = params.get('sample');
    if (!sample || !sample.startsWith('/') || sample.startsWith('//')) return;
    const prov = params.get('province') ?? undefined;
    (async () => {
      try {
        const res = await fetch(sample);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const name = decodeURIComponent(sample.split('/').pop() || 'sample.dwg');
        await handleFile(new File([await res.arrayBuffer()], name), prov);
      } catch (err) {
        setError(`Không tải được file mẫu ${sample}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [handleFile]);

  // Debug hook for automated verification (not in production builds).
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__dwgApp = {
      getDoc: () => docRef.current,
      buildExport,
      setVisible: (names: string[]) => setVisible(new Set(names)),
    };
  }, []);

  /** Province picked from the list: VN-2000 with that (former) province's KTT, 3° zone, keeping units / axis swap. */
  const onPickUnit = (id: string, lon0: number) => {
    setProvinceId(id);
    setProvinceGuess(null);
    if (rawDoc?.crs) {
      // KML/KMZ: this only sets the DXF target CRS.
      setForm({ ...targetFormFor(id), lon0 });
      if (doc) setCheck(checkLocation(doc, id || undefined));
    } else if (rawDoc) {
      const crs: CrsOptions = {
        proj4: buildVn2000(lon0, 3),
        swapXY: activeCrs?.swapXY ?? false,
        unitScale: activeCrs?.unitScale ?? 1,
      };
      void applyCrs(crs, { fit: true, provinceId: id });
    }
  };

  const onApplyForm = () => {
    const crs = crsFromForm(form);
    if (!crs.proj4) return;
    // Only a fine offset changed → keep the view so the user can compare with the imagery.
    void applyCrs(crs, { fit: !sameBaseCrs(crs, activeCrs), provinceId });
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of rawDoc?.entities ?? []) m.set(e.layer, (m.get(e.layer) ?? 0) + 1);
    return m;
  }, [rawDoc]);

  const highlightHandle = pick?.ref.entity.handle;
  const layers = useMemo(
    () =>
      doc
        ? buildLayers(doc, { visibleLayers: visible, highlightHandle, fontFamily: font.family, showText: font.ready })
        : [],
    [doc, visible, highlightHandle, font],
  );

  const popup = useMemo(
    () => (pick ? { lngLat: pick.lngLat, content: <EntityPopup pick={pick.ref} onClose={() => setPick(null)} /> } : null),
    [pick],
  );

  const busy = status === 'parsing' || status === 'transforming';
  /** Source already in WGS84 (KML/KMZ): step 2 picks the DXF target CRS instead of the drawing CRS. */
  const isGeoSource = !!rawDoc?.crs;
  const dxfCrs = isGeoSource ? (crsFromForm(form).proj4 ? crsFromForm(form) : null) : activeCrs;
  const warnings = doc?.warnings ?? rawDoc?.warnings ?? [];
  const entityCount = rawDoc?.entities.length ?? 0;
  const stats = rawDoc
    ? [
        `${entityCount.toLocaleString('vi-VN')} đối tượng`,
        `${rawDoc.layers.length} layer`,
        ...(timing.parse ? [`đọc ${fmtMs(timing.parse)}`] : []),
      ]
    : undefined;
  const zoomToDrawing = doc
    ? () => {
        const b = documentBounds(doc);
        if (b) setFit((f) => ({ bounds: b, seq: (f?.seq ?? 0) + 1 }));
      }
    : undefined;

  // Drop a file anywhere on any page.
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) setDragDepth((d) => d + 1);
    },
    onDragLeave: () => setDragDepth((d) => Math.max(0, d - 1)),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragDepth(0);
      const f = e.dataTransfer.files?.[0];
      if (f && !busy) void handleFile(f);
    },
  };

  const dragOverlay = dragDepth > 0 && (
    <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-[2px]">
      <div className="ui-floating flex items-center gap-3 px-5 py-4 text-sm font-medium text-zinc-900">
        <IconUpload className="text-blue-600" width={20} height={20} />
        Thả để mở file
      </div>
    </div>
  );

  const crsPanel = (onStepPage: boolean) => (
    <CrsPanel
      provinceId={provinceId}
      hint={
        provinceGuess
          ? `Tự nhận từ chữ trong bản vẽ (${provinceGuess.hits} chuỗi nhắc tới ${provinceGuess.name}). Đổi nếu chưa đúng.`
          : rawDoc && !provinceId
            ? 'Hãy chọn tỉnh: nhiều kinh tuyến trục đều cho vị trí hợp lệ.'
            : undefined
      }
      onPickUnit={onPickUnit}
      activeCrs={activeCrs}
      form={form}
      onFormChange={setForm}
      onApplyForm={onApplyForm}
      onCheck={() => doc && setCheck(checkLocation(doc, provinceId || undefined))}
      onZoom={zoomToDrawing}
      showZoom={!onStepPage}
      target={isGeoSource}
      check={check}
      busy={busy}
      disabled={!rawDoc}
    />
  );

  // Landing and the CRS step share one <Landing> so the hero (and its animation) stays put.
  if (stage === 'landing' || stage === 'crs') {
    return (
      <div className="relative" {...dropHandlers}>
        <Landing
          onFile={(f) => void handleFile(f)}
          busy={status === 'parsing'}
          progress={progress}
          error={stage === 'landing' ? error : null}
          resumeName={rawDoc ? fileName : undefined}
          onResume={rawDoc ? () => setStage(isGeoSource ? 'map' : 'crs') : undefined}
          panel={
            stage === 'crs' ? (
              <CrsStep
                fileName={fileName}
                stats={stats}
                error={error}
                busy={busy}
                canContinue={!!doc && status === 'ready'}
                onBack={() => setStage('landing')}
                onContinue={() => {
                  const b = doc && documentBounds(doc);
                  if (b) setFit((f) => ({ bounds: b, seq: (f?.seq ?? 0) + 1 }));
                  setStage('map');
                }}
              >
                {crsPanel(true)}
              </CrsStep>
            ) : undefined
          }
        />
        {stage === 'crs' && status === 'parsing' && (
          <div className="ui-floating fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-700">
            <IconSpinner className="text-blue-600" />
            {`${progress?.stage ?? 'Đang đọc'} · ${Math.round(progress?.percent ?? 0)}%`}
          </div>
        )}
        {dragOverlay}
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-zinc-100" {...dropHandlers}>
      <main className="absolute inset-0">
        <MapView
          basemapId={basemapId}
          onBasemapChange={setBasemapId}
          layers={layers}
          fit={fit}
          onPick={setPick}
          popup={popup}
          insetLeft={sidebarOpen ? PANEL_INSET : 0}
        />
      </main>

      {/* Floating control panel */}
      <aside
        className={`ui-floating absolute bottom-3 left-3 top-3 z-30 flex w-[384px] max-w-[calc(100%-24px)] flex-col overflow-hidden transition-transform duration-300 ease-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%+24px)]'
        }`}
        aria-hidden={!sidebarOpen}
      >
        <header className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4">
          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setStage('landing')} title="Về trang chủ">
            <Logo />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-tight text-zinc-900">LEDAT-GIS</span>
              <span className="block truncate text-xs text-zinc-500">Bản vẽ CAD trên nền Google Hybrid</span>
            </span>
          </button>
          <button
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Thu gọn bảng điều khiển"
            onClick={() => setSidebarOpen(false)}
          >
            <IconPanel width={18} height={18} />
          </button>
        </header>

        <div className="ui-scroll min-h-0 flex-1 overflow-y-auto">
          <Section step={1} title="Bản vẽ">
            <FileDropzone onFile={(f) => void handleFile(f)} busy={busy} fileName={fileName} stats={stats} progress={progress} />
            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                <IconAlert className="mt-px shrink-0" width={14} height={14} />
                {error}
              </p>
            )}
          </Section>

          <Section step={2} title={isGeoSource ? 'Hệ tọa độ đích (DXF)' : 'Hệ tọa độ'} defaultOpen>
            {crsPanel(false)}
          </Section>

          <Section step={3} title="Layer" badge={rawDoc ? <span className="ui-chip">{rawDoc.layers.length}</span> : undefined}>
            {rawDoc ? (
              <LayerPanel layers={rawDoc.layers} counts={counts} visible={visible} onChange={setVisible} />
            ) : (
              <p className="text-xs text-zinc-400">Mở bản vẽ để xem danh sách layer.</p>
            )}
          </Section>

          <Section step={4} title={isGeoSource ? 'Xuất DXF / KML / KMZ' : 'Xuất KML / KMZ / DXF'}>
            <ExportPanel
              key={isGeoSource ? 'geo' : 'cad'}
              doc={doc}
              sourceFileName={fileName}
              visible={visible}
              dxfCrs={dxfCrs}
              defaultFormat={isGeoSource ? 'dxf' : 'kmz'}
            />
          </Section>

          <Section
            title="Cảnh báo"
            defaultOpen={false}
            badge={warnings.length ? <span className="ui-chip bg-amber-50 text-amber-700">{warnings.length}</span> : undefined}
          >
            {warnings.length ? (
              <ul className="ui-scroll flex max-h-60 flex-col gap-1.5 overflow-y-auto text-xs leading-relaxed text-zinc-600">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400">Không có cảnh báo.</p>
            )}
          </Section>
        </div>

        <footer className="border-t border-zinc-100 px-5 py-3 text-[11px] text-zinc-400">
          <p>
            Tác giả <span className="font-medium text-zinc-600">LEDAT</span>
          </p>
          <p className="mt-0.5">Ảnh nền © Google / © Esri · Mã nguồn GPL-3.0 · Xử lý hoàn toàn trên trình duyệt</p>
        </footer>
      </aside>

      {!sidebarOpen && (
        <button
          className="ui-floating absolute left-3 top-3 z-30 flex items-center gap-2.5 py-2 pl-2 pr-4 text-sm font-medium text-zinc-900 transition hover:bg-white"
          onClick={() => setSidebarOpen(true)}
        >
          <Logo width={24} height={24} />
          Bảng điều khiển
        </button>
      )}

      {dragOverlay}

      {/* Status pill */}
      {busy && (
        <div className="ui-floating pointer-events-none absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-700">
          <IconSpinner className="text-blue-600" />
          {status === 'parsing' ? `${progress?.stage ?? 'Đang đọc'} · ${Math.round(progress?.percent ?? 0)}%` : 'Đang chuyển tọa độ…'}
        </div>
      )}
    </div>
  );
}
