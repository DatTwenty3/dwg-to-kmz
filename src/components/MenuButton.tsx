'use client';
// A toolbar button that opens a short menu (e.g. "Mở ▾" → folder / .zip, "Báo cáo ▾" → CSV / PDF), so related
// actions share one button. Closes on choosing, clicking outside or Escape.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevron } from './icons';

export interface MenuItem {
  label: string;
  /** Small grey line under the label. */
  hint?: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export default function MenuButton({
  label,
  icon,
  items,
  title,
  disabled,
  align = 'right',
}: {
  label: ReactNode;
  icon?: ReactNode;
  items: MenuItem[];
  title?: string;
  disabled?: boolean;
  /** Edge of the button the menu lines up with. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button className="ui-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" title={title} disabled={disabled}>
        {icon}
        <span className="hidden md:inline">{label}</span>
        <IconChevron width={12} height={12} className={`text-zinc-400 transition ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {open && (
        <div
          role="menu"
          className={`ui-floating ui-pop-in absolute top-full z-40 mt-1.5 w-60 p-1.5 text-[13px] ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-40"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon && <span className="mt-0.5 shrink-0 text-zinc-500">{it.icon}</span>}
              <span className="min-w-0">
                <span className="block font-medium">{it.label}</span>
                {it.hint && <span className="block text-[11.5px] text-zinc-500">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
