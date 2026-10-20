'use client';
// "Chọn và xóa" on the map page: a button next to the measuring tools, and the bar shown while selecting — pick
// objects by clicking or sweep a box (CAD style), then delete, reshape (edit the vertices) or undo.
import { IconPen, IconRedo, IconSelect, IconTrash, IconUndo, IconX } from './icons';

export type SelectMode = 'off' | 'on';

export function SelectToolButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      className={`ui-floating ui-drop-in flex h-10 w-10 items-center justify-center transition ${active ? '!bg-blue-600 !text-white' : 'text-zinc-700'}`}
      style={{ animationDelay: '0.45s' }}
      aria-label="Chọn và xóa đối tượng"
      aria-pressed={active}
      title={active ? 'Thoát chế độ chọn' : 'Chọn nhiều đối tượng, quét khung, xóa hoặc sửa hình'}
      onClick={onToggle}
    >
      <IconSelect width={19} height={19} />
    </button>
  );
}

export function SelectBar({
  counts,
  canReshape,
  reshapeHint,
  onDelete,
  onReshape,
  onClearSelection,
  onDone,
  sweepTarget,
  onSweepTarget,
  gripCount,
  gripsCapped,
  history,
  insetLeft,
}: {
  counts: { sketches: number; objects: number; total: number };
  canReshape: boolean;
  reshapeHint: string;
  onDelete: () => void;
  onReshape: () => void;
  onClearSelection: () => void;
  onDone: () => void;
  /** What a box sweep selects: whole objects, or the vertices of the selected objects. */
  sweepTarget: 'object' | 'vertex';
  onSweepTarget: (t: 'object' | 'vertex') => void;
  /** Vertices selected / too many vertices to show them. */
  gripCount: number;
  gripsCapped: boolean;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  insetLeft: number;
}) {
  const n = (v: number) => v.toLocaleString('vi-VN');
  return (
    <div
      className="ui-floating ui-pop-in absolute bottom-14 z-20 flex -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-2xl p-1.5 text-xs text-zinc-600"
      style={{ left: `calc(${insetLeft}px + (100% - ${insetLeft}px) / 2)`, maxWidth: `calc(100% - ${insetLeft + 24}px)` }}
      role="status"
    >
      {counts.total > 0 && (
        <div className="ui-segment" role="group" aria-label="Kéo khung chọn" title="Kéo khung để chọn đối tượng, hoặc các đỉnh của đối tượng đã chọn">
          <button className="whitespace-nowrap" aria-pressed={sweepTarget === 'object'} onClick={() => onSweepTarget('object')}>
            Đối tượng
          </button>
          <button className="whitespace-nowrap" aria-pressed={sweepTarget === 'vertex'} onClick={() => onSweepTarget('vertex')}>
            Đỉnh
          </button>
        </div>
      )}
      <span
        className="px-1 tabular-nums"
        title="Bấm để chọn · kéo khung để quét (trái → phải: nằm trọn, phải → trái: chạm) · ô vuông là đỉnh: kéo để di chuyển (Shift thêm) · chuột giữa kéo bản đồ · Delete xóa · Esc bỏ chọn"
      >
        <b className="font-semibold text-zinc-900">{n(counts.total)}</b> đã chọn
        {gripCount > 0 && (
          <>
            {' · '}
            <b className="font-semibold text-red-600">{n(gripCount)}</b> đỉnh
          </>
        )}
      </span>
      {counts.total > 0 && (
        <button className="ui-icon-btn !h-7 !w-7" onClick={onClearSelection} aria-label="Bỏ chọn" title={gripCount > 0 ? 'Bỏ chọn các đỉnh (Esc)' : 'Bỏ chọn (Esc)'}>
          <IconX width={13} height={13} />
        </button>
      )}
      <span className="mx-0.5 hidden h-5 w-px bg-zinc-200 sm:block" aria-hidden />
      <button
        className="ui-btn !px-2.5 !py-1 !text-[12px] text-red-600 disabled:opacity-40"
        disabled={!counts.total}
        onClick={onDelete}
        title={gripCount > 0 ? 'Xóa các đỉnh đã chọn (Delete)' : 'Xóa các đối tượng đã chọn (Delete)'}
      >
        <IconTrash width={13} height={13} />
        {gripCount > 0 ? `Xóa ${n(gripCount)} đỉnh` : `Xóa${counts.total ? ` ${n(counts.total)}` : ''}`}
      </button>
      <button className="ui-icon-btn !h-7 !w-7 disabled:opacity-40" disabled={!canReshape} onClick={onReshape} aria-label="Sửa hình" title={canReshape ? 'Sửa hình: kéo đỉnh, thêm hoặc xóa đỉnh' : reshapeHint}>
        <IconPen width={14} height={14} />
      </button>
      <button className="ui-icon-btn !h-7 !w-7" onClick={history.undo} disabled={!history.canUndo} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)">
        <IconUndo width={15} height={15} />
      </button>
      <button className="ui-icon-btn !h-7 !w-7" onClick={history.redo} disabled={!history.canRedo} aria-label="Làm lại" title="Làm lại (Ctrl+Y)">
        <IconRedo width={15} height={15} />
      </button>
      <button className="ui-btn-primary !px-3 !py-1 !text-[12px]" onClick={onDone}>
        Xong
      </button>
      {gripsCapped && <p className="basis-full px-1 text-[11.5px] text-amber-700">Quá nhiều đỉnh để hiện — chọn ít đối tượng hơn.</p>}
    </div>
  );
}
