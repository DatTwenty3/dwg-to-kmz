'use client';
import type { ReactNode } from 'react';
import { IconAlert, IconArrowLeft, IconArrowRight, IconCheck, IconFile, IconSpinner } from './icons';

const STEPS = ['Tải file', 'Hệ tọa độ', 'Bản đồ'];

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-center gap-2 text-xs font-medium">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span className={`h-px w-6 sm:w-10 ${done || active ? 'bg-zinc-900' : 'bg-zinc-200'}`} />}
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                done ? 'bg-zinc-900 text-white' : active ? 'bg-blue-600 text-white ring-4 ring-blue-600/15' : 'bg-zinc-100 text-zinc-400'
              }`}
            >
              {done ? <IconCheck width={11} height={11} strokeWidth={3} /> : i + 1}
            </span>
            <span className={active ? 'text-zinc-900' : done ? 'text-zinc-600' : 'text-zinc-400'}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Step 2, shown under the landing hero: confirm the drawing's coordinate system before opening the map. */
export default function CrsStep({
  fileName,
  stats,
  error,
  busy,
  canContinue,
  onBack,
  onContinue,
  children,
}: {
  fileName?: string;
  stats?: string[];
  error: string | null;
  busy: boolean;
  /** A transformed document exists for the selected CRS. */
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
  /** The CRS panel. */
  children: ReactNode;
}) {
  return (
    <section aria-label="Chọn hệ tọa độ">
      <div className="ui-pop-in" style={{ animationDelay: '0.05s' }}>
        <Stepper current={1} />
      </div>

      <div className="ui-pop-in mt-6 text-center" style={{ animationDelay: '0.12s' }}>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900">Chọn hệ tọa độ của bản vẽ</h2>
        <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-zinc-500">
          Chọn tỉnh / thành nơi bản vẽ được lập (theo địa giới cũ nếu bản vẽ có trước 2025) rồi mở bản đồ — vẫn đổi lại được ở bảng
          bên trái bản đồ.
        </p>
      </div>

      <div className="ui-card ui-pop-in mt-6 flex items-start gap-3 p-4 shadow-[0_8px_32px_rgba(15,23,42,0.06)]" style={{ animationDelay: '0.2s' }}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <IconFile width={20} height={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900" title={fileName}>
            {fileName}
          </p>
          {stats && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {stats.map((s) => (
                <span key={s} className="ui-chip">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <button className="ui-btn-ghost shrink-0" onClick={onBack}>
          Đổi file
        </button>
      </div>

      <div className="ui-card ui-pop-in mt-3 p-5 shadow-[0_8px_32px_rgba(15,23,42,0.06)]" style={{ animationDelay: '0.28s' }}>
        {children}
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
          <IconAlert className="mt-px shrink-0" width={14} height={14} />
          {error}
        </p>
      )}

      <div
        className="ui-pop-in sticky bottom-0 -mx-4 mt-4 flex items-center gap-3 bg-gradient-to-t from-white via-white to-white/0 px-4 pb-4 pt-6"
        style={{ animationDelay: '0.36s' }}
      >
        <button className="ui-btn" onClick={onBack}>
          <IconArrowLeft />
          Chọn file khác
        </button>
        <button className="ui-btn-primary ml-auto px-5" disabled={!canContinue || busy} onClick={onContinue}>
          {busy ? <IconSpinner /> : null}
          {busy ? 'Đang chuyển tọa độ…' : 'Hiển thị lên bản đồ'}
          {!busy && <IconArrowRight />}
        </button>
      </div>
    </section>
  );
}
