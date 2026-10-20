'use client';
// CAD-style selection box on the map, together with plain clicking: while enabled, a click (no drag) is left to
// the map (it picks the object under the pointer) and a left-button drag draws a rectangle instead of panning —
// left → right = window (wholly inside), right → left = crossing (touching), as in AutoCAD. A drag that starts on a
// vertex grip belongs to the grips. The map is still panned with the middle button and zoomed with the wheel.
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { Vec2 } from '@/lib/cad/types';

const DRAG_PX = 4;

export interface BoxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function useBoxSelect(
  mapRef: RefObject<MlMap | null>,
  /** Called with the box corners ([lng, lat] ring) and `crossing` (dragged right → left). null = off. */
  onBox: ((ring: Vec2[], crossing: boolean) => void) | null,
  /** True when the pointer (px in the map) is over a vertex grip: that drag is not a box. */
  isOverGrip: (at: [number, number]) => boolean,
  /** Set after a drag so the page ignores the click that ends it. */
  suppressClick: MutableRefObject<boolean>,
): { box: BoxRect | null } {
  const [box, setBox] = useState<BoxRect | null>(null);
  const onBoxRef = useRef(onBox);
  const overGripRef = useRef(isOverGrip);
  useEffect(() => {
    onBoxRef.current = onBox;
    overGripRef.current = isOverGrip;
  });
  const enabled = onBox !== null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enabled) return;
    const container = map.getContainer();
    const surface = map.getCanvasContainer();
    const previousCursor = surface.style.cursor;
    surface.style.cursor = 'crosshair';
    let start: { x: number; y: number } | null = null;
    let dragging = false;

    const local = (ev: MouseEvent) => {
      const r = container.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const onDown = (e: MapMouseEvent) => {
      const me = e.originalEvent as MouseEvent;
      if (me.button !== 0 || overGripRef.current([e.point.x, e.point.y])) return;
      // No panning with the left button while selecting; a click without moving still reaches the map.
      e.preventDefault();
      map.dragPan.disable();
      start = { x: e.point.x, y: e.point.y };
      dragging = false;
    };
    const onMove = (ev: MouseEvent) => {
      if (!start) return;
      const p = local(ev);
      if (!dragging && Math.hypot(p.x - start.x, p.y - start.y) > DRAG_PX) dragging = true;
      if (dragging) setBox({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
    };
    const onUp = (ev: MouseEvent) => {
      if (!start) return;
      const s = start;
      const was = dragging;
      start = null;
      dragging = false;
      map.dragPan.enable();
      setBox(null);
      if (!was) return;
      const p = local(ev);
      const corners: [number, number][] = [
        [s.x, s.y],
        [p.x, s.y],
        [p.x, p.y],
        [s.x, p.y],
      ];
      onBoxRef.current?.(
        corners.map(([x, y]) => {
          const ll = map.unproject([x, y]);
          return [ll.lng, ll.lat] as Vec2;
        }),
        p.x < s.x,
      );
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 80);
    };

    map.on('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      map.off('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      map.dragPan.enable();
      surface.style.cursor = previousCursor;
      setBox(null);
    };
  }, [enabled, mapRef, suppressClick]);

  return { box };
}
