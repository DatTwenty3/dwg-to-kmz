'use client';
// Floating tool picker for the measurement tools: distance, area, point, plus "clear".
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
}: {
  tool: MeasureTool | null;
  onTool: (t: MeasureTool | null) => void;
  hasMeasurements: boolean;
  onClear: () => void;
}) {
  const index = TOOLS.findIndex((t) => t.id === tool);
  return (
    <div
      className="ui-floating ui-drop-in flex items-center gap-1 rounded-xl p-1"
      style={{ animationDelay: '0.4s' }}
      role="toolbar"
      aria-label="Công cụ đo"
    >
      <div className="ui-tabs !rounded-lg" style={{ ['--n' as string]: TOOLS.length, ['--i' as string]: Math.max(0, index) }}>
        <span className="ui-tabs-indicator ui-tool-indicator" data-on={index >= 0} aria-hidden />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={`${t.hint}${tool === t.id ? ' (nhấn lại để tắt)' : ''}`}
            aria-pressed={tool === t.id}
            onClick={() => onTool(tool === t.id ? null : t.id)}
            className="!px-2.5 !py-1.5"
          >
            <t.icon width={15} height={15} />
            <span className="max-[1180px]:hidden">{t.label}</span>
          </button>
        ))}
      </div>
      <button
        className="ui-icon-btn !h-8 !w-8 disabled:pointer-events-none disabled:opacity-30"
        title="Xóa mọi phép đo"
        aria-label="Xóa mọi phép đo"
        disabled={!hasMeasurements && !tool}
        onClick={onClear}
      >
        <IconTrash width={16} height={16} />
      </button>
    </div>
  );
}
