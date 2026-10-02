'use client';
import { useEffect, useState } from 'react';
import type { CadDocument, CrsOptions } from '@/lib/cad/types';
import { toDxf, toKml, toKmz, type ExportOptions } from '@/lib/export';
import { epsgForProj4, projectDocument } from '@/lib/geo';
import { IconAlert, IconDownload, IconSpinner } from './icons';

export type ExportFormat = 'kmz' | 'kml' | 'dxf';

export interface ExportRequest {
  format: ExportFormat;
  fileName: string;
  options: ExportOptions;
  /** DXF only: drawing CRS to project the WGS84 document into. */
  dxfCrs?: CrsOptions | null;
}

/** Build the file (main thread). Returns blob + elapsed ms. */
export async function buildExport(doc: CadDocument, req: ExportRequest): Promise<{ blob: Blob; ms: number }> {
  const t0 = performance.now();
  let blob: Blob;
  if (req.format === 'dxf') {
    if (!req.dxfCrs) throw new Error('Chưa chọn hệ tọa độ cho file DXF.');
    const projected = projectDocument(doc, req.dxfCrs);
    blob = new Blob([toDxf(projected, { layers: req.options.layers, units: projected.units })], { type: 'application/dxf;charset=utf-8' });
  } else if (req.format === 'kmz') {
    blob = await toKmz(doc, req.options);
  } else {
    blob = new Blob([toKml(doc, req.options)], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  }
  return { blob, ms: performance.now() - t0 };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function baseName(fileName: string | undefined): string {
  return (fileName ?? 'ban-ve').replace(/\.(dwg|dxf|kmz|kml)$/i, '').trim() || 'ban-ve';
}

const FORMAT_INFO: Record<ExportFormat, { title: string; hint: string }> = {
  kmz: { title: 'KMZ', hint: 'Google Earth / My Maps, file nén' },
  kml: { title: 'KML', hint: 'Google Earth, dạng văn bản' },
  dxf: { title: 'DXF', hint: 'AutoCAD, giữ tọa độ gốc' },
};

/** Little document icon; floats when selected. */
function FormatIcon({ label, active }: { label: string; active: boolean }) {
  const stroke = active ? '#2563eb' : '#d4d4d8';
  return (
    <svg
      width="34"
      height="40"
      viewBox="0 0 34 40"
      aria-hidden
      className={`transition-transform duration-300 ${active ? 'ui-float' : 'group-hover:-translate-y-0.5'}`}
    >
      <path d="M6 2h14l10 10v24a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke={stroke} strokeWidth="1.6" />
      <path d="M20 2v8a2 2 0 0 0 2 2h8" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="8" y="22" width="18" height="9" rx="2" fill={active ? '#2563eb' : '#a1a1aa'} />
      <text x="17" y="29.2" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="#fff" fontFamily="var(--font-ui), sans-serif">
        {label}
      </text>
    </svg>
  );
}

export default function ExportPanel({
  doc,
  sourceFileName,
  visible,
  dxfCrs,
  defaultFormat = 'kmz',
  merged,
  mergedName,
}: {
  /** Document with layer styles applied (`applyLayerStyles`) so exports honour colour / width / dash. */
  doc: CadDocument | null;
  sourceFileName?: string;
  visible: Set<string>;
  /** CRS the DXF is written in: the drawing's own CRS for CAD sources, the chosen target for KML/KMZ. */
  dxfCrs: CrsOptions | null;
  defaultFormat?: ExportFormat;
  /** Everything shown on the map merged (visible layers of shown files + sketches), for "Gộp tất cả". */
  merged?: { doc: CadDocument | null; files: number; sketches: number };
  /** File name for merged exports that include sketches (the map's title). */
  mergedName?: string;
}) {
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const canMerge = !!merged && merged.files + merged.sketches > 1;
  /** No drawing open (blank map): the sketches are the only thing to export. */
  const sketchOnly = !doc && !!merged && merged.sketches > 0;
  // Until the user picks, merge as soon as there are sketches (they only leave the map through a merged export).
  const [sourceChoice, setSource] = useState<'active' | 'merged' | null>(null);
  const source = sourceChoice ?? (merged && merged.sketches > 0 ? 'merged' : 'active');
  const isMerged = sketchOnly || (canMerge && source === 'merged');
  const docOut = isMerged ? (merged?.doc ?? null) : doc;
  const [scope, setScope] = useState<'visible' | 'all'>('visible');
  const [textAsLabels, setTextAsLabels] = useState(true);
  const [tableAsHtml, setTableAsHtml] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; seq: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const fileBase = name ?? (isMerged ? (mergedName ?? `${baseName(sourceFileName)}-gop`) : baseName(sourceFileName));
  const visibleCount = doc ? doc.layers.filter((l) => visible.has(l.name)).length : 0;
  // Merged documents already contain only what is shown on the map.
  const exported = docOut ? docOut.layers.filter((l) => isMerged || scope === 'all' || visible.has(l.name)) : [];
  const dashLayers = exported.filter((l) => l.style?.dash && l.style.dash !== 'solid').length;
  const styledLayers = exported.filter((l) => l.style).length;

  // The success card fades away by itself.
  useEffect(() => {
    if (!result?.ok) return;
    const t = setTimeout(() => setResult((r) => (r && r.seq === result.seq ? null : r)), 7000);
    return () => clearTimeout(t);
  }, [result]);

  const run = async () => {
    if (!docOut) return;
    setBusy(true);
    setResult(null);
    try {
      const layers = exported.map((l) => l.name);
      const { blob, ms } = await buildExport(docOut, {
        format,
        fileName: fileBase,
        options: { name: fileBase, layers, textAsLabels, tableAsHtml },
        dxfCrs,
      });
      download(blob, `${fileBase}.${format}`);
      setResult({ ok: true, seq: Date.now(), text: `${fileBase}.${format} · ${(blob.size / 1024).toFixed(0)} KB · ${ms.toFixed(0)} ms` });
    } catch (err) {
      setResult({ ok: false, seq: Date.now(), text: `Lỗi khi xuất: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const epsg = dxfCrs ? epsgForProj4(dxfCrs.proj4) : null;

  return (
    <div className="flex flex-col gap-5">
      {canMerge && merged && !sketchOnly && (
        <div>
          <span className="ui-label">Nguồn</span>
          <div className="ui-segment" role="group" aria-label="Nguồn xuất">
            <button type="button" aria-pressed={!isMerged} onClick={() => setSource('active')}>
              File đang chọn
            </button>
            <button type="button" aria-pressed={isMerged} onClick={() => setSource('merged')}>
              Gộp tất cả
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-zinc-400">
            {isMerged
              ? `Gộp ${merged.files} file đang hiện${merged.sketches ? ` và ${merged.sketches} nét vẽ` : ''} thành một file — layer được đặt tên “tên file – layer”, chỉ lấy layer đang hiện.`
              : 'Chỉ xuất file đang chọn trong danh sách.'}
          </p>
        </div>
      )}

      <div>
        <span className="ui-label">Định dạng</span>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Định dạng">
          {(['kmz', 'kml', 'dxf'] as const).map((f) => {
            const active = format === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => setFormat(f)}
                className={`group flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center transition ${
                  active ? 'bg-blue-50/70 ring-2 ring-blue-600' : 'bg-zinc-50 ring-1 ring-zinc-200 hover:bg-white hover:ring-zinc-300'
                }`}
              >
                <FormatIcon label={FORMAT_INFO[f].title} active={active} />
                <span className="text-xs font-semibold text-zinc-900">{FORMAT_INFO[f].title}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-zinc-400">
          {format === 'dxf'
            ? `Mở bằng AutoCAD (Save As → DWG nếu cần). Hệ tọa độ: ${
                dxfCrs ? (epsg ? `EPSG:${epsg}` : 'theo tab Tọa độ') : 'chưa chọn'
              }. Giữ màu, độ dày nét và kiểu nét (gạch/chấm).`
            : `${FORMAT_INFO[format].hint}. Giữ màu và độ dày nét.`}
        </p>
        {format !== 'dxf' && dashLayers > 0 && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            <IconAlert className="mt-px shrink-0" width={14} height={14} />
            KML không hỗ trợ nét đứt — {dashLayers} layer xuất thành nét liền. Chọn DXF nếu cần giữ nét đứt.
          </p>
        )}
        {styledLayers > 0 && (
          <p className="mt-2 text-[11px] text-zinc-400">{styledLayers} layer có kiểu tùy chỉnh sẽ được áp dụng khi xuất.</p>
        )}
      </div>

      {!isMerged && (
      <div>
        <span className="ui-label">Phạm vi</span>
        <div className="ui-segment" role="group" aria-label="Phạm vi">
          <button type="button" aria-pressed={scope === 'visible'} onClick={() => setScope('visible')}>
            Đang hiện ({visibleCount})
          </button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Tất cả ({doc?.layers.length ?? 0})
          </button>
        </div>
      </div>
      )}

      {format !== 'dxf' && (
        <div className="flex flex-col gap-2.5 text-[13px] text-zinc-700">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="ui-check" checked={textAsLabels} onChange={(e) => setTextAsLabels(e.target.checked)} />
            Xuất chữ thành nhãn (label)
          </label>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="ui-check" checked={tableAsHtml} onChange={(e) => setTableAsHtml(e.target.checked)} />
            Kèm bảng dạng HTML trong mô tả
          </label>
        </div>
      )}

      <label>
        <span className="ui-label">Tên file</span>
        <div className="flex items-center rounded-lg border border-zinc-200 bg-white pr-3 transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
          <input
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none"
            value={fileBase}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="text-sm text-zinc-400">.{format}</span>
        </div>
      </label>

      <button className="ui-btn-primary w-full" disabled={!docOut || busy || (format === 'dxf' && !dxfCrs)} onClick={run}>
        {busy ? <IconSpinner /> : <IconDownload />}
        {busy ? 'Đang xuất…' : `Tải ${format.toUpperCase()}`}
      </button>

      {result && (
        <div
          key={result.seq}
          aria-live="polite"
          className={`ui-popover flex items-center gap-3 rounded-xl px-3.5 py-3 text-xs ${
            result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {result.ok ? (
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="shrink-0">
              <circle cx="14" cy="14" r="12" fill="none" stroke="#10b981" strokeWidth="2" pathLength="100" className="ui-circle-draw" />
              <path
                d="m8.5 14.5 3.8 3.8 7.4-8"
                fill="none"
                stroke="#059669"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength="30"
                className="ui-check-draw"
              />
            </svg>
          ) : (
            <IconAlert className="shrink-0" width={18} height={18} />
          )}
          <div className="min-w-0">
            {result.ok && <p className="text-[13px] font-semibold">Đã tạo file</p>}
            <p className="break-words leading-relaxed">{result.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}
