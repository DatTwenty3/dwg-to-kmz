'use client';
// Measurement tool state + map interaction (click / double-click / keyboard / snapping).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import type { Vec2 } from '@/lib/cad/types';
import {
  buildMeasureLayers,
  nearestSnap,
  snapCandidatesOf,
  type MeasureDraft,
  type Measurement,
  type MeasureTool,
} from '@/lib/map';

const SNAP_PX = 8;
const PICK_INTERVAL_MS = 90;
const MIN_POINTS: Record<MeasureTool, number> = { distance: 2, area: 3, point: 1 };

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 0 → 1 progress over `ms` after each `trigger()` (instant under reduced motion). */
function useProgress(ms: number): [number, () => void] {
  const [t, setT] = useState(1);
  const raf = useRef(0);
  const trigger = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (prefersReducedMotion()) return setT(1);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setT(p);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    setT(0);
    raf.current = requestAnimationFrame(step);
  }, [ms]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return [t, trigger];
}

const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export interface MeasureCurrent {
  kind: MeasureTool;
  points: Vec2[];
  isDraft: boolean;
}

export interface MeasureApi {
  tool: MeasureTool | null;
  setTool: (t: MeasureTool | null) => void;
  finished: Measurement[];
  /** What the result card shows: the draft (with the live cursor point) or the selected finished measurement. */
  current: MeasureCurrent | null;
  layers: Layer[];
  clear: () => void;
  finish: () => void;
  undo: () => void;
  cancel: () => void;
  /** Closes the card (keeps measurements on the map). */
  dismiss: () => void;
  /** True while a tool is active: callers must not open entity popups. */
  active: boolean;
}

export function useMeasure(
  mapRef: RefObject<MlMap | null>,
  overlayRef: RefObject<MapboxOverlay | null>,
  fontFamily: string | undefined,
): MeasureApi {
  const [tool, setToolState] = useState<MeasureTool | null>(null);
  const [finished, setFinished] = useState<Measurement[]>([]);
  const [points, setPoints] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [popT, popTrigger] = useProgress(320);
  const [fadeT, fadeTrigger] = useProgress(380);
  const nextId = useRef(1);
  const toolRef = useRef(tool);
  const pointsRef = useRef(points);
  useEffect(() => {
    toolRef.current = tool;
    pointsRef.current = points;
  });

  const commit = useCallback(
    (kind: MeasureTool, pts: Vec2[]) => {
      if (pts.length < MIN_POINTS[kind]) return false;
      const id = nextId.current++;
      setFinished((f) => [...f, { id, kind, points: pts }]);
      setSelectedId(id);
      setPoints([]);
      fadeTrigger();
      return true;
    },
    [fadeTrigger],
  );

  const finish = useCallback(() => {
    const k = toolRef.current;
    if (k && k !== 'point') commit(k, pointsRef.current);
  }, [commit]);
  const undo = useCallback(() => setPoints((p) => p.slice(0, -1)), []);
  const cancel = useCallback(() => {
    if (pointsRef.current.length) setPoints([]);
    else setToolState(null);
  }, []);
  const setTool = useCallback((t: MeasureTool | null) => {
    setToolState(t);
    setPoints([]);
    setCursor(null);
  }, []);
  const clear = useCallback(() => {
    setFinished([]);
    setPoints([]);
    setSelectedId(null);
  }, []);
  const dismiss = useCallback(() => {
    setSelectedId(null);
    setPoints([]);
    setToolState(null);
  }, []);

  // Pointer + keyboard handling while a tool is active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tool) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';
    map.doubleClickZoom.disable();

    let raf = 0;
    let pending: MapMouseEvent | null = null;
    let lastSnap: { x: number; y: number; p: Vec2 } | null = null;
    let lastClick: { x: number; y: number; t: number } | null = null;

    const snapAt = (x: number, y: number): Vec2 | null => {
      const overlay = overlayRef.current;
      if (!overlay) return null;
      try {
        const info = overlay.pickObject({ x, y, radius: SNAP_PX });
        const cands = snapCandidatesOf(info?.object);
        if (cands.length === 0) return null;
        return nearestSnap(cands, [x, y], (p) => {
          const q = map.project(p);
          return [q.x, q.y];
        }, SNAP_PX);
      } catch {
        return null;
      }
    };

    // A pick renders the picking pass of every layer: keep it to a few per second while the pointer moves.
    let lastPick = 0;
    const move = () => {
      raf = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      const now = performance.now();
      let snap: Vec2 | null = null;
      if (now - lastPick >= PICK_INTERVAL_MS) {
        snap = snapAt(e.point.x, e.point.y);
        lastPick = performance.now();
        lastSnap = snap ? { x: e.point.x, y: e.point.y, p: snap } : null;
      } else if (lastSnap && Math.hypot(lastSnap.x - e.point.x, lastSnap.y - e.point.y) <= 2) snap = lastSnap.p;
      setCursor(snap ?? [e.lngLat.lng, e.lngLat.lat]);
    };
    const onMove = (e: MapMouseEvent) => {
      pending = e;
      if (!raf) raf = requestAnimationFrame(move);
    };
    const onLeave = () => {
      pending = null;
      setCursor(null);
    };
    const onClick = (e: MapMouseEvent) => {
      const now = performance.now();
      // The second click of a double-click lands on the same pixel: ignore it (dblclick then finishes).
      // Use the browser's click count; the time check is a fallback for synthetic events.
      const nth = (e.originalEvent as MouseEvent | undefined)?.detail ?? 1;
      if (nth >= 2) return;
      if (lastClick && now - lastClick.t < 420 && Math.hypot(e.point.x - lastClick.x, e.point.y - lastClick.y) < 4) return;
      lastClick = { x: e.point.x, y: e.point.y, t: now };
      let p: Vec2 = [e.lngLat.lng, e.lngLat.lat];
      const snap = snapAt(e.point.x, e.point.y);
      if (snap) p = snap;
      else if (lastSnap && Math.hypot(lastSnap.x - e.point.x, lastSnap.y - e.point.y) < 2) p = lastSnap.p;
      const k = toolRef.current;
      if (k === 'point') {
        commit('point', [p]);
        popTrigger();
        return;
      }
      setPoints((prev) => [...prev, p]);
      popTrigger();
    };
    const onDbl = (e: MapMouseEvent) => {
      e.preventDefault();
      finish();
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'Enter') {
        finish();
        e.preventDefault();
      } else if (e.key === 'Escape') cancel();
      else if (e.key === 'Backspace') {
        undo();
        e.preventDefault();
      }
    };
    map.on('mousemove', onMove);
    map.on('click', onClick);
    map.on('dblclick', onDbl);
    canvas.addEventListener('mouseleave', onLeave);
    window.addEventListener('keydown', onKey);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      map.off('mousemove', onMove);
      map.off('click', onClick);
      map.off('dblclick', onDbl);
      canvas.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onKey);
      map.doubleClickZoom.enable();
      canvas.style.cursor = '';
    };
  }, [tool, mapRef, overlayRef, commit, finish, cancel, undo, popTrigger]);

  const draft: MeasureDraft | null = useMemo(
    () => (tool && tool !== 'point' && points.length > 0 ? { kind: tool, points, cursor } : null),
    [tool, points, cursor],
  );

  const layers = useMemo(
    () =>
      buildMeasureLayers({
        finished,
        draft,
        fontFamily,
        anim: { labelOpacity: fadeT, pop: 0.35 + 0.65 * easeOutBack(popT) },
      }),
    [finished, draft, fontFamily, fadeT, popT],
  );

  const current: MeasureCurrent | null = useMemo(() => {
    if (draft) return { kind: draft.kind, points: draft.cursor ? [...draft.points, draft.cursor] : draft.points, isDraft: true };
    const sel = finished.find((m) => m.id === selectedId);
    return sel ? { kind: sel.kind, points: sel.points, isDraft: false } : null;
  }, [draft, finished, selectedId]);

  return { tool, setTool, finished, current, layers, clear, finish, undo, cancel, dismiss, active: tool !== null };
}
