'use client';
import type { CadEntity } from '@/lib/cad/types';
import type { PickRef } from '@/lib/map';
import { IconX } from './icons';

const KIND_LABEL: Record<CadEntity['kind'], string> = {
  polyline: 'Đường (polyline)',
  polygon: 'Vùng tô (hatch/solid)',
  text: 'Chữ (text/mtext)',
  table: 'Bảng',
  point: 'Điểm',
};

export default function EntityPopup({ pick, onClose }: { pick: PickRef; onClose: () => void }) {
  const e = pick.entity;
  const rows: [string, string][] = [['Layer', e.layer]];
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
    <div className="ui-floating overflow-hidden text-xs text-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-zinc-900/10" style={{ background: e.color }} title={e.color} />
        <b className="text-[13px] font-semibold">{KIND_LABEL[e.kind]}</b>
        <button aria-label="Đóng" className="ml-auto rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900" onClick={onClose}>
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
