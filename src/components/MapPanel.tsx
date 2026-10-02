'use client';
// Floating control panel of the map page: header, file chip, tabs (Layer · Vẽ · Tọa độ · Xuất).
import { useState, type ReactNode } from 'react';
import Tagline from './Tagline';
import { IconAlert, IconCheck, IconDownload, IconFile, IconGlobe, IconHome, IconLayers, IconPanel, IconPen, Logo } from './icons';

export type PanelTab = 'layers' | 'draw' | 'crs' | 'export';

const TABS: { id: PanelTab; label: string; icon: typeof IconLayers }[] = [
  { id: 'layers', label: 'Layer', icon: IconLayers },
  { id: 'draw', label: 'Vẽ', icon: IconPen },
  { id: 'crs', label: 'Tọa độ', icon: IconGlobe },
  { id: 'export', label: 'Xuất', icon: IconDownload },
];

export default function MapPanel({
  open,
  onCollapse,
  onHome,
  fileName,
  stats,
  busy,
  progress,
  error,
  filesSection,
  focusTab,
  warnings,
  layersTab,
  drawTab,
  crsTab,
  exportTab,
}: {
  open: boolean;
  onCollapse: () => void;
  onHome: () => void;
  fileName?: string;
  stats?: string[];
  busy: boolean;
  progress: { stage: string; percent: number } | null;
  error: string | null;
  /** File list (open files, opacity, order). */
  filesSection: ReactNode;
  /** Switch to a tab from outside (e.g. after adding a file that needs a CRS check). */
  focusTab?: { tab: PanelTab; seq: number };
  warnings: string[];
  layersTab: ReactNode;
  /** Sketch tools: draw lines / areas / points and style them. */
  drawTab: ReactNode;
  crsTab: ReactNode;
  exportTab: ReactNode;
}) {
  // A request made before the panel mounted (e.g. "Tạo bản đồ mới" → Vẽ) picks the first tab.
  const [tab, setTab] = useState<PanelTab>(focusTab?.tab ?? 'layers');
  const [warnOpen, setWarnOpen] = useState(false);
  // External tab requests (adjust state during render instead of in an effect).
  const [seenFocus, setSeenFocus] = useState(focusTab?.seq);
  if (focusTab && focusTab.seq !== seenFocus) {
    setSeenFocus(focusTab.seq);
    setTab(focusTab.tab);
  }
  const index = TABS.findIndex((t) => t.id === tab);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = (index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next].id);
    (e.currentTarget.querySelectorAll('button')[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <aside
      className={`ui-floating ui-slide-in-left absolute bottom-3 left-3 top-3 z-30 flex w-[384px] max-w-[calc(100%-24px)] flex-col overflow-hidden transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : '-translate-x-[calc(100%+24px)]'
      }`}
      aria-hidden={!open}
    >
      <header className="flex items-center gap-2 px-4 pb-3 pt-4">
        <Logo width={30} height={30} />
        <span className="flex flex-1">
          <span className="flex flex-col items-stretch">
            <span className="ui-wordmark text-base leading-tight">LEDAT-GIS</span>
            <Tagline className="pl-px text-[7px] leading-tight" />
          </span>
        </span>
        <button className="ui-icon-btn" aria-label="Về trang chủ" title="Về trang chủ" onClick={onHome}>
          <IconHome width={17} height={17} />
        </button>
        <button className="ui-icon-btn" aria-label="Thu gọn bảng điều khiển" title="Thu gọn" onClick={onCollapse}>
          <IconPanel width={17} height={17} />
        </button>
      </header>

      {filesSection}

      {/* Active file details */}
      <div className="mx-4 mb-3 rounded-xl bg-zinc-50 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm ring-1 ring-zinc-900/5">
            <IconFile width={16} height={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-zinc-900" title={fileName}>
              {fileName ? `Đang chọn: ${fileName}` : 'Chưa có bản vẽ'}
            </p>
            <p className="truncate text-[11px] text-zinc-500">{busy && progress ? `${progress.stage} · ${Math.round(progress.percent)}%` : (stats ?? []).slice(0, 2).join(' · ')}</p>
          </div>
        </div>
        {busy && progress && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full rounded-full bg-zinc-900 transition-[width]" style={{ width: `${Math.max(3, progress.percent)}%` }} />
          </div>
        )}
        {fileName && (
          <button
            className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              warnings.length ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-white text-zinc-500 hover:text-zinc-900'
            }`}
            aria-expanded={warnOpen}
            onClick={() => setWarnOpen((o) => !o)}
          >
            {warnings.length ? <IconAlert width={12} height={12} /> : <IconCheck width={12} height={12} />}
            {warnings.length ? `${warnings.length} cảnh báo` : 'Không có cảnh báo'}
          </button>
        )}
        <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: warnOpen ? '1fr' : '0fr' }}>
          <div className="overflow-hidden">
            {warnings.length ? (
              <ul className="ui-scroll mt-2 flex max-h-44 flex-col gap-1.5 overflow-y-auto text-xs leading-relaxed text-zinc-600">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 pb-1 pt-3 text-xs text-zinc-400">
                <svg width="56" height="44" viewBox="0 0 56 44" aria-hidden>
                  <circle cx="28" cy="22" r="14" fill="#ecfdf5" />
                  <circle cx="28" cy="22" r="14" fill="none" stroke="#10b981" strokeWidth="2" pathLength="100" className="ui-circle-draw" />
                  <path d="m21.5 22.5 4.3 4.3 8.7-9.3" fill="none" stroke="#059669" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" pathLength="30" className="ui-check-draw" />
                </svg>
                Bản vẽ được đọc trọn vẹn.
              </div>
            )}
          </div>
        </div>
        {error && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            <IconAlert className="mt-px shrink-0" width={14} height={14} />
            {error}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="px-4 pb-3">
        <div
          className="ui-tabs"
          role="tablist"
          aria-label="Bảng điều khiển"
          style={{ ['--n' as string]: TABS.length, ['--i' as string]: index }}
          onKeyDown={onKeyDown}
        >
          <span className="ui-tabs-indicator" aria-hidden />
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              <t.icon width={14} height={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content: all tabs stay mounted (they hold form state); the active one re-plays its entrance. */}
      <div className="relative min-h-0 flex-1">
        <div
          role="tabpanel"
          id="tabpanel-layers"
          aria-labelledby="tab-layers"
          hidden={tab !== 'layers'}
          className="ui-tab-in absolute inset-0 px-4 pb-3"
        >
          {layersTab}
        </div>
        <div
          role="tabpanel"
          id="tabpanel-draw"
          aria-labelledby="tab-draw"
          hidden={tab !== 'draw'}
          className="ui-tab-in absolute inset-0 px-4 pb-3"
        >
          {drawTab}
        </div>
        <div
          role="tabpanel"
          id="tabpanel-crs"
          aria-labelledby="tab-crs"
          hidden={tab !== 'crs'}
          className="ui-tab-in ui-scroll absolute inset-0 overflow-y-auto px-5 pb-5"
        >
          {crsTab}
        </div>
        <div
          role="tabpanel"
          id="tabpanel-export"
          aria-labelledby="tab-export"
          hidden={tab !== 'export'}
          className="ui-tab-in ui-scroll absolute inset-0 overflow-y-auto px-5 pb-5"
        >
          {exportTab}
        </div>
      </div>

      <footer className="px-5 py-2.5 text-[10.5px] leading-snug text-zinc-400">
        <span className="font-medium text-zinc-500">LEDAT</span> · Ảnh nền © Google / © Esri · GPL-3.0 · Xử lý ngay trên trình duyệt
      </footer>
    </aside>
  );
}
