'use client';
import { useState } from 'react';
import type { CadEntity, Vec2 } from '@/lib/cad/types';
import { formatArea, formatLength, geodesicArea, pathLength } from '@/lib/geo';
import type { PickRef } from '@/lib/map';
import { IconCheck, IconCopy, IconX } from './icons';

/** Ground measures (WGS84 ellipsoid) of a line / area, or nothing when they cannot be computed. */
function measures(e: CadEntity): [string, string][] {
  const safe = <T,>(f: () => T): T | null => {
    try {
      const v = f();
      return typeof v === 'number' && !Number.isFinite(v) ? null : v;
    } catch {
      return null;
    }
  };
  const areaOf = (outer: Vec2[], holes: Vec2[][] = []) =>
    safe(() => Math.abs(geodesicArea(outer)) - holes.reduce((t, h) => t + Math.abs(geodesicArea(h)), 0));
  const out: [string, string][] = [];
  if (e.kind === 'polygon' && e.rings[0]?.length >= 3) {
    const a = areaOf(e.rings[0], e.rings.slice(1));
    const p = safe(() => pathLength(e.rings[0], true));
    if (a !== null) out.push(['Diện tích', formatArea(a)]);
    if (p !== null) out.push(['Chu vi', formatLength(p)]);
  } else if (e.kind === 'polyline' && e.points.length >= 2) {
    if (e.closed && e.points.length >= 3) {
      const a = areaOf(e.points);
      if (a !== null) out.push(['Diện tích', formatArea(a)]);
    }
    const l = safe(() => pathLength(e.points, e.closed));
    if (l !== null) out.push([e.closed ? 'Chu vi' : 'Chiều dài', formatLength(l)]);
  }
  return out;
}

const KIND_LABEL: Record<CadEntity['kind'], string> = {
  polyline: 'Đường (polyline)',
  polygon: 'Vùng tô (hatch/solid)',
  text: 'Chữ (text/mtext)',
  table: 'Bảng',
  point: 'Điểm',
};

export default function EntityPopup({
  pick,
  file,
  onClose,
}: {
  pick: PickRef;
  /** Shown when several files are open: which one the object belongs to. */
  file?: { name: string; tag: string };
  onClose: () => void;
}) {
  const e = pick.entity;
  const rows: [string, string][] = [];
  const [copied, setCopied] = useState(false);
  if (file) rows.push(['File', file.name]);
  rows.push(['Layer', e.layer]);
  rows.push(...measures(e));
  if (e.kind === 'text') {
    rows.push(['Nội dung', e.text]);
    rows.push(['Cao chữ', `${e.height.toFixed(2)} m`]);
    rows.push(['Góc', `${e.rotation.toFixed(1)}°`]);
  } else if (e.kind === 'polyline') {
    rows.push(['Số đỉnh', String(e.points.length)]);
    rows.push(['Khép kín', e.closed ? 'có' : 'không']);
    if (e.width) rows.push(['Bề rộng', `${e.width.toFixed(2)} m`]);
  } else if (e.kind === 'polygon') {
    if (e.pattern) rows.push(['Mẫu hatch', e.pattern]);
    rows.push(['Số vòng', `${e.rings.length} (${Math.max(0, e.rings.length - 1)} lỗ)`]);
  } else if (e.kind === 'table') {
    rows.push(['Kích thước', `${e.rows} hàng × ${e.cols} cột`]);
    if (pick.cell) {
      rows.push(['Ô', `hàng ${pick.cell.r + 1}, cột ${pick.cell.c + 1}`]);
      rows.push(['Nội dung ô', pick.cell.text]);
    }
  }
  rows.push(['Handle', e.handle ?? '—']);

  return (
    <div className="ui-floating overflow-hidden text-[13px] text-zinc-900 sm:text-xs">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-zinc-900/10" style={{ background: e.color }} title={e.color} />
        <b className="text-[13px] font-semibold">{KIND_LABEL[e.kind]}</b>
        <button
          aria-label="Chép thông tin"
          title="Chép thông tin"
          className="ml-auto rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 sm:p-1"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText([KIND_LABEL[e.kind], ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n'));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {copied ? <IconCheck width={14} height={14} className="text-emerald-600" /> : <IconCopy width={14} height={14} />}
        </button>
        <button aria-label="Đóng" className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 sm:p-1" onClick={onClose}>
          <IconX width={14} height={14} />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-3.5 py-3">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="whitespace-nowrap text-zinc-400">{k}</dt>
            <dd className="whitespace-pre-wrap break-words text-zinc-800">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
