'use client';
// Open files stacked on the map: select, show/hide, opacity, zoom, order, remove.
import { useEffect, useRef, useState } from 'react';
import { ACCEPTED_EXT, ACCEPTED_HINT } from './FileDropzone';
import { IconAlert, IconArrowDown, IconArrowUp, IconExpand, IconEye, IconEyeOff, IconMore, IconPlus, IconTarget, IconTrash } from './icons';
import { toast } from './toast';
import { useFileAccept } from './useFileAccept';

export interface FileRowData {
  id: string;
  name: string;
  /** Colour tag. */
  tag: string;
  status: 'parsing' | 'transforming' | 'ready' | 'error';
  progress: { stage: string; percent: number } | null;
  shown: boolean;
  opacity: number;
  /** Short line under the name (counts) or an error. */
  subtitle?: string;
  /** CRS was chosen automatically for a file added afterwards and awaits the user's confirmation. */
  needsConfirm?: boolean;
}

const LEAVE_MS = 260;

function Row({
  row,
  active,
  first,
  last,
  leaving,
  onSelect,
  onToggle,
  onOpacity,
  onZoom,
  onMove,
  onRemove,
}: {
  row: FileRowData;
  active: boolean;
  first: boolean;
  last: boolean;
  leaving: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onOpacity: (v: number) => void;
  onZoom: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const pct = Math.round(row.opacity * 100);
  const busy = row.status === 'parsing' || row.status === 'transforming';
  return (
    <li className="ui-file-row" data-leaving={leaving}>
      <div className="ui-file-row-inner p-0.5">
        <div
          className={`rounded-xl px-2.5 py-2 transition-colors ${
            active ? 'bg-blue-50/60 ring-1 ring-blue-500/30' : 'hover:bg-zinc-50'
          }`}
          data-active={active}
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ background: row.tag }} aria-hidden />
            <button
              className="min-w-0 flex-1 text-left"
              onClick={onSelect}
              aria-current={active ? 'true' : undefined}
              title={`${row.name} — chọn để chỉnh layer / tọa độ / xuất`}
            >
              <span className="block truncate text-[13px] font-medium text-zinc-900">{row.name}</span>
              <span className={`block truncate text-[11px] ${row.status === 'error' ? 'text-red-600' : 'text-zinc-500'}`}>
                {busy && row.progress ? `${row.progress.stage} · ${Math.round(row.progress.percent)}%` : (row.subtitle ?? '')}
              </span>
            </button>
            {row.needsConfirm && (
              <span className="ui-chip !bg-amber-50 !text-amber-700" title="Kiểm tra hệ tọa độ của file này">
                <IconAlert width={11} height={11} />
                tọa độ
              </span>
            )}
            <button
              className="ui-icon-btn"
              aria-pressed={row.shown}
              aria-label={row.shown ? `Ẩn ${row.name}` : `Hiện ${row.name}`}
              title={row.shown ? 'Ẩn file' : 'Hiện file'}
              onClick={onToggle}
            >
              <span key={String(row.shown)} className="ui-eye-pop flex">
                {row.shown ? <IconEye width={16} height={16} /> : <IconEyeOff width={16} height={16} />}
              </span>
            </button>
            <button
              className={`ui-icon-btn ${menu ? '!bg-zinc-100 !text-zinc-900' : ''}`}
              aria-expanded={menu}
              aria-label={`Thao tác với ${row.name}`}
              title="Thao tác"
              onClick={() => setMenu((m) => !m)}
            >
              <IconMore width={16} height={16} />
            </button>
          </div>
          {busy ? (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full rounded-full bg-zinc-900 transition-[width]" style={{ width: `${Math.max(3, row.progress?.percent ?? 8)}%` }} />
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2 pl-[18px]">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct}
                className="ui-range"
                style={{ ['--p' as string]: `${pct}%` }}
                aria-label={`Độ trong suốt ${row.name}`}
                onChange={(e) => onOpacity(Number(e.target.value) / 100)}
              />
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">{pct}%</span>
            </div>
          )}
          <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: menu ? '1fr' : '0fr' }}>
            <div className="overflow-hidden" inert={!menu}>
              <div className="flex flex-wrap gap-1 pt-2 pl-[18px]">
                <button className="ui-btn-ghost" disabled={!row.shown} onClick={() => (setMenu(false), onZoom())}>
                  <IconTarget width={13} height={13} />
                  Tới file
                </button>
                <button className="ui-btn-ghost disabled:opacity-30" disabled={first} onClick={() => onMove(-1)} title="Đưa lên trên (vẽ đè lên các file dưới)">
                  <IconArrowUp width={13} height={13} />
                  Lên
                </button>
                <button className="ui-btn-ghost disabled:opacity-30" disabled={last} onClick={() => onMove(1)} title="Đưa xuống dưới">
                  <IconArrowDown width={13} height={13} />
                  Xuống
                </button>
                <button className="ui-btn-ghost !text-red-600 hover:!bg-red-50" onClick={onRemove}>
                  <IconTrash width={13} height={13} />
                  Xóa file
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function FileList({
  rows,
  activeId,
  busy,
  onSelect,
  onToggle,
  onOpacity,
  onZoom,
  onMove,
  onRemove,
  onAdd,
  onFitAll,
}: {
  rows: FileRowData[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onOpacity: (id: string, v: number) => void;
  onZoom: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: (files: File[]) => void;
  onFitAll: () => void;
}) {
  const fileAccept = useFileAccept();
  const inputRef = useRef<HTMLInputElement>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const remove = (id: string) => {
    setLeaving((s) => new Set(s).add(id));
    timers.current.push(
      setTimeout(() => {
        onRemove(id);
        setLeaving((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }, LEAVE_MS),
    );
  };

  return (
    <section className="mx-4 mb-3" aria-label="Các file đang mở">
      <div className="mb-1 flex items-center gap-0.5">
        <h2 className="ui-label !mb-0 flex-1">
          Bản vẽ <span className="ui-chip ml-1 !normal-case">{rows.length}</span>
        </h2>
        {rows.length > 1 && (
          <button className="ui-btn-ghost" onClick={onFitAll} title="Thu phóng để thấy mọi file đang hiện">
            <IconExpand width={13} height={13} />
            Xem tất cả
          </button>
        )}
        <button className="ui-btn-ghost !text-blue-600 hover:!bg-blue-50" onClick={() => inputRef.current?.click()} title="Thêm file chồng lên bản đồ (hoặc kéo thả vào bản đồ)">
          <IconPlus width={13} height={13} />
          Thêm file
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={fileAccept}
          className="hidden"
          aria-label="Thêm file bản vẽ"
          data-testid="add-file-input"
          onChange={(e) => {
            const all = Array.from(e.target.files ?? []);
            const fs = all.filter((f) => ACCEPTED_EXT.test(f.name));
            // Phones pick any file (see useFileAccept): say why the others were skipped.
            if (fs.length < all.length) toast.error(ACCEPTED_HINT);
            if (fs.length) onAdd(fs);
            e.target.value = '';
          }}
        />
      </div>
      <ul className="ui-scroll -mx-1 flex max-h-[212px] flex-col overflow-y-auto px-1" aria-busy={busy}>
        {rows.map((r, i) => (
          <Row
            key={r.id}
            row={r}
            active={r.id === activeId}
            first={i === 0}
            last={i === rows.length - 1}
            leaving={leaving.has(r.id)}
            onSelect={() => onSelect(r.id)}
            onToggle={() => onToggle(r.id)}
            onOpacity={(v) => onOpacity(r.id, v)}
            onZoom={() => onZoom(r.id)}
            onMove={(d) => onMove(r.id, d)}
            onRemove={() => remove(r.id)}
          />
        ))}
      </ul>
    </section>
  );
}
