'use client';
import { useState } from 'react';
import type { CadDocument, CrsOptions } from '@/lib/cad/types';
import { toDxf, toKml, toKmz, type ExportOptions } from '@/lib/export';
import { epsgForProj4, projectDocument } from '@/lib/geo';
import { IconDownload, IconSpinner } from './icons';

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

function download(blob: Blob, name: string) {
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

export default function ExportPanel({
  doc,
  sourceFileName,
  visible,
  dxfCrs,
  defaultFormat = 'kmz',
}: {
  doc: CadDocument | null;
  sourceFileName?: string;
  visible: Set<string>;
  /** CRS the DXF is written in: the drawing's own CRS for CAD sources, the chosen target for KML/KMZ. */
  dxfCrs: CrsOptions | null;
  defaultFormat?: ExportFormat;
}) {
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [scope, setScope] = useState<'visible' | 'all'>('visible');
  const [textAsLabels, setTextAsLabels] = useState(true);
  const [tableAsHtml, setTableAsHtml] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fileBase = name ?? baseName(sourceFileName);
  const visibleCount = doc ? doc.layers.filter((l) => visible.has(l.name)).length : 0;

  const run = async () => {
    if (!doc) return;
    setBusy(true);
    setStatus('Đang tạo file…');
    try {
      const layers = scope === 'visible' ? doc.layers.filter((l) => visible.has(l.name)).map((l) => l.name) : doc.layers.map((l) => l.name);
      const { blob, ms } = await buildExport(doc, {
        format,
        fileName: fileBase,
        options: { name: fileBase, layers, textAsLabels, tableAsHtml },
        dxfCrs,
      });
      download(blob, `${fileBase}.${format}`);
      setStatus(`Đã tạo ${fileBase}.${format} (${(blob.size / 1024).toFixed(0)} KB, ${ms.toFixed(0)} ms).`);
    } catch (err) {
      setStatus(`Lỗi khi xuất: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="ui-label">Định dạng</span>
        <div className="ui-segment" role="group" aria-label="Định dạng">
          {(['kmz', 'kml', 'dxf'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">
          {format === 'dxf'
            ? `Mở bằng AutoCAD (Save As → DWG nếu cần). Hệ tọa độ: ${
                dxfCrs ? (epsgForProj4(dxfCrs.proj4) ? `EPSG:${epsgForProj4(dxfCrs.proj4)}` : 'theo bước 2') : 'chưa chọn'
              }.`
            : format === 'kmz'
              ? 'Google Earth / Google My Maps, file nén.'
              : 'Google Earth, dạng văn bản XML.'}
        </p>
      </div>
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
      {format !== 'dxf' && (
      <div className="flex flex-col gap-2 text-[13px] text-zinc-700">
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
      <button className="ui-btn-primary w-full" disabled={!doc || busy || (format === 'dxf' && !dxfCrs)} onClick={run}>
        {busy ? <IconSpinner /> : <IconDownload />}
        {busy ? 'Đang xuất…' : `Tải ${format.toUpperCase()}`}
      </button>
      {status && (
        <p className="text-xs text-zinc-500" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}
