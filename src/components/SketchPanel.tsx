'use client';
// "Vẽ" tab: draw lines / areas / points on the map, then name, label and style each one.
// Sketches are exported with the open files through the "Gộp tất cả" export option.
import { useState } from 'react';
import type { LayerStyle } from '@/lib/cad/types';
import { SKETCH_DEFAULT_COLOR, SKETCH_DEFAULT_FILL, SKETCH_DEFAULT_LABEL_SIZE, type SketchFeature, type SketchKind } from '@/lib/cad/sketch';
import { IconAlert, IconArea, IconBrush, IconEye, IconEyeOff, IconNodes, IconPin, IconPolyline, IconRedo, IconShare, IconTarget, IconTrash, IconUndo } from './icons';
import LayerStyleEditor from './LayerStyleEditor';

const TOOLS: { id: SketchKind; label: string; hint: string; icon: typeof IconPolyline }[] = [
  { id: 'line', label: 'Đường', hint: 'Vẽ đường gấp khúc', icon: IconPolyline },
  { id: 'polygon', label: 'Vùng', hint: 'Vẽ vùng khép kín', icon: IconArea },
  { id: 'point', label: 'Điểm', hint: 'Đặt điểm', icon: IconPin },
];
const KIND_ICON: Record<SketchKind, typeof IconPolyline> = { line: IconPolyline, polygon: IconArea, point: IconPin };

export interface SketchPanelProps {
  features: SketchFeature[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tool: SketchKind | null;
  onTool: (t: SketchKind | null) => void;
  /** Colour new sketches start with. */
  nextColor: string;
  onNextColor: (c: string) => void;
  onUpdate: (id: string, patch: Partial<SketchFeature>) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  shown: boolean;
  onToggleShown: () => void;
  opacity: number;
  onOpacity: (v: number) => void;
  onZoom: (id: string) => void;
  /** Map name / description (shared with the link and used as export file name). */
  title: string;
  description: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  onShare: () => void;
  /** Viewing a map opened from a shared link: edits are not saved on this device. */
  sharedView: boolean;
  onKeepShared: () => void;
  /** What `sharedView` shows: a shared link or a .ldg session opened in place of the map. */
  sharedKind: 'link' | 'session';
  /** Sketch whose shape is being edited on the map. */
  editingId: string | null;
  onEdit: (id: string | null) => void;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
}

export default function SketchPanel(p: SketchPanelProps) {
  const [styleOpen, setStyleOpen] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const index = TOOLS.findIndex((t) => t.id === p.tool);
  const editing = styleOpen ? p.features.find((f) => f.id === styleOpen.id) : undefined;

  const [descOpen, setDescOpen] = useState(!!p.description);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {p.sharedView && (
        <div className="ui-pop-in flex items-start gap-2.5 rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-900">
          <IconAlert className="mt-0.5 shrink-0 text-blue-600" width={14} height={14} />
          <div className="min-w-0 flex-1">
            {p.sharedKind === 'session' ? (
              <>
                <p className="font-medium">Đang xem phiên làm việc (.ldg)</p>
                <p className="text-blue-800/80">
                  Bản đồ riêng trên máy này được giữ nguyên. Thay đổi trong phiên được lưu khi bạn lưu lại file .ldg (Ctrl+S).
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Bản đồ được chia sẻ</p>
                <p className="text-blue-800/80">Thay đổi không được lưu trên máy này. Sửa xong hãy bấm Chia sẻ để gửi link mới.</p>
              </>
            )}
            <button className="ui-btn mt-2 !px-2.5 !py-1 !text-xs" onClick={p.onKeepShared}>
              Lưu vào máy này
            </button>
          </div>
        </div>
      )}

      {/* Map name + share */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold text-zinc-900 outline-none transition placeholder:text-zinc-400 hover:border-zinc-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
            value={p.title}
            placeholder="Tên bản đồ"
            aria-label="Tên bản đồ"
            maxLength={160}
            onChange={(e) => p.onTitle(e.target.value)}
          />
          {descOpen ? (
            <textarea
              className="mt-1 w-full resize-none rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              rows={2}
              maxLength={500}
              placeholder="Mô tả ngắn (tùy chọn)"
              aria-label="Mô tả bản đồ"
              value={p.description}
              onChange={(e) => p.onDescription(e.target.value)}
            />
          ) : (
            <button className="ui-btn-ghost !px-2 !text-[11px]" onClick={() => setDescOpen(true)}>
              + Thêm mô tả
            </button>
          )}
        </div>
        <button
          className="ui-btn-primary shrink-0 !px-3 !py-2"
          onClick={p.onShare}
          disabled={p.features.length === 0}
          title={p.features.length ? 'Tạo link chia sẻ bản đồ' : 'Vẽ ít nhất một nét để chia sẻ'}
        >
          <IconShare width={15} height={15} />
          Chia sẻ
        </button>
      </div>

      {/* Tools */}
      <div>
        <div className="ui-tabs" style={{ ['--n' as string]: TOOLS.length, ['--i' as string]: Math.max(0, index) }} role="toolbar" aria-label="Công cụ vẽ">
          <span className="ui-tabs-indicator ui-tool-indicator" data-on={index >= 0} aria-hidden />
          {TOOLS.map((t) => (
            <button
              key={t.id}
              aria-pressed={p.tool === t.id}
              title={`${t.hint}${p.tool === t.id ? ' (nhấn lại để tắt)' : ''}`}
              onClick={() => p.onTool(p.tool === t.id ? null : t.id)}
            >
              <t.icon width={14} height={14} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
          <span>Màu nét mới</span>
          <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full ring-1 ring-zinc-900/10" title="Đổi màu nét vẽ mới">
            <span className="absolute inset-0" style={{ background: p.nextColor }} />
            <input
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={p.nextColor}
              onChange={(e) => p.onNextColor(e.target.value)}
              aria-label="Màu nét vẽ mới"
            />
          </label>
          <span className="ml-auto truncate">{p.tool ? 'Nhấp lên bản đồ để vẽ' : 'Chọn công cụ rồi nhấp lên bản đồ'}</span>
        </div>
      </div>

      {/* Layer-level controls */}
      <div className="flex items-center gap-2 rounded-xl bg-zinc-50 px-2.5 py-2">
        <button
          className="ui-icon-btn"
          role="switch"
          aria-checked={p.shown}
          aria-label={p.shown ? 'Ẩn lớp nét vẽ' : 'Hiện lớp nét vẽ'}
          onClick={p.onToggleShown}
          style={{ color: p.shown ? '#0e1f3b' : '#d4d4d8' }}
        >
          {p.shown ? <IconEye /> : <IconEyeOff />}
        </button>
        <span className="whitespace-nowrap text-[13px] font-medium text-zinc-800">Nét vẽ</span>
        <span className="ui-chip">{p.features.length}</span>
        <input
          type="range"
          className="ui-range ml-auto w-24"
          min={0}
          max={100}
          value={Math.round(p.opacity * 100)}
          style={{ ['--p' as string]: `${Math.round(p.opacity * 100)}%` }}
          onChange={(e) => p.onOpacity(Number(e.target.value) / 100)}
          aria-label="Độ trong suốt lớp nét vẽ"
          title="Độ hiển thị lớp nét vẽ"
        />
        <span className="w-9 text-right text-[11px] tabular-nums text-zinc-500">{Math.round(p.opacity * 100)}%</span>
      </div>

      {/* List */}
      <ul className="ui-scroll -mx-2 min-h-0 flex-1 overflow-y-auto px-1">
        {p.features.length === 0 && (
          <li className="flex flex-col items-center gap-3 px-4 py-8 text-center text-xs text-zinc-400">
            <svg width="88" height="56" viewBox="0 0 88 56" aria-hidden>
              <path d="M8 44 30 18l18 18L80 10" fill="none" stroke="#e4e4e7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 44 30 18l18 18L80 10" fill="none" stroke="#e11d48" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" pathLength="100" className="ui-check-draw" />
              {[
                [8, 44],
                [30, 18],
                [48, 36],
                [80, 10],
              ].map(([x, y]) => (
                <circle key={`${x}`} cx={x} cy={y} r="3.2" fill="#fff" stroke="#e11d48" strokeWidth="2" />
              ))}
            </svg>
            Chưa có nét vẽ. Chọn Đường, Vùng hoặc Điểm ở trên để bắt đầu — nét vẽ được xuất chung với bản vẽ khi chọn “Gộp tất cả” ở tab Xuất.
          </li>
        )}
        {p.features.map((f, i) => {
          const Icon = KIND_ICON[f.kind];
          const selected = p.selectedId === f.id;
          return (
            <li
              key={f.id}
              className={`ui-row-in rounded-lg px-1 transition-colors ${selected ? 'bg-blue-50/60' : 'hover:bg-zinc-50'}`}
              style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }}
            >
              <div className="group flex items-center gap-1">
                <button
                  className="ui-icon-btn"
                  role="switch"
                  aria-checked={!f.hidden}
                  aria-label={`${f.hidden ? 'Hiện' : 'Ẩn'} ${f.name}`}
                  onClick={() => p.onUpdate(f.id, { hidden: !f.hidden })}
                  style={{ color: f.hidden ? '#d4d4d8' : '#0e1f3b' }}
                >
                  {f.hidden ? <IconEyeOff /> : <IconEye />}
                </button>
                <button className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left" onClick={() => p.onSelect(selected ? null : f.id)}>
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white"
                    style={{ background: f.style.color, opacity: f.hidden ? 0.4 : 1 }}
                  >
                    <Icon width={12} height={12} />
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[13px] ${f.hidden ? 'text-zinc-400' : 'text-zinc-800'}`} title={f.name}>
                    {f.name}
                  </span>
                  {f.label && <span className="max-w-[35%] truncate text-[11px] text-zinc-400">“{f.label}”</span>}
                </button>
                <button
                  className={`ui-icon-btn ${p.editingId === f.id ? '!bg-blue-50 !text-blue-600' : 'ui-row-action'}`}
                  aria-label={`Sửa hình ${f.name}`}
                  aria-pressed={p.editingId === f.id}
                  title="Sửa hình (kéo đỉnh, thêm / xóa đỉnh, dời)"
                  onClick={() => p.onEdit(p.editingId === f.id ? null : f.id)}
                >
                  <IconNodes width={15} height={15} />
                </button>
                <button
                  className="ui-icon-btn ui-row-action"
                  aria-label={`Kiểu ${f.name}`}
                  title="Đổi màu, nét, vùng tô"
                  onClick={(e) => {
                    const el = e.currentTarget;
                    setStyleOpen((o) => (o?.id === f.id ? null : { id: f.id, el }));
                  }}
                >
                  <IconBrush width={15} height={15} />
                </button>
                <button className="ui-icon-btn ui-row-action hover:!text-red-600" aria-label={`Xóa ${f.name}`} title="Xóa" onClick={() => p.onRemove(f.id)}>
                  <IconTrash width={15} height={15} />
                </button>
              </div>

              {/* Details of the selected sketch */}
              <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: selected ? '1fr' : '0fr' }}>
                <div className="overflow-hidden">
                  {selected && (
                    <div className="grid grid-cols-[1fr_auto] gap-2 px-2 pb-3 pt-1">
                      <label className="col-span-2">
                        <span className="ui-label">Tên (tên layer khi xuất)</span>
                        <input
                          key={f.name}
                          className="ui-input !py-1.5"
                          defaultValue={f.name}
                          onBlur={(e) => p.onUpdate(f.id, { name: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        />
                      </label>
                      <label>
                        <span className="ui-label">Nhãn chữ trên bản đồ</span>
                        <input
                          className="ui-input !py-1.5"
                          placeholder="Không có nhãn"
                          value={f.label ?? ''}
                          onChange={(e) => p.onUpdate(f.id, { label: e.target.value })}
                        />
                      </label>
                      <label>
                        <span className="ui-label">Cỡ (m)</span>
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          className="ui-input w-20 !py-1.5 tabular-nums"
                          value={f.labelSize ?? SKETCH_DEFAULT_LABEL_SIZE}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (v > 0) p.onUpdate(f.id, { labelSize: v });
                          }}
                        />
                      </label>
                      <div className="col-span-2 grid grid-cols-2 gap-2">
                        <button
                          className={`${p.editingId === f.id ? 'ui-btn-primary' : 'ui-btn'} !py-1.5 !text-xs`}
                          onClick={() => p.onEdit(p.editingId === f.id ? null : f.id)}
                        >
                          <IconNodes width={14} height={14} />
                          {p.editingId === f.id ? 'Xong sửa hình' : 'Sửa hình'}
                        </button>
                        <button className="ui-btn !py-1.5 !text-xs" onClick={() => p.onZoom(f.id)}>
                          <IconTarget width={14} height={14} />
                          Tới nét vẽ
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {(p.features.length > 0 || p.history.canUndo || p.history.canRedo) && (
        <div className="flex items-center gap-1 text-[11px] text-zinc-400">
          <button className="ui-icon-btn !h-7 !w-7" onClick={p.history.undo} disabled={!p.history.canUndo} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)">
            <IconUndo width={15} height={15} />
          </button>
          <button className="ui-icon-btn !h-7 !w-7" onClick={p.history.redo} disabled={!p.history.canRedo} aria-label="Làm lại" title="Làm lại (Ctrl+Y)">
            <IconRedo width={15} height={15} />
          </button>
          <span className="ml-1 mr-auto truncate">{p.sharedView
            ? p.sharedKind === 'session'
              ? 'Phiên .ldg — chưa lưu trên máy này'
              : 'Bản đồ chia sẻ — chưa lưu trên máy này'
            : 'Lưu tự động trên trình duyệt này'}</span>
          {confirmClear ? (
            <span className="flex items-center gap-1">
              <button className="ui-btn-ghost !text-red-600 hover:!bg-red-50" onClick={() => (p.onClearAll(), setConfirmClear(false))}>
                Xóa hết?
              </button>
              <button className="ui-btn-ghost" onClick={() => setConfirmClear(false)}>
                Không
              </button>
            </span>
          ) : (
            p.features.length > 0 && (
              <button className="ui-btn-ghost" onClick={() => setConfirmClear(true)}>
                <IconTrash width={13} height={13} />
                Xóa tất cả
              </button>
            )
          )}
        </div>
      )}

      {styleOpen && editing && (
        <LayerStyleEditor
          key={editing.id}
          anchor={styleOpen.el}
          title={editing.name}
          subtitle={editing.kind === 'line' ? 'Đường' : editing.kind === 'polygon' ? 'Vùng' : 'Điểm'}
          value={editing.style}
          defaultColor={SKETCH_DEFAULT_COLOR}
          features={{ line: editing.kind !== 'point', fill: editing.kind === 'polygon' }}
          onChange={(patch: LayerStyle) => p.onUpdate(editing.id, { style: { ...editing.style, ...patch, color: patch.color ?? editing.style.color } })}
          onReset={() =>
            p.onUpdate(editing.id, {
              style: {
                color: SKETCH_DEFAULT_COLOR,
                ...(editing.kind === 'line' ? { width: 3 } : editing.kind === 'polygon' ? { width: 2, fillOpacity: SKETCH_DEFAULT_FILL } : {}),
              },
            })
          }
          onClose={() => setStyleOpen(null)}
        />
      )}
    </div>
  );
}
