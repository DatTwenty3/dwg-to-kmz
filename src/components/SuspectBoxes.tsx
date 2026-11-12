'use client';
// The rectangles that look like the box of a label without being the exact boundary of an MTEXT, gathered in one list: the user
// clicks one to see it on the map, ticks the ones that are not parcels and deletes them (they are left out of the export;
// Hoàn lại puts them back). Nothing in this list is left out by itself.
import { useMemo, useState } from 'react';
import { SUSPECT_WHY_LABEL, type SuspectWhy } from '@/lib/dwg2gdb';
import { IconTrash, IconUndo, IconX } from './icons';

export interface SuspectItem {
  /** `<drawing id>|<index>` */
  key: string;
  drawing: string;
  drawingName: string;
  index: number;
  layer: string;
  /** The text the rectangle is sized for / holds ("" if it was found through another suspect). */
  text: string;
  why: SuspectWhy;
  w: number;
  h: number;
  /** Already deleted (left out of the export). */
  excluded: boolean;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');
const size = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { maximumFractionDigits: 1 }));

export default function SuspectBoxes({
  items,
  activeDrawing,
  focusKey,
  onFocus,
  onDelete,
  onRestore,
  onClose,
}: {
  items: SuspectItem[];
  /** The drawing shown on the map (the list can be limited to it). */
  activeDrawing: string | null;
  focusKey: string | null;
  onFocus: (item: SuspectItem) => void;
  onDelete: (items: SuspectItem[]) => void;
  onRestore: (items: SuspectItem[]) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<'here' | 'all'>('all');
  const [why, setWhy] = useState<SuspectWhy | ''>('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const shown = useMemo(
    () => items.filter((it) => (scope === 'all' || it.drawing === activeDrawing) && (!why || it.why === why)),
    [items, scope, why, activeDrawing],
  );
  const reasons = useMemo(() => [...new Set(items.map((i) => i.why))], [items]);
  const kept = shown.filter((i) => !i.excluded);
  const gone = shown.filter((i) => i.excluded);
  const tickedKept = kept.filter((i) => ticked.has(i.key));
  const toggle = (k: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <section className="ui-floating ui-pop-in flex max-h-[min(34rem,calc(100vh-7rem))] w-full flex-col overflow-hidden" aria-label="Ô chữ nhật nghi ngờ">
      <header className="flex items-start gap-2 border-b border-zinc-100 p-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-zinc-900">
            Ô chữ nhật nghi ngờ <span className="font-normal text-zinc-500">· {fmt(kept.length)} còn / {fmt(items.length)}</span>
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">
            Hình chữ nhật có vẻ là khung quanh nhãn tên nhưng chưa chắc: bấm một dòng để xem trên bản đồ, đánh dấu những ô không phải thửa đất rồi xóa. Chưa ô nào bị bỏ nếu bạn chưa xóa.
          </p>
        </div>
        <button className="ui-icon-btn shrink-0" onClick={onClose} aria-label="Đóng danh sách" title="Đóng">
          <IconX width={15} height={15} />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-2.5 py-2">
        <div className="ui-segment" role="group" aria-label="Phạm vi">
          <button className="whitespace-nowrap" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Cả hồ sơ
          </button>
          <button className="whitespace-nowrap" aria-pressed={scope === 'here'} onClick={() => setScope('here')} disabled={!activeDrawing}>
            Bản vẽ đang xem
          </button>
        </div>
        {reasons.length > 1 && (
          <select className="ui-input !py-1 text-[12px]" value={why} onChange={(e) => setWhy(e.target.value as SuspectWhy | '')} aria-label="Lọc theo lý do">
            <option value="">Mọi lý do</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {SUSPECT_WHY_LABEL[r]}
              </option>
            ))}
          </select>
        )}
      </div>

      <ul className="ui-scroll min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto">
        {shown.length === 0 && <li className="px-4 py-8 text-center text-[12.5px] text-zinc-400">Không có ô nghi ngờ nào trong phạm vi này.</li>}
        {shown.map((it) => (
          <li key={it.key} className={`flex items-start gap-2 px-2.5 py-1.5 ${focusKey === it.key ? 'bg-amber-50' : 'hover:bg-zinc-50'}`}>
            <input
              type="checkbox"
              className="ui-check mt-1 shrink-0"
              checked={ticked.has(it.key)}
              onChange={() => toggle(it.key)}
              aria-label={`Chọn ô ${it.text || it.layer}`}
              disabled={it.excluded}
            />
            <button className="min-w-0 flex-1 text-left" onClick={() => onFocus(it)} title="Xem ô này trên bản đồ">
              <span className={`block truncate text-[12.5px] font-medium ${it.excluded ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>
                {it.text || '(không có chữ riêng)'}
              </span>
              <span className="block truncate text-[11px] text-zinc-500">
                {it.drawingName} · {it.layer} · {size(it.w)} × {size(it.h)} m · {SUSPECT_WHY_LABEL[it.why]}
              </span>
            </button>
            {it.excluded && <span className="mt-0.5 shrink-0 rounded-full bg-red-50 px-1.5 text-[10.5px] font-semibold text-red-600">đã xóa</span>}
          </li>
        ))}
      </ul>

      <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-100 p-2.5">
        <button className="ui-btn-ghost !px-2 !py-1 !text-[12px]" onClick={() => setTicked(new Set([...ticked, ...kept.map((i) => i.key)]))} disabled={!kept.length}>
          Chọn tất cả ({fmt(kept.length)})
        </button>
        <button className="ui-btn-ghost !px-2 !py-1 !text-[12px]" onClick={() => setTicked(new Set())} disabled={!ticked.size}>
          Bỏ chọn
        </button>
        <span className="flex-1" />
        {gone.length > 0 && (
          <button className="ui-btn-ghost !px-2 !py-1 !text-[12px]" onClick={() => onRestore(gone)} title="Đưa các ô đã xóa trong danh sách này trở lại">
            <IconUndo width={13} height={13} /> Hoàn lại {fmt(gone.length)}
          </button>
        )}
        <button
          className="ui-btn-primary !bg-red-600 !px-3 !py-1 !text-[12px] hover:!bg-red-700"
          onClick={() => {
            onDelete(tickedKept);
            setTicked(new Set());
          }}
          disabled={!tickedKept.length}
        >
          <IconTrash width={13} height={13} /> Xóa {fmt(tickedKept.length)} ô đã chọn
        </button>
      </footer>
    </section>
  );
}
