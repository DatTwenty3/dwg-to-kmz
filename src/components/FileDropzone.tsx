'use client';
import { useRef, useState } from 'react';
import { IconFile, IconUpload } from './icons';

export const ACCEPTED_EXT = /\.(dwg|dxf|kmz|kml)$/i;

export default function FileDropzone({
  onFile,
  busy,
  fileName,
  stats,
  progress,
}: {
  onFile: (file: File) => void;
  busy: boolean;
  fileName?: string;
  /** Short facts about the loaded drawing, shown as chips. */
  stats?: string[];
  progress?: { stage: string; percent: number } | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => inputRef.current?.click();

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".dwg,.dxf,.kmz,.kml"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = '';
      }}
    />
  );

  // Loaded: compact file card with a "replace" action.
  if (fileName && !busy) {
    return (
      <div className="ui-card flex items-start gap-3 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <IconFile width={18} height={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900" title={fileName}>
            {fileName}
          </p>
          {stats && stats.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {stats.map((s) => (
                <span key={s} className="ui-chip">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <button className="ui-btn-ghost shrink-0" onClick={open}>
          Đổi file
        </button>
        {input}
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Chọn hoặc kéo thả file DWG/DXF"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') open();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition ${
          over ? 'border-blue-500 bg-blue-50/60' : 'border-zinc-300 bg-zinc-50/60 hover:border-zinc-400 hover:bg-zinc-50'
        }`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200">
          <IconUpload width={18} height={18} />
        </span>
        <span className="text-sm font-medium text-zinc-900">Kéo thả bản vẽ hoặc file KMZ vào đây</span>
        <span className="text-xs text-zinc-500">
          hoặc <span className="font-medium text-blue-600">chọn file</span> .dwg / .dxf / .kmz / .kml
        </span>
        {input}
      </div>
      {busy && progress && (
        <div className="mt-3" aria-live="polite">
          <div className="flex justify-between text-xs text-zinc-500">
            <span>{progress.stage}</span>
            <span className="tabular-nums">{Math.round(progress.percent)}%</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-zinc-900 transition-[width]" style={{ width: `${Math.max(3, progress.percent)}%` }} />
          </div>
        </div>
      )}
      <p className="mt-2.5 text-center text-[11px] text-zinc-400">File được xử lý ngay trên máy, không tải lên máy chủ.</p>
    </div>
  );
}
