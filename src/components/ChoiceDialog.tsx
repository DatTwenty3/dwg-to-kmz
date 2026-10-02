'use client';
// Small decision dialog: a title, an explanation, 2–3 large choice buttons and "Hủy". Same look as the share
// dialog (floating card over a dimmed page). Used for "Tạo bản đồ mới" and opening a .ldg session.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowRight, IconX } from './icons';

export interface Choice {
  key: string;
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  /** 'primary': the safe, pre-focused choice; 'danger': destroys something (turns red on hover). */
  tone: 'primary' | 'danger' | 'neutral';
  onSelect: () => void;
}

export default function ChoiceDialog({
  title,
  description,
  choices,
  hint,
  onClose,
}: {
  title: string;
  description: ReactNode;
  choices: Choice[];
  /** Small note next to "Hủy". */
  hint?: ReactNode;
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
    firstRef.current?.focus(); // the first choice is the safe one
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && leave(onClose);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const base =
    'group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left ring-1 transition focus-visible:outline-none focus-visible:ring-2';
  const tones = {
    primary: {
      button: 'bg-blue-50/60 ring-blue-100 hover:bg-blue-50 hover:ring-blue-200 focus-visible:ring-blue-500',
      icon: 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100',
      title: 'text-zinc-900',
    },
    danger: {
      button: 'ring-zinc-200 hover:bg-red-50/60 hover:ring-red-200 focus-visible:ring-red-500',
      icon: 'bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200 transition group-hover:bg-white group-hover:text-red-600 group-hover:ring-red-200',
      title: 'text-zinc-900 transition group-hover:text-red-700',
    },
    neutral: {
      button: 'ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300 focus-visible:ring-blue-500',
      icon: 'bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200 transition group-hover:bg-white',
      title: 'text-zinc-900',
    },
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4 backdrop-blur-[2px] transition-opacity duration-150 ${
        closing ? 'opacity-0' : 'ui-fade-up'
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && leave(onClose)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="choice-title"
      aria-describedby="choice-desc"
    >
      <div className={`ui-floating w-[26rem] max-w-full overflow-hidden ${closing ? '' : 'ui-pop-in'}`}>
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id="choice-title" className="text-[15px] font-semibold text-zinc-900">
              {title}
            </h2>
            <p id="choice-desc" className="mt-1 text-xs leading-relaxed text-zinc-500">
              {description}
            </p>
          </div>
          <button className="ui-icon-btn -mr-1 -mt-1" aria-label="Đóng" onClick={() => leave(onClose)}>
            <IconX width={16} height={16} />
          </button>
        </div>

        <div className="flex flex-col gap-2 px-5 pb-4 pt-3">
          {choices.map((c, i) => {
            const t = tones[c.tone];
            return (
              <button key={c.key} ref={i === 0 ? firstRef : undefined} className={`${base} ${t.button}`} onClick={() => leave(c.onSelect)}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.icon}`}>{c.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] font-semibold ${t.title}`}>{c.title}</span>
                  <span className="block truncate text-xs text-zinc-500">{c.subtitle}</span>
                </span>
                {c.tone === 'primary' && (
                  <IconArrowRight className="shrink-0 text-blue-600 transition group-hover:translate-x-0.5" width={16} height={16} />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">
          <p className="text-[11px] leading-snug text-zinc-400">{hint}</p>
          <button className="ui-btn shrink-0 !px-3 !py-1.5 !text-xs" onClick={() => leave(onClose)}>
            Hủy
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
