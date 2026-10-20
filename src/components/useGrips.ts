'use client';
// Vertices ("grips") of the selected objects on the map: click one to select it (Shift/Ctrl adds), drag a selected
// one to move every selected vertex by the same amount. The dragged vertex snaps to the vertices and edge midpoints
// of what is under the pointer ("bắt điểm") and a mark shows what it caught. Two more gestures when the page
// supports them: drag the small handle in the middle of an edge to insert a vertex there (`onInsert`), drag an
// outline to move every selected object whole (through `onMove`). The live preview is drawn here; a gesture is
// committed once on release (one undo step).
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { Map as MlMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Vec2 } from '@/lib/cad/types';
import { allGripKeys, edgeHandles, groupGrips, gripsOfShape, movedPaths, pathsWithInsert, type EdgeHandle, type GripShape } from '@/lib/cad/grips';
import { pickSnap } from '@/lib/map';

const HIT_PX = 10;
const MID_PX = 8;
const BODY_PX = 6;
const SNAP_PX = 9;
const ACCENT: [number, number, number] = [37, 99, 235];
const HOT: [number, number, number] = [239, 68, 68];
const SNAP_END: [number, number, number] = [22, 163, 74];
const SNAP_MID: [number, number, number] = [8, 145, 178];

export interface GripsConfig {
  /** Geometry of the selected objects (vertices to show). */
  shapes: GripShape[];
  /** Selected grip keys (gripKey). */
  selected: ReadonlySet<string>;
  onSelect: (keys: Set<string>) => void;
  /** A drag finished: every key in `keys` moves by `delta` (degrees). */
  onMove: (delta: Vec2, keys: Set<string>) => void;
  /** An edge handle was dragged: a vertex `p` goes in as vertex `at` of path `r` of `owner`. Absent = no handles. */
  onInsert?: (owner: string, r: number, at: number, p: Vec2) => void;
}

interface Item {
  key: string;
  p: Vec2;
}

type Drag =
  | { kind: 'vertex'; origin: Vec2; keys: Set<string> }
  /** An outline dragged: every selected object moves by the pointer's displacement (no snapping). */
  | { kind: 'body'; origin: Vec2; keys: Set<string> }
  | { kind: 'insert'; origin: Vec2; handle: EdgeHandle };

interface Live {
  delta: Vec2;
  snap: { p: Vec2; mid: boolean } | null;
  /** The vertex being inserted. */
  insert?: { handle: EdgeHandle; p: Vec2 };
}

type Hit = { type: 'vertex'; item: Item } | { type: 'mid'; handle: EdgeHandle } | { type: 'body' };

function segDistPx(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function useGrips(
  mapRef: RefObject<MlMap | null>,
  overlayRef: RefObject<MapboxOverlay | null>,
  config: GripsConfig | null,
  /** Set while a grip gesture runs and a moment after: the page ignores the map click that ends it. */
  suppressClick: MutableRefObject<boolean>,
  /** Layer ids start with this (two instances on one map need different ones; it must begin with "grip-"). */
  idPrefix = 'grip-',
): { layers: Layer[]; /** True when the pointer (px) is over a grip. */ isOver: (at: [number, number]) => boolean } {
  const [live, setLive] = useState<Live | null>(null);
  const hitRef = useRef<(at: [number, number]) => boolean>(() => false);
  const [dragKeys, setDragKeys] = useState<Set<string> | null>(null);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const items = useMemo<Item[]>(() => (config ? config.shapes.flatMap(gripsOfShape) : []), [config]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  const handles = useMemo<EdgeHandle[]>(() => (config?.onInsert ? config.shapes.flatMap(edgeHandles) : []), [config]);
  const handlesRef = useRef(handles);
  useEffect(() => {
    handlesRef.current = handles;
  });

  const active = items.length > 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !active) return;
    const canvas = map.getCanvas();
    let drag: Drag | null = null;
    let moved = false;
    // The cursor before a grip was hovered (a measuring tool keeps its own crosshair).
    let hoverCursor: string | null = null;
    let lastDelta: Vec2 = [0, 0];
    let lastInsert: Vec2 | null = null;

    const px = (p: Vec2): [number, number] => {
      const q = map.project(p);
      return [q.x, q.y];
    };
    /** What is under the pointer: a vertex, an edge handle, an outline of a selected object, or nothing. */
    const hit = (at: [number, number]): Hit | null => {
      let best: Item | null = null;
      let bestD = HIT_PX;
      for (const it of itemsRef.current) {
        const [x, y] = px(it.p);
        const d = Math.hypot(x - at[0], y - at[1]);
        if (d <= bestD) {
          bestD = d;
          best = it;
        }
      }
      if (best) return { type: 'vertex', item: best };
      for (const h of handlesRef.current) {
        const [x, y] = px(h.p);
        if (Math.hypot(x - at[0], y - at[1]) <= MID_PX) return { type: 'mid', handle: h };
      }
      const cfg = configRef.current;
      if (cfg?.onInsert) {
        for (const s of cfg.shapes) {
          for (const path of s.paths) {
            if (path.length < 2) continue;
            const sp = path.map(px);
            const n = s.closed && sp.length >= 3 ? sp.length : sp.length - 1;
            for (let i = 0; i < n; i++) if (segDistPx(at, sp[i], sp[(i + 1) % sp.length]) <= BODY_PX) return { type: 'body' };
          }
        }
      }
      return null;
    };
    hitRef.current = (at) => !!hit(at);
    const snapAt = (x: number, y: number, ignore: Set<string>) =>
      pickSnap(overlayRef.current, px, x, y, SNAP_PX, { ignore, skipLayer: (id) => id.startsWith('grip-') || id.startsWith('sel:') });

    const begin = (d: Drag, cursor: string) => {
      drag = d;
      moved = false;
      lastDelta = [0, 0];
      lastInsert = null;
      map.dragPan.disable();
      if (hoverCursor === null) hoverCursor = canvas.style.cursor;
      canvas.style.cursor = cursor;
    };

    const start = (at: [number, number], lngLat: Vec2, additive: boolean, prevent: () => void): boolean => {
      const cfg = configRef.current;
      const h = hit(at);
      if (!cfg || !h) return false;
      prevent();
      if (h.type === 'mid') {
        suppressClick.current = true;
        begin({ kind: 'insert', origin: h.handle.p, handle: h.handle }, 'crosshair');
        return true;
      }
      if (h.type === 'body') {
        // A plain click on an outline still reaches the map (it picks); only a real drag is a move.
        const keys = allGripKeys(cfg.shapes);
        setDragKeys(keys);
        begin({ kind: 'body', origin: lngLat, keys }, 'grabbing');
        return true;
      }
      const it = h.item;
      suppressClick.current = true;
      const had = cfg.selected.has(it.key);
      let keys: Set<string>;
      if (additive) {
        keys = new Set(cfg.selected);
        if (had) keys.delete(it.key);
        else keys.add(it.key);
        cfg.onSelect(keys);
        if (had) return true; // taken out: nothing to drag
      } else {
        keys = had ? new Set(cfg.selected) : new Set([it.key]);
        if (!had) cfg.onSelect(keys);
      }
      setDragKeys(keys);
      begin({ kind: 'vertex', origin: it.p, keys }, 'grabbing');
      return true;
    };

    const update = (at: [number, number], lngLat: Vec2) => {
      if (!drag) return;
      const d = drag;
      moved = moved || Math.hypot(at[0] - px(d.origin)[0], at[1] - px(d.origin)[1]) > 3;
      if (d.kind === 'body') {
        lastDelta = [lngLat[0] - d.origin[0], lngLat[1] - d.origin[1]];
        // `origin` of a body drag is the pointer itself: measure the pixel distance from where it started.
        if (moved) suppressClick.current = true;
        setLive({ delta: lastDelta, snap: null });
        return;
      }
      const ignore =
        d.kind === 'insert'
          ? new Set([`${d.handle.p[0]},${d.handle.p[1]}`])
          : new Set(itemsRef.current.filter((it) => d.keys.has(it.key)).map((it) => `${it.p[0]},${it.p[1]}`));
      const snap = snapAt(at[0], at[1], ignore);
      const target = snap?.p ?? lngLat;
      if (d.kind === 'insert') {
        lastInsert = target;
        setLive({ delta: [0, 0], snap, insert: { handle: d.handle, p: target } });
        return;
      }
      lastDelta = [target[0] - d.origin[0], target[1] - d.origin[1]];
      setLive({ delta: lastDelta, snap });
    };

    const end = () => {
      if (!drag) {
        setTimeout(() => (suppressClick.current = false), 80);
        return;
      }
      const d = drag;
      drag = null;
      map.dragPan.enable();
      canvas.style.cursor = hoverCursor ?? '';
      hoverCursor = null;
      setLive(null);
      setDragKeys(null);
      if (moved) {
        if (d.kind === 'insert') {
          if (lastInsert) configRef.current?.onInsert?.(d.handle.owner, d.handle.r, d.handle.at, lastInsert);
        } else if (lastDelta[0] !== 0 || lastDelta[1] !== 0) configRef.current?.onMove(lastDelta, d.keys);
      }
      setTimeout(() => (suppressClick.current = false), 80);
    };

    const onDown = (e: MapMouseEvent) => {
      const me = e.originalEvent as MouseEvent;
      if (me.button !== 0) return;
      start([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat], me.shiftKey || me.ctrlKey || me.metaKey, () => e.preventDefault());
    };
    const onMove = (e: MapMouseEvent) => {
      if (drag) update([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat]);
      else if (hit([e.point.x, e.point.y])) {
        const h = hit([e.point.x, e.point.y]);
        if (hoverCursor === null) hoverCursor = canvas.style.cursor;
        canvas.style.cursor = h?.type === 'body' ? 'move' : h?.type === 'mid' ? 'copy' : 'pointer';
      } else if (hoverCursor !== null) {
        canvas.style.cursor = hoverCursor;
        hoverCursor = null;
      }
    };
    const onTouchStart = (e: MapTouchEvent) => {
      if (e.points.length === 1) start([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat], false, () => e.preventDefault());
    };
    const onTouchMove = (e: MapTouchEvent) => {
      if (!drag) return;
      e.preventDefault();
      update([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat]);
    };

    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('touchstart', onTouchStart);
      map.off('touchmove', onTouchMove);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      map.dragPan.enable();
      if (hoverCursor !== null) canvas.style.cursor = hoverCursor;
      suppressClick.current = false;
      hitRef.current = () => false;
    };
  }, [active, mapRef, overlayRef, suppressClick]);

  const layers = useMemo<Layer[]>(() => {
    if (!config || !items.length) return [];
    const chosen = dragKeys ?? config.selected;
    const byOwner = groupGrips(chosen);
    const out: Layer[] = [];
    // The shapes as they will be once released.
    const delta = live?.delta;
    const ins = live?.insert;
    const moved = (s: GripShape): Vec2[][] => (delta && byOwner.has(s.owner) ? movedPaths(s, byOwner.get(s.owner)!, delta) : s.paths);
    if (delta || ins) {
      const outlines: Vec2[][] = [];
      if (ins) {
        const s = config.shapes.find((x) => x.owner === ins.handle.owner);
        if (s) pathsWithInsert(s, ins.handle.r, ins.handle.at, ins.p).forEach((path, r) => outlines.push(s.closed && !s.dup[r] ? [...path, path[0]] : path));
      } else {
        for (const s of config.shapes) {
          if (!byOwner.has(s.owner)) continue;
          moved(s).forEach((path, r) => outlines.push(s.closed && !s.dup[r] ? [...path, path[0]] : path));
        }
      }
      out.push(
        new PathLayer<Vec2[]>({
          id: `${idPrefix}preview`,
          data: outlines,
          getPath: (d) => d,
          getColor: [...HOT, 230],
          getWidth: 2,
          widthUnits: 'pixels',
          pickable: false,
        }),
      );
    }
    if (handles.length && !live) {
      out.push(
        new ScatterplotLayer<EdgeHandle>({
          id: `${idPrefix}mids`,
          data: handles,
          getPosition: (d) => d.p,
          getRadius: 3.5,
          radiusUnits: 'pixels',
          getFillColor: [255, 255, 255, 190],
          getLineColor: [...ACCENT, 200],
          getLineWidth: 1.4,
          lineWidthUnits: 'pixels',
          stroked: true,
          pickable: false,
        }),
      );
    }
    const data = items.map((it) => {
      const sel = chosen.has(it.key);
      return { key: it.key, sel, p: delta && sel ? ([it.p[0] + delta[0], it.p[1] + delta[1]] as Vec2) : it.p };
    });
    out.push(
      new ScatterplotLayer<(typeof data)[number]>({
        id: `${idPrefix}points`,
        data,
        getPosition: (d) => d.p,
        getRadius: 5.5,
        radiusUnits: 'pixels',
        getFillColor: (d) => (d.sel ? [...HOT, 255] : [255, 255, 255, 255]),
        getLineColor: (d) => (d.sel ? [255, 255, 255, 255] : [...ACCENT, 255]),
        getLineWidth: 1.8,
        lineWidthUnits: 'pixels',
        stroked: true,
        pickable: false,
        updateTriggers: { getPosition: [delta?.[0], delta?.[1]], getFillColor: [chosen], getLineColor: [chosen] },
      }),
    );
    if (ins) {
      out.push(
        new ScatterplotLayer<Vec2>({
          id: `${idPrefix}inserted`,
          data: [ins.p],
          getPosition: (d) => d,
          getRadius: 5.5,
          radiusUnits: 'pixels',
          getFillColor: [...HOT, 255],
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 1.8,
          lineWidthUnits: 'pixels',
          stroked: true,
          pickable: false,
        }),
      );
    }
    if (live?.snap) {
      const c = live.snap.mid ? SNAP_MID : SNAP_END;
      out.push(
        new ScatterplotLayer<Vec2>({
          id: `${idPrefix}snap`,
          data: [live.snap.p],
          getPosition: (d) => d,
          getRadius: 9,
          radiusUnits: 'pixels',
          filled: false,
          stroked: true,
          getLineColor: [...c, 255],
          getLineWidth: 2.5,
          lineWidthUnits: 'pixels',
          pickable: false,
        }),
      );
    }
    return out;
  }, [config, items, handles, live, dragKeys, idPrefix]);

  return { layers, isOver: (at) => hitRef.current(at) };
}
