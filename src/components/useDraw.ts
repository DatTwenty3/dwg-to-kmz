'use client';
// Sketch drawing input on the map: click to add vertices (snapping to drawing vertices), double-click / Enter
// to finish, Backspace to remove the last vertex, Esc to cancel. The tool itself is controlled by the caller.
// The draft is drawn with the measurement layers, so segment lengths show while drawing.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import type { Vec2 } from '@/lib/cad/types';
import { SKETCH_MIN_POINTS, type SketchKind } from '@/lib/cad/sketch';
import { buildMeasureLayers, nearestSnap, snapCandidatesOf, type MeasureTool } from '@/lib/map';

const SNAP_PX = 8;
const PICK_INTERVAL_MS = 90;
const AS_MEASURE: Record<SketchKind, MeasureTool> = { line: 'distance', polygon: 'area', point: 'point' };

export interface DrawApi {
  /** Vertices placed so far (without the live cursor). */
  points: Vec2[];
  layers: Layer[];
  finish: () => void;
  undo: () => void;
  cancel: () => void;
}

export function useDraw(
  mapRef: RefObject<MlMap | null>,
  overlayRef: RefObject<MapboxOverlay | null>,
  fontFamily: string | undefined,
  tool: SketchKind | null,
  onCommit: (kind: SketchKind, points: Vec2[]) => void,
  onExit: () => void,
): DrawApi {
  const [points, setPoints] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const toolRef = useRef(tool);
  const pointsRef = useRef(points);
  const onCommitRef = useRef(onCommit);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    toolRef.current = tool;
    pointsRef.current = points;
    onCommitRef.current = onCommit;
    onExitRef.current = onExit;
  });

  // A new tool starts a fresh draft (adjust state during render, not in an effect).
  const [seenTool, setSeenTool] = useState(tool);
  if (seenTool !== tool) {
    setSeenTool(tool);
    setPoints([]);
    setCursor(null);
  }

  const commit = useCallback((kind: SketchKind, pts: Vec2[]) => {
    if (pts.length < SKETCH_MIN_POINTS[kind]) return;
    onCommitRef.current(kind, pts);
    setPoints([]);
  }, []);
  const finish = useCallback(() => {
    const k = toolRef.current;
    if (k && k !== 'point') commit(k, pointsRef.current);
  }, [commit]);
  const undo = useCallback(() => setPoints((p) => p.slice(0, -1)), []);
  const cancel = useCallback(() => {
    if (pointsRef.current.length) setPoints([]);
    else onExitRef.current();
  }, []);

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
    let lastPick = 0;

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
    const move = () => {
      raf = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      let snap: Vec2 | null = null;
      if (performance.now() - lastPick >= PICK_INTERVAL_MS) {
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
      const nth = (e.originalEvent as MouseEvent | undefined)?.detail ?? 1;
      if (nth >= 2) return; // second click of a double-click: dblclick finishes instead
      if (lastClick && now - lastClick.t < 420 && Math.hypot(e.point.x - lastClick.x, e.point.y - lastClick.y) < 4) return;
      lastClick = { x: e.point.x, y: e.point.y, t: now };
      let p: Vec2 = [e.lngLat.lng, e.lngLat.lat];
      const snap = snapAt(e.point.x, e.point.y);
      if (snap) p = snap;
      else if (lastSnap && Math.hypot(lastSnap.x - e.point.x, lastSnap.y - e.point.y) < 2) p = lastSnap.p;
      if (toolRef.current === 'point') {
        commit('point', [p]);
        return;
      }
      setPoints((prev) => [...prev, p]);
    };
    const onDbl = (e: MapMouseEvent) => {
      e.preventDefault();
      finish();
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
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
  }, [tool, mapRef, overlayRef, commit, finish, cancel, undo]);

  const layers = useMemo(() => {
    if (!tool || tool === 'point') return [];
    if (points.length === 0 && !cursor) return [];
    return buildMeasureLayers({
      finished: [],
      draft: points.length ? { kind: AS_MEASURE[tool], points, cursor } : null,
      fontFamily,
    });
  }, [tool, points, cursor, fontFamily]);

  return { points, layers, finish, undo, cancel };
}
