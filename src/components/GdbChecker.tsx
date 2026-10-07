'use client';
// Kiểm tra cơ sở dữ liệu GIS (File Geodatabase) theo Thông tư 16/2025/TT-BXD. Bố cục kiểu trình duyệt GIS:
// cây Feature Dataset / Feature Class bên trái, bảng "Lỗi cần sửa & Cảnh báo" đánh số bên phải, bảng thuộc tính của
// lớp đang chọn ở dưới bản đồ vệ tinh (cột thiếu/thừa, ô sai tô đỏ), danh sách lỗi ở cột bên phải.
// Đọc hoàn toàn trên trình duyệt (worker), không tải lên máy chủ.
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CadDocument } from '@/lib/cad/types';
import {
  cellProblem,
  RULE_HINT,
  type ClassReport,
  type DatasetReport,
  type GdbReport,
  type Level,
  type SrInfo,
  type Status,
  type SubmissionReport,
} from '@/lib/gdb/check';
import { suggestProvince, type ProvinceSuggestion } from '@/lib/gdb/crs';
import { ROOT, rowsFor, type Row, type Selection } from '@/lib/gdb/rows';
import { describeMaThongTin, parseMaHoSo, parseMaThongTin, PROVINCE_CODES, TT16_FIELDS } from '@/lib/gdb/tt16';
import type { GdbWorkerRequest, GdbWorkerResponse } from '@/workers/gdb.worker';
import {
  IconAlert,
  IconArrowLeft,
  IconCheckCircle,
  IconChevron,
  IconCircleDashed,
  IconDatabaseCheck,
  IconDownload,
  IconFolderOpen,
  IconGeomLine,
  IconGeomPoint,
  IconGeomPolygon,
  IconPlusCircle,
  IconSearch,
  IconSpinner,
  IconUpload,
  IconX,
  IconXCircle,
  Logo,
} from './icons';
import GdbMap from './GdbMap';

type Picked = { path: string; file: File };
type Filter = 'all' | 'issues' | 'present';

const BRAND = 'LEDAT-GIS';
const fmt = (n: number) => n.toLocaleString('vi-VN');
const PROBLEM: Status[] = ['error', 'missing', 'warn'];
const isProblem = (s: Status) => PROBLEM.includes(s);

const STATUS_LABEL: Record<Status, string> = {
  ok: 'Đúng',
  warn: 'Cần xem lại',
  error: 'Sai',
  missing: 'Thiếu',
  absent: 'Chưa có',
  extra: 'Bổ sung',
};

function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  const p = { width: size, height: size, 'aria-label': STATUS_LABEL[status] };
  if (status === 'ok') return <IconCheckCircle {...p} className="shrink-0 text-emerald-600" />;
  if (status === 'warn') return <IconAlert {...p} className="shrink-0 text-amber-500" />;
  if (status === 'error' || status === 'missing') return <IconXCircle {...p} className="shrink-0 text-red-600" />;
  if (status === 'extra') return <IconPlusCircle {...p} className="shrink-0 text-blue-600" />;
  return <IconCircleDashed {...p} className="shrink-0 text-zinc-300" />;
}

function GeomIcon({ geom }: { geom: 'A' | 'L' | 'P' | null }) {
  if (geom === 'P') return <IconGeomPoint width={14} height={14} className="shrink-0 text-rose-500" />;
  if (geom === 'L') return <IconGeomLine width={14} height={14} className="shrink-0 text-blue-600" />;
  if (geom === 'A') return <IconGeomPolygon width={14} height={14} className="shrink-0 text-emerald-600" />;
  return <span className="h-3.5 w-3.5 shrink-0" />;
}

const dms = (deg: number) => {
  const d = Math.floor(deg + 1e-9);
  const m = Math.round((deg - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}'`;
};
const srLine = (sr: SrInfo | null) =>
  sr ? [sr.vn2000 ? 'VN2000' : sr.name, sr.lon0 !== null ? dms(sr.lon0) : null, sr.zone ? `Múi ${sr.zone}°` : null].filter(Boolean).join(' • ') : null;

const TYPE_LABEL: Record<string, string> = {
  string: 'String',
  int16: 'Short',
  int32: 'Integer',
  int64: 'BigInteger',
  float32: 'Float',
  float64: 'Double',
  datetime: 'Date',
  date: 'DateOnly',
  time: 'TimeOnly',
  datetimeoffset: 'TimestampOffset',
  objectid: 'ObjectID',
  geometry: 'Geometry',
  guid: 'GUID',
  globalid: 'GlobalID',
  xml: 'XML',
  binary: 'Blob',
  raster: 'Raster',
};

// ---- File collection (folder drop / folder picker / zip) --------------------------------------------------

async function fromDataTransfer(dt: DataTransfer): Promise<Picked[]> {
  const out: Picked[] = [];
  const roots = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!roots.length) return [...dt.files].map((f) => ({ path: f.name, file: f }));
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns batches (≤100 in Chrome) until an empty one.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const r of roots) await walk(r, '');
  return out;
}

const fromInput = (files: FileList): Picked[] => [...files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));

// ---- CSV report -------------------------------------------------------------------------------------------

function toCsv(rep: SubmissionReport): string {
  const rows: string[][] = [['STT', 'CSDL', 'Nhóm dữ liệu', 'Lớp dữ liệu', 'Trường', 'Mức', 'Nội dung']];
  const LV: Record<Level, string> = { error: 'Lỗi', warn: 'Cảnh báo', info: 'Ghi chú' };
  for (const g of rep.gdbs)
    for (const r of rowsFor(rep, g, { ds: null, cls: null }))
      rows.push([String(rows.length), g.fileName, r.ds ?? '', r.kind === 'Feature Class' ? r.name : '', r.field ?? '', LV[r.level], r.example ? `${r.text}, vd. "${r.example}"` : r.text]);
  const esc = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ---- Tree (left) ------------------------------------------------------------------------------------------

function matches(q: string, ...names: (string | null | undefined)[]) {
  return !q || names.some((n) => n && n.toLowerCase().includes(q));
}

function visibleClass(c: ClassReport, filter: Filter, q: string) {
  if (filter === 'issues' && !isProblem(c.status)) return false;
  if (filter === 'present' && c.status === 'absent') return false;
  return matches(q, c.name, c.actualName, c.alias);
}

function ClassNode({ c, selected, onSelect }: { c: ClassReport; selected: boolean; onSelect: () => void }) {
  const absent = c.status === 'absent';
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-[5px] text-left text-[12.5px] transition ${
        selected ? 'border-amber-300 bg-amber-50' : 'border-transparent hover:bg-zinc-100'
      }`}
      title={c.alias}
    >
      <GeomIcon geom={c.actualGeom ?? c.expectedGeom} />
      <span className={`min-w-0 flex-1 truncate ${absent ? 'text-zinc-400' : 'text-zinc-800'}`}>
        {c.actualName ?? c.name}
        {c.rowCount !== null && <span className="text-zinc-400"> ({fmt(c.rowCount)})</span>}
      </span>
      <StatusIcon status={c.status} size={13} />
    </button>
  );
}

function DatasetNode({
  d,
  open,
  onToggle,
  sel,
  onSelect,
  filter,
  q,
}: {
  d: DatasetReport;
  open: boolean;
  onToggle: () => void;
  sel: Selection;
  onSelect: (s: Selection) => void;
  filter: Filter;
  q: string;
}) {
  const key = d.actualName ?? d.name;
  const classes = d.classes.filter((c) => visibleClass(c, filter, q) || (q && matches(q, key) && visibleClass(c, filter, '')));
  const present = d.classes.filter((c) => c.status !== 'absent').length;
  const crs = srLine(d.sr);
  const active = sel.ds === key && !sel.cls;
  return (
    <li>
      <div className={`flex items-start gap-1 rounded-md px-1 py-1 ${active ? 'bg-blue-50' : ''}`}>
        <button onClick={onToggle} className="mt-0.5 rounded p-0.5 text-zinc-500 hover:bg-zinc-200" aria-label={open ? 'Thu gọn' : 'Mở rộng'} aria-expanded={open}>
          <IconChevron width={13} height={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={() => onSelect({ ds: key, cls: null })}>
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[13px] font-medium ${d.status === 'missing' ? 'text-zinc-400' : 'text-blue-700'}`}>{key}</span>
            <StatusIcon status={d.status} size={13} />
            <span className="ml-auto pl-1 text-[12px] tabular-nums text-zinc-500">({present})</span>
          </span>
          <span
            className={`flex items-center gap-1 truncate text-[11.5px] ${d.crs ? CRS_TONE[d.crs.status] : 'text-zinc-400'}`}
            title={d.crs?.text}
          >
            {d.crs && d.crs.status !== 'ok' && <IconAlert width={11} height={11} className="shrink-0" />}
            <span className="truncate">{d.status === 'missing' ? 'Chưa có nhóm dữ liệu này' : (crs ?? 'Chưa xác định hệ tọa độ')}</span>
          </span>
        </button>
      </div>
      {open && (
        <div className="mb-1 ml-[18px] mt-0.5 space-y-px border-l border-zinc-200 pl-1.5">
          {classes.length ? (
            classes.map((c) => (
              <ClassNode key={c.name} c={c} selected={sel.ds === key && sel.cls === c.name} onSelect={() => onSelect({ ds: key, cls: c.name })} />
            ))
          ) : (
            <p className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-500">
              <IconXCircle width={12} height={12} className="text-red-500" />
              {d.classes.length ? 'Không có lớp khớp bộ lọc' : 'Không có lớp dữ liệu'}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ---- Attribute table (bottom) -----------------------------------------------------------------------------

function AttributeTable({ c, focusField }: { c: ClassReport; focusField: string | null }) {
  const s = c.sample;
  const required = new Map(TT16_FIELDS.map((f) => [f.name.toLowerCase(), f]));
  const fieldReport = new Map(c.fields.map((f) => [f.name.toLowerCase(), f]));
  const extra = new Set(c.extraFields.map((f) => f.toLowerCase()));
  const columns = s?.columns ?? [];
  const missing = c.fields.filter((f) => !f.actual);
  const oidIdx = columns.findIndex((col) => col.type === 'objectid');
  const maIdx = columns.findIndex((col) => col.name.toLowerCase() === 'mahosoqh');
  const focus = focusField?.toLowerCase() ?? null;

  const headState = (name: string): { text: string; tone: string } | null => {
    const k = name.toLowerCase();
    if (extra.has(k)) return { text: 'Thừa Field', tone: 'text-amber-600' };
    const fr = fieldReport.get(k);
    if (!fr) return null;
    const len = `Độ dài ${fr.actual?.length}/${required.get(k)?.length}`;
    if (fr.issues.some((i) => /Kiểu dữ liệu/.test(i.text))) return { text: 'Sai kiểu', tone: 'text-red-600' };
    if (fr.issues.some((i) => /Độ dài/.test(i.text) && i.level === 'error')) return { text: len, tone: 'text-red-600' };
    if (fr.issues.some((i) => /Độ dài/.test(i.text))) return { text: len, tone: 'text-amber-600' };
    if (fr.issues.some((i) => /chữ hoa/.test(i.text))) return { text: `→ ${fr.name}`, tone: 'text-amber-600' };
    if (fr.status === 'error') return { text: 'Giá trị sai', tone: 'text-red-600' };
    return { text: 'Đúng quy định', tone: 'text-emerald-600' };
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-3 py-1.5 text-[12px]">
        <span className="text-zinc-400">{s ? `Hiển thị ${fmt(s.rows.length)}/${fmt(s.total)} đối tượng` : ''}</span>
        <span className="mx-auto rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-zinc-900">{c.actualName ?? c.name}</span>
        <span className="text-zinc-400">Field ({columns.length + missing.length})</span>
      </div>
      {c.status === 'absent' ? (
        <p className="p-4 text-[13px] text-zinc-400">Lớp chưa có trong geodatabase — không có bảng thuộc tính.</p>
      ) : !s ? (
        <p className="p-4 text-[13px] text-red-600">Không đọc được bảng thuộc tính.</p>
      ) : (
        <div className="ui-scroll min-h-0 flex-1 overflow-auto bg-white">
          <table className="border-separate border-spacing-0 text-[12px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                {columns.map((col) => {
                  const st = headState(col.name);
                  const isFocus = focus === col.name.toLowerCase();
                  return (
                    <th
                      key={col.name}
                      className={`min-w-[120px] max-w-[220px] border-b border-r border-zinc-200 px-3 py-2 text-center align-top font-normal ${isFocus ? 'bg-amber-50' : ''}`}
                    >
                      <div className="font-semibold text-zinc-900">{col.type === 'geometry' ? `${col.name.toUpperCase()} *` : col.name}</div>
                      <div className="text-zinc-500">
                        {TYPE_LABEL[col.type] ?? col.type}
                        {col.type === 'string' && col.length ? ` (${col.length})` : ''}
                      </div>
                      {st && <div className={`text-[11px] ${st.tone}`}>{st.text}</div>}
                    </th>
                  );
                })}
                {missing.map((f) => (
                  <th
                    key={f.name}
                    className={`min-w-[120px] border-b border-r border-zinc-200 bg-red-50 px-3 py-2 text-center align-top font-normal ${
                      focus === f.name.toLowerCase() ? 'ring-2 ring-inset ring-amber-300' : ''
                    }`}
                  >
                    <div className="font-semibold text-zinc-900">{f.name}</div>
                    <div className="text-zinc-500">String ({required.get(f.name.toLowerCase())?.length})</div>
                    <div className="text-[11px] text-red-600">Thiếu Field</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, ri) => (
                <tr key={ri} className="hover:bg-zinc-50">
                  {r.map((v, ci) => {
                    const col = columns[ci];
                    const problem = cellProblem(col.name, v, {
                      oid: oidIdx >= 0 ? r[oidIdx] : ri + 1,
                      ma: maIdx >= 0 ? String(r[maIdx] ?? '').trim() : '',
                      className: c.actualName ?? c.name,
                    });
                    const isFocus = focus === col.name.toLowerCase();
                    return (
                      <td
                        key={ci}
                        title={problem ?? undefined}
                        className={`max-w-[220px] border-b border-r border-zinc-100 px-3 py-1.5 align-top ${
                          problem ? 'bg-red-50 text-red-700' : isFocus ? 'bg-amber-50/60' : extra.has(col.name.toLowerCase()) ? 'text-zinc-400' : 'text-zinc-800'
                        }`}
                      >
                        <span className="line-clamp-3 break-words">{v === null ? <span className="text-zinc-300">&lt;Null&gt;</span> : String(v)}</span>
                      </td>
                    );
                  })}
                  {missing.map((f) => (
                    <td key={f.name} className="border-b border-r border-zinc-100 bg-red-50/40" />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {s.rows.length === 0 && <p className="p-4 text-[13px] text-zinc-400">Lớp rỗng (0 đối tượng).</p>}
        </div>
      )}
    </div>
  );
}

// ---- Summary (gdb selected, nothing else) -----------------------------------------------------------------

function Stat({ label, value, status, title }: { label: string; value: ReactNode; status?: Status; title?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={title}>
      {status && <StatusIcon status={status} size={13} />}
      <span className="whitespace-nowrap text-zinc-400">{label}</span>
      <span className="truncate font-medium text-zinc-900">{value}</span>
    </span>
  );
}

/** One compact line: the facts that matter for the whole geodatabase. */
function SummaryBar({ rep, g }: { rep: SubmissionReport; g: GdbReport }) {
  const c = g.counts;
  const ma = rep.maHoSo[0]?.[0];
  const pMa = ma ? parseMaHoSo(ma) : null;
  const mtt = rep.maThongTin[0]?.[0];
  const pMtt = mtt ? parseMaThongTin(mtt) : null;
  const classCount = [...g.datasets.flatMap((d) => d.classes), ...g.rootClasses].filter((x) => x.status !== 'absent').length;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-zinc-200 bg-white px-3 py-2 text-[12.5px]">
      <Stat label="Tên" value={g.fileName} status={g.nameStatus} />
      {c.datasets.expected > 0 ? (
        <Stat label="Nhóm dữ liệu" value={`${c.datasets.present}/${c.datasets.expected}`} status={c.datasets.present === c.datasets.expected ? 'ok' : 'missing'} />
      ) : (
        <Stat label="Nhóm dữ liệu" value={g.datasets.filter((d) => d.actualName).length} />
      )}
      <Stat
        label="Lớp"
        value={c.classes.reference ? `${c.classes.present}/${c.classes.reference}${c.classes.extra ? ` +${c.classes.extra}` : ''}` : classCount}
        title={c.classes.reference ? 'Có / danh mục tham khảo (+ lớp bổ sung)' : undefined}
      />
      <Stat
        label="maHoSoQH"
        value={<span className="font-mono">{ma ?? '—'}</span>}
        status={!ma ? 'missing' : pMa && rep.maHoSo.length === 1 ? 'ok' : 'error'}
        title={pMa ? `${pMa.provinceName ?? 'mã tỉnh ' + pMa.province} · ${pMa.kind}` : RULE_HINT.maHoSoQH}
      />
      <Stat
        label="maThongTinQH"
        value={<span className="font-mono">{mtt ?? '—'}</span>}
        status={!mtt ? 'missing' : pMtt && rep.maThongTin.length === 1 ? 'ok' : 'error'}
        title={pMtt ? describeMaThongTin(pMtt) : RULE_HINT.maThongTinQH}
      />
      {rep.folder && (
        <Stat
          label="Tệp tổng hợp"
          value={rep.folder.projectFiles.join(', ') || 'chưa có'}
          status={rep.folder.projectFiles.length ? 'ok' : 'missing'}
        />
      )}
      {g.crs && (
        <span className={`flex min-w-0 basis-full items-center gap-1.5 ${CRS_TONE[g.crs.status]}`} title={[g.srNames.join(', '), g.crs.detail].filter(Boolean).join(' · ')}>
          <StatusIcon status={g.crs.status} size={13} />
          <span className="whitespace-nowrap text-zinc-400">Hệ tọa độ</span>
          <span className="truncate font-medium">{g.crs.text}</span>
        </span>
      )}
    </div>
  );
}

/** Asked right after the upload: the province decides which central meridian (KTT) is right. */
function ProvinceDialog({
  suggestion,
  current,
  onConfirm,
  onClose,
}: {
  suggestion: ProvinceSuggestion | null;
  current: string | null;
  onConfirm: (code: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(current ?? suggestion?.code ?? '');
  const SOURCE = { maHoSoQH: 'theo mã hồ sơ (maHoSoQH)', maThongTinQH: 'theo mã thông tin quy hoạch', location: 'theo vị trí dữ liệu — hãy kiểm tra lại' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4 backdrop-blur-[2px]" role="dialog" aria-modal aria-label="Tỉnh của đồ án">
      <div className="ui-floating ui-pop-in w-full max-w-md p-5">
        <h2 className="text-[16px] font-semibold text-zinc-900">Đồ án thuộc tỉnh nào?</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
          Mỗi tỉnh có kinh tuyến trục (KTT) VN-2000 riêng. Chọn tỉnh để kiểm tra hệ tọa độ của dữ liệu cho chính xác — chỉ dựa vào tọa độ thì tỉnh láng
          giềng dùng KTT khác cũng có thể &quot;khớp&quot;.
        </p>
        <select className="ui-input mt-4 w-full" value={code} onChange={(e) => setCode(e.target.value)} autoFocus>
          <option value="">— Chọn tỉnh / thành phố —</option>
          {Object.entries(PROVINCE_CODES)
            .sort((x, y) => x[1].localeCompare(y[1], 'vi'))
            .map(([k, name]) => (
              <option key={k} value={k}>
                {name} ({k})
                {suggestion?.code === k ? ` — ${SOURCE[suggestion.source]}` : ''}
              </option>
            ))}
        </select>
        {suggestion && (
          <p className="mt-2 text-[12px] text-zinc-500">
            Gợi ý: <b className="font-medium text-zinc-700">{PROVINCE_CODES[suggestion.code]}</b> {SOURCE[suggestion.source]}.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="ui-btn-ghost" onClick={onClose}>
            Để sau
          </button>
          <button className="ui-btn-primary" disabled={!code} onClick={() => onConfirm(code)}>
            Kiểm tra với tỉnh này
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Issues, grouped by object (right) ----------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  'Feature Class': 'Feature Class',
  'Feature Dataset': 'Feature Dataset',
  Geodatabase: 'Geodatabase',
  'Hồ sơ': 'Hồ sơ',
};

function LevelIcon({ level }: { level: Level }) {
  if (level === 'error') return <IconXCircle width={14} height={14} className="mt-px shrink-0 text-red-600" />;
  if (level === 'warn') return <IconAlert width={14} height={14} className="mt-px shrink-0 text-amber-500" />;
  return <IconCircleDashed width={14} height={14} className="mt-px shrink-0 text-zinc-400" />;
}

function IssueGroups({
  rows,
  lookup,
  active,
  onPick,
}: {
  rows: Row[];
  lookup: (ds: string | null, cls: string) => ClassReport | undefined;
  active: { cls: string | null; field: string | null };
  onPick: (r: Row, field: string | null) => void;
}) {
  // Consecutive rows about the same object form one block (rowsFor already lists them object by object).
  const groups: { key: string; head: Row; rows: { r: Row; n: number }[] }[] = [];
  rows.forEach((r, i) => {
    const key = `${r.kind}|${r.ds ?? ''}|${r.name}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push({ r, n: i + 1 });
    else groups.push({ key, head: r, rows: [{ r, n: i + 1 }] });
  });
  return (
    <div className="divide-y divide-zinc-100">
      {groups.map(({ key, head, rows: list }) => {
        const cls = head.cls ? lookup(head.ds, head.cls) : undefined;
        const errors = list.filter((x) => x.r.level === 'error').length;
        const warns = list.filter((x) => x.r.level === 'warn').length;
        const selected = !!head.cls && active.cls === head.cls;
        return (
          <section key={key} className={selected ? 'bg-amber-50/40' : ''}>
            <button
              className="flex w-full items-center gap-2 px-3 pb-1 pt-2.5 text-left hover:bg-zinc-50"
              onClick={() => onPick(head, null)}
              title={head.ds && head.kind === 'Feature Class' ? `Nhóm ${head.ds}` : undefined}
            >
              {cls ? <GeomIcon geom={cls.actualGeom ?? cls.expectedGeom} /> : <IconDatabaseCheck width={14} height={14} className="shrink-0 text-zinc-400" />}
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-zinc-400">{KIND_LABEL[head.kind] ?? head.kind}</span>
              <span className="truncate font-mono text-[13px] font-semibold text-zinc-900">{head.name}</span>
              {cls?.rowCount != null && <span className="shrink-0 text-[12px] text-zinc-400">{fmt(cls.rowCount)} đối tượng</span>}
              <span className="ml-auto flex shrink-0 gap-1">
                {errors > 0 && <span className="rounded-full bg-red-50 px-2 py-px text-[11px] font-medium text-red-700">{errors} lỗi</span>}
                {warns > 0 && <span className="rounded-full bg-amber-50 px-2 py-px text-[11px] font-medium text-amber-800">{warns} cảnh báo</span>}
              </span>
            </button>
            <ul className="pb-1.5">
              {list.map(({ r, n }) => {
                const on = selected && (r.field ?? null) === active.field;
                return (
                  <li key={n}>
                    <button
                      onClick={() => onPick(r, r.field ?? null)}
                      title={r.hint}
                      className={`grid w-full grid-cols-[1.75rem_1rem_minmax(0,6.5rem)_minmax(0,1fr)] sm:grid-cols-[2.25rem_1rem_minmax(0,9.5rem)_minmax(0,1fr)] items-start gap-x-2 px-3 py-[3px] text-left text-[12.5px] hover:bg-blue-50/50 ${
                        on ? 'bg-amber-100/60' : ''
                      }`}
                    >
                      <span className="text-right tabular-nums text-zinc-400">{n}</span>
                      <LevelIcon level={r.level} />
                      {r.field && <span className="truncate font-mono text-[12px] text-zinc-600">{r.field}</span>}
                      <span className={`min-w-0 ${r.field ? '' : 'col-span-2'} ${r.level === 'info' ? 'text-zinc-500' : 'text-zinc-800'}`}>
                        {r.text}
                        {r.example && (
                          <span className="ml-1.5 inline-block max-w-full truncate rounded bg-zinc-100 px-1.5 align-bottom font-mono text-[11.5px] text-zinc-600">
                            vd. {r.example}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const CRS_TONE: Record<Status, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  error: 'text-red-700',
  missing: 'text-red-700',
  absent: 'text-zinc-400',
  extra: 'text-blue-700',
};

// ---- Page -------------------------------------------------------------------------------------------------

export default function GdbChecker() {
  const [rep, setRep] = useState<SubmissionReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [gi, setGi] = useState(0);
  const [sel, setSel] = useState<Selection>({ ds: null, cls: null });
  const [focusField, setFocusField] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<Record<Level, boolean>>({ error: true, warn: true, info: false });
  /** Toggled datasets: present ones start open, missing ones closed. */
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [bottomH, setBottomH] = useState(320);
  const [pdfBusy, setPdfBusy] = useState(false);
  /** The geodatabases drawn on the map (WGS84), built by the worker after the report. */
  const [mapDoc, setMapDoc] = useState<CadDocument | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  /** Issue list column width (px) on wide screens; dragged with the splitter. */
  const [mapW, setMapW] = useState(460);
  /** Province chosen by the user for the KTT check (null = read from maHoSoQH / maThongTinQH). */
  const [province, setProvince] = useState<string | null>(null);
  /** Province question, asked once right after each upload (and from the top-bar chip). */
  const [askProvince, setAskProvince] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    // React has no typed prop for these non-standard attributes.
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  });

  const run = (files: Picked[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    setProvince(null);
    workerRef.current?.terminate();
    const w = new Worker(new URL('../workers/gdb.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    // The worker stays alive with the picked files so a province change re-checks without picking them again.
    let fresh = true;
    setMapDoc(null);
    setMapError(null);
    setMapLoading(true);
    w.onmessage = (ev: MessageEvent<GdbWorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') setProgress(m);
      else if (m.type === 'map') {
        setMapLoading(false);
        setMapDoc(m.doc);
        setMapError(m.error ?? null);
      } else {
        if (m.type === 'error' || !m.report.gdbs.length) setMapLoading(false);
        setBusy(false);
        if (m.type === 'error') setError(`Không đọc được dữ liệu: ${m.message}`);
        else if (!m.report.gdbs.length)
          setError(
            m.zipCount
              ? 'Không tìm thấy geodatabase (.gdb) nào trong file .zip — hãy nén cả thư mục .gdb (hoặc thư mục HoSoGIS).'
              : 'Không tìm thấy geodatabase (.gdb) nào — hãy chọn thư mục .gdb, thư mục HoSoGIS, hoặc file .zip chứa chúng.',
          );
        else {
          setRep(m.report);
          if (fresh) {
            setAskProvince(true);
            setGi(0);
            setSel({ ds: null, cls: null });
            setFocusField(null);
            setFilter('all');
            setQuery('');
            setToggled(new Set());
          }
          fresh = false;
        }
      }
    };
    w.onerror = () => {
      setBusy(false);
      setError('Trình duyệt dừng việc kiểm tra (dữ liệu quá lớn?).');
    };
    w.postMessage({ type: 'check', files } satisfies GdbWorkerRequest);
  };
  /** Re-check the same files with a province chosen by the user (null = from the planning codes). */
  const recheck = (code: string | null) => {
    setProvince(code);
    if (!workerRef.current) return;
    setBusy(true);
    workerRef.current.postMessage({ type: 'recheck', provinceCode: code } satisfies GdbWorkerRequest);
  };

  const g = rep?.gdbs[gi] ?? null;
  const rows = useMemo(() => (rep && g ? rowsFor(rep, g, sel) : []), [rep, g, sel]);
  const shown = rows.filter((r) => levels[r.level]);
  const count = (l: Level) => rows.filter((r) => r.level === l).length;
  const selectedClass = useMemo(() => {
    if (!g || !sel.cls) return null;
    const list = sel.ds === ROOT ? g.rootClasses : (g.datasets.find((d) => (d.actualName ?? d.name) === sel.ds)?.classes ?? []);
    return list.find((c) => c.name === sel.cls) ?? null;
  }, [g, sel]);

  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const download = () => {
    if (rep) save(new Blob([toCsv(rep)], { type: 'text/csv;charset=utf-8' }), `kiem-tra-TT16-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  const downloadPdf = async () => {
    if (!rep || pdfBusy) return;
    setPdfBusy(true);
    try {
      const { buildGdbPdf } = await import('./gdbPdf');
      // "Ghi chú" (reference classes not present) follow the level toggle of the issue table.
      const { blob, fileName } = await buildGdbPdf(rep, { includeInfo: levels.info });
      save(blob, fileName);
    } catch (e) {
      setError(`Không tạo được báo cáo PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (!busy) run(await fromDataTransfer(e.dataTransfer));
    },
  };

  const pickers = (
    <>
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) run(fromInput(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,application/zip"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) run(fromInput(e.target.files));
          e.target.value = '';
        }}
      />
    </>
  );

  const errorBox = error && (
    <p className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
      <IconAlert width={15} height={15} className="mt-0.5 shrink-0" />
      <span className="flex-1">{error}</span>
      <button aria-label="Đóng" onClick={() => setError(null)}>
        <IconX width={14} height={14} />
      </button>
    </p>
  );

  // ---------- Start screen ----------
  if (!rep || !g) {
    return (
      <div className="min-h-dvh bg-zinc-50/60">
        <header className="border-b border-zinc-200/70 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5" aria-label="Về trang chủ">
              <Logo className="h-8 w-8" />
              <span className="ui-wordmark text-lg leading-none">{BRAND}</span>
            </Link>
            <Link href="/" className="ui-btn-ghost ml-auto">
              <IconArrowLeft width={14} height={14} /> Trang chủ
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6 sm:py-12">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">Kiểm tra CSDL GIS quy hoạch</h1>
            <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-zinc-500">
              Đối chiếu File Geodatabase (.gdb) với <b className="font-medium text-zinc-700">Thông tư 16/2025/TT-BXD, Phụ lục II</b>: tên các CSDL
              (HienTrang, QuyHoach, NenDiaHinh, MocGioi), nhóm dữ liệu (Feature Dataset), lớp dữ liệu (Feature Class), 6 trường thuộc tính quy định
              và giá trị mã hồ sơ.
            </p>
          </div>
          <div
            {...dropHandlers}
            role="button"
            tabIndex={0}
            aria-label="Kéo thả thư mục .gdb, thư mục HoSoGIS hoặc file .zip"
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !busy) folderRef.current?.click();
            }}
            className={`rounded-2xl border border-dashed bg-white px-5 py-12 transition ${
              over ? 'border-blue-500 bg-blue-50/70 ring-8 ring-blue-500/10' : 'border-zinc-300'
            }`}
          >
            {busy ? (
              <div className="mx-auto w-full max-w-sm text-center" aria-live="polite">
                <p className="text-sm font-medium text-zinc-900">{progress?.name ? `Đang kiểm tra ${progress.name}…` : 'Đang đọc dữ liệu…'}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-zinc-900 transition-[width]"
                    style={{ width: `${progress?.total ? Math.max(6, (progress.done / progress.total) * 100) : 6}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white">
                  <IconUpload width={20} height={20} />
                </span>
                <p className="text-[15px] font-medium text-zinc-900">Kéo thả thư mục HoSoGIS, các thư mục .gdb hoặc file .zip</p>
                <p className="text-[13px] text-zinc-500">Một hoặc nhiều geodatabase cùng lúc · xử lý ngay trên trình duyệt, không tải lên máy chủ.</p>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  <button className="ui-btn-primary" onClick={() => folderRef.current?.click()}>
                    <IconFolderOpen width={15} height={15} /> Chọn thư mục
                  </button>
                  <button className="ui-btn" onClick={() => zipRef.current?.click()}>
                    Chọn file .zip
                  </button>
                </div>
              </div>
            )}
            {pickers}
          </div>
          {errorBox}
        </main>
      </div>
    );
  }

  // ---------- Workspace ----------
  const provinceCode = province ?? rep.gdbs.find((x) => x.province)?.province?.code ?? null;
  const q = query.trim().toLowerCase();
  const datasets = g.datasets.filter((d) => {
    if (filter === 'present' && d.status === 'missing') return false;
    if (filter === 'issues' && !isProblem(d.status)) return false;
    return !q || matches(q, d.actualName, d.name) || d.classes.some((c) => visibleClass(c, filter, q));
  });
  const roots = g.rootClasses.filter((c) => visibleClass(c, filter, q));
  const presentDs = g.datasets.filter((d) => d.actualName).length;
  const presentCls = [...g.datasets.flatMap((d) => d.classes), ...g.rootClasses].filter((c) => c.status !== 'absent').length;
  const select = (s: Selection) => {
    setSel(s);
    setFocusField(null);
  };

  const startResize = (e: React.PointerEvent) => {
    const box = mainRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => setBottomH(Math.max(140, Math.min(box.height - 120, box.bottom - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** Vertical splitter between the map and the issue list. */
  const startMapResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setMapW(Math.max(320, Math.min(window.innerWidth - 700, window.innerWidth - ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-100 md:h-dvh" {...dropHandlers}>
      {/* Top bar: brand, one tab per geodatabase (main databases not uploaded are listed dimmed), actions. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 bg-white px-3 py-2">
        <Link href="/" className="flex items-center gap-2" aria-label="Về trang chủ">
          <Logo className="h-7 w-7" />
          <span className="ui-wordmark hidden text-base leading-none sm:inline">{BRAND}</span>
        </Link>
        <span className="hidden h-5 w-px bg-zinc-200 sm:block" />
        <nav className="ui-scroll -mx-1 flex max-w-full gap-1 overflow-x-auto px-1" aria-label="Geodatabase">
          {rep.gdbs.map((x, i) => {
            const st: Status = x.counts.errors ? 'error' : x.counts.warnings ? 'warn' : 'ok';
            return (
              <button
                key={x.dir}
                onClick={() => {
                  setGi(i);
                  select({ ds: null, cls: null });
                }}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                  i === gi ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <StatusIcon status={st} size={13} />
                <span className="font-mono">{x.fileName}</span>
                {x.counts.errors > 0 && <span className={`text-[11px] ${i === gi ? 'text-red-300' : 'text-red-600'}`}>{fmt(x.counts.errors)}</span>}
              </button>
            );
          })}
          {rep.missingDatabases.map((m) => (
            <span key={m.name} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-zinc-400" title={m.title}>
              <IconCircleDashed width={13} height={13} />
              <span className="font-mono">{m.name}.gdb</span>
              <span className="text-[11px]">{rep.folder ? 'thiếu' : 'chưa tải'}</span>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setAskProvince(true)}
            disabled={busy}
            title="Tỉnh dùng để kiểm tra kinh tuyến trục (KTT) của hệ tọa độ"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ring-1 ring-inset transition ${
              provinceCode ? 'text-zinc-700 ring-zinc-200 hover:bg-zinc-50' : 'bg-amber-50 text-amber-800 ring-amber-300 hover:bg-amber-100'
            }`}
          >
            <span className="text-zinc-400">Tỉnh</span>
            <b className="font-medium">{provinceCode ? PROVINCE_CODES[provinceCode] : 'chưa chọn'}</b>
            <IconChevron width={12} height={12} className="rotate-90 text-zinc-400" />
          </button>
          {busy ? (
            <span className="text-[12px] text-zinc-500">{progress?.name ? `Đang kiểm tra ${progress.name}…` : 'Đang đọc…'}</span>
          ) : (
            <>
              <button className="ui-btn" onClick={() => folderRef.current?.click()} title="Mở thư mục khác (hoặc kéo thả vào cửa sổ)">
                <IconFolderOpen width={15} height={15} /> <span className="hidden md:inline">Mở thư mục</span>
              </button>
              <button className="ui-btn" onClick={() => zipRef.current?.click()} title="Mở file .zip">
                .zip
              </button>
              <button className="ui-btn" onClick={download} title="Tải báo cáo CSV (mở bằng Excel)">
                CSV
              </button>
              <button className="ui-btn-primary" onClick={downloadPdf} disabled={pdfBusy} title="Tải báo cáo PDF">
                {pdfBusy ? <IconSpinner width={15} height={15} /> : <IconDownload width={15} height={15} />}
                <span className="hidden md:inline">{pdfBusy ? 'Đang tạo PDF…' : 'Báo cáo PDF'}</span>
              </button>
            </>
          )}
          {pickers}
        </div>
      </header>
      {error && <div className="px-3 pt-2">{errorBox}</div>}

      <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
        {/* Left: dataset / class tree */}
        <aside className="flex max-h-[45dvh] shrink-0 flex-col border-b border-zinc-200 bg-white md:max-h-none md:w-80 md:border-b-0 md:border-r">
          <div className="space-y-2 border-b border-zinc-100 p-2.5">
            <button
              onClick={() => select({ ds: null, cls: null })}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
                !sel.ds && !sel.cls ? 'bg-blue-50 text-blue-800' : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <IconDatabaseCheck width={15} height={15} />
              <span className="font-medium">Feature Dataset ({presentDs})</span>
              <IconChevron width={12} height={12} className="text-zinc-400" />
              <span className="font-medium">Feature Class ({presentCls})</span>
            </button>
            <label className="relative block">
              <IconSearch width={14} height={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm kiếm" className="ui-input w-full pl-8" />
            </label>
            <div className="ui-segment" role="group" aria-label="Bộ lọc cây">
              {(
                [
                  ['all', 'Tất cả'],
                  ['issues', 'Có vấn đề'],
                  ['present', 'Đang có'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className="whitespace-nowrap" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="ui-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
            {datasets.map((d) => {
              const key = d.actualName ?? d.name;
              const startsOpen = d.status !== 'missing';
              const open = q ? true : startsOpen !== toggled.has(key);
              return (
                <DatasetNode
                  key={key}
                  d={d}
                  open={open}
                  onToggle={() =>
                    setToggled((s) => {
                      const n = new Set(s);
                      if (n.has(key)) n.delete(key);
                      else n.add(key);
                      return n;
                    })
                  }
                  sel={sel}
                  onSelect={select}
                  filter={filter}
                  q={q}
                />
              );
            })}
            {roots.length > 0 && (
              <li className="pt-1">
                <button
                  className={`w-full rounded-md px-2 py-1 text-left text-[13px] font-medium text-amber-700 ${sel.ds === ROOT && !sel.cls ? 'bg-blue-50' : ''}`}
                  onClick={() => select({ ds: ROOT, cls: null })}
                >
                  Lớp ngoài nhóm dữ liệu ({roots.length})
                </button>
                <div className="ml-[18px] space-y-px border-l border-zinc-200 pl-1.5">
                  {roots.map((c) => (
                    <ClassNode key={c.name} c={c} selected={sel.ds === ROOT && sel.cls === c.name} onSelect={() => select({ ds: ROOT, cls: c.name })} />
                  ))}
                </div>
              </li>
            )}
            {!datasets.length && !roots.length && <li className="p-3 text-center text-[12.5px] text-zinc-400">Không có mục nào khớp.</li>}
          </ul>
        </aside>

        {/* Centre: summary, the satellite map, and the attribute table of the selected class under it. */}
        <div ref={mainRef} className="flex min-w-0 flex-1 flex-col bg-white md:min-h-0">
          {!sel.ds && !sel.cls && <SummaryBar rep={rep} g={g} />}
          <div className="relative h-[60dvh] min-h-[240px] shrink-0 md:h-auto md:flex-1">
            <GdbMap
              doc={mapDoc}
              gdbName={g.fileName}
              focusClass={selectedClass ? (selectedClass.actualName ?? selectedClass.name) : null}
              loading={mapLoading}
              error={mapError}
              onSelectClass={(name) => {
                const lower = name.toLowerCase();
                const hit = (list: ClassReport[]) => list.find((c) => (c.actualName ?? c.name).toLowerCase() === lower);
                for (const d of g.datasets) {
                  const c = hit(d.classes);
                  if (c) return select({ ds: d.actualName ?? d.name, cls: c.name });
                }
                const r = hit(g.rootClasses);
                if (r) select({ ds: ROOT, cls: r.name });
              }}
            />
          </div>

          {selectedClass && (
            <>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Kéo để đổi chiều cao bảng thuộc tính"
                onPointerDown={startResize}
                className="hidden h-2 shrink-0 cursor-row-resize touch-none items-center justify-center border-y border-zinc-200 bg-emerald-50 hover:bg-emerald-100 md:flex"
              >
                <span className="h-0.5 w-10 rounded-full bg-emerald-400" />
              </div>
              <div
                className="h-[65dvh] shrink-0 border-t border-zinc-200 md:h-[var(--bh)] md:border-t-0"
                style={{ '--bh': `${bottomH}px` } as React.CSSProperties}
              >
                <AttributeTable c={selectedClass} focusField={focusField} />
              </div>
            </>
          )}
        </div>

        {/* Right: the numbered issues of what is selected (drag the splitter to widen). */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Kéo để đổi độ rộng danh sách lỗi"
          onPointerDown={startMapResize}
          className="hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center border-x border-zinc-200 bg-emerald-50 hover:bg-emerald-100 md:flex"
        >
          <span className="h-10 w-0.5 rounded-full bg-emerald-400" />
        </div>
        <div
          className="flex min-w-0 shrink-0 flex-col border-t border-zinc-200 bg-white md:min-h-0 md:w-[min(var(--iw),45vw)] md:border-t-0"
          style={{ '--iw': `${mapW}px` } as React.CSSProperties}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-1.5">
            <span className="min-w-0 truncate text-[12.5px] text-zinc-500">
              {sel.cls ? (
                <>
                  Feature Class <b className="text-zinc-900">{selectedClass?.actualName ?? sel.cls}</b>
                </>
              ) : sel.ds ? (
                <>
                  Feature Dataset <b className="text-zinc-900">{sel.ds}</b>
                </>
              ) : (
                <>
                  Toàn bộ <b className="text-zinc-900">{g.fileName}</b>
                </>
              )}
            </span>
            <div className="ml-auto flex gap-1">
              {(
                [
                  ['error', 'Lỗi', 'bg-red-50 text-red-700 ring-red-200'],
                  ['warn', 'Cảnh báo', 'bg-amber-50 text-amber-800 ring-amber-200'],
                  ['info', 'Ghi chú', 'bg-zinc-100 text-zinc-600 ring-zinc-200'],
                ] as const
              ).map(([l, label, tone]) => (
                <button
                  key={l}
                  aria-pressed={levels[l]}
                  onClick={() => setLevels((s) => ({ ...s, [l]: !s[l] }))}
                  className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset transition ${
                    levels[l] ? tone : 'bg-white text-zinc-400 ring-zinc-200 line-through'
                  }`}
                >
                  {label} {fmt(count(l))}
                </button>
              ))}
            </div>
          </div>

          <div className="ui-scroll max-h-[55dvh] min-h-[120px] flex-1 overflow-auto md:max-h-none">
            <IssueGroups
              rows={shown}
              lookup={(ds, name) => (ds === ROOT ? g.rootClasses : (g.datasets.find((d) => (d.actualName ?? d.name) === ds)?.classes ?? [])).find((c) => c.name === name)}
              active={{ cls: sel.cls, field: focusField }}
              onPick={(r, field) => {
                if (r.cls) {
                  setSel({ ds: r.ds, cls: r.cls });
                  setFocusField(field);
                } else if (r.ds) select({ ds: r.ds, cls: null });
              }}
            />
            {!shown.length && (
              <p className="flex items-center justify-center gap-2 p-6 text-[13px] text-emerald-700">
                <IconCheckCircle width={16} height={16} />
                {rows.length ? 'Không có mục nào ở mức đang chọn.' : 'Không có lỗi hay cảnh báo.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {askProvince && (
        <ProvinceDialog
          suggestion={suggestProvince(rep.gdbs)}
          current={province}
          onClose={() => setAskProvince(false)}
          onConfirm={(code) => {
            setAskProvince(false);
            recheck(code);
          }}
        />
      )}

      {over && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/10 ring-8 ring-inset ring-blue-500/30">
          <span className="rounded-xl bg-white px-4 py-2 text-[14px] font-medium text-blue-700 shadow">Thả để kiểm tra dữ liệu mới</span>
        </div>
      )}
    </div>
  );
}
