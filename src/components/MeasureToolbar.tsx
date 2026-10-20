'use client';
// Measuring tools behind one square button (same size as the basemap button): a click opens a small strip to its left
// with distance, area, point and "clear"; the button shows the active tool. Keeps the map's right edge uncluttered.
import { useEffect, useRef, useState } from 'react';
import type { MeasureTool } from '@/lib/map';
import { IconArea, IconPin, IconRuler, IconTrash } from './icons';

const TOOLS: { id: MeasureTool; label: string; hint: string; icon: typeof IconRuler }[] = [
  { id: 'distance', label: 'Khoảng cách', hint: 'Đo khoảng cách theo đường gấp khúc', icon: IconRuler },
  { id: 'area', label: 'Diện tích', hint: 'Đo diện tích vùng khép kín', icon: IconArea },
  { id: 'point', label: 'Tọa độ', hint: 'Lấy tọa độ một điểm', icon: IconPin },
];

export default function MeasureToolbar({
  tool,
  onTool,
  hasMeasurements,
  onClear,
  iconOnly = false,
}: {
  tool: MeasureTool | null;
  onTool: (t: MeasureTool | null) => void;
  hasMeasurements: boolean;
  onClear: () => void;
  /** Labels hidden (narrow map panes). */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const index = TOOLS.findIndex((t) => t.id === tool);
  const active = index >= 0 ? TOOLS[index] : null;
  const Icon = active?.icon ?? IconRuler;
  return (
    <div ref={boxRef} className="relative">
      <button
        className={`ui-floating ui-drop-in flex h-10 w-10 items-center justify-center transition ${
          active ? '!bg-blue-600 !text-white' : open ? 'text-blue-600' : 'text-zinc-700'
        }`}
        style={{ animationDelay: '0.4s' }}
        aria-label="Công cụ đo"
        aria-expanded={open}
        aria-pressed={!!active}
        title={active ? `Đang đo: ${active.label} — bấm để đổi hoặc tắt` : 'Đo khoảng cách, diện tích, tọa độ'}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon width={19} height={19} />
      </button>
      {open && (
        <div className="ui-floating ui-pop-in absolute right-12 top-0 flex items-center gap-1 whitespace-nowrap rounded-xl p-1" role="toolbar" aria-label="Công cụ đo">
          <div className="ui-tabs !rounded-lg" style={{ ['--n' as string]: TOOLS.length, ['--i' as string]: Math.max(0, index) }}>
            <span className="ui-tabs-indicator ui-tool-indicator" data-on={index >= 0} aria-hidden />
            {TOOLS.map((t) => (
              <button
                key={t.id}
                title={`${t.hint}${tool === t.id ? ' (nhấn lại để tắt)' : ''}`}
                aria-pressed={tool === t.id}
                onClick={() => {
                  onTool(tool === t.id ? null : t.id);
                  setOpen(false);
                }}
                className="!px-2.5 !py-1.5"
              >
                <t.icon width={15} height={15} />
                <span className={iconOnly ? 'sr-only' : ''}>{t.label}</span>
              </button>
            ))}
          </div>
          <button
            className="ui-icon-btn !h-8 !w-8 disabled:pointer-events-none disabled:opacity-30"
            title="Xóa mọi phép đo"
            aria-label="Xóa mọi phép đo"
            disabled={!hasMeasurements && !tool}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            <IconTrash width={16} height={16} />
          </button>
        </div>
      )}
    </div>
  );
}
