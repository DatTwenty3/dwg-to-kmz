'use client';
// Asked by "Tạo bản đồ mới" when this device already holds a map with drawings: continue it, overwrite it, or
// cancel. Same look as the share dialog (floating card over a dimmed page).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowRight, IconPen, IconPlus, IconX } from './icons';

export default function NewMapDialog({
  title,
  count,
  onContinue,
  onOverwrite,
  onClose,
}: {
  /** The map saved on this device. */
  title: string;
  count: number;
  onContinue: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);

  // Leave with the fade-out, then run the chosen action.
  const leave = (then: () => void) => {
    setClosing(true);
    window.setTimeout(then, 150);
  };

  useEffect(() => {
    firstRef.current?.focus(); // the safe choice
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && leave(onClose);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const choice =
    'group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left ring-1 transition focus-visible:outline-none focus-visible:ring-2';

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4 backdrop-blur-[2px] transition-opacity duration-150 ${
        closing ? 'opacity-0' : 'ui-fade-up'
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && leave(onClose)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="newmap-title"
      aria-describedby="newmap-desc"
    >
      <div className={`ui-floating w-[26rem] max-w-full overflow-hidden ${closing ? '' : 'ui-pop-in'}`}>
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id="newmap-title" className="text-[15px] font-semibold text-zinc-900">
              Tạo bản đồ mới?
            </h2>
            <p id="newmap-desc" className="mt-1 text-xs leading-relaxed text-zinc-500">
              Máy này đang lưu bản đồ <b className="font-semibold text-zinc-800">“{title}”</b> với {count} nét vẽ. Mỗi máy
              lưu một bản đồ — tạo mới sẽ thay thế bản đồ này.
            </p>
          </div>
          <button className="ui-icon-btn -mr-1 -mt-1" aria-label="Đóng" onClick={() => leave(onClose)}>
            <IconX width={16} height={16} />
          </button>
        </div>

        <div className="flex flex-col gap-2 px-5 pb-4 pt-3">
          <button
            ref={firstRef}
            className={`${choice} bg-blue-50/60 ring-blue-100 hover:bg-blue-50 hover:ring-blue-200 focus-visible:ring-blue-500`}
            onClick={() => leave(onContinue)}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm ring-1 ring-blue-100">
              <IconPen width={16} height={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-zinc-900">Tiếp tục vẽ</span>
              <span className="block truncate text-xs text-zinc-500">Mở lại “{title}” để vẽ tiếp</span>
            </span>
            <IconArrowRight className="shrink-0 text-blue-600 transition group-hover:translate-x-0.5" width={16} height={16} />
          </button>

          <button
            className={`${choice} ring-zinc-200 hover:bg-red-50/60 hover:ring-red-200 focus-visible:ring-red-500`}
            onClick={() => leave(onOverwrite)}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200 transition group-hover:bg-white group-hover:text-red-600 group-hover:ring-red-200">
              <IconPlus width={16} height={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-zinc-900 transition group-hover:text-red-700">
                Ghi đè — tạo bản đồ mới
              </span>
              <span className="block text-xs text-zinc-500">Xóa {count} nét vẽ hiện có và bắt đầu từ bản đồ trống</span>
            </span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">
          <p className="text-[11px] leading-snug text-zinc-400">Muốn giữ bản cũ? Xuất KMZ ở tab Xuất trước khi ghi đè.</p>
          <button className="ui-btn shrink-0 !px-3 !py-1.5 !text-xs" onClick={() => leave(onClose)}>
            Hủy
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
