'use client';
// Result card for the measurement tools: plain length / area (ground, WGS84 ellipsoid), segments, copy buttons;
// the point tool shows lat/lng and the drawing-CRS X/Y.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CrsOptions, Vec2 } from '@/lib/cad/types';
import {
  createInversePointTransformer,
  formatArea,
  formatLength,
  geodesicArea,
  pathLength,
} from '@/lib/geo';
import { fmtLngLat, segmentsOf, type MeasureTool } from '@/lib/map';
import type { MeasureCurrent } from './useMeasure';
import { IconArea, IconCheck, IconCopy, IconPin, IconRuler, IconX } from './icons';

const TITLE: Record<MeasureTool, string> = { distance: 'Khoảng cách', area: 'Diện tích', point: 'Tọa độ điểm' };
const ICON: Record<MeasureTool, typeof IconRuler> = { distance: IconRuler, area: IconArea, point: IconPin };

function attempt<T>(f: () => T): T | null {
  try {
    const v = f();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}
const num = (n: number, d = 2) => n.toLocaleString('vi-VN', { maximumFractionDigits: d });
const len = (m: number | null) => (m === null || !Number.isFinite(m) ? '—' : (attempt(() => formatLength(m)) ?? `${num(m)} m`));
const area = (m: number | null) => (m === null || !Number.isFinite(m) ? '—' : (attempt(() => formatArea(m)) ?? `${num(m)} m²`));

export interface MeasureStats {
  geoLength: number | null;
  geoArea: number | null;
  segments: number[];
  /** Drawing-CRS X/Y of a single point. */
  xy: Vec2 | null;
}

export function computeStats(cur: MeasureCurrent, crs: CrsOptions | null): MeasureStats {
  const closed = cur.kind === 'area';
  const pts = cur.points;
  const segments = segmentsOf(pts, closed).map((s) => s.length);
  const geoLength = pts.length >= 2 ? attempt(() => pathLength(pts, closed)) : null;
  const geoArea = closed && pts.length >= 3 ? attempt(() => geodesicArea(pts)) : null;
  // Drawing-CRS coordinates only matter for the point tool.
  const xy = crs && cur.kind === 'point' && pts[0] ? (attempt(() => createInversePointTransformer(crs)(pts[0][0], pts[0][1])) as Vec2 | null) : null;
  return { geoLength, geoArea, segments, xy };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <button
      className="ui-icon-btn !h-6 !w-6"
      title={`Chép ${label}`}
      aria-label={`Chép ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        clearTimeout(t.current);
        t.current = setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <IconCheck width={13} height={13} className="text-emerald-600" /> : <IconCopy width={13} height={13} />}
    </button>
  );
}

function Row({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <dt className="min-w-0 flex-1 text-zinc-500">{label}</dt>
      <dd className="font-medium tabular-nums text-zinc-900">{value}</dd>
      {copy !== undefined ? <CopyButton text={copy} label={label.toLowerCase()} /> : <span className="w-6" />}
    </div>
  );
}

export default function MeasureCard({
  current,
  drawingCrs,
  crsLabel,
  onClose,
}: {
  current: MeasureCurrent;
  drawingCrs: CrsOptions | null;
  /** Name of the planar system, e.g. "VN-2000". */
  crsLabel: string;
  onClose: () => void;
}) {
  const stats = useMemo(() => computeStats(current, drawingCrs), [current, drawingCrs]);
  const Icon = ICON[current.kind];
  const isArea = current.kind === 'area';
  const isPoint = current.kind === 'point';
  const p0 = current.points[0];
  const hero = isPoint ? (p0 ? fmtLngLat(p0) : '—') : isArea ? area(stats.geoArea) : len(stats.geoLength);
  const lenWord = isArea ? 'Chu vi' : 'Chiều dài';
  // Length / area: one plain (ground) value each. Only the point tool shows both WGS84 and drawing-CRS coordinates.
  const summary = [
    TITLE[current.kind],
    ...(isPoint
      ? [`Vĩ độ, kinh độ: ${hero}`, ...(stats.xy ? [`X, Y (${crsLabel}): ${num(stats.xy[0], 3)}, ${num(stats.xy[1], 3)}`] : [])]
      : isArea
        ? [`Diện tích: ${stats.geoArea === null ? '—' : num(stats.geoArea)} m² (${area(stats.geoArea)})`, `Chu vi: ${len(stats.geoLength)}`]
        : [`Chiều dài: ${len(stats.geoLength)}`]),
  ].join('\n');

  return (
    <div
      className="ui-floating ui-pop-in w-[19rem] max-w-[calc(100vw-24px)] overflow-hidden text-xs text-zinc-900"
      role="region"
      aria-label="Kết quả đo"
    >
      <div className="flex items-center gap-2 px-3.5 pb-1 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600">
          <Icon width={14} height={14} />
        </span>
        <b className="text-[13px] font-semibold">{TITLE[current.kind]}</b>
        {current.isDraft && <span className="ui-chip !bg-blue-50 !text-blue-700">đang đo</span>}
        <span className="ml-auto" />
        <CopyButton text={summary} label="kết quả" />
        <button className="ui-icon-btn !h-6 !w-6" aria-label="Đóng kết quả" title="Đóng" onClick={onClose}>
          <IconX width={14} height={14} />
        </button>
      </div>
      <div className="px-3.5 pb-1 text-[22px] font-semibold tracking-tight tabular-nums" aria-live="polite" data-testid="measure-hero">
        {hero}
      </div>
      <dl className="divide-y divide-zinc-100 px-3.5 pb-2">
        {isPoint ? (
          <>
            <Row label="Vĩ độ" value={p0 ? `${p0[1].toFixed(6)}°` : '—'} copy={p0 ? p0[1].toFixed(6) : ''} />
            <Row label="Kinh độ" value={p0 ? `${p0[0].toFixed(6)}°` : '—'} copy={p0 ? p0[0].toFixed(6) : ''} />
            {stats.xy && (
              <>
                <Row label={`X (${crsLabel})`} value={num(stats.xy[0], 3)} copy={stats.xy[0].toFixed(3)} />
                <Row label={`Y (${crsLabel})`} value={num(stats.xy[1], 3)} copy={stats.xy[1].toFixed(3)} />
              </>
            )}
          </>
        ) : (
          <>
            {isArea && (
              <Row
                label="Diện tích"
                value={`${stats.geoArea === null ? '—' : num(stats.geoArea)} m²`}
                copy={stats.geoArea === null ? '' : stats.geoArea.toFixed(2)}
              />
            )}
            <Row label={lenWord} value={len(stats.geoLength)} copy={stats.geoLength === null ? '' : stats.geoLength.toFixed(2)} />
          </>
        )}
      </dl>
      {!isPoint && stats.segments.length > 1 && (
        <details className="border-t border-zinc-100 px-3.5 py-2">
          <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-900">{stats.segments.length} đoạn</summary>
          <ol className="ui-scroll mt-1.5 max-h-28 space-y-0.5 overflow-y-auto pr-1 tabular-nums">
            {stats.segments.map((s, i) => (
              <li key={i} className="flex justify-between text-zinc-600">
                <span className="text-zinc-400">{i + 1}</span>
                {len(s)}
              </li>
            ))}
          </ol>
        </details>
      )}
      {current.isDraft && (
        <p className="border-t border-zinc-100 bg-zinc-50 px-3.5 py-2 leading-relaxed text-zinc-500">
          Nhấp để thêm điểm · Nhấp đúp hoặc Enter để kết thúc · Backspace xóa điểm cuối · Esc hủy
        </p>
      )}
    </div>
  );
}
