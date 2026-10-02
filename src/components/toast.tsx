'use client';
// Toast notifications: short messages in the bottom corner that disappear on their own. A tiny module-level store
// (no context needed): call `toast.success(...)` / `toast.error(...)` from anywhere, render <Toaster/> once.
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { IconAlert, IconCheck, IconX } from './icons';

export type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  leaving: boolean;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 200);
}

function push(tone: ToastTone, message: string, ms?: number) {
  // The same message twice in a row: refresh it instead of stacking duplicates.
  const dup = toasts.find((t) => t.message === message && !t.leaving);
  if (dup) dismiss(dup.id);
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, tone, message, leaving: false }];
  emit();
  timers.set(id, setTimeout(() => dismiss(id), ms ?? (tone === 'error' ? 7000 : 3500)));
  return id;
}

export const toast = {
  success: (message: string, ms?: number) => push('success', message, ms),
  error: (message: string, ms?: number) => push('error', message, ms),
  info: (message: string, ms?: number) => push('info', message, ms),
  dismiss,
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => toasts;
const serverSnapshot = (): Toast[] => [];

const TONE = {
  success: { icon: IconCheck, dot: 'bg-emerald-50 text-emerald-600' },
  error: { icon: IconAlert, dot: 'bg-red-50 text-red-600' },
  info: { icon: IconCheck, dot: 'bg-blue-50 text-blue-600' },
} as const;

/** Renders the toasts (bottom-centre on phones, bottom-right otherwise). Mount once. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (typeof document === 'undefined' || list.length === 0) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-3 bottom-16 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-14 sm:right-3 sm:items-end"
      aria-live="polite"
      role="status"
    >
      {list.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            className={`ui-floating pointer-events-auto flex w-full max-w-sm items-start gap-2.5 py-2.5 pl-3 pr-2 text-[13px] leading-snug text-zinc-800 transition duration-200 sm:w-auto ${
              t.leaving ? 'translate-y-1 opacity-0' : 'ui-pop-in'
            }`}
          >
            <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone.dot}`}>
              <tone.icon width={12} height={12} />
            </span>
            <span className="min-w-0 flex-1">{t.message}</span>
            <button className="ui-icon-btn !h-5 !w-5 shrink-0" aria-label="Đóng thông báo" onClick={() => dismiss(t.id)}>
              <IconX width={12} height={12} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
