'use client';
// Vertices ("grips") of the selected objects on the map: click one to select it (Shift/Ctrl adds), drag a selected
// one to move every selected vertex by the same amount. The dragged vertex snaps to the vertices and edge midpoints
// of what is under the pointer ("bắt điểm") and a mark shows what it caught. The live preview is drawn here; the
// move is committed once on release (one undo step) through `onMove`.
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { Map as MlMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Vec2 } from '@/lib/cad/types';
import { groupGrips, gripsOfShape, movedPaths, type GripShape } from '@/lib/cad/grips';
import { pickSnap } from '@/lib/map';

const HIT_PX = 10;
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
}

interface Item {
  key: string;
  p: Vec2;
}

interface Drag {
  key: string;
  origin: Vec2;
  keys: Set<string>;
}

interface Live {
  delta: Vec2;
  snap: { p: Vec2; mid: boolean } | null;
}

export function useGrips(
  mapRef: RefObject<MlMap | null>,
  overlayRef: RefObject<MapboxOverlay | null>,
  config: GripsConfig | null,
  /** Set while a grip gesture runs and a moment after: the page ignores the map click that ends it. */
  suppressClick: MutableRefObject<boolean>,
  /** Layer ids start with this (two instances on one map need different ones; it must begin with "grip-"). */
  idPrefix = 'grip-',
): { layers: Layer[] } {
  const [live, setLive] = useState<Live | null>(null);
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

    const px = (p: Vec2): [number, number] => {
      const q = map.project(p);
      return [q.x, q.y];
    };
    const hit = (at: [number, number]): Item | null => {
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
      return best;
    };
    const snapAt = (x: number, y: number, ignore: Set<string>) =>
      pickSnap(overlayRef.current, px, x, y, SNAP_PX, { ignore, skipLayer: (id) => id.startsWith('grip-') || id.startsWith('sel:') });

    const start = (at: [number, number], additive: boolean, prevent: () => void): boolean => {
      const cfg = configRef.current;
      const h = hit(at);
      if (!cfg || !h) return false;
      prevent();
      suppressClick.current = true;
      const had = cfg.selected.has(h.key);
      let keys: Set<string>;
      if (additive) {
        keys = new Set(cfg.selected);
        if (had) keys.delete(h.key);
        else keys.add(h.key);
        cfg.onSelect(keys);
        if (had) return true; // taken out: nothing to drag
      } else {
        keys = had ? new Set(cfg.selected) : new Set([h.key]);
        if (!had) cfg.onSelect(keys);
      }
      drag = { key: h.key, origin: h.p, keys };
      moved = false;
      lastDelta = [0, 0];
      setDragKeys(keys);
      map.dragPan.disable();
      if (hoverCursor === null) hoverCursor = canvas.style.cursor;
      canvas.style.cursor = 'grabbing';
      return true;
    };

    const update = (at: [number, number], lngLat: Vec2) => {
      if (!drag) return;
      const ignore = new Set(itemsRef.current.filter((it) => drag!.keys.has(it.key)).map((it) => `${it.p[0]},${it.p[1]}`));
      const snap = snapAt(at[0], at[1], ignore);
      const target = snap?.p ?? lngLat;
      lastDelta = [target[0] - drag.origin[0], target[1] - drag.origin[1]];
      moved = moved || Math.hypot(at[0] - px(drag.origin)[0], at[1] - px(drag.origin)[1]) > 3;
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
      if (moved && (lastDelta[0] !== 0 || lastDelta[1] !== 0)) configRef.current?.onMove(lastDelta, d.keys);
      setTimeout(() => (suppressClick.current = false), 80);
    };

    const onDown = (e: MapMouseEvent) => {
      const me = e.originalEvent as MouseEvent;
      if (me.button !== 0) return;
      start([e.point.x, e.point.y], me.shiftKey || me.ctrlKey || me.metaKey, () => e.preventDefault());
    };
    const onMove = (e: MapMouseEvent) => {
      if (drag) update([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat]);
      else if (hit([e.point.x, e.point.y])) {
        if (hoverCursor === null) hoverCursor = canvas.style.cursor;
        canvas.style.cursor = 'pointer';
      } else if (hoverCursor !== null) {
        canvas.style.cursor = hoverCursor;
        hoverCursor = null;
      }
    };
    const onTouchStart = (e: MapTouchEvent) => {
      if (e.points.length === 1) start([e.point.x, e.point.y], false, () => e.preventDefault());
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
    };
  }, [active, mapRef, overlayRef, suppressClick]);

  const layers = useMemo<Layer[]>(() => {
    if (!config || !items.length) return [];
    const chosen = dragKeys ?? config.selected;
    const byOwner = groupGrips(chosen);
    const out: Layer[] = [];
    // The shapes as they will be once released.
    const delta = live?.delta;
    const moved = (s: GripShape): Vec2[][] => (delta && byOwner.has(s.owner) ? movedPaths(s, byOwner.get(s.owner)!, delta) : s.paths);
    if (delta) {
      const outlines: Vec2[][] = [];
      for (const s of config.shapes) {
        if (!byOwner.has(s.owner)) continue;
        moved(s).forEach((path, r) => outlines.push(s.closed && !s.dup[r] ? [...path, path[0]] : path));
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
  }, [config, items, live, dragKeys, idPrefix]);

  return { layers };
}
