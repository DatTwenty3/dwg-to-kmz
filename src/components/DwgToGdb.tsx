'use client';
// "Bóc tách DWG → CSDL TT16": the user drops the DWG folder of a planning dossier (lấy ý kiến Sở Xây dựng); every
// drawing is recognised (hiện trạng, sử dụng đất, giao thông, điện, nước…) with its xrefs, each layer gets a
// suggested Thông tư 16 class, the user reviews the mapping on the satellite map and exports HoSoGIS.zip. The
// mapping is kept as a template ("mẫu ghép layer", localStorage + .json file) for the office's next projects.
// Everything runs in src/workers/dwgTt16.worker.ts; nothing is uploaded.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CadDocument, CrsOptions } from '@/lib/cad/types';
import {
  cleanProjectName,
  compactName,
  conversionNote,
  emptyTemplate,
  initialMapping,
  kindFits,
  landUseOf,
  mergeTemplate,
  prettyLayer,
  readTemplate,
  roleById,
  rowFeatureCount,
  ROLES,
  suggestRow,
  targetOption,
  TARGETS,
  templateDecisions,
  templateLookup,
  type DrawingInfo,
  type GeomKind,
  featureKept,
  type LayerRow,
  type SourceRef,
  type MappingEntry,
  type MappingState,
  type MappingTemplate,
  type RoleId,
} from '@/lib/dwg2gdb';
import { codeForProvince } from '@/lib/gdb/crs';
import { buildVn2000, formatDegMin } from '@/lib/geo/crs';
import { getProvince, PROVINCES } from '@/lib/geo/provinces';
import type { DwgTt16Request, DwgTt16Response } from '@/workers/dwgTt16.worker';
import BrandLoader from './BrandLoader';
import DwgPreviewMap from './DwgPreviewMap';
import HomeLogo from './HomeLogo';
import ToolStart from './ToolStart';
import { useIsPhone } from './useIsPhone';
import { pickedFromDrop, pickedFromInput } from './dropFiles';
import { handOffToChecker } from './handoff';
import {
  IconAlert,
  IconCheckCircle,
  IconDatabaseCheck,
  IconDownload,
  IconFolderOpen,
  IconGeomLine,
  IconGeomPoint,
  IconGeomPolygon,
  IconLayers,
  IconPanel,
  IconSave,
  IconSearch,
  IconSpinner,
  IconTrash,
  IconX,
  IconXCircle,
} from './icons';
import PlanningCodeFields, { startDownload, usePlanningCodes } from './PlanningCodes';

type Picked = { path: string; file: File };
type Loaded = Extract<DwgTt16Response, { type: 'loaded' }>;
type Done = Extract<DwgTt16Response, { type: 'done' }>;
type Progress = { stage: string; done: number; total: number };

const TEMPLATE_KEY = 'ledat-gis:layer-map:v1';
const fmt = (n: number) => n.toLocaleString('vi-VN');

function loadTemplate(): MappingTemplate | null {
  try {
    const s = localStorage.getItem(TEMPLATE_KEY);
    return s ? readTemplate(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}
function storeTemplate(t: MappingTemplate | null): boolean {
  try {
    if (t) localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t));
    else localStorage.removeItem(TEMPLATE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** VN-2000 KTT choices: each former province (before the 2025 mergers) grouped under its current province. */
interface Unit {
  key: string;
  provinceId: string;
  name: string;
  lon0: number;
}
const UNIT_GROUPS = PROVINCES.map((p) => ({
  id: p.id,
  name: p.name,
  units: (p.formerUnits?.length ? p.formerUnits : [{ name: p.name, lon0: p.lon0 }]).map((u): Unit => ({ key: `${p.id}|${u.name}`, provinceId: p.id, name: u.name, lon0: u.lon0 })),
})).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
const UNITS = new Map(UNIT_GROUPS.flatMap((g) => g.units.map((u) => [u.key, u] as const)));

const KIND_ICON: Record<GeomKind, (p: { width: number; height: number; className?: string }) => React.ReactElement> = {
  A: IconGeomPolygon,
  L: IconGeomLine,
  P: IconGeomPoint,
  T: (p) => (
    <span className={`inline-flex items-center justify-center font-serif text-[11px] font-bold leading-none ${p.className ?? ''}`} style={{ width: p.width, height: p.height }}>
      T
    </span>
  ),
};
const NO_INDEXES = new Set<number>();
const KIND_LABEL: Record<GeomKind, string> = { A: 'vùng (hatch)', L: 'đường', P: 'điểm', T: 'chữ' };

/** Short label of a target class: "QuyHoach · ChucNangSuDungDat_A". */
const targetLabel = (t: string | null) => {
  const o = targetOption(t);
  return o ? `${o.db === 'HienTrang' ? 'HT' : o.db === 'QuyHoach' ? 'QH' : o.db} · ${o.cls}` : '';
};

type View = 'review' | 'mapped' | 'all';
type ExportOptions = {
  maHoSoQH: string;
  maThongTinQH: string;
  createMissing: boolean;
  sourceInGhiChu: boolean;
  dxf: boolean;
  qgz: boolean;
  projectName: string;
};

export default function DwgToGdb() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [drawings, setDrawings] = useState<DrawingInfo[]>([]);
  const [mapping, setMapping] = useState<Map<string, MappingState>>(new Map());
  const [template, setTemplate] = useState<MappingTemplate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [rowSel, setRowSel] = useState<string | null>(null);
  const [unitKey, setUnitKey] = useState('');
  const [zone, setZone] = useState<3 | 6>(3);
  const [preview, setPreview] = useState<{ id: string; doc: CadDocument; truncated: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [view, setView] = useState<View>('review');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Objects removed on the map ("Biên tập"): drawing id → entity indexes; history for undo.
  const [excluded, setExcluded] = useState<Map<string, Set<number>>>(new Map());
  const [excludedHistory, setExcludedHistory] = useState<Map<string, Set<number>>[]>([]);
  /** One undoable step: these CAD objects left out of / put back into the export. */
  const editExcluded = (add: SourceRef[], remove: SourceRef[]) => {
    setExcludedHistory((h) => [...h.slice(-49), excluded]);
    const next = new Map(excluded);
    const setOf = (d: string) => {
      let set = next.get(d);
      if (!set || set === excluded.get(d)) next.set(d, (set = new Set(set ?? [])));
      return set;
    };
    for (const [d, i] of add) setOf(d).add(i);
    for (const [d, i] of remove) setOf(d).delete(i);
    setExcluded(next);
  };
  // "Biên tập": the map shows what one geodatabase will get (worker `output`), not a drawing.
  const [editMode, setEditMode] = useState(false);
  const [editDb, setEditDb] = useState('QuyHoach');
  const [output, setOutput] = useState<{ db: string; doc: CadDocument; refs: SourceRef[][][]; dbs: { db: string; count: number }[] } | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const undoExcluded = () => {
    const prev = excludedHistory[excludedHistory.length - 1];
    if (!prev) return;
    setExcluded(prev);
    setExcludedHistory((h) => h.slice(0, -1));
  };
  const excludedCount = [...excluded].reduce((t, [id, set]) => t + (drawings.find((d) => d.id === id)?.included ? set.size : 0), 0);
  const [exportState, setExportState] = useState<{ progress: Progress | null; result: Done | null; error: string | null }>({ progress: null, result: null, error: null });
  const workerRef = useRef<Worker | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    // React has no typed prop for these non-standard attributes.
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  });
  useEffect(() => {
    // Saved template (browser storage, read after mount).
    const t = setTimeout(() => setTemplate(loadTemplate()));
    return () => clearTimeout(t);
  }, []);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const rowsByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const unit = UNITS.get(unitKey) ?? null;
  const crs = useMemo<CrsOptions | null>(() => (unit ? { proj4: buildVn2000(unit.lon0, zone), swapXY: false, unitScale: 1 } : null), [unit, zone]);
  const provinceCode = unit ? codeForProvince(getProvince(unit.provinceId)!) : null;

  const onMessage = (ev: MessageEvent<DwgTt16Response>) => {
    const m = ev.data;
    if (m.type === 'progress') {
      setProgress(m);
      setExportState((s) => (s.progress && !s.result && !s.error ? { ...s, progress: m } : s));
    } else if (m.type === 'loaded') {
      setBusy(false);
      setProgress(null);
      setData(m);
      setDrawings(m.drawings);
      const t = loadTemplate();
      setTemplate(t);
      setMapping(initialMapping(m, t));
      const first = m.drawings.find((d) => d.included && !d.owner) ?? m.drawings[0];
      setSel(first?.id ?? null);
      setRowSel(null);
      setView('review');
      // KTT: the one placing the planning area inside its own province.
      const g = m.guesses[0];
      const units = [...UNITS.values()].filter((x) => !m.provinceId || x.provinceId === m.provinceId);
      const u = g
        ? (units.find((x) => x.lon0 === g.lon0 && g.province.split(', ').includes(x.name)) ??
          units.find((x) => x.lon0 === g.lon0) ??
          [...UNITS.values()].find((x) => x.lon0 === g.lon0))
        : null;
      setUnitKey(u?.key ?? '');
      setZone(3);
    } else if (m.type === 'preview') {
      setPreviewLoading(false);
      setPreview({ id: m.drawingId, doc: m.doc, truncated: m.truncated });
    } else if (m.type === 'output') {
      setOutputLoading(false);
      setOutputError(null);
      setOutput({ db: m.db, doc: m.doc, refs: m.refs, dbs: m.dbs });
    } else if (m.type === 'done') {
      setExportState({ progress: null, result: m, error: null });
    } else if (m.type === 'error') {
      if (m.during === 'load') {
        setBusy(false);
        setError(`Không đọc được bản vẽ: ${m.message}`);
      } else if (m.during === 'preview') {
        setPreviewLoading(false);
        setPreviewError(m.message);
      } else if (m.during === 'output') {
        setOutputLoading(false);
        setOutputError(m.message);
      } else setExportState({ progress: null, result: null, error: m.message });
    }
  };

  const load = (files: Picked[]) => {
    const cad = files.filter((f) => /\.(dwg|dxf)$/i.test(f.path));
    if (!cad.length) {
      setError('Không có file .dwg / .dxf nào — hãy chọn thư mục hồ sơ lấy ý kiến (có các bản vẽ QH…).');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(null);
    setData(null);
    setPreview(null);
    setExcluded(new Map());
    setExcludedHistory([]);
    setEditMode(false);
    setOutput(null);
    workerRef.current?.terminate();
    const w = new Worker(new URL('../workers/dwgTt16.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = onMessage;
    w.onerror = () => {
      setBusy(false);
      setError('Trình duyệt dừng việc đọc bản vẽ (thiếu bộ nhớ?). Hãy bỏ bớt các file xref rất lớn rồi thử lại.');
    };
    w.postMessage({ type: 'load', files: cad } satisfies DwgTt16Request);
  };

  // Preview of the selected drawing (again when the KTT changes).
  const selDrawing = drawings.find((d) => d.id === sel) ?? null;
  const usedLayers = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.drawing === sel && mapping.get(r.key)?.target) s.add(r.layer);
    return s;
  }, [rows, sel, mapping]);
  const previewKey = sel && crs ? `${sel}|${crs.proj4}` : null;
  const [requested, setRequested] = useState<string | null>(null);
  useEffect(() => {
    if (!previewKey || previewKey === requested || !workerRef.current || !data) return;
    const t = setTimeout(() => {
      setRequested(previewKey);
      setPreviewLoading(true);
      setPreviewError(null);
      const big = (selDrawing?.inside ?? 0) > 200_000;
      workerRef.current?.postMessage({ type: 'preview', drawingId: sel!, crs: crs!, layers: big ? [...usedLayers] : null } satisfies DwgTt16Request);
    });
    return () => clearTimeout(t);
  }, [previewKey, requested, data, sel, crs, selDrawing, usedLayers]);

  // What goes to the geodatabases: the export payload and the "Biên tập" view.
  const includedIds = useMemo(() => drawings.filter((d) => d.included).map((d) => d.id), [drawings]);
  const exportMapping = useMemo(
    () => [...mapping].filter(([k]) => rowsByKey.has(k)).map(([k, v]): [string, MappingEntry] => [k, { target: v.target, phanLoai: v.phanLoai }]),
    [mapping, rowsByKey],
  );
  useEffect(() => {
    if (!editMode || !crs || !data || !workerRef.current) return;
    const t = setTimeout(() => {
      setOutputLoading(true);
      workerRef.current?.postMessage({ type: 'output', db: editDb, drawings: includedIds, mapping: exportMapping, crs, projectTitle: data.projectTitle ?? null } satisfies DwgTt16Request);
    }, 300);
    return () => clearTimeout(t);
  }, [editMode, editDb, crs, data, includedIds, exportMapping]);
  const editView = editMode && output && output.db === editDb ? output : null;
  /** Features of the edit view that will not be written (all their sources left out). */
  const removedFeatures = useMemo(() => {
    const out = new Set<number>();
    editView?.refs.forEach((alts, k) => {
      if (!featureKept(alts, excluded)) out.add(k);
    });
    return out;
  }, [editView, excluded]);
  const featureRefs = (ks: number[] | null) => (ks ?? editView?.refs.map((_, k) => k) ?? []).flatMap((k) => editView?.refs[k]?.flat() ?? []);
  const editLayers = useMemo(() => new Set(editView?.doc.layers.map((l) => l.name) ?? []), [editView]);

  // ----- Mapping edits -----
  const setRole = (id: string, role: RoleId) => {
    setDrawings((ds) => ds.map((d) => (d.id === id ? { ...d, role, included: !!roleById(role).db && d.inside > 0 } : d)));
    const lookup = templateLookup(template);
    setMapping((m) => {
      const n = new Map(m);
      for (const r of rows) {
        if (r.drawing !== id || n.get(r.key)?.source === 'manual') continue;
        const t = roleById(role).db ? lookup(role, r.layer, r.kind) : null;
        n.set(r.key, t ? { ...t, source: 'template', reason: 'Theo mẫu ghép đã lưu' } : suggestRow(r, role, rowsByKey));
      }
      return n;
    });
  };
  const setTarget = (r: LayerRow, target: string | null) => {
    setMapping((m) => {
      const n = new Map(m);
      const old = n.get(r.key);
      const opt = targetOption(target);
      const phanLoai = !target ? '' : old?.phanLoai || (opt?.cls === 'ChucNangSuDungDat_A' ? (landUseOf(compactName(r.layer)) ?? prettyLayer(r.layer)) : prettyLayer(r.layer));
      n.set(r.key, { target, phanLoai, source: 'manual', reason: target ? 'Bạn đã chọn' : 'Bạn đã bỏ qua layer này' });
      return n;
    });
    setEditing(null);
  };
  const setPhanLoai = (r: LayerRow, v: string) =>
    setMapping((m) => {
      const n = new Map(m);
      const old = n.get(r.key);
      if (old) n.set(r.key, { ...old, phanLoai: v.slice(0, 250), source: 'manual' });
      return n;
    });

  // ----- Template -----
  const saveTemplate = (silent = false) => {
    const next = mergeTemplate(template ?? emptyTemplate(), templateDecisions(drawings, rows, mapping));
    setTemplate(next);
    const ok = storeTemplate(next);
    if (!silent) setNotice(ok ? `Đã lưu ${fmt(next.rules.length)} quy tắc vào mẫu ghép trên máy này.` : 'Trình duyệt không cho lưu — hãy dùng “Tải mẫu về (.json)”.');
    return next;
  };
  const downloadTemplate = () => {
    const t = saveTemplate(true);
    const url = URL.createObjectURL(new Blob([JSON.stringify(t, null, 1)], { type: 'application/json' }));
    startDownload(url, 'mau-ghep-layer-TT16.json');
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const applyTemplate = (t: MappingTemplate | null) => {
    const lookup = templateLookup(t);
    const roleOf = new Map(drawings.map((d) => [d.id, d.role]));
    setMapping((m) => {
      const n = new Map(m);
      for (const r of rows) {
        const role = roleOf.get(r.drawing) ?? 'other';
        if (n.get(r.key)?.source === 'manual' || !roleById(role).db) continue;
        const hit = lookup(role, r.layer, r.kind);
        n.set(r.key, hit ? { ...hit, source: 'template', reason: 'Theo mẫu ghép đã lưu' } : suggestRow(r, role, rowsByKey));
      }
      return n;
    });
  };
  const importTemplate = async (file: File) => {
    try {
      const t = readTemplate(JSON.parse(await file.text()));
      const merged = mergeTemplate(template ?? emptyTemplate(t.name), t.rules);
      setTemplate(merged);
      storeTemplate(merged);
      applyTemplate(merged);
      setNotice(`Đã nhập ${fmt(t.rules.length)} quy tắc từ ${file.name} và áp dụng cho bảng ghép.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được file mẫu.');
    }
  };
  const clearTemplate = () => {
    setTemplate(null);
    storeTemplate(null);
    setNotice('Đã xóa mẫu ghép đã lưu trên máy này.');
  };

  // ----- Export -----
  const startExport = (opts: ExportOptions) => {
    if (!workerRef.current || !unit) return;
    setExportState({ progress: { stage: 'Bắt đầu', done: 0, total: 1 }, result: null, error: null });
    saveTemplate(true);
    workerRef.current.postMessage({
      type: 'export',
      drawings: includedIds,
      mapping: exportMapping,
      lon0: unit.lon0,
      zone,
      place: unit.name,
      ...opts,
      roles: Object.fromEntries(drawings.map((d) => [d.id, d.role])),
      projectTitle: data?.projectTitle ?? null,
      provinceCode,
      excluded: Object.fromEntries([...excluded].filter(([, set]) => set.size).map(([id, set]) => [id, [...set]])),
    } satisfies DwgTt16Request);
  };
  const openInChecker = (zip: Blob, name: string) => {
    handOffToChecker([new File([zip], name, { type: 'application/zip' })]);
    router.push('/kiem-tra');
  };

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (!busy) load(await pickedFromDrop(e.dataTransfer));
    },
  };
  const pickers = (
    <>
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) load(pickedFromInput(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={filesRef}
        type="file"
        accept=".dwg,.dxf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) load(pickedFromInput(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={templateRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importTemplate(f);
          e.target.value = '';
        }}
      />
    </>
  );
  const messageBox = (error || notice) && (
    <p className={`flex items-start gap-2 rounded-xl px-4 py-2.5 text-[13px] ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
      {error ? <IconAlert width={15} height={15} className="mt-0.5 shrink-0" /> : <IconCheckCircle width={15} height={15} className="mt-0.5 shrink-0" />}
      <span className="flex-1">{error ?? notice}</span>
      <button
        aria-label="Đóng"
        onClick={() => {
          setError(null);
          setNotice(null);
        }}
      >
        <IconX width={14} height={14} />
      </button>
    </p>
  );

  /** Floating panels over the map (wider than a phone): drawing list and mapping table. */
  const [listOpen, setListOpen] = useState(true);
  const [tableOpen, setTableOpen] = useState(true);
  const [tableW, setTableW] = useState(460);
  const phone = useIsPhone();
  const startTableResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setTableW(Math.max(340, Math.min(window.innerWidth * 0.5, window.innerWidth - 12 - ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Every wait (reading the folder, drawing a map, building the edit view, writing HoSoGIS): the brand loader.
  const exporting = !!exportState.progress && !exportState.result && !exportState.error;
  const loader = (
    <BrandLoader
      show={busy || previewLoading || outputLoading || exporting}
      stage={
        exporting
          ? exportState.progress?.stage
          : busy
            ? (progress?.stage ?? 'Đang đọc thư mục bản vẽ…')
            : outputLoading
              ? 'Đang dựng các đối tượng sẽ ghi vào gdb…'
              : 'Đang vẽ bản vẽ lên bản đồ…'
      }
      percent={
        exporting
          ? exportState.progress && exportState.progress.total > 1
            ? (exportState.progress.done / exportState.progress.total) * 100
            : null
          : busy && progress?.total
            ? (progress.done / progress.total) * 100
            : null
      }
    />
  );

  // ---------- Start screen ----------
  if (!data) {
    return (
      <div className="flex min-h-dvh flex-col bg-white" {...dropHandlers}>
        <ToolStart
          art="extract"
          title={<>Bóc tách <span className="ui-shimmer">DWG → GIS</span></>}
          subtitle="Thư mục bản vẽ quy hoạch → HoSoGIS theo Thông tư 16."
          prompt="Thả cả thư mục bản vẽ (kèm file xref)"
          label="Kéo thả thư mục bản vẽ DWG"
          over={over}
          onActivate={() => !busy && folderRef.current?.click()}
          actions={
            <>
              <button className="ui-btn-primary" onClick={() => folderRef.current?.click()}>
                <IconFolderOpen width={15} height={15} /> Chọn thư mục
              </button>
              <button className="ui-btn" onClick={() => filesRef.current?.click()}>
                Chọn file .dwg
              </button>
            </>
          }
          after={messageBox}
        >
          {pickers}
        </ToolStart>
        {loader}
      </div>
    );
  }

  // ---------- Workspace ----------
  const included = drawings.filter((d) => d.included);
  const missingXrefs = data.missingXrefs.filter((m) => included.some((d) => m.startsWith(`${d.name} → `)));
  const isReview = (r: LayerRow) => {
    const m = mapping.get(r.key);
    return r.kind !== 'T' && r.count > 0 && !m?.target && (m?.unknown ?? false) && m?.source !== 'manual';
  };
  const reviewCount = (id: string) => rows.filter((r) => r.drawing === id && isReview(r)).length;
  const totalReview = included.reduce((t, d) => t + reviewCount(d.id), 0);
  const mappedCount = (id: string) => rows.filter((r) => r.drawing === id && mapping.get(r.key)?.target).reduce((t, r) => t + r.count, 0);
  const q = compactName(query);
  const drawingRows = rows
    .filter((r) => r.drawing === sel && r.count > 0)
    .filter((r) => (view === 'review' ? isReview(r) : view === 'mapped' ? !!mapping.get(r.key)?.target : true))
    .filter((r) => !q || compactName(r.layer).includes(q))
    .sort((a, b) => b.count - a.count);
  const focusRow = rowSel ? rowsByKey.get(rowSel) : undefined;
  const focusLayer = focusRow && focusRow.drawing === sel ? focusRow.layer : null;
  const role = selDrawing ? roleById(selDrawing.role) : null;
  const selectDrawing = (id: string) => {
    setSel(id);
    setRowSel(null);
    // Nothing left to review → show what is mapped instead of an empty list.
    setView(reviewCount(id) > 0 ? 'review' : 'mapped');
  };
  const mainDrawings = drawings.filter((d) => !d.owner && roleById(d.role).db);
  const otherDrawings = drawings.filter((d) => !d.owner && !roleById(d.role).db);
  /** Main drawings in use first, each followed by its xrefs. */
  const withXrefs = (list: DrawingInfo[]) =>
    [...list.filter((d) => d.included), ...list.filter((d) => !d.included)].flatMap((d) => [d, ...drawings.filter((x) => x.owner?.id === d.id)]);
  const drawingItem = (d: DrawingInfo) => {
    const active = d.id === sel;
    const db = roleById(d.role).db;
    const nReview = d.included ? reviewCount(d.id) : 0;
    return (
      <li key={d.id} className={d.owner ? 'pl-3' : ''}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => selectDrawing(d.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') selectDrawing(d.id);
          }}
          className={`rounded-lg px-2 py-1.5 transition ${active ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-zinc-50'}`}
        >
          <div className="flex items-center gap-1.5">
            {d.owner && <span className="text-[12px] text-zinc-300">↳</span>}
            <span
              className={`min-w-0 flex-1 truncate text-[12.5px] font-medium ${d.included || !db ? 'text-zinc-900' : 'text-zinc-400'}`}
              title={`${d.path}${d.owner ? `\nxref của ${d.owner.name}` : ''}${d.title ? `\n${d.title}` : ''}`}
            >
              {d.name.replace(/\.(dwg|dxf)$/i, '')}
            </span>
            {nReview > 0 && (
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800" title={`${nReview} layer cần xem`}>
                {nReview}
              </span>
            )}
            {db && (
              <label
                className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                  d.included ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-white text-zinc-500 ring-zinc-200'
                }`}
                title="Đưa bản vẽ này vào HoSoGIS khi xuất (không ảnh hưởng việc xem trên bản đồ)"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className="ui-check"
                  checked={d.included}
                  onChange={(e) => setDrawings((ds) => ds.map((x) => (x.id === d.id ? { ...x, included: e.target.checked } : x)))}
                  aria-label={`Xuất ${d.name} vào HoSoGIS`}
                />
                Xuất
              </label>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-zinc-400">
            <select
              className={`min-w-0 max-w-[60%] shrink cursor-pointer truncate rounded bg-transparent py-0 font-medium outline-none hover:bg-zinc-100 focus:bg-white focus:ring-1 focus:ring-blue-400 ${
                db ? 'text-blue-700' : 'text-zinc-500'
              }`}
              value={d.role}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRole(d.id, e.target.value as RoleId)}
              aria-label={`Loại bản đồ của ${d.name}`}
              title="Loại bản đồ — quyết định CSDL và nhóm dữ liệu của các layer"
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="min-w-0 truncate" title={d.note ?? `${fmt(mappedCount(d.id))} đối tượng đã ghép / ${fmt(d.inside)} trong ranh quy hoạch`}>
              · {d.note ?? `${fmt(mappedCount(d.id))}/${fmt(d.inside)}`}
            </span>
          </div>
          {db && !d.included && !d.note && <p className="mt-0.5 text-[11px] font-medium text-amber-700">Không xuất vào HoSoGIS</p>}
        </div>
      </li>
    );
  };
  const pickLayer = (layer: string) => {
    const r = rows.find((x) => x.drawing === sel && x.layer === layer && x.count > 0 && x.kind !== 'T');
    if (!r) return;
    setRowSel(r.key);
    if (!drawingRows.includes(r)) setView('all');
  };
  const mapNote = previewError
    ? `Không vẽ được: ${previewError}`
    : !unit
      ? 'Hãy chọn kinh tuyến trục (KTT) ở thanh trên để xem bản vẽ trên bản đồ.'
      : preview?.truncated
        ? 'Bản vẽ lớn: chỉ hiện các layer đã ghép.'
        : null;

  return (
    <div className={`flex flex-col bg-zinc-100 ${phone ? 'min-h-dvh' : 'h-dvh'}`} {...dropHandlers}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 bg-white px-3 py-2">
        <HomeLogo wordmark={false} />
        <span className="hidden h-5 w-px bg-zinc-200 sm:block" />
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold text-zinc-900">Bóc tách DWG → TT16</h1>
          <p className="truncate text-[11.5px] text-zinc-500">
            {fmt(included.length)} bản vẽ dùng · ranh quy hoạch {data.boundaryArea ? `${fmt(Math.round(data.boundaryArea / 100) / 100)} ha` : 'chưa tìm thấy'}
            {totalReview > 0 && <span className="text-amber-700"> · {fmt(totalReview)} layer cần xem</span>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] ring-1 ring-inset ${unit ? 'ring-zinc-200' : 'bg-amber-50 ring-amber-300'}`}>
            <span className="text-zinc-400">VN-2000</span>
            <select className="max-w-[13rem] bg-transparent font-medium text-zinc-800 outline-none" value={unitKey} onChange={(e) => setUnitKey(e.target.value)} aria-label="Kinh tuyến trục">
              <option value="">Chọn tỉnh / KTT…</option>
              {UNIT_GROUPS.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.units.map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.name} — KTT {formatDegMin(u.lon0)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select className="bg-transparent text-zinc-600 outline-none" value={zone} onChange={(e) => setZone(Number(e.target.value) as 3 | 6)} aria-label="Múi chiếu">
              <option value={3}>múi 3°</option>
              <option value={6}>múi 6°</option>
            </select>
          </label>
          <div className="relative">
            <button className="ui-btn" onClick={() => setMenu((v) => !v)} aria-expanded={menu} title="Mẫu ghép layer: lưu để dùng lại cho đồ án sau">
              <IconSave width={15} height={15} /> <span className="hidden md:inline">Mẫu ghép</span>
              {template && <span className="text-[11px] text-zinc-400">{fmt(template.rules.length)}</span>}
            </button>
            {menu && (
              <div className="ui-floating ui-pop-in absolute right-0 top-full z-30 mt-1 w-72 p-1.5 text-[13px]" onMouseLeave={() => setMenu(false)}>
                <p className="px-2.5 py-1.5 text-[12px] text-zinc-500">
                  {template ? `${template.name}: ${fmt(template.rules.length)} quy tắc, cập nhật ${new Date(template.updated).toLocaleDateString('vi-VN')}` : 'Chưa có mẫu ghép trên máy này.'}
                </p>
                <MenuItem label="Lưu bảng ghép vào mẫu" onClick={() => (setMenu(false), saveTemplate())} />
                <MenuItem label="Tải mẫu về (.json)" onClick={() => (setMenu(false), downloadTemplate())} />
                <MenuItem label="Nhập mẫu từ file .json…" onClick={() => (setMenu(false), templateRef.current?.click())} />
                {template && (
                  <>
                    <MenuItem label="Áp lại mẫu cho bảng ghép" onClick={() => (setMenu(false), applyTemplate(template))} />
                    <MenuItem label="Xóa mẫu đã lưu" onClick={() => (setMenu(false), clearTemplate())} />
                  </>
                )}
              </div>
            )}
          </div>
          <button className="ui-btn" onClick={() => folderRef.current?.click()} disabled={busy} title="Mở thư mục khác (hoặc kéo thả vào cửa sổ)">
            {busy ? <IconSpinner width={15} height={15} /> : <IconFolderOpen width={15} height={15} />} <span className="hidden md:inline">{busy ? 'Đang đọc…' : 'Mở thư mục'}</span>
          </button>
          <button
            className="ui-btn-primary"
            disabled={!unit || !included.length || busy}
            onClick={() => {
              setExportState({ progress: null, result: null, error: null });
              setExportOpen(true);
            }}
            title={!unit ? 'Chọn KTT trước' : 'Ghi HoSoGIS.zip theo Thông tư 16'}
          >
            <IconDatabaseCheck width={15} height={15} /> Xuất HoSoGIS
          </button>
          {pickers}
        </div>
      </header>
      {(() => {
        // Pieces shared by the phone layout (stacked) and the wide one (floating over the map).
        const drawingsBody = (
          <>
            <div className="flex items-baseline gap-2 border-b border-zinc-100 py-2 pl-3 pr-11">
              <span className="text-[12.5px] font-semibold text-zinc-900">Bản vẽ</span>
              <span className="text-[11.5px] text-zinc-400">
                {fmt(included.length)}/{fmt(mainDrawings.length)} xuất
              </span>
              <span className="ml-auto text-[11px] text-zinc-400" title="Bấm tên để xem và ghép layer; ô Xuất = đưa bản vẽ vào HoSoGIS">
                bấm để ghép layer
              </span>
            </div>
            {missingXrefs.length > 0 && (
              <p className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-800" title={missingXrefs.join('\n')}>
                Thiếu {fmt(missingXrefs.length)} file xref của bản vẽ đang dùng
              </p>
            )}
            <div className="ui-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
              <ul className="space-y-0.5">{withXrefs(mainDrawings).map(drawingItem)}</ul>
              {(otherDrawings.length > 0 || data.unused.length > 0) && (
                <details className="mt-2 border-t border-zinc-100 pt-1.5">
                  <summary className="cursor-pointer select-none px-2 py-1 text-[11.5px] text-zinc-500 hover:text-zinc-800">
                    Không dùng ({fmt(otherDrawings.length + data.unused.length)}) — sơ đồ vị trí, khung tên, xref thừa
                  </summary>
                  <ul className="mt-1 space-y-0.5">{withXrefs(otherDrawings).map(drawingItem)}</ul>
                  {data.unused.length > 0 && (
                    <p className="px-2 pt-1 text-[11px] leading-relaxed text-zinc-400" title={data.unused.map((u) => u.path).join('\n')}>
                      Không bản vẽ nào tham chiếu: {data.unused.map((u) => u.name.replace(/\.(dwg|dxf)$/i, '')).join(', ')}
                    </p>
                  )}
                </details>
              )}
            </div>
          </>
        );
        const mappingBody = (
          <>
            <div className="space-y-2 border-b border-zinc-100 p-2.5">
              <div className="flex items-baseline gap-2 pr-8">
                <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900" title={selDrawing?.title ?? undefined}>
                  {selDrawing ? selDrawing.name.replace(/\.(dwg|dxf)$/i, '') : 'Chọn một bản vẽ'}
                </h2>
                {role && (
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${role.db ? 'bg-blue-50 text-blue-700' : 'bg-zinc-100 text-zinc-500'}`}>
                    {role.db ? `→ ${role.db}.gdb` : 'không dùng'}
                  </span>
                )}
              </div>
              {selDrawing && role?.db && (
                <p className="-mt-1 text-[11.5px] text-zinc-500">
                  {role.label} · {fmt(mappedCount(selDrawing.id))}/{fmt(selDrawing.inside)} đối tượng đã ghép
                  {selDrawing.owner ? ` · xref của ${selDrawing.owner.name.replace(/.(dwg|dxf)$/i, '')}` : ''}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="ui-segment" role="group" aria-label="Lọc layer">
                  {(
                    [
                      ['review', `Cần xem (${sel ? reviewCount(sel) : 0})`],
                      ['mapped', 'Đã ghép'],
                      ['all', 'Tất cả'],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} className="whitespace-nowrap" aria-pressed={view === k} onClick={() => setView(k)}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="relative min-w-[8rem] flex-1">
                  <IconSearch width={14} height={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm layer" className="ui-input w-full pl-8" />
                </label>
              </div>
            </div>
            <div className="ui-scroll min-h-0 flex-1 overflow-y-auto">
              {drawingRows.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] text-zinc-400">
                  {view === 'review' ? (
                    <>
                      <IconCheckCircle width={22} height={22} className="mx-auto mb-2 text-emerald-500" />
                      Mọi layer có dữ liệu của bản vẽ này đã được ghép hoặc bỏ qua.
                      <div className="mt-3 flex justify-center gap-2">
                        <button className="ui-btn" onClick={() => setView('mapped')}>
                          Xem layer đã ghép
                        </button>
                        <button className="ui-btn-ghost" onClick={() => setView('all')}>
                          Tất cả
                        </button>
                      </div>
                    </>
                  ) : query ? (
                    'Không có layer nào khớp.'
                  ) : (
                    'Không có layer nào.'
                  )}
                </div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-[11.5px] text-zinc-500">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">Layer</th>
                      <th className="px-1 py-1.5 text-right font-medium">SL</th>
                      <th className="px-2.5 py-1.5 font-medium">Lớp dữ liệu TT16 · phân loại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawingRows.map((r) => {
                      const m = mapping.get(r.key);
                      const Icon = KIND_ICON[r.kind];
                      const active = r.key === rowSel;
                      // A target that gets nothing from this row (open lines → vùng) is flagged like a row to review.
                      const geom = targetOption(m?.target)?.geom;
                      const status = m?.target ? (geom && !rowFeatureCount(r, geom) ? 'review' : 'ok') : isReview(r) ? 'review' : 'skip';
                      return (
                        <tr
                          key={r.key}
                          onClick={() => setRowSel(r.key)}
                          className={`cursor-pointer border-t border-zinc-100 align-top ${active ? 'bg-blue-50/70' : 'hover:bg-zinc-50'}`}
                        >
                          <td className="max-w-[11rem] px-2.5 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/10" style={{ background: r.color }} />
                              <Icon width={13} height={13} className="shrink-0 text-zinc-500" />
                              <span className={`truncate ${status === 'skip' ? 'text-zinc-400' : 'text-zinc-900'}`} title={`${r.layer} — ${KIND_LABEL[r.kind]}`}>
                                {r.layer}
                              </span>
                            </div>
                            {r.kind === 'T' && r.samples.length > 0 && <p className="truncate pl-8 text-[11px] text-zinc-400">{r.samples.join(' · ')}</p>}
                          </td>
                          <td className="px-1 py-1.5 text-right tabular-nums text-zinc-600">{fmt(r.count)}</td>
                          <td className="px-2.5 py-1.5">
                            {editing === r.key ? (
                              <select
                                autoFocus
                                className="w-full rounded-md bg-white px-1 py-0.5 text-[12px] ring-1 ring-blue-400"
                                value={m?.target ?? ''}
                                onChange={(e) => setTarget(r, e.target.value || null)}
                                onBlur={() => setEditing(null)}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">— Bỏ qua layer này —</option>
                                {targetGroups(r.kind, role?.db ?? null).map((g) => (
                                  <optgroup key={g.label} label={g.label}>
                                    {g.options.map((o) => (
                                      <option key={o.path} value={o.path}>
                                        {o.cls} — {o.alias}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            ) : (
                              <button
                                className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left ring-1 ring-inset ${
                                  status === 'ok' ? 'ring-emerald-200' : status === 'review' ? 'bg-amber-50 ring-amber-300' : 'ring-zinc-200'
                                }`}
                                title={m?.reason}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRowSel(r.key);
                                  setEditing(r.key);
                                }}
                              >
                                {status === 'ok' ? (
                                  <IconCheckCircle width={12} height={12} className="shrink-0 text-emerald-600" />
                                ) : status === 'review' ? (
                                  <IconAlert width={12} height={12} className="shrink-0 text-amber-600" />
                                ) : (
                                  <IconXCircle width={12} height={12} className="shrink-0 text-zinc-300" />
                                )}
                                <span className={`truncate ${m?.target ? 'font-mono text-[11.5px] text-zinc-800' : 'text-zinc-400'}`}>
                                  {m?.target ? targetLabel(m.target) : status === 'review' ? 'Chọn lớp…' : 'Bỏ qua'}
                                </span>
                                {m?.source === 'template' && <span className="ml-auto shrink-0 text-[10.5px] text-blue-600">mẫu</span>}
                              </button>
                            )}
                            {m?.target &&
                              (() => {
                                const conv = conversionNote(r, targetOption(m.target)?.geom ?? 'A');
                                return (
                                  conv && (
                                    <p className="mt-0.5 px-1.5 text-[11px] leading-snug text-zinc-500">
                                      {conv.text}
                                      {conv.warn && (
                                        <span className="mt-0.5 flex items-start gap-1 text-amber-700">
                                          <IconAlert width={11} height={11} className="mt-px shrink-0" />
                                          {conv.warn}
                                        </span>
                                      )}
                                    </p>
                                  )
                                );
                              })()}
                            {m?.target && (
                              <input
                                className="mt-1 w-full rounded-md bg-transparent px-1.5 py-0.5 text-[12px] text-zinc-700 ring-1 ring-inset ring-transparent hover:ring-zinc-200 focus:bg-white focus:ring-blue-400 focus:outline-none"
                                value={m.phanLoai}
                                placeholder="Phân loại (phanLoai)"
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setPhanLoai(r, e.target.value)}
                                aria-label={`Phân loại của ${r.layer}`}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        );
        const map = (insetLeft: number, insetRight: number) => (
          <DwgPreviewMap
            doc={editMode ? (editView?.doc ?? null) : preview && preview.id === sel ? preview.doc : null}
            used={editMode ? editLayers : usedLayers}
            focusLayer={editMode ? null : focusLayer}
            onPickLayer={pickLayer}
            loading={editMode ? outputLoading : previewLoading}
            loadingText={editMode ? 'Đang dựng các đối tượng sẽ ghi vào gdb…' : undefined}
            note={editMode ? (outputError ? `Không dựng được: ${outputError}` : !unit ? mapNote : null) : mapNote}
            excluded={editMode ? removedFeatures : (sel && excluded.get(sel)) || NO_INDEXES}
            onExclude={(ks) => editMode && editExcluded(featureRefs(ks), [])}
            onRestore={(ks) => editMode && editExcluded([], featureRefs(ks))}
            undo={{ can: excludedHistory.length > 0, run: undoExcluded }}
            editMode={editMode}
            onEditMode={setEditMode}
            views={editMode ? (output?.dbs ?? []).map((d) => ({ id: d.db, label: `${d.db}.gdb`, count: d.db === editView?.db ? d.count - removedFeatures.size : d.count })) : []}
            view={editDb}
            onView={setEditDb}
            insetLeft={insetLeft}
            insetRight={insetRight}
          />
        );

        // ---------- Phones: everything stacked, the page scrolls ----------
        if (phone)
          return (
            <>
              {(error || notice) && <div className="px-3 pt-2">{messageBox}</div>}
              <aside className="flex max-h-[40dvh] shrink-0 flex-col border-b border-zinc-200 bg-white">{drawingsBody}</aside>
              <section className="relative h-[50dvh] shrink-0">{map(0, 0)}</section>
              <section className="flex min-h-[50dvh] flex-col border-t border-zinc-200 bg-white">{mappingBody}</section>
            </>
          );

        // ---------- Wider screens: the map fills the page, the panels float over it ----------
        const GAP = 12;
        // Collapsed, the list is a fixed-width button in the corner: the map's own overlays ("Biên tập", the edit
        // panel, the object card) start right of it instead of under it.
        const leftInset = listOpen ? 320 + GAP : 112 + GAP;
        const rightInset = tableOpen ? tableW + GAP : 0;
        return (
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute inset-0">{map(leftInset, rightInset)}</div>

            {/* Left: drawings */}
            {listOpen ? (
              <aside className="ui-floating ui-pop-in absolute bottom-3 left-3 top-3 z-20 flex w-80 flex-col overflow-hidden">
                <button
                  className="ui-icon-btn absolute right-1.5 top-1 z-10"
                  onClick={() => setListOpen(false)}
                  aria-label="Thu gọn danh sách bản vẽ"
                  title="Thu gọn"
                >
                  <IconPanel width={16} height={16} />
                </button>
                {drawingsBody}
              </aside>
            ) : (
              <button
                className="ui-floating ui-pop-in absolute left-3 top-3 z-20 flex w-28 items-center justify-center gap-2 py-2 text-[12.5px] font-medium text-zinc-800 hover:bg-white"
                onClick={() => setListOpen(true)}
                title="Mở danh sách bản vẽ"
              >
                <IconLayers width={15} height={15} className="text-blue-600" />
                Bản vẽ <span className="text-zinc-400">{fmt(included.length)}</span>
              </button>
            )}

            {/* Right: mapping table of the selected drawing (drag the left edge to widen). */}
            {tableOpen ? (
              <section
                className="ui-floating ui-pop-in absolute bottom-3 right-3 top-3 z-20 flex flex-col overflow-hidden"
                style={{ width: tableW }}
                aria-label="Bảng ghép layer"
              >
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Kéo để đổi độ rộng bảng ghép"
                  onPointerDown={startTableResize}
                  className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none hover:bg-blue-500/20"
                />
                <button
                  className="ui-icon-btn absolute right-1.5 top-1.5 z-20"
                  onClick={() => setTableOpen(false)}
                  aria-label="Thu gọn bảng ghép"
                  title="Thu gọn"
                >
                  <IconX width={15} height={15} />
                </button>
                {mappingBody}
              </section>
            ) : (
              <button
                className="ui-floating ui-pop-in absolute right-[3.75rem] top-3 z-20 flex items-center gap-2 px-3 py-2 text-[12.5px] font-medium text-zinc-800 hover:bg-white"
                onClick={() => setTableOpen(true)}
                title="Mở bảng ghép layer"
              >
                Ghép layer
                {totalReview > 0 && <span className="rounded-full bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800">{fmt(totalReview)} cần xem</span>}
              </button>
            )}

            {(error || notice) && (
              <div className="absolute top-3 z-30" style={{ left: leftInset + GAP, right: rightInset + GAP }}>
                {messageBox}
              </div>
            )}
          </div>
        );
      })()}

      {exportOpen && (
        <ExportDialog
          state={exportState}
          provinceCode={provinceCode}
          ktt={unit ? `${unit.name} — KTT ${formatDegMin(unit.lon0)}, múi ${zone}°` : ''}
          review={totalReview}
          excludedCount={excludedCount}
          leftOut={drawings.filter((d) => roleById(d.role).db && !d.included && d.inside > 0).map((d) => d.name.replace(/\.(dwg|dxf)$/i, ''))}
          defaultName={data.projectName ?? 'DoAnQuyHoach'}
          summary={exportSummary(rows, mapping, new Set(included.map((d) => d.id)))}
          onStart={startExport}
          onClose={() => setExportOpen(false)}
          onOpenChecker={openInChecker}
        />
      )}
      {loader}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="block w-full rounded-md px-2.5 py-1.5 text-left text-zinc-800 hover:bg-zinc-100" onClick={onClick}>
      {label}
    </button>
  );
}

/** Classes a row can go to: those of the drawing's database first, then the others; geometry must fit. */
function targetGroups(kind: GeomKind, db: string | null) {
  const groups = new Map<string, { label: string; db: string; options: typeof TARGETS }>();
  for (const t of TARGETS) {
    if (!kindFits(kind, t.geom)) continue;
    const key = `${t.db}/${t.dataset}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { label: `${t.db} · ${t.dataset}`, db: t.db, options: [] }));
    g.options.push(t);
  }
  return [...groups.values()].sort((a, b) => Number(b.db === db) - Number(a.db === db));
}

/** Rough feature counts per class (before duplicates are removed), for the export dialog. */
function exportSummary(rows: LayerRow[], mapping: Map<string, MappingState>, drawings: Set<string>) {
  const by = new Map<string, number>();
  for (const r of rows) {
    const t = mapping.get(r.key)?.target;
    const geom = targetOption(t)?.geom;
    if (!t || !geom || !drawings.has(r.drawing) || !r.count) continue;
    by.set(t, (by.get(t) ?? 0) + rowFeatureCount(r, geom));
  }
  return [...by].sort((a, b) => a[0].localeCompare(b[0]));
}

function ExportDialog({
  state,
  provinceCode,
  ktt,
  review,
  leftOut,
  excludedCount,
  summary,
  defaultName,
  onStart,
  onClose,
  onOpenChecker,
}: {
  state: { progress: Progress | null; result: Done | null; error: string | null };
  provinceCode: string | null;
  ktt: string;
  review: number;
  /** Drawings with a map kind that the user unticked. */
  leftOut: string[];
  /** Objects removed on the map ("Biên tập"). */
  excludedCount: number;
  summary: [string, number][];
  defaultName: string;
  onStart: (o: ExportOptions) => void;
  onClose: () => void;
  onOpenChecker: (zip: Blob, name: string) => void;
}) {
  const codes = usePlanningCodes({ maHoSoQH: '', maThongTinQH: '' }, provinceCode ?? '86');
  const [createMissing, setCreateMissing] = useState(true);
  const [sourceInGhiChu, setSourceInGhiChu] = useState(false);
  const [withDxf, setWithDxf] = useState(true);
  const [withQgz, setWithQgz] = useState(true);
  const [projectName, setProjectName] = useState(defaultName);
  const { progress, result, error } = state;
  const running = !!progress && !result && !error;
  const [urls, setUrls] = useState<{ zip: string; dxf: string | null } | null>(null);
  useEffect(() => {
    if (!result) return;
    const zip = URL.createObjectURL(result.zip);
    const dxf = result.dxf ? URL.createObjectURL(result.dxf.blob) : null;
    const t = setTimeout(() => {
      setUrls({ zip, dxf });
      // Only the zip starts by itself: browsers block a second automatic download — the DXF has its link.
      startDownload(zip, result.fileName);
    });
    return () => {
      clearTimeout(t);
      URL.revokeObjectURL(zip);
      if (dxf) URL.revokeObjectURL(dxf);
    };
  }, [result]);
  const rep = result?.report;
  const errors = rep ? [...rep.issues, ...rep.gdbs.flatMap((g) => g.issues)].filter((i) => i.level === 'error') : [];
  const errorCount = rep ? rep.gdbs.reduce((t, g) => t + g.counts.errors, rep.issues.filter((i) => i.level === 'error').length) : 0;
  const onlyProjectFile = errors.length > 0 && errors.every((i) => /aprx|ppkx|tệp tổng hợp/i.test(i.text)) && errorCount === errors.length;
  const hasQgz = !!result?.notes.some((n) => /\.qgz/.test(n));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4 backdrop-blur-[2px]" role="dialog" aria-modal aria-label="Xuất HoSoGIS">
      <div className="ui-floating ui-pop-in flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden">
        <div className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="flex-1">
            <h2 className="text-[16px] font-semibold text-zinc-900">Xuất HoSoGIS theo Thông tư 16</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">
              Hệ tọa độ VN-2000 {ktt}. Kết quả: <b className="font-medium text-zinc-700">HoSoGIS.zip</b> gồm các .gdb theo mẫu cấu trúc dữ liệu của Bộ Xây dựng.
            </p>
          </div>
          {!running && (
            <button aria-label="Đóng" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900" onClick={onClose}>
              <IconX width={16} height={16} />
            </button>
          )}
        </div>

        <div className="ui-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px]">
          {!result && (
            <div className="space-y-4">
              <PlanningCodeFields codes={codes} provinceCode={provinceCode} disabled={running} />
              <label className="flex items-start gap-2">
                <input type="checkbox" className="ui-check mt-0.5" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} disabled={running} />
                <span className="text-zinc-700">
                  Tạo đủ 4 CSDL <span className="text-zinc-400">(MocGioi, NenDiaHinh rỗng — NenDiaHinh theo mẫu của Bộ Xây dựng)</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="ui-check mt-0.5" checked={sourceInGhiChu} onChange={(e) => setSourceInGhiChu(e.target.checked)} disabled={running} />
                <span className="text-zinc-700">
                  Ghi nguồn vào ghiChu <span className="text-zinc-400">(“Nguồn: tên bản vẽ · layer” — để rà soát trong ArcGIS)</span>
                </span>
              </label>
              <div className="space-y-1.5">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="ui-check mt-0.5" checked={withQgz} onChange={(e) => setWithQgz(e.target.checked)} disabled={running} />
                  <span className="text-zinc-700">
                    Tạo tệp tổng hợp <b className="font-medium">.qgz</b> (QGIS) trong HoSoGIS{' '}
                    <span className="text-zinc-400">(các lớp tô màu theo phân loại như bản vẽ, nhãn theo tên đối tượng)</span>
                  </span>
                </label>
                {withQgz && (
                  <label className="ml-6 flex items-center gap-2">
                    <span className="shrink-0 text-[12px] text-zinc-500">Tên đồ án</span>
                    <input
                      className="ui-input w-full font-mono"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="vd. QHC_XaLongHiep"
                      disabled={running}
                      maxLength={80}
                    />
                    <span className="shrink-0 font-mono text-[12px] text-zinc-400">.qgz</span>
                  </label>
                )}
              </div>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="ui-check mt-0.5" checked={withDxf} onChange={(e) => setWithDxf(e.target.checked)} disabled={running} />
                <span className="text-zinc-700">
                  Xuất thêm bản vẽ tổng hợp <b className="font-medium">.dxf</b>{' '}
                  <span className="text-zinc-400">
                    (giữ nguyên màu, kiểu hatch, chữ của bản vẽ; layer đặt theo lớp TT16 + phân loại — mở trong ArcGIS Pro / QGIS / AutoCAD để làm file tổng hợp)
                  </span>
                </span>
              </label>
              <div>
                <span className="ui-label">Dữ liệu sẽ ghi ({summary.length} lớp)</span>
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-zinc-50 px-3 py-2 font-mono text-[11.5px] text-zinc-600">
                  {summary.map(([t, n]) => (
                    <li key={t} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">{t.replace(/\//g, ' / ')}</span>
                      <span className="tabular-nums">{n.toLocaleString('vi-VN')}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {excludedCount > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-600">
                  <IconTrash width={14} height={14} className="mt-0.5 shrink-0 text-red-500" />
                  <span>{excludedCount.toLocaleString('vi-VN')} đối tượng đã loại trên bản đồ (Biên tập) sẽ không có trong HoSoGIS và bản vẽ tổng hợp.</span>
                </p>
              )}
              {leftOut.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  <IconAlert width={14} height={14} className="mt-0.5 shrink-0" />
                  <span>
                    {leftOut.length} bản vẽ đang bỏ chọn ô “Xuất” — dữ liệu của chúng sẽ không có trong HoSoGIS: {leftOut.join(', ')}.
                  </span>
                </p>
              )}
              {review > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  <IconAlert width={14} height={14} className="mt-0.5 shrink-0" />
                  Còn {review} layer có dữ liệu chưa ghép — sẽ bị bỏ qua.
                </p>
              )}
              {error && (
                <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                  <IconXCircle width={14} height={14} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          )}

          {result && rep && (
            <div className="space-y-3">
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 font-medium ${errorCount && !onlyProjectFile ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}
              >
                {errorCount && !onlyProjectFile ? <IconAlert width={16} height={16} /> : <IconCheckCircle width={16} height={16} />}
                {errorCount && !onlyProjectFile ? `Đã xuất — còn ${errorCount} lỗi cần xử lý` : hasQgz && !errorCount ? 'Đã xuất — HoSoGIS đạt Thông tư 16' : 'Đã xuất — các geodatabase đạt Thông tư 16'}
              </div>
              {onlyProjectFile && (
                <p className="text-[12.5px] text-zinc-500">
                  Còn thiếu tệp tổng hợp .aprx/.ppkx: mở các .gdb trong ArcGIS Pro, lưu project vào thư mục HoSoGIS.
                </p>
              )}
              {!onlyProjectFile && errors.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-700">
                  {errors.slice(0, 6).map((i, k) => (
                    <li key={k} className="flex gap-2">
                      <IconXCircle width={13} height={13} className="mt-0.5 shrink-0 text-red-600" />
                      {i.text}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[12.5px] text-zinc-500">
                {rep.gdbs.map((g) => g.fileName).join(', ')} · {(result.zip.size / 1048576).toFixed(1)} MB · {(result.ms / 1000).toFixed(1)} s
              </p>
              <details className="text-[12.5px] text-zinc-700">
                <summary className="cursor-pointer text-zinc-500">Đối tượng đã ghi ({result.classes.reduce((t, c) => t + c.count, 0).toLocaleString('vi-VN')})</summary>
                <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-[11.5px]">
                  {result.classes.map((c) => (
                    <li key={c.target} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">{c.target.replace(/\//g, ' / ')}</span>
                      <span className="tabular-nums">{c.count.toLocaleString('vi-VN')}</span>
                    </li>
                  ))}
                </ul>
              </details>
              <ul className="space-y-1 text-[12.5px] text-zinc-700">
                {result.notes.map((n, k) => (
                  <li key={k} className="flex gap-2">
                    <IconCheckCircle width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                    {n}
                  </li>
                ))}
                <li className="flex gap-2">
                  <IconCheckCircle width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                  Bảng ghép đã được lưu vào mẫu ghép để dùng cho đồ án sau.
                </li>
                {result.dxf && (
                  <li className="flex gap-2">
                    <IconCheckCircle width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                    Bản vẽ tổng hợp {result.dxf.fileName}: {result.dxf.layers} layer, {result.dxf.entities.toLocaleString('vi-VN')} đối tượng, VN-2000 (mét). Cần
                    .dwg: mở trong AutoCAD rồi Save As.
                  </li>
                )}
              </ul>
            </div>
          )}

          {running && (
            <div className="mt-4" aria-live="polite">
              <div className="flex items-center gap-2 text-[12.5px] text-zinc-600">
                <IconSpinner width={14} height={14} className="text-blue-600" />
                <span className="truncate">{progress?.stage}</span>
                {progress && progress.total > 1 && (
                  <span className="ml-auto tabular-nums text-zinc-400">
                    {progress.done}/{progress.total}
                  </span>
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-[width]"
                  style={{ width: `${progress && progress.total > 1 ? Math.max(4, (progress.done / progress.total) * 100) : 4}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          {result ? (
            <>
              {urls?.dxf && result.dxf && (
                <a className="ui-btn" href={urls.dxf} download={result.dxf.fileName} title={`${result.dxf.layers} layer · ${result.dxf.entities.toLocaleString('vi-VN')} đối tượng`}>
                  <IconDownload width={15} height={15} /> {result.dxf.fileName} ({(result.dxf.blob.size / 1048576).toFixed(1)} MB)
                </a>
              )}
              {urls && (
                // A real link: a click on it is a user gesture, so it downloads even when the automatic one was blocked.
                <a className="ui-btn" href={urls.zip} download={result.fileName}>
                  <IconDownload width={15} height={15} /> {result.fileName} ({(result.zip.size / 1048576).toFixed(1)} MB)
                </a>
              )}
              <button className="ui-btn-primary" onClick={() => onOpenChecker(result.zip, result.fileName)}>
                Kiểm tra chi tiết
              </button>
            </>
          ) : (
            <>
              <button className="ui-btn-ghost" onClick={onClose} disabled={running}>
                Hủy
              </button>
              <button
                className="ui-btn-primary"
                onClick={() =>
                  onStart({
                    maHoSoQH: codes.maHoSo.trim(),
                    maThongTinQH: codes.maTT.trim(),
                    createMissing,
                    sourceInGhiChu,
                    dxf: withDxf,
                    qgz: withQgz,
                    projectName: cleanProjectName(projectName),
                  })
                }
                disabled={running || !codes.valid || !summary.length}
              >
                {running ? 'Đang xuất…' : 'Xuất và tải về'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
