'use client';
// Coordinates of a searched point in both systems, each value copyable: WGS84 latitude / longitude and VN-2000
// X (Bắc) / Y (Đông). The VN-2000 zone can be switched here to convert (the point itself does not move).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CrsOptions, Vec2 } from '@/lib/cad/types';
import {
  createSurveyPointTransformer,
  formatDegMin,
  isGeographic,
  resolveCrsInput,
  vn2000Candidates,
  VN2000_ZONES,
  zoneByKey,
  zoneProj4,
} from '@/lib/geo';
import { IconCheck, IconCopy, IconPin, IconX } from './icons';

/** 'auto' = the drawing's CRS when projected, else VN-2000 of the province under the point. */
export type ZoneChoice = 'auto' | string;

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <button
      className="ui-icon-btn !h-6 !w-6 shrink-0"
      title={`Chép ${label}`}
      aria-label={`Chép ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard blocked: nothing else to do */
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

const fmt = (n: number, d: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function CoordCard({
  lngLat,
  zone: initialZone,
  drawingCrs,
  onClose,
}: {
  lngLat: Vec2;
  /** Zone the coordinates were searched in (X/Y queries) or the default zone of the search bar. */
  zone: ZoneChoice;
  drawingCrs: CrsOptions | null;
  onClose: () => void;
}) {
  const [zone, setZone] = useState<ZoneChoice>(initialZone);
  const [lng, lat] = lngLat;

  const drawingProjected = useMemo(() => {
    if (!drawingCrs) return false;
    const r = resolveCrsInput(drawingCrs.proj4);
    return r.ok && !isGeographic(r.proj4);
  }, [drawingCrs]);
  const auto = useMemo(() => vn2000Candidates(lng, lat)[0] ?? null, [lng, lat]);

  const { xy, crsName } = useMemo(() => {
    let crs: CrsOptions | null = null;
    let name = '';
    const z = zone === 'auto' ? null : zoneByKey(zone);
    if (z) {
      crs = { proj4: zoneProj4(z), swapXY: false, unitScale: 1 };
      name = z.zone === 6 ? `VN-2000 múi 6°, KTT ${z.lon0}°` : `VN-2000 KTT ${formatDegMin(z.lon0)} (${z.label.split(' · ')[0]})`;
    } else if (drawingProjected && drawingCrs) {
      crs = drawingCrs;
      name = 'Hệ tọa độ của bản vẽ';
    } else if (auto) {
      crs = { proj4: auto.proj4, swapXY: false, unitScale: 1 };
      name = `VN-2000 KTT ${formatDegMin(auto.lon0)} (${auto.province})`;
    }
    let p: Vec2 | null = null;
    try {
      p = crs ? (createSurveyPointTransformer(crs)?.(lng, lat) ?? null) : null;
    } catch {
      p = null;
    }
    return { xy: p, crsName: name };
  }, [zone, drawingProjected, drawingCrs, auto, lng, lat]);

  const latS = lat.toFixed(6);
  const lngS = lng.toFixed(6);
  const all = [`Vĩ độ, kinh độ (WGS84): ${latS}, ${lngS}`, ...(xy ? [`X (Bắc), Y (Đông) — ${crsName}: ${xy[0].toFixed(3)}, ${xy[1].toFixed(3)}`] : [])].join('\n');

  const row = (label: string, value: string, copy: string) => (
    <div className="flex items-center gap-2 py-1">
      <dt className="min-w-0 flex-1 text-zinc-500">{label}</dt>
      <dd className="font-medium tabular-nums text-zinc-900">{value}</dd>
      <Copy text={copy} label={label.toLowerCase()} />
    </div>
  );

  return (
    <div className="ui-floating ui-pop-in mt-2 overflow-hidden text-xs" role="region" aria-label="Tọa độ điểm tìm được">
      <div className="flex items-center gap-2 px-3.5 pb-1 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600">
          <IconPin width={14} height={14} />
        </span>
        <b className="flex-1 text-[13px] font-semibold text-zinc-900">Tọa độ điểm</b>
        <Copy text={all} label="tất cả tọa độ" />
        <button className="ui-icon-btn !h-6 !w-6" aria-label="Đóng thông tin tọa độ" onClick={onClose}>
          <IconX width={14} height={14} />
        </button>
      </div>
      <dl className="divide-y divide-zinc-100 px-3.5">
        <div className="pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">WGS84</div>
        {row('Vĩ độ', `${latS}°`, latS)}
        {row('Kinh độ', `${lngS}°`, lngS)}
        {row('Vĩ độ, kinh độ', `${latS}, ${lngS}`, `${latS}, ${lngS}`)}
        <div className="pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">VN-2000</div>
        {xy ? (
          <>
            {row('X – Bắc', fmt(xy[0], 3), xy[0].toFixed(3))}
            {row('Y – Đông', fmt(xy[1], 3), xy[1].toFixed(3))}
            {row('X, Y', `${fmt(xy[0], 3)}; ${fmt(xy[1], 3)}`, `${xy[0].toFixed(3)}, ${xy[1].toFixed(3)}`)}
          </>
        ) : (
          <div className="py-1.5 text-zinc-400">Điểm nằm ngoài Việt Nam — hãy chọn múi chiếu bên dưới.</div>
        )}
      </dl>
      <label className="flex items-center gap-2 px-3.5 pb-3 pt-1.5 text-[10.5px] text-zinc-400">
        <span className="shrink-0">Múi chiếu</span>
        <select
          className="ui-input min-w-0 flex-1 !py-1 !text-[11px]"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          aria-label="Múi chiếu VN-2000 để quy đổi"
          title={crsName}
        >
          <option value="auto">
            {drawingProjected ? 'Tự động (theo bản vẽ)' : auto ? `Tự động (${auto.province.split(', ')[0]} · KTT ${formatDegMin(auto.lon0)})` : 'Tự động'}
          </option>
          {VN2000_ZONES.map((z) => (
            <option key={z.key} value={z.key}>
              {z.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
