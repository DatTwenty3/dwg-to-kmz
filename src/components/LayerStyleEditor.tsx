'use client';
// Popover that edits the style of one layer (or of several, in bulk mode). Edits apply live.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DashStyle, LayerStyle } from '@/lib/cad/types';
import { IconReset, IconX } from './icons';

export const PALETTE = [
  '#ef4444',
  '#f97316',
  '#facc15',
  '#84cc16',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
  '#a1a1aa',
  '#18181b',
];

const DASHES: { id: DashStyle; label: string; array?: string }[] = [
  { id: 'solid', label: 'Liền' },
  { id: 'dashed', label: 'Gạch', array: '7 4' },
  { id: 'dotted', label: 'Chấm', array: '1.5 4' },
  { id: 'dashdot', label: 'Gạch-chấm', array: '8 3 1.5 3' },
];

export interface StyleFeatures {
  /** Layer has polylines / table grids: width and dash apply. */
  line: boolean;
  /** Layer has filled polygons: fill opacity applies. */
  fill: boolean;
}

const HEX_RE = /^#?([0-9a-f]{6})$/i;
const POPOVER_W = 288;

export default function LayerStyleEditor({
  anchor,
  title,
  subtitle,
  value,
  defaultColor,
  features,
  onChange,
  onReset,
  onClose,
}: {
  anchor: HTMLElement;
  title: string;
  subtitle?: string;
  value: LayerStyle;
  /** Layer's original colour (shown when no colour override); undefined in bulk mode. */
  defaultColor?: string;
  features: StyleFeatures;
  onChange: (patch: LayerStyle) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const color = value.color ?? defaultColor ?? '#a1a1aa';
  const [hex, setHex] = useState(color);
  const [prevColor, setPrevColor] = useState(color);
  if (prevColor !== color) {
    setPrevColor(color);
    setHex(color);
  }

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 140);
  }, [onClose]);

  const place = useCallback(() => {
    const r = anchor.getBoundingClientRect();
    const aside = anchor.closest('aside')?.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = ref.current?.offsetHeight ?? 360;
    let left = aside ? aside.right + 8 : r.right + 8;
    // Not enough room beside the panel (tablet): overlap the panel, aligned to the button.
    if (left + POPOVER_W > vw - 8) left = Math.max(8, Math.min(r.right - POPOVER_W, vw - POPOVER_W - 8));
    const top = Math.max(8, Math.min(r.top - 8, vh - h - 8));
    setPos({ left, top });
  }, [anchor]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        anchor.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [anchor, close, place]);

  const commitHex = (text: string) => {
    setHex(text);
    const m = HEX_RE.exec(text.trim());
    if (m) onChange({ color: `#${m[1].toLowerCase()}` });
  };

  const width = value.width ?? 1;
  const opacity = value.fillOpacity ?? 0.5;
  const pct = (v: number, min: number, max: number) => `${((v - min) / (max - min)) * 100}%`;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Kiểu layer ${title}`}
      data-closing={closing}
      className="ui-popover ui-floating fixed z-50 flex flex-col gap-4 p-4 text-zinc-900"
      style={{ width: POPOVER_W, left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold" title={title}>
            {title}
          </p>
          {subtitle && <p className="text-[11px] text-zinc-400">{subtitle}</p>}
        </div>
        <button className="ui-icon-btn -mr-1 -mt-1" aria-label="Đóng" onClick={close}>
          <IconX width={14} height={14} />
        </button>
      </div>

      {/* Colour */}
      <div>
        <span className="ui-label">Màu</span>
        <div className="grid grid-cols-6 gap-1.5">
          {PALETTE.map((c) => {
            const on = color.toLowerCase() === c && value.color !== undefined;
            return (
              <button
                key={c}
                type="button"
                aria-label={`Màu ${c}`}
                aria-pressed={on}
                onClick={() => onChange({ color: c })}
                className={`h-7 rounded-lg ring-1 ring-zinc-900/10 transition hover:scale-110 active:scale-95 ${
                  on ? 'outline outline-2 outline-offset-2 outline-blue-600' : ''
                }`}
                style={{ background: c }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-900/15" title="Chọn màu tùy ý">
            <span
              className="pointer-events-none absolute inset-0"
              style={{ background: 'conic-gradient(#ef4444, #facc15, #22c55e, #06b6d4, #3b82f6, #ec4899, #ef4444)' }}
            />
            <input
              type="color"
              className="ui-color absolute inset-0 h-full w-full opacity-0"
              aria-label="Chọn màu tùy ý"
              value={HEX_RE.test(color) ? (color.startsWith('#') ? color : `#${color}`) : '#a1a1aa'}
              onChange={(e) => onChange({ color: e.target.value })}
            />
          </span>
          <input
            className="ui-input py-1.5 font-mono text-xs uppercase"
            aria-label="Mã màu hex"
            spellCheck={false}
            maxLength={7}
            value={hex}
            onChange={(e) => commitHex(e.target.value)}
          />
        </div>
      </div>

      {features.line && (
        <>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="ui-label !mb-0">Độ dày nét</span>
              <span className="text-xs tabular-nums text-zinc-500">
                {value.width === undefined ? 'Tự động' : `${width.toLocaleString('vi-VN')} px`}
              </span>
            </div>
            <input
              type="range"
              className="ui-range"
              aria-label="Độ dày nét"
              min={0.5}
              max={8}
              step={0.5}
              value={width}
              style={{ ['--p' as string]: pct(width, 0.5, 8) }}
              onChange={(e) => onChange({ width: Number(e.target.value) })}
            />
          </div>
          <div>
            <span className="ui-label">Kiểu nét</span>
            <div className="ui-segment" role="group" aria-label="Kiểu nét">
              {DASHES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  title={d.label}
                  aria-label={d.label}
                  aria-pressed={(value.dash ?? 'solid') === d.id}
                  onClick={() => onChange({ dash: d.id })}
                  className="flex items-center justify-center !px-1"
                >
                  <svg width="38" height="10" viewBox="0 0 38 10" aria-hidden>
                    <line
                      x1="2"
                      y1="5"
                      x2="36"
                      y2="5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="butt"
                      strokeDasharray={d.array}
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {features.fill && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="ui-label !mb-0">Độ đặc vùng tô</span>
            <span className="text-xs tabular-nums text-zinc-500">
              {value.fillOpacity === undefined ? 'Tự động' : `${Math.round(opacity * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            className="ui-range"
            aria-label="Độ đặc vùng tô"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            style={{ ['--p' as string]: pct(opacity, 0, 1) }}
            onChange={(e) => onChange({ fillOpacity: Number(e.target.value) })}
          />
        </div>
      )}

      {!features.line && !features.fill && (
        <p className="text-[11px] leading-snug text-zinc-400">Layer này chỉ có chữ/điểm nên chỉ đổi được màu.</p>
      )}

      <button className="ui-btn w-full" onClick={onReset}>
        <IconReset />
        Đặt lại
      </button>
    </div>,
    document.body,
  );
}
