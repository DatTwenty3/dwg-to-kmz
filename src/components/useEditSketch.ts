'use client';
// Editing a finished sketch on the map: drag a vertex to move it (snaps to drawing vertices like the draw
// tool), drag the small midpoint handle of an edge to insert a vertex there, right-click / Alt+click a vertex
// to delete it, drag the shape itself to move it whole. Mouse and touch. Each finished gesture is committed
// once (one undo step); the live preview is drawn here meanwhile.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Map as MlMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Vec2 } from '@/lib/cad/types';
import { SKETCH_MIN_POINTS, type SketchFeature } from '@/lib/cad/sketch';
import { nearestSnap, snapCandidatesOf } from '@/lib/map';

const HANDLE_PX = 10; // grab radius of a vertex
const MID_PX = 8;
const BODY_PX = 8; // grab distance from a line
const SNAP_PX = 8;
const ACCENT: [number, number, number] = [37, 99, 235];

type Drag =
  | { kind: 'vertex'; index: number; insert: boolean }
  | { kind: 'move'; from: Vec2; base: Vec2[] };

function segDistPx(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function insidePx(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface EditApi {
  layers: Layer[];
  /** A gesture is in progress (the map should not show hover cursors / popups). */
  dragging: boolean;
}

export function useEditSketch(
  mapRef: RefObject<MlMap | null>,
  overlayRef: RefObject<MapboxOverlay | null>,
  feature: SketchFeature | null,
  onCommit: (points: Vec2[]) => void,
): EditApi {
  // Live geometry while dragging; null = show the feature as stored.
  const [live, setLive] = useState<Vec2[] | null>(null);
  const featureRef = useRef(feature);
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    featureRef.current = feature;
    onCommitRef.current = onCommit;
  });

  // Another feature (or none): drop any preview.
  const [seenId, setSeenId] = useState(feature?.id);
  if (seenId !== feature?.id) {
    setSeenId(feature?.id);
    setLive(null);
  }

  const featureId = feature?.id;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !featureId) return;
    const canvas = map.getCanvas();
    let drag: Drag | null = null;
    let current: Vec2[] | null = null;
    let moved = false;

    const px = (p: Vec2): [number, number] => {
      const q = map.project(p);
      return [q.x, q.y];
    };
    const closed = () => featureRef.current?.kind === 'polygon';
    const midpoints = (pts: Vec2[]): Vec2[] => {
      const out: Vec2[] = [];
      const n = closed() ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      }
      return out;
    };

    /** What is under the pointer: a vertex, an edge midpoint, the shape, or nothing. */
    const hit = (at: [number, number]): { type: 'vertex' | 'mid'; index: number } | { type: 'body' } | null => {
      const f = featureRef.current;
      if (!f) return null;
      const pts = f.points;
      let best = -1;
      let bestD = HANDLE_PX;
      pts.forEach((p, i) => {
        const d = Math.hypot(px(p)[0] - at[0], px(p)[1] - at[1]);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) return { type: 'vertex', index: best };
      if (f.kind !== 'point') {
        const mids = midpoints(pts);
        for (let i = 0; i < mids.length; i++) {
          const q = px(mids[i]);
          if (Math.hypot(q[0] - at[0], q[1] - at[1]) <= MID_PX) return { type: 'mid', index: i };
        }
        const sp = pts.map(px);
        const n = f.kind === 'polygon' ? sp.length : sp.length - 1;
        for (let i = 0; i < n; i++) if (segDistPx(at, sp[i], sp[(i + 1) % sp.length]) <= BODY_PX) return { type: 'body' };
        if (f.kind === 'polygon' && insidePx(at, sp)) return { type: 'body' };
      }
      return null;
    };

    const snapAt = (x: number, y: number): Vec2 | null => {
      const overlay = overlayRef.current;
      if (!overlay) return null;
      try {
        // Ignore the edit handles themselves.
        const infos = overlay.pickMultipleObjects({ x, y, radius: SNAP_PX, depth: 4 });
        for (const info of infos) {
          if (info.layer?.id.startsWith('sketch-edit')) continue;
          const cands = snapCandidatesOf(info.object);
          const s = cands.length ? nearestSnap(cands, [x, y], px, SNAP_PX) : null;
          if (s) return s;
        }
      } catch {
        /* no snapping */
      }
      return null;
    };

    const start = (at: [number, number], lngLat: Vec2, alt: boolean, prevent: () => void): boolean => {
      const f = featureRef.current;
      if (!f) return false;
      const h = hit(at);
      if (!h) return false;
      prevent();
      if (h.type === 'vertex' && alt) {
        removeVertex(h.index);
        return true;
      }
      if (h.type === 'vertex') drag = { kind: 'vertex', index: h.index, insert: false };
      else if (h.type === 'mid') drag = { kind: 'vertex', index: h.index + 1, insert: true };
      else drag = { kind: 'move', from: lngLat, base: f.points };
      current = f.points;
      moved = false;
      map.dragPan.disable();
      canvas.style.cursor = drag.kind === 'move' ? 'grabbing' : 'crosshair';
      return true;
    };

    const update = (at: [number, number], lngLat: Vec2) => {
      const f = featureRef.current;
      if (!drag || !f) return;
      moved = true;
      if (drag.kind === 'move') {
        const dx = lngLat[0] - drag.from[0];
        const dy = lngLat[1] - drag.from[1];
        current = drag.base.map((p) => [p[0] + dx, p[1] + dy] as Vec2);
      } else {
        const p = snapAt(at[0], at[1]) ?? lngLat;
        const pts = drag.insert && current === f.points ? [...f.points.slice(0, drag.index), p, ...f.points.slice(drag.index)] : [...(current ?? f.points)];
        pts[drag.index] = p;
        current = pts;
      }
      setLive(current);
    };

    const end = () => {
      if (!drag) return;
      const changed = moved && current && current !== featureRef.current?.points;
      drag = null;
      map.dragPan.enable();
      canvas.style.cursor = '';
      if (changed && current) onCommitRef.current(current);
      setLive(null);
      current = null;
    };

    const removeVertex = (index: number) => {
      const f = featureRef.current;
      if (!f || f.points.length <= SKETCH_MIN_POINTS[f.kind]) return;
      onCommitRef.current(f.points.filter((_, i) => i !== index));
    };

    const onDown = (e: MapMouseEvent) => {
      const me = e.originalEvent as MouseEvent;
      if (me.button !== 0) return;
      start([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat], me.altKey, () => e.preventDefault());
    };
    const onMove = (e: MapMouseEvent) => {
      if (drag) {
        update([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      const h = hit([e.point.x, e.point.y]);
      canvas.style.cursor = !h ? '' : h.type === 'body' ? 'move' : h.type === 'mid' ? 'copy' : 'pointer';
    };
    const onContext = (e: MapMouseEvent) => {
      const h = hit([e.point.x, e.point.y]);
      if (h?.type === 'vertex') {
        e.preventDefault();
        removeVertex(h.index);
      }
    };
    const onTouchStart = (e: MapTouchEvent) => {
      if (e.points.length !== 1) return;
      start([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat], false, () => e.preventDefault());
    };
    const onTouchMove = (e: MapTouchEvent) => {
      if (!drag) return;
      e.preventDefault();
      update([e.point.x, e.point.y], [e.lngLat.lng, e.lngLat.lat]);
    };
    // Swallow the click that ends a drag, so it does not select something under the pointer.
    const onClickCapture = (ev: MouseEvent) => {
      if (moved) {
        ev.stopPropagation();
        moved = false;
      }
    };

    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('contextmenu', onContext);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    canvas.addEventListener('click', onClickCapture, true);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('contextmenu', onContext);
      map.off('touchstart', onTouchStart);
      map.off('touchmove', onTouchMove);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      canvas.removeEventListener('click', onClickCapture, true);
      map.dragPan.enable();
      canvas.style.cursor = '';
    };
  }, [featureId, mapRef, overlayRef]);

  const layers = useMemo<Layer[]>(() => {
    if (!feature) return [];
    const pts = live ?? feature.points;
    const out: Layer[] = [];
    if (feature.kind === 'polygon' && pts.length >= 3) {
      out.push(
        new PolygonLayer<Vec2[]>({
          id: 'sketch-edit-shape',
          data: [pts],
          getPolygon: (d) => d,
          filled: true,
          stroked: true,
          getFillColor: [...ACCENT, 28],
          getLineColor: [...ACCENT, 255],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          pickable: false,
        }),
      );
    } else if (feature.kind === 'line' && pts.length >= 2) {
      out.push(
        new PathLayer<Vec2[]>({
          id: 'sketch-edit-shape',
          data: [pts],
          getPath: (d) => d,
          getColor: [...ACCENT, 255],
          getWidth: 2,
          widthUnits: 'pixels',
          pickable: false,
        }),
      );
    }
    if (feature.kind !== 'point' && pts.length >= 2) {
      const mids: Vec2[] = [];
      const n = feature.kind === 'polygon' ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      }
      out.push(
        new ScatterplotLayer<Vec2>({
          id: 'sketch-edit-mids',
          data: mids,
          getPosition: (d) => d,
          getRadius: 4,
          radiusUnits: 'pixels',
          getFillColor: [255, 255, 255, 200],
          getLineColor: [...ACCENT, 200],
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
          stroked: true,
          pickable: false,
        }),
      );
    }
    out.push(
      new ScatterplotLayer<Vec2>({
        id: 'sketch-edit-vertices',
        data: pts,
        getPosition: (d) => d,
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: [255, 255, 255, 255],
        getLineColor: [...ACCENT, 255],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        stroked: true,
        pickable: false,
      }),
    );
    return out;
  }, [feature, live]);

  return { layers, dragging: live !== null };
}
