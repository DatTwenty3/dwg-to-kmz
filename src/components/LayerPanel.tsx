'use client';
import { useMemo, useState } from 'react';
import type { CadLayer } from '@/lib/cad/types';
import { foldVietnamese } from '@/lib/geo';
import { IconSearch } from './icons';

export default function LayerPanel({
  layers,
  counts,
  visible,
  onChange,
}: {
  layers: CadLayer[];
  counts: Map<string, number>;
  visible: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const filtered = useMemo(() => {
    const q = foldVietnamese(query);
    return layers.filter(
      (l) => (!hideEmpty || (counts.get(l.name) ?? 0) > 0) && (!q || foldVietnamese(l.name).includes(q)),
    );
  }, [layers, counts, query, hideEmpty]);

  const setMany = (show: boolean) => {
    const next = new Set(visible);
    for (const l of filtered) {
      if (show) next.add(l.name);
      else next.delete(l.name);
    }
    onChange(next);
  };
  const toggle = (name: string) => {
    const next = new Set(visible);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };
  const shownCount = layers.filter((l) => visible.has(l.name) && (counts.get(l.name) ?? 0) > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          className="ui-input pl-9"
          placeholder="Tìm layer (không cần dấu)"
          aria-label="Tìm layer"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-1 text-xs">
        <button className="ui-btn-ghost" onClick={() => setMany(true)}>
          Hiện tất cả
        </button>
        <button className="ui-btn-ghost" onClick={() => setMany(false)}>
          Ẩn tất cả
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-zinc-500">
          <input type="checkbox" className="ui-check" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Ẩn layer rỗng
        </label>
      </div>
      <ul className="ui-scroll -mx-2 max-h-[38vh] overflow-y-auto">
        {filtered.map((l) => {
          const on = visible.has(l.name);
          return (
            <li key={l.name}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-zinc-50">
                <input type="checkbox" className="ui-check" checked={on} onChange={() => toggle(l.name)} />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-zinc-900/10"
                  style={{ background: l.color }}
                  title={l.color}
                />
                <span className={`min-w-0 flex-1 truncate text-[13px] ${on ? 'text-zinc-800' : 'text-zinc-400'}`} title={l.name}>
                  {l.name}
                </span>
                <span className="text-[11px] tabular-nums text-zinc-400">{(counts.get(l.name) ?? 0).toLocaleString('vi-VN')}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-zinc-400">
        Đang hiện {shownCount} layer có đối tượng · lọc {filtered.length}/{layers.length}
      </p>
    </div>
  );
}
