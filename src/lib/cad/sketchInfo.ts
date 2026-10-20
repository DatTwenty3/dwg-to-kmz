// What the info card of a drawn object (sketch) shows: name, kind, size on the ground, vertices. Pure.
import { formatArea, formatLength, geodesicArea, pathLength } from '@/lib/geo';
import type { SketchFeature, SketchKind } from './sketch';

export const SKETCH_KIND_LABEL: Record<SketchKind, string> = { line: 'Đường', polygon: 'Vùng', point: 'Điểm' };

/** Ground measure that may fail on degenerate input: null instead of NaN / a throw. */
function safe(f: () => number): number | null {
  try {
    const v = f();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Rows [label, value] for the card of a sketch: size on the ground (WGS84 ellipsoid), vertices, label. */
export function sketchInfoRows(f: SketchFeature): [string, string][] {
  const rows: [string, string][] = [['Tên', f.name]];
  if (f.kind === 'point') {
    const [lng, lat] = f.points[0];
    rows.push(['Vĩ độ', lat.toFixed(7)], ['Kinh độ', lng.toFixed(7)]);
  } else if (f.kind === 'line') {
    const l = safe(() => pathLength(f.points, false));
    if (l !== null) rows.push(['Chiều dài', formatLength(l)]);
    rows.push(['Số đỉnh', String(f.points.length)]);
  } else {
    const a = safe(() => Math.abs(geodesicArea(f.points)));
    const p = safe(() => pathLength(f.points, true));
    if (a !== null) rows.push(['Diện tích', formatArea(a)]);
    if (p !== null) rows.push(['Chu vi', formatLength(p)]);
    rows.push(['Số đỉnh', String(f.points.length)]);
  }
  if (f.label) rows.push(['Nhãn', f.label]);
  return rows;
}
