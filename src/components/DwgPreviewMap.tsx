'use client';
// Map of "Bóc tách DWG → TT16": one drawing (inside the planning boundary, already in WGS84) on Google satellite.
// Layers that go to the geodatabase are drawn normally, the others dimmed, the layer selected in the mapping table
// on top; clicking an object selects its layer in the table. The red outline is the planning boundary.
//
// "Biên tập": objects of the mapped layers can be picked (click) or boxed (a CAD-style selection rectangle:
// left → right = wholly inside, right → left = touching) and left
// out of the export — stray hatches, legend leftovers, an old map's patches. Removed objects disappear from the map
// (Hoàn tác / "Khôi phục tất cả" bring them back); every change can be undone.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { robustBBox } from '@/lib/cad/normalize/bbox';
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { BOUNDARY_LAYER, previewIndex } from '@/lib/dwg2gdb/inventory';
import { sweepSelect } from '@/lib/dwg2gdb/sweep';
import { basemapPaper, buildLayers, DEFAULT_BASEMAP_ID, DEFAULT_FONT_FAMILY, documentBounds } from '@/lib/map';
import EntityPopup from './EntityPopup';
import { IconPen, IconSpinner, IconTrash, IconUndo, IconX } from './icons';
import { loadTextFont } from './mapFont';
import type { MapPick } from './MapView';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="ui-skeleton h-full w-full" aria-busy />,
});

const PICKED = '__selected';
const fmt = (n: number) => n.toLocaleString('vi-VN');

/** The objects of `doc` with these indexes, recoloured on one layer (removed: red ghost, selected: amber). */
function overlayDoc(doc: CadDocument, keep: (i: number) => boolean, layer: string, color: string): CadDocument | null {
  const entities: CadEntity[] = [];
  for (const e of doc.entities) {
    const i = previewIndex(e.handle);
    if (i !== null && keep(i)) entities.push(e.kind === 'polygon' ? { ...e, layer, color, fillOpacity: 0.3 } : { ...e, layer, color });
  }
  return entities.length ? { ...doc, entities, layers: [{ name: layer, color, visible: true }] } : null;
}

export default function DwgPreviewMap({
  doc,
  used,
  focusLayer,
  focusColor = null,
  onPickLayer,
  loading,
  note,
  excluded,
  onExclude,
  onRestore,
  undo,
  loadingText,
  editMode,
  onEditMode,
  views,
  view,
  onView,
  insetLeft = 0,
  insetRight = 0,
  insetTop = 0,
}: {
  doc: CadDocument | null;
  /** Layers that go to the geodatabase (drawn at full strength). */
  used: Set<string>;
  /** Layer selected in the table: drawn on top and zoomed to. */
  focusLayer: string | null;
  /** '#rrggbb': the selected row is one colour group of the layer — only its hatches are drawn. */
  focusColor?: string | null;
  /** `color` = colour of the object clicked (picks the colour group of the layer). */
  onPickLayer: (layer: string, color: string) => void;
  loading: boolean;
  /** Message over the map (error, "only mapped layers shown"…). */
  note?: string | null;
  /** Objects of this drawing left out of the export (indexes in the drawing). */
  excluded: Set<number>;
  onExclude: (indexes: number[]) => void;
  /** Put objects back (null = all of this drawing). */
  onRestore: (indexes: number[] | null) => void;
  undo: { can: boolean; run: () => void };
  /** Spinner text while `loading` (default: drawing the drawing). */
  loadingText?: string;
  /** "Biên tập" on (controlled: the page swaps `doc` for what the geodatabases will get). */
  editMode: boolean;
  onEditMode: (on: boolean) => void;
  /** Geodatabases to look at while editing (QuyHoach.gdb, HienTrang.gdb…) with their feature counts. */
  views: { id: string; label: string; count: number }[];
  view: string;
  onView: (id: string) => void;
  /** Widths (px) covered by the page's floating panels over the map. */
  insetLeft?: number;
  insetRight?: number;
  insetTop?: number;
}) {
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP_ID);
  const [font, setFont] = useState({ family: DEFAULT_FONT_FAMILY, ready: false });
  const [pick, setPick] = useState<MapPick | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    let alive = true;
    loadTextFont().then((family) => alive && setFont({ family, ready: true }));
    return () => {
      alive = false;
    };
  }, []);

  // Another drawing: start with nothing selected (adjust state during render, not in an effect).
  const [seenDoc, setSeenDoc] = useState(doc);
  if (seenDoc !== doc) {
    setSeenDoc(doc);
    setSelected(new Set());
    setPick(null);
  }

  const layers = useMemo(() => {
    if (!doc) return [];
    const opts = { fontFamily: font.family, showText: font.ready, highlightHandle: pick?.ref.entity.handle, paper: basemapPaper(basemapId) };
    // Removed and selected objects are drawn only by their overlays.
    const hidden = (e: CadEntity) => {
      const i = previewIndex(e.handle);
      return i !== null && (excluded.has(i) || selected.has(i));
    };
    const otherColor = (e: CadEntity) => !!focusColor && e.layer === focusLayer && e.kind === 'polygon' && e.color.toLowerCase() !== focusColor;
    const base = excluded.size || selected.size || focusColor ? { ...doc, entities: doc.entities.filter((e) => !hidden(e) && !otherColor(e)) } : doc;
    const all = doc.layers.map((l) => l.name);
    const strong = new Set(all.filter((n) => used.has(n) || n === BOUNDARY_LAYER));
    const weak = new Set(all.filter((n) => !strong.has(n)));
    const picked = overlayDoc(doc, (i) => selected.has(i), PICKED, '#f59e0b');
    // A layer is selected: only it (and the red planning boundary, kept for orientation) is drawn; the other
    // layers are hidden until it is deselected.
    const focus = focusLayer && all.includes(focusLayer) ? focusLayer : null;
    const shown = focus ? new Set([focus, ...(strong.has(BOUNDARY_LAYER) ? [BOUNDARY_LAYER] : [])]) : null;
    return [
      ...(shown ? [] : buildLayers(base, { ...opts, visibleLayers: weak, idPrefix: 'weak:', opacity: 0.25 })),
      ...buildLayers(base, { ...opts, visibleLayers: shown ?? strong, idPrefix: 'used:' }),
      ...(picked ? buildLayers(picked, { ...opts, visibleLayers: new Set([PICKED]), idPrefix: 'picked:' }) : []),
    ];
  }, [doc, used, focusLayer, focusColor, font, pick, excluded, selected, basemapId]);

  // Zoom to the drawing, then to the selected layer.
  const fit = useMemo(() => {
    if (!doc) return undefined;
    const entities = focusLayer ? doc.entities.filter((e) => e.layer === focusLayer && (!focusColor || e.kind !== 'polygon' || e.color.toLowerCase() === focusColor)) : doc.entities;
    const bounds = entities.length ? documentBounds({ ...doc, entities, bbox: robustBBox(entities) }) : null;
    const key = `${doc.entities.length}|${doc.bbox.flat().join(',')}|${focusLayer ?? ''}|${focusColor ?? ''}`;
    let seq = 0;
    for (let i = 0; i < key.length; i++) seq = (seq * 31 + key.charCodeAt(i)) | 0;
    return bounds ? { bounds: bounds as [Vec2, Vec2], seq } : undefined;
  }, [doc, focusLayer, focusColor]);

  const toggle = (indexes: number[], add?: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const i of indexes) {
        if (add ?? !next.has(i)) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  // Layers of the edit view with their objects still kept: a whole layer is taken out (or put back) in one click.
  const [layersOpen, setLayersOpen] = useState(false);
  const layerCounts = useMemo(() => {
    if (!doc || !editMode) return [];
    const by = new Map<string, { all: number[]; kept: number }>();
    const seenHandle = new Set<string>();
    for (const e of doc.entities) {
      const i = previewIndex(e.handle);
      if (i === null || (e.handle && seenHandle.has(e.handle))) continue;
      if (e.handle) seenHandle.add(e.handle);
      const row = by.get(e.layer) ?? { all: [], kept: 0 };
      row.all.push(i);
      if (!excluded.has(i)) row.kept++;
      by.set(e.layer, row);
    }
    return [...by].map(([name, r]) => ({ name, all: r.all, kept: r.kept })).sort((a, b) => b.all.length - a.all.length);
  }, [doc, editMode, excluded]);
  const selList = [...selected];
  const toRemove = selList.filter((i) => !excluded.has(i));
  const remove = () => {
    if (!toRemove.length) return;
    onExclude(toRemove);
    setSelected(new Set());
  };
  const exit = () => {
    onEditMode(false);
    setSelected(new Set());
  };

  // Delete (or Backspace) removes the selection, Esc clears it, Ctrl+Z undoes — in both tools.
  useEffect(() => {
    if (!editMode) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        if (toRemove.length) {
          onExclude(toRemove);
          setSelected(new Set());
        }
      } else if (ev.key === 'Escape') setSelected(new Set());
      else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && undo.can) {
        ev.preventDefault();
        undo.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, toRemove, onExclude, undo]);

  const popup = pick && !editMode ? { lngLat: pick.lngLat, content: <EntityPopup pick={pick.ref} onClose={() => setPick(null)} /> } : null;
  const selectable = (p: MapPick) => {
    const i = previewIndex(p.ref.entity.handle);
    return i !== null && (used.has(p.ref.layer) || p.ref.layer === PICKED) && !excluded.has(i) ? i : null;
  };

  return (
    <div className="relative h-full w-full bg-zinc-200" style={{ '--map-il': `${insetLeft}px`, '--map-ir': `${insetRight}px`, '--map-it': `${insetTop}px` } as React.CSSProperties}>
      <MapView
        insetLeft={insetLeft}
        insetRight={insetRight}
        insetTop={insetTop}
        basemapId={basemapId}
        onBasemapChange={setBasemapId}
        layers={layers}
        fit={fit}
        fontFamily={font.family}
        loading={loading}
        popup={popup}
        compact
        onBoxSelect={editMode && doc ? (ring, crossing) => toggle(sweepSelect(doc, ring, used, crossing), true) : null}
        onPick={(p) => {
          if (editMode) {
            const i = p ? selectable(p) : null;
            if (i !== null) toggle([i]);
            return;
          }
          setPick(p);
          if (p && p.ref.layer !== BOUNDARY_LAYER) onPickLayer(p.ref.layer, p.ref.entity.color);
        }}
      />
      {doc && !editMode && (
        <button
          className="ui-floating absolute left-[calc(var(--map-il,0px)+0.75rem)] top-[calc(var(--map-it,0px)+0.75rem)] z-10 flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-800 hover:bg-zinc-50"
          onClick={() => {
            setPick(null);
            onEditMode(true);
          }}
          title="Chọn hoặc quét các đối tượng không mong muốn để bỏ khỏi HoSoGIS"
        >
          <IconPen width={14} height={14} className="text-blue-600" />
          Biên tập
          {excluded.size > 0 && <span className="rounded-full bg-red-50 px-1.5 text-[11px] font-semibold text-red-600">{fmt(excluded.size)} đã loại</span>}
        </button>
      )}
      {editMode && (
        <div className="ui-floating ui-pop-in absolute left-[calc(var(--map-il,0px)+0.75rem)] top-[calc(var(--map-it,0px)+0.75rem)] z-20 flex w-[min(24rem,calc(100%-1.5rem))] max-w-[calc(100%-var(--map-il,0px)-var(--map-ir,0px)-1.5rem)] flex-col gap-1.5 p-2 text-[12.5px] text-zinc-700">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Geodatabase" title="Bản đồ đang hiện đúng những gì sẽ ghi vào geodatabase (và tệp .qgz)">
            {views.map((v) => (
              <button
                key={v.id}
                aria-pressed={v.id === view}
                onClick={() => onView(v.id)}
                className={`rounded-md px-2 py-0.5 font-mono text-[11.5px] ring-1 ring-inset ${
                  v.id === view ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50'
                }`}
              >
                {v.label} {v.count >= 0 && <span className={v.id === view ? 'text-blue-100' : 'text-zinc-400'}>{fmt(v.count)}</span>}
              </button>
            ))}
            {!views.length && <span className="text-[11.5px] text-zinc-400">Chưa có lớp nào được ghép.</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="px-1 tabular-nums"
              title="Bấm đối tượng để chọn · kéo khung để quét (trái → phải: nằm trọn, phải → trái: chạm) · chuột giữa kéo bản đồ · Delete xóa · Esc bỏ chọn · Ctrl+Z hoàn tác"
            >
              <b className="font-semibold text-zinc-900">{fmt(selected.size)}</b> đã chọn
            </span>
            {selected.size > 0 && (
              <button className="ui-icon-btn !h-7 !w-7" onClick={() => setSelected(new Set())} aria-label="Bỏ chọn" title="Bỏ chọn (Esc)">
                <IconX width={13} height={13} />
              </button>
            )}
            <button className="ui-btn !px-2.5 !py-1 !text-[12px] text-red-600 disabled:opacity-40" disabled={!toRemove.length} onClick={remove} title="Xóa các đối tượng đã chọn khỏi HoSoGIS (Delete)">
              <IconTrash width={13} height={13} />
              Xóa{toRemove.length ? ` ${fmt(toRemove.length)}` : ''}
            </button>
            <button className="ui-icon-btn !h-7 !w-7 disabled:opacity-40" disabled={!undo.can} onClick={undo.run} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)">
              <IconUndo width={14} height={14} />
            </button>
            <button className="ui-btn-primary ml-auto !px-3 !py-1 !text-[12px]" onClick={exit}>
              Xong
            </button>
          </div>
          {layerCounts.length > 1 && (
            <div className="px-1">
              <button className="text-[11.5px] font-medium text-blue-600 hover:underline" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen}>
                {layersOpen ? 'Ẩn danh sách layer' : `Xóa cả layer (${fmt(layerCounts.length)})`}
              </button>
              {layersOpen && (
                <ul className="ui-scroll mt-1 max-h-52 overflow-y-auto rounded-lg bg-zinc-50 py-1">
                  {layerCounts.map((l) => (
                    <li key={l.name} className="flex items-center gap-2 px-2 py-0.5 text-[11.5px]">
                      <span className={`min-w-0 flex-1 truncate font-mono ${l.kept ? 'text-zinc-700' : 'text-zinc-400 line-through'}`} title={l.name}>
                        {l.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-zinc-400">{fmt(l.kept)}</span>
                      {l.kept > 0 ? (
                        <button className="ui-icon-btn !h-6 !w-6 text-red-600" onClick={() => onExclude(l.all.filter((i) => !excluded.has(i)))} aria-label={`Xóa layer ${l.name}`} title="Xóa cả layer khỏi bản xuất">
                          <IconTrash width={12} height={12} />
                        </button>
                      ) : (
                        <button className="ui-icon-btn !h-6 !w-6" onClick={() => onRestore(l.all)} aria-label={`Khôi phục layer ${l.name}`} title="Khôi phục layer">
                          <IconUndo width={12} height={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {excluded.size > 0 && (
            <p className="flex items-center gap-2 px-1 text-[11.5px] text-zinc-500">
              <span className="flex-1">{fmt(excluded.size)} đối tượng đã xóa khỏi {views.find((v) => v.id === view)?.label ?? 'gdb này'}</span>
              <button className="shrink-0 font-medium text-blue-600 hover:underline" onClick={() => onRestore(null)}>
                Khôi phục tất cả
              </button>
            </p>
          )}
        </div>
      )}
      {(loading || note) && (
        <div className="pointer-events-none absolute left-[calc(var(--map-il,0px)+0.75rem)] right-[calc(var(--map-ir,0px)+0.75rem)] top-[calc(var(--map-it,0px)+3.5rem)] z-10 flex justify-center">
          <span className="ui-floating flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-zinc-700">
            {loading && <IconSpinner width={14} height={14} className="text-blue-600" />}
            {loading ? (loadingText ?? 'Đang vẽ bản vẽ lên bản đồ…') : note}
          </span>
        </div>
      )}
    </div>
  );
}
