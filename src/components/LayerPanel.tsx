'use client';
import { useMemo, useState } from 'react';
import type { CadLayer, LayerStyle } from '@/lib/cad/types';
import { isEmptyStyle, type LayerStyles } from '@/lib/cad/style';
import { foldVietnamese } from '@/lib/geo';
import { IconBrush, IconEye, IconEyeOff, IconSearch } from './icons';
import LayerStyleEditor, { type StyleFeatures } from './LayerStyleEditor';

export type { LayerStyles };
/** `null` clears the style of the named layers. */
export type StylePatchHandler = (names: string[], patch: LayerStyle | null) => void;

type Open = { kind: 'layer'; name: string; el: HTMLElement } | { kind: 'bulk'; el: HTMLElement } | null;

function styleSummary(s: LayerStyle | undefined): string | undefined {
  if (isEmptyStyle(s) || !s) return undefined;
  const parts: string[] = [];
  if (s.color) parts.push(s.color);
  if (s.width !== undefined) parts.push(`${s.width}px`);
  if (s.dash && s.dash !== 'solid') parts.push(s.dash);
  if (s.fillOpacity !== undefined) parts.push(`tô ${Math.round(s.fillOpacity * 100)}%`);
  return parts.join(' · ');
}

export default function LayerPanel({
  layers,
  counts,
  kinds,
  visible,
  onChange,
  styles,
  onStyle,
}: {
  layers: CadLayer[];
  counts: Map<string, number>;
  /** Which style controls make sense per layer (has lines / has polygons). */
  kinds: Map<string, StyleFeatures>;
  visible: Set<string>;
  onChange: (next: Set<string>) => void;
  styles: LayerStyles;
  onStyle: StylePatchHandler;
}) {
  const [query, setQuery] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [open, setOpen] = useState<Open>(null);
  const [bulkDraft, setBulkDraft] = useState<LayerStyle>({});

  const filtered = useMemo(() => {
    const q = foldVietnamese(query);
    return layers.filter(
      (l) => (!hideEmpty || (counts.get(l.name) ?? 0) > 0) && (!q || foldVietnamese(l.name).includes(q)),
    );
  }, [layers, counts, query, hideEmpty]);

  const bulkTargets = useMemo(() => filtered.filter((l) => visible.has(l.name)).map((l) => l.name), [filtered, visible]);

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

  const openLayer = open?.kind === 'layer' ? layers.find((l) => l.name === open.name) : undefined;
  const bulkFeatures: StyleFeatures = {
    line: bulkTargets.some((n) => kinds.get(n)?.line),
    fill: bulkTargets.some((n) => kinds.get(n)?.fill),
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          className="ui-input border-transparent bg-zinc-100 pl-9 focus:bg-white"
          placeholder="Tìm layer (không cần dấu)"
          aria-label="Tìm layer"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-0.5 text-xs">
        <button className="ui-btn-ghost" onClick={() => setMany(true)}>
          Hiện tất cả
        </button>
        <button className="ui-btn-ghost" onClick={() => setMany(false)}>
          Ẩn tất cả
        </button>
        <button
          className="ui-btn-ghost ml-auto !text-blue-600 hover:!bg-blue-50 disabled:opacity-40"
          disabled={bulkTargets.length === 0}
          aria-label={`Áp dụng kiểu cho ${bulkTargets.length} layer`}
          onClick={(e) => {
            const el = e.currentTarget;
            if (open?.kind === 'bulk') return setOpen(null);
            setBulkDraft({});
            setOpen({ kind: 'bulk', el });
          }}
        >
          <IconBrush width={14} height={14} />
          Áp dụng cho {bulkTargets.length} layer
        </button>
      </div>

      <ul className="ui-scroll -mx-2 min-h-0 flex-1 overflow-y-auto px-1">
        {filtered.map((l, i) => {
          const on = visible.has(l.name);
          const st = styles[l.name];
          const styled = !isEmptyStyle(st);
          const isOpen = open?.kind === 'layer' && open.name === l.name;
          return (
            <li
              key={l.name}
              data-active={isOpen}
              className="ui-layer-row ui-row-in group flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-zinc-50 data-[active=true]:bg-zinc-50"
              style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }}
            >
              <button
                className="ui-icon-btn"
                role="switch"
                aria-checked={on}
                aria-label={`${on ? 'Ẩn' : 'Hiện'} layer ${l.name}`}
                onClick={() => toggle(l.name)}
                style={{ color: on ? '#0e1f3b' : '#d4d4d8' }}
              >
                {on ? <IconEye key="on" className="ui-eye-pop" /> : <IconEyeOff key="off" className="ui-eye-pop" />}
              </button>
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
                onClick={() => toggle(l.name)}
                tabIndex={-1}
                title={l.name}
              >
                <span
                  className={`h-3 w-3 shrink-0 rounded-full ring-1 transition-all ${
                    styled ? 'ring-2 ring-blue-500/70 ring-offset-1' : 'ring-zinc-900/10'
                  } ${on ? '' : 'opacity-40'}`}
                  style={{ background: st?.color ?? l.color }}
                />
                <span className={`min-w-0 flex-1 truncate text-[13px] transition-colors ${on ? 'text-zinc-800' : 'text-zinc-400'}`}>
                  {l.name}
                </span>
              </button>
              <span className="text-[11px] tabular-nums text-zinc-400">{(counts.get(l.name) ?? 0).toLocaleString('vi-VN')}</span>
              <button
                className="ui-icon-btn ui-row-action"
                aria-label={`Kiểu layer ${l.name}`}
                title={styleSummary(st) ?? 'Đổi màu, nét, vùng tô'}
                aria-expanded={isOpen}
                onClick={(e) => {
                  const el = e.currentTarget;
                  setOpen(isOpen ? null : { kind: 'layer', name: l.name, el });
                }}
              >
                <IconBrush width={15} height={15} />
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="px-3 py-8 text-center text-xs text-zinc-400">Không có layer phù hợp.</li>}
      </ul>

      <div className="flex items-center justify-between text-[11px] text-zinc-400">
        <span>
          Hiện {shownCount} · lọc {filtered.length}/{layers.length}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="ui-check" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Ẩn layer rỗng
        </label>
      </div>

      {open?.kind === 'layer' && openLayer && (
        <LayerStyleEditor
          key={openLayer.name}
          anchor={open.el}
          title={openLayer.name}
          subtitle={`${(counts.get(openLayer.name) ?? 0).toLocaleString('vi-VN')} đối tượng`}
          value={styles[openLayer.name] ?? {}}
          defaultColor={openLayer.color}
          features={kinds.get(openLayer.name) ?? { line: true, fill: false }}
          onChange={(patch) => onStyle([openLayer.name], patch)}
          onReset={() => onStyle([openLayer.name], null)}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'bulk' && (
        <LayerStyleEditor
          anchor={open.el}
          title={`Áp dụng cho ${bulkTargets.length} layer`}
          subtitle={query ? `Layer đang hiện khớp “${query}”` : 'Các layer đang hiện trong danh sách'}
          value={bulkDraft}
          features={bulkFeatures}
          onChange={(patch) => {
            setBulkDraft((d) => ({ ...d, ...patch }));
            onStyle(bulkTargets, patch);
          }}
          onReset={() => {
            setBulkDraft({});
            onStyle(bulkTargets, null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
