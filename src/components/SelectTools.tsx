'use client';
// "Chọn và xóa" on the map page: a button next to the measuring tools, and the bar shown while selecting — pick
// objects by clicking or sweep a box (CAD style), then delete, reshape (edit the vertices) or undo.
import { IconPen, IconRedo, IconSelect, IconTrash, IconUndo } from './icons';

export type SelectMode = 'off' | 'click' | 'sweep';

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
  mode,
  onMode,
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
  mode: Exclude<SelectMode, 'off'>;
  onMode: (m: Exclude<SelectMode, 'off'>) => void;
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
  return (
    <div
      className="ui-floating ui-pop-in absolute bottom-14 z-20 flex -translate-x-1/2 flex-col gap-1.5 rounded-2xl p-2 text-xs text-zinc-600"
      style={{ left: `calc(${insetLeft}px + (100% - ${insetLeft}px) / 2)`, maxWidth: `calc(100% - ${insetLeft + 24}px)` }}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="ui-segment" role="group" aria-label="Cách chọn">
          <button className="whitespace-nowrap" aria-pressed={mode === 'click'} onClick={() => onMode('click')}>
            Bấm chọn
          </button>
          <button className="whitespace-nowrap" aria-pressed={mode === 'sweep'} onClick={() => onMode('sweep')}>
            Quét khung
          </button>
        </div>
        <span className="tabular-nums">
          Đã chọn <b className="font-semibold text-zinc-900">{counts.total.toLocaleString('vi-VN')}</b>
          {counts.total > 0 && counts.sketches > 0 && counts.objects > 0 && (
            <span className="text-zinc-400">
              {' '}
              ({counts.sketches} nét vẽ, {counts.objects.toLocaleString('vi-VN')} đối tượng file)
            </span>
          )}
        </span>
        {gripCount > 0 && (
          <span className="tabular-nums">
            <b className="font-semibold text-red-600">{gripCount.toLocaleString('vi-VN')}</b> đỉnh
          </span>
        )}
        {counts.total > 0 && (
          <button className="ui-btn-ghost !px-2 !py-1 !text-[12px]" onClick={onClearSelection} title={gripCount > 0 ? 'Bỏ chọn các đỉnh (Esc)' : 'Bỏ chọn (Esc)'}>
            {gripCount > 0 ? 'Bỏ chọn đỉnh' : 'Bỏ chọn'}
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button className="ui-icon-btn !h-7 !w-7" onClick={history.undo} disabled={!history.canUndo} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)">
            <IconUndo width={15} height={15} />
          </button>
          <button className="ui-icon-btn !h-7 !w-7" onClick={history.redo} disabled={!history.canRedo} aria-label="Làm lại" title="Làm lại (Ctrl+Y)">
            <IconRedo width={15} height={15} />
          </button>
        </span>
      </div>
      {mode === 'sweep' && counts.total > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-zinc-500">Quét để chọn</span>
          <div className="ui-segment" role="group" aria-label="Quét chọn">
            <button className="whitespace-nowrap" aria-pressed={sweepTarget === 'object'} onClick={() => onSweepTarget('object')}>
              Đối tượng
            </button>
            <button className="whitespace-nowrap" aria-pressed={sweepTarget === 'vertex'} onClick={() => onSweepTarget('vertex')}>
              Đỉnh
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className="ui-btn !px-2.5 !py-1 !text-[12px] text-red-600 disabled:opacity-40"
          disabled={!counts.total}
          onClick={onDelete}
          title={gripCount > 0 ? 'Xóa các đỉnh đã chọn (phím Delete)' : 'Xóa các đối tượng đã chọn (phím Delete)'}
        >
          <IconTrash width={13} height={13} />
          {gripCount > 0 ? `Xóa ${gripCount.toLocaleString('vi-VN')} đỉnh` : `Xóa${counts.total ? ` ${counts.total.toLocaleString('vi-VN')}` : ''}`}
          <kbd className="rounded border border-red-200 bg-red-50 px-1 font-sans text-[10.5px] font-medium text-red-600">Delete</kbd>
        </button>
        <button className="ui-btn !px-2.5 !py-1 !text-[12px] disabled:opacity-40" disabled={!canReshape} onClick={onReshape} title={canReshape ? 'Kéo đỉnh, thêm hoặc xóa đỉnh' : reshapeHint}>
          <IconPen width={13} height={13} />
          Sửa hình
        </button>
        <button className="ui-btn-primary ml-auto !px-3 !py-1 !text-[12px]" onClick={onDone}>
          Xong
        </button>
      </div>
      <p className="hidden text-[11.5px] leading-snug text-zinc-500 sm:block">
        {gripsCapped
          ? 'Đã chọn quá nhiều đối tượng để hiện từng đỉnh — chọn ít hơn để di chuyển đỉnh.'
          : mode === 'click'
            ? 'Bấm đối tượng để chọn / bỏ chọn. Ô vuông trên đối tượng là đỉnh: bấm để chọn (Shift thêm), kéo để di chuyển — tự hút vào đỉnh và trung điểm. Delete = xóa, Esc = bỏ chọn.'
            : sweepTarget === 'vertex'
              ? 'Kéo khung quanh các đỉnh (ô vuông) của đối tượng đã chọn để chọn chúng, rồi chuyển sang "Bấm chọn" để kéo.'
              : 'Kéo khung: trái → phải chọn đối tượng nằm trọn trong khung, phải → trái chọn cả đối tượng chạm khung. Kéo tiếp để chọn thêm, cuộn chuột để phóng to.'}
      </p>
    </div>
  );
}
