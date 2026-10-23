'use client';
// Map of "Bóc tách DWG → TT16": one drawing (inside the planning boundary, already in WGS84) on Google satellite.
// Layers that go to the geodatabase are drawn normally, the others dimmed, the layer selected in the mapping table
// on top; clicking an object selects its layer in the table. The red outline is the planning boundary.
//
// "Biên tập": objects of the mapped layers can be picked (click) or boxed (a CAD-style selection rectangle:
// left → right = wholly inside, right → left = touching) and left
// out of the export — stray hatches, legend leftovers, an old map's patches. Removed objects disappear from the map
// (Hoàn tác / "Khôi phục tất cả" bring them back); every change can be undone. "Đổi lớp" sends the selected objects to
// another feature class (one by one, whatever their layer row says). "Chọn đối tượng" does the same on the drawing
// itself (any layer, mapped or not): keep a few objects of a layer to review, or move ones that were put in the wrong class.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { robustBBox } from '@/lib/cad/normalize/bbox';
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { BOUNDARY_LAYER, previewIndex } from '@/lib/dwg2gdb/inventory';
import { TARGETS } from '@/lib/dwg2gdb/template';
import { sweepSelect } from '@/lib/dwg2gdb/sweep';
import { basemapPaper, buildLayers, DEFAULT_BASEMAP_ID, DEFAULT_FONT_FAMILY, documentBounds } from '@/lib/map';
import EntityPopup from './EntityPopup';
import { IconPen, IconSelect, IconSpinner, IconTrash, IconUndo, IconX } from './icons';
import { loadTextFont } from './mapFont';
import type { MapPick } from './MapView';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="ui-skeleton h-full w-full" aria-busy />,
});

const PICKED = '__selected';
const MOVED = '__moved';
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
  onReassign,
  reassigned,
  movedGroups,
  onRevertAll,
  autoSelect = null,
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
  /** Send the objects to a class (`target`, with `phanLoai` or null = keep theirs); target null = back to their layer row's class. Absent: not offered. */
  onReassign?: (indexes: number[], target: string | null, phanLoai: string | null) => void;
  /** Features of this view made of objects sent to another class (indexes), and how many CAD objects were sent in all. */
  reassigned?: { here: number[]; total: number };
  /** On the drawing: the objects sent to another class, by class — hidden from their own layer, drawn in the class's colour. */
  movedGroups?: { id: string; label: string; color: string; indexes: number[] }[];
  /** Put every object sent to another class back. */
  onRevertAll?: () => void;
  /** Select these features (once per `token`): the objects just moved, when the view that holds them is ready. */
  autoSelect?: { token: number; indexes: number[] } | null;
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
  const [rawSelected, setSelected] = useState<Set<number>>(new Set());
  /** The editing toolbar is open: on the drawing itself (editMode false) or on what the geodatabases will get (editMode). */
  const [open, setOpen] = useState(false);
  const active = editMode || open;
  // An object that was removed is no longer selectable: a sweep over it, or a removal made some other way (a whole layer,
  // an undo), must not leave it in the selection (it would be drawn amber and counted).
  const selected = useMemo(() => (excluded.size ? new Set([...rawSelected].filter((i) => !excluded.has(i))) : rawSelected), [rawSelected, excluded]);
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

  // The objects just moved to another class are selected once (after the reset above: their view is a new document).
  const [seenAuto, setSeenAuto] = useState<number | null>(null);
  if (autoSelect && autoSelect.token !== seenAuto) {
    setSeenAuto(autoSelect.token);
    if (autoSelect.indexes.length) setSelected(new Set(autoSelect.indexes));
  }

  const movedSet = useMemo(() => new Set(reassigned?.here ?? []), [reassigned]);
  const layers = useMemo(() => {
    if (!doc) return [];
    const opts = { fontFamily: font.family, showText: font.ready, highlightHandle: pick?.ref.entity.handle, paper: basemapPaper(basemapId) };
    // Removed and selected objects are drawn only by their overlays.
    const hidden = (e: CadEntity) => {
      const i = previewIndex(e.handle);
      return i !== null && (excluded.has(i) || selected.has(i) || (!editMode && movedSet.has(i)));
    };
    const otherColor = (e: CadEntity) => !!focusColor && e.layer === focusLayer && e.kind === 'polygon' && e.color.toLowerCase() !== focusColor;
    const base = excluded.size || selected.size || movedSet.size || focusColor ? { ...doc, entities: doc.entities.filter((e) => !hidden(e) && !otherColor(e)) } : doc;
    const all = doc.layers.map((l) => l.name);
    const strong = new Set(all.filter((n) => used.has(n) || n === BOUNDARY_LAYER));
    const weak = new Set(all.filter((n) => !strong.has(n)));
    const picked = overlayDoc(doc, (i) => selected.has(i), PICKED, '#f59e0b');
    // Objects already sent to another class (on the drawing: the geodatabase view shows them in their new class).
    const movedDocs = editMode ? [] : (movedGroups ?? []).map((g) => {
      const idx = new Set(g.indexes);
      return { g, doc: overlayDoc(doc, (i) => idx.has(i) && !selected.has(i), `${MOVED}:${g.id}`, g.color) };
    }).filter((x) => x.doc);
    // A layer is selected: only it (and the red planning boundary, kept for orientation) is drawn; the other
    // layers are hidden until it is deselected.
    const focus = focusLayer && all.includes(focusLayer) ? focusLayer : null;
    const shown = focus ? new Set([focus, ...(strong.has(BOUNDARY_LAYER) ? [BOUNDARY_LAYER] : [])]) : null;
    return [
      ...(shown ? [] : buildLayers(base, { ...opts, visibleLayers: weak, idPrefix: 'weak:', opacity: 0.25 })),
      ...buildLayers(base, { ...opts, visibleLayers: shown ?? strong, idPrefix: 'used:' }),
      ...movedDocs.flatMap(({ g, doc: d }) => buildLayers(d!, { ...opts, visibleLayers: new Set([`${MOVED}:${g.id}`]), idPrefix: `moved:${g.id}:` })),
      ...(picked ? buildLayers(picked, { ...opts, visibleLayers: new Set([PICKED]), idPrefix: 'picked:' }) : []),
    ];
  }, [doc, used, focusLayer, focusColor, font, pick, excluded, selected, basemapId, editMode, movedGroups, movedSet]);

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
        if (excluded.has(i)) continue;
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
    setOpen(false);
    setSelected(new Set());
  };

  // "Đổi lớp": the class the selection goes to.
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState('');
  const [reassignPhanLoai, setReassignPhanLoai] = useState('');
  /** The classes used last: one click to use them again. */
  const [recent, setRecent] = useState<string[]>([]);
  const targetGroups = useMemo(() => {
    const by = new Map<string, typeof TARGETS>();
    for (const t of TARGETS) {
      const k = `${t.db} · ${t.dataset}`;
      by.set(k, [...(by.get(k) ?? []), t]);
    }
    return [...by];
  }, []);
  const applyReassign = (target: string | null) => {
    if (!toRemove.length || (target && !target.length)) return;
    onReassign?.(toRemove, target, target && reassignPhanLoai.trim() ? reassignPhanLoai.trim() : null);
    if (target) setRecent((r) => [target, ...r.filter((x) => x !== target)].slice(0, 4));
    setSelected(new Set());
    setReassignOpen(false);
  };

  // Delete (or Backspace) removes the selection, Esc clears it, Ctrl+Z undoes — in both tools.
  useEffect(() => {
    if (!active) return;
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
  }, [active, toRemove, onExclude, undo]);

  const popup = pick && !active ? { lngLat: pick.lngLat, content: <EntityPopup pick={pick.ref} onClose={() => setPick(null)} /> } : null;
  // Layers whose objects can be picked: in the geodatabase view those that are drawn there; on the drawing, every layer
  // that is drawn (only the selected layer when one is, else all but the planning boundary).
  const selectLayers = useMemo(() => {
    if (editMode || !doc) return used;
    const all = doc.layers.map((l) => l.name).filter((n) => n !== BOUNDARY_LAYER);
    return new Set(focusLayer && all.includes(focusLayer) ? [focusLayer] : all);
  }, [editMode, doc, used, focusLayer]);
  const selectable = (p: MapPick) => {
    const i = previewIndex(p.ref.entity.handle);
    return i !== null && (selectLayers.has(p.ref.layer) || p.ref.layer === PICKED || p.ref.layer.startsWith(MOVED)) && !excluded.has(i) ? i : null;
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
        onBoxSelect={active && doc ? (ring, crossing) => toggle(sweepSelect(doc, ring, selectLayers, crossing), true) : null}
        onPick={(p) => {
          if (active) {
            const i = p ? selectable(p) : null;
            if (i !== null) toggle([i]);
            return;
          }
          setPick(p);
          if (p && p.ref.layer !== BOUNDARY_LAYER) onPickLayer(p.ref.layer, p.ref.entity.color);
        }}
      />
      {doc && !active && (
        <button
          className="ui-floating absolute left-[calc(var(--map-il,0px)+0.75rem)] top-[calc(var(--map-it,0px)+0.75rem)] z-10 flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-zinc-800 hover:bg-zinc-50"
          onClick={() => {
            setPick(null);
            setOpen(true);
          }}
          title="Chọn hoặc quét đối tượng trên bản đồ để đổi sang feature class khác hoặc bỏ khỏi HoSoGIS"
        >
          <IconSelect width={14} height={14} className="text-blue-600" />
          Chỉnh sửa đối tượng
          {reassigned && reassigned.total > 0 && <span className="rounded-full bg-violet-50 px-1.5 text-[11px] font-semibold text-violet-700">{fmt(reassigned.total)} đổi lớp</span>}
          {excluded.size > 0 && !editMode && <span className="rounded-full bg-red-50 px-1.5 text-[11px] font-semibold text-red-600">{fmt(excluded.size)} đã xóa</span>}
        </button>
      )}
      {active && (
        <div className="ui-floating ui-pop-in absolute left-[calc(var(--map-il,0px)+0.75rem)] top-[calc(var(--map-it,0px)+0.75rem)] z-20 flex w-[min(22rem,calc(100%-1.5rem))] max-w-[calc(100%-var(--map-il,0px)-var(--map-ir,0px)-1.5rem)] flex-col gap-2 p-2.5 text-[12.5px] text-zinc-700">
          {/* What is shown: the drawing, or what the geodatabases will get. */}
          <div className="flex items-center gap-2">
            <div className="ui-segment" role="group" aria-label="Đang chỉnh trên">
              <button className="whitespace-nowrap" aria-pressed={!editMode} onClick={() => onEditMode(false)} title="Các đối tượng của bản vẽ, mọi layer đang hiện">
                Bản vẽ
              </button>
              <button className="whitespace-nowrap" aria-pressed={editMode} onClick={() => onEditMode(true)} title="Đúng những gì sẽ ghi vào từng geodatabase (và tệp .qgz)">
                Kết quả
              </button>
            </div>
            <button className="ui-btn-primary ml-auto !px-3 !py-1 !text-[12px]" onClick={exit}>
              Xong
            </button>
          </div>
          {editMode && (
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
                  {v.label} {v.count >= 0 && <span className={v.id === view ? 'text-blue-100' : 'text-zinc-400'}>{fmt(v.count)}</span>}
                </button>
              ))}
              {!views.length && <span className="text-[11.5px] text-zinc-400">Chưa có lớp nào được ghép.</span>}
            </div>
          )}

          {/* The selection and what can be done with it. */}
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate tabular-nums" title="Bấm đối tượng để chọn · kéo khung để quét (trái → phải: nằm trọn, phải → trái: chạm) · chuột giữa kéo bản đồ · Delete xóa · Esc bỏ chọn · Ctrl+Z hoàn tác">
              {selected.size > 0 ? (
                <>
                  <b className="font-semibold text-zinc-900">{fmt(selected.size)}</b> đối tượng đã chọn
                </>
              ) : (
                <span className="text-zinc-400">Bấm hoặc kéo khung để chọn</span>
              )}
            </span>
            {selected.size > 0 && (
              <button className="ui-icon-btn !h-7 !w-7" onClick={() => setSelected(new Set())} aria-label="Bỏ chọn" title="Bỏ chọn (Esc)">
                <IconX width={13} height={13} />
              </button>
            )}
            {onReassign && (
              <button
                className={`ui-btn-primary !px-2.5 !py-1 !text-[12px] disabled:opacity-40 ${reassignOpen && toRemove.length ? 'ring-2 ring-blue-300' : ''}`}
                disabled={!toRemove.length}
                aria-expanded={reassignOpen}
                onClick={() => setReassignOpen((o) => !o)}
                title="Ghi các đối tượng đã chọn vào feature class khác (chỉ các đối tượng này, không đổi cả layer)"
              >
                <IconPen width={13} height={13} />
                Đổi lớp
              </button>
            )}
            <button className="ui-icon-btn !h-7 !w-7 text-red-600 disabled:opacity-40" disabled={!toRemove.length} onClick={remove} aria-label="Xóa" title="Xóa các đối tượng đã chọn khỏi HoSoGIS (Delete)">
              <IconTrash width={14} height={14} />
            </button>
            <button className="ui-icon-btn !h-7 !w-7 disabled:opacity-40" disabled={!undo.can} onClick={undo.run} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)">
              <IconUndo width={14} height={14} />
            </button>
          </div>

          {onReassign && reassignOpen && toRemove.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg bg-zinc-50 p-2">
              {recent.length > 0 && (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Lớp dùng gần đây">
                  {recent.map((t) => (
                    <button
                      key={t}
                      aria-pressed={t === reassignTarget}
                      onClick={() => setReassignTarget(t)}
                      className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset ${t === reassignTarget ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-100'}`}
                      title={t}
                    >
                      {t.split('/').pop()}
                    </button>
                  ))}
                </div>
              )}
              <select className="ui-input !py-1 font-mono text-[12px]" value={reassignTarget} onChange={(e) => setReassignTarget(e.target.value)} aria-label="Feature class đích">
                <option value="">Chọn feature class đích…</option>
                {targetGroups.map(([group, list]) => (
                  <optgroup key={group} label={group}>
                    {list.map((t) => (
                      <option key={t.path} value={t.path}>
                        {t.cls} — {t.alias}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input className="ui-input !py-1 text-[12px]" value={reassignPhanLoai} onChange={(e) => setReassignPhanLoai(e.target.value)} maxLength={250} placeholder="Phân loại (để trống: giữ phân loại hiện có)" aria-label="Phân loại" />
              <div className="flex items-center gap-2">
                <button className="ui-btn-primary !px-3 !py-1 !text-[12px] disabled:opacity-40" disabled={!reassignTarget} onClick={() => applyReassign(reassignTarget)}>
                  Áp dụng cho {fmt(toRemove.length)}
                </button>
                <button className="text-[11.5px] font-medium text-blue-600 hover:underline" onClick={() => applyReassign(null)} title="Trả các đối tượng về lớp theo bảng ghép layer">
                  Về lớp theo layer
                </button>
              </div>
            </div>
          )}

          {/* What was already changed: one line each, with the way back. */}
          {((reassigned && reassigned.total > 0) || excluded.size > 0) && (
            <div className="flex flex-col gap-0.5 border-t border-zinc-100 pt-1.5 text-[11.5px] text-zinc-500">
              {reassigned && reassigned.total > 0 && (
                <p className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-medium text-violet-700">{fmt(reassigned.here.length)}</b> đã đổi lớp{reassigned.total !== reassigned.here.length ? ` (${fmt(reassigned.total)} ở mọi gdb)` : ''}
                  </span>
                  {reassigned.here.length > 0 && (
                    <button className="shrink-0 font-medium text-blue-600 hover:underline" onClick={() => setSelected(new Set(reassigned.here.filter((i) => !excluded.has(i))))} title="Chọn các đối tượng đã đổi lớp để đổi lại hoặc đưa về lớp theo layer">
                      Chọn
                    </button>
                  )}
                  <button className="shrink-0 font-medium text-blue-600 hover:underline" onClick={onRevertAll} title="Đưa mọi đối tượng đã đổi lớp về lớp theo bảng ghép">
                    Hoàn lại
                  </button>
                </p>
              )}
              {excluded.size > 0 && (
                <p className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-medium text-red-600">{fmt(excluded.size)}</b> đã xóa khỏi bản xuất
                  </span>
                  <button className="shrink-0 font-medium text-blue-600 hover:underline" onClick={() => onRestore(null)}>
                    Khôi phục
                  </button>
                </p>
              )}
            </div>
          )}

          {/* Rarely needed: a whole layer at once. */}
          {editMode && layerCounts.length > 1 && (
            <div>
              <button className="text-[11.5px] font-medium text-blue-600 hover:underline" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen}>
                {layersOpen ? 'Ẩn danh sách layer' : `Xóa cả layer… (${fmt(layerCounts.length)})`}
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
