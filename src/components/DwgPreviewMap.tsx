'use client';
// Map of "Bóc tách DWG → TT16": one drawing (inside the planning boundary, already in WGS84) on Google satellite.
// Layers that go to the geodatabase are drawn normally, the others dimmed, the layer selected in the mapping table
// on top; clicking an object selects its layer in the table. The red outline is the planning boundary.
//
// "Biên tập": objects of the mapped layers can be picked (click) or boxed (a CAD-style selection rectangle:
// left → right = wholly inside, right → left = touching) and left
// out of the export — stray hatches, legend leftovers, an old map's patches. Removed objects stay as a red ghost
// (pickable, to restore them); every change can be undone.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { robustBBox } from '@/lib/cad/normalize/bbox';
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { BOUNDARY_LAYER, previewIndex } from '@/lib/dwg2gdb/inventory';
import { sweepSelect } from '@/lib/dwg2gdb/sweep';
import { basemapPaper, buildLayers, DEFAULT_BASEMAP_ID, DEFAULT_FONT_FAMILY, documentBounds } from '@/lib/map';
import EntityPopup from './EntityPopup';
import { IconPen, IconSpinner, IconTrash, IconUndo } from './icons';
import { loadTextFont } from './mapFont';
import type { MapPick } from './MapView';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="ui-skeleton h-full w-full" aria-busy />,
});

const GHOST = '__excluded';
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
  onPickLayer: (layer: string) => void;
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
  const [tool, setTool] = useState<'click' | 'sweep'>('click');
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
    const base = excluded.size || selected.size ? { ...doc, entities: doc.entities.filter((e) => !hidden(e)) } : doc;
    const all = doc.layers.map((l) => l.name);
    const strong = new Set(all.filter((n) => used.has(n) || n === BOUNDARY_LAYER));
    const weak = new Set(all.filter((n) => !strong.has(n)));
    const ghost = editMode ? overlayDoc(doc, (i) => excluded.has(i) && !selected.has(i), GHOST, '#ef4444') : null;
    const picked = overlayDoc(doc, (i) => selected.has(i), PICKED, '#f59e0b');
    // A layer is selected: only it (and the red planning boundary, kept for orientation) is drawn; the other
    // layers are hidden until it is deselected.
    const focus = focusLayer && all.includes(focusLayer) ? focusLayer : null;
    const shown = focus ? new Set([focus, ...(strong.has(BOUNDARY_LAYER) ? [BOUNDARY_LAYER] : [])]) : null;
    return [
      ...(shown ? [] : buildLayers(base, { ...opts, visibleLayers: weak, idPrefix: 'weak:', opacity: 0.25 })),
      ...buildLayers(base, { ...opts, visibleLayers: shown ?? strong, idPrefix: 'used:' }),
      ...(ghost ? buildLayers(ghost, { ...opts, visibleLayers: new Set([GHOST]), idPrefix: 'ghost:', opacity: 0.45 }) : []),
      ...(picked ? buildLayers(picked, { ...opts, visibleLayers: new Set([PICKED]), idPrefix: 'picked:' }) : []),
    ];
  }, [doc, used, focusLayer, font, pick, excluded, selected, editMode, basemapId]);

  // Zoom to the drawing, then to the selected layer.
  const fit = useMemo(() => {
    if (!doc) return undefined;
    const entities = focusLayer ? doc.entities.filter((e) => e.layer === focusLayer) : doc.entities;
    const bounds = entities.length ? documentBounds({ ...doc, entities, bbox: robustBBox(entities) }) : null;
    const key = `${doc.entities.length}|${doc.bbox.flat().join(',')}|${focusLayer ?? ''}`;
    let seq = 0;
    for (let i = 0; i < key.length; i++) seq = (seq * 31 + key.charCodeAt(i)) | 0;
    return bounds ? { bounds: bounds as [Vec2, Vec2], seq } : undefined;
  }, [doc, focusLayer]);

  const toggle = (indexes: number[], add?: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const i of indexes) {
        if (add ?? !next.has(i)) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  const selList = [...selected];
  const toRemove = selList.filter((i) => !excluded.has(i));
  const toRestore = selList.filter((i) => excluded.has(i));
  const remove = () => {
    if (!toRemove.length) return;
    onExclude(toRemove);
    setSelected(new Set());
  };
  const restore = () => {
    if (!toRestore.length) return;
    onRestore(toRestore);
    setSelected(new Set());
  };
  const exit = () => {
    onEditMode(false);
    setTool('click');
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
    return i !== null && (used.has(p.ref.layer) || p.ref.layer === GHOST || p.ref.layer === PICKED) ? i : null;
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
        onBoxSelect={editMode && tool === 'sweep' && doc ? (ring, crossing) => toggle(sweepSelect(doc, ring, used, crossing), true) : null}
        onPick={(p) => {
          if (editMode) {
            const i = p ? selectable(p) : null;
            if (i !== null) toggle([i]);
            return;
          }
          setPick(p);
          if (p && p.ref.layer !== BOUNDARY_LAYER) onPickLayer(p.ref.layer);
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
        <div className="ui-floating ui-pop-in absolute left-[calc(var(--map-il,0px)+0.75rem)] top-[calc(var(--map-it,0px)+0.75rem)] z-20 w-[min(23rem,calc(100%-1.5rem))] space-y-2 p-2.5 text-[12.5px] text-zinc-700">
          <div>
            <p className="mb-1 text-[11.5px] text-zinc-500">Đang xem đúng những gì sẽ ghi vào geodatabase (và tệp .qgz):</p>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Geodatabase">
              {views.map((v) => (
                <button
                  key={v.id}
                  aria-pressed={v.id === view}
                  onClick={() => onView(v.id)}
                  className={`rounded-md px-2 py-0.5 font-mono text-[11.5px] ring-1 ring-inset ${
                    v.id === view ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  {v.label} <span className={v.id === view ? 'text-blue-100' : 'text-zinc-400'}>{fmt(v.count)}</span>
                </button>
              ))}
              {!views.length && <span className="text-[11.5px] text-zinc-400">Chưa có lớp nào được ghép.</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="ui-segment flex-1">
              <button aria-pressed={tool === 'click'} onClick={() => setTool('click')}>
                Bấm chọn
              </button>
              <button aria-pressed={tool === 'sweep'} onClick={() => setTool('sweep')}>
                Quét khung
              </button>
            </div>
            <button className="ui-btn-primary !px-2.5 !py-1 !text-[12px]" onClick={exit}>
              Xong
            </button>
          </div>
          <p className="text-[11.5px] leading-snug text-zinc-500">
            {tool === 'click'
              ? 'Bấm vào đối tượng để chọn / bỏ chọn. Delete = xóa, Esc = bỏ chọn, Ctrl+Z = hoàn tác.'
              : 'Kéo khung như AutoCAD: trái → phải (khung xanh) chọn đối tượng nằm trọn trong khung; phải → trái (khung nét đứt xanh lá) chọn cả đối tượng chạm khung. Kéo tiếp để chọn thêm, cuộn chuột để phóng to/thu nhỏ. Delete = xóa, Esc = bỏ chọn, Ctrl+Z = hoàn tác.'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-auto tabular-nums">
              Đã chọn <b className="font-semibold text-zinc-900">{fmt(selected.size)}</b>
            </span>
            {selected.size > 0 && (
              <button className="ui-btn-ghost !px-2 !py-1 !text-[12px]" onClick={() => setSelected(new Set())}>
                Bỏ chọn
              </button>
            )}
            {toRestore.length > 0 && (
              <button className="ui-btn !px-2 !py-1 !text-[12px]" onClick={restore}>
                Khôi phục {fmt(toRestore.length)}
              </button>
            )}
            <button className="ui-btn !px-2 !py-1 !text-[12px] text-red-600 disabled:opacity-40" disabled={!toRemove.length} onClick={remove} title="Xóa các đối tượng đã chọn khỏi HoSoGIS (phím Delete)">
              <IconTrash width={13} height={13} />
              Xóa{toRemove.length ? ` ${fmt(toRemove.length)}` : ''}
              <kbd className="rounded border border-red-200 bg-red-50 px-1 font-sans text-[10.5px] font-medium text-red-600">Delete</kbd>
            </button>
            <button className="ui-btn !px-2 !py-1 !text-[12px] disabled:opacity-40" disabled={!undo.can} onClick={undo.run} title="Hoàn tác (Ctrl+Z)">
              <IconUndo width={13} height={13} />
            </button>
          </div>
          {excluded.size > 0 && (
            <p className="flex items-center gap-2 border-t border-zinc-100 pt-2 text-[11.5px] text-zinc-500">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-red-500/60" />
              <span className="flex-1">
                {fmt(excluded.size)} đối tượng của {views.find((v) => v.id === view)?.label ?? 'gdb này'} đã xóa — sẽ không ghi (vẽ màu đỏ mờ, bấm để chọn lại)
              </span>
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
