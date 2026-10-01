'use client';
import { useMemo, useState } from 'react';
import type { CrsOptions } from '@/lib/cad/types';
import {
  CANDIDATE_LON0,
  EPSG_TABLE,
  epsgForProj4,
  formatDegMin,
  resolveCrsInput,
  getProvince,
  searchProvinces,
  type CrsCandidate,
  type LocationCheck,
} from '@/lib/geo';
import { crsFromForm, type CrsForm, type CrsMode } from './crsForm';
import { IconAlert, IconCheck, IconChevron, IconSearch, IconTarget } from './icons';

const UNIT_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'mét (m)' },
  { value: 0.001, label: 'milimét (mm)' },
  { value: 0.01, label: 'xentimét (cm)' },
];


export interface CrsPanelProps {
  provinceId: string;
  /** Note under the province picker (auto-detected province, or a reminder to choose one). */
  hint?: string;
  onProvince: (id: string) => void;
  candidates: CrsCandidate[];
  activeCrs: CrsOptions | null;
  onApplyCandidate: (c: CrsCandidate) => void;
  form: CrsForm;
  onFormChange: (f: CrsForm) => void;
  onApplyForm: () => void;
  onCheck: () => void;
  /** Target mode (KML/KMZ source): the form defines the DXF output CRS; no candidates, no Apply. */
  target?: boolean;
  /** Fit the map to the drawing; undefined while nothing is loaded. */
  onZoom?: () => void;
  check: LocationCheck | null;
  busy: boolean;
  disabled: boolean;
}

export default function CrsPanel(props: CrsPanelProps) {
  const { provinceId, onProvince, candidates, activeCrs, form, onFormChange, busy, disabled } = props;
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState(false);
  const results = useMemo(() => searchProvinces(query), [query]);
  const province = provinceId ? getProvince(provinceId) : undefined;
  const set = <K extends keyof CrsForm>(k: K, v: CrsForm[K]) => onFormChange({ ...form, [k]: v });

  const lon0Options = useMemo(() => {
    const s = new Set<number>([...(province?.lon0Candidates ?? []), ...CANDIDATE_LON0, form.lon0]);
    return [...s].sort((a, b) => a - b);
  }, [province, form.lon0]);

  const formCrs = crsFromForm(form);
  const customResult = form.mode === 'proj4' && form.proj4.trim() ? resolveCrsInput(form.proj4) : null;
  const formEpsg = formCrs.proj4 ? epsgForProj4(formCrs.proj4) : undefined;
  const isActive = (c: CrsOptions) =>
    !!activeCrs && activeCrs.proj4 === c.proj4 && activeCrs.swapXY === c.swapXY && activeCrs.unitScale === c.unitScale;
  const shown = showAll ? candidates : candidates.slice(0, 3);

  const pickProvince = (id: string) => {
    onProvince(id);
    setQuery('');
    setPicking(false);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Province */}
      <div>
        <span className="ui-label">Tỉnh / thành của bản vẽ</span>
        {province && !picking ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-900">{province.name}</p>
              <p className="truncate text-[11px] text-zinc-500">
                KTT {formatDegMin(province.lon0)}
                {province.aliases.length ? ` · gồm ${province.aliases.slice(0, 3).join(', ')}` : ''}
              </p>
            </div>
            <button className="ui-btn-ghost" onClick={() => setPicking(true)}>
              Đổi
            </button>
          </div>
        ) : (
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-[19px] -translate-y-1/2 text-zinc-400" />
            <input
              id="province-search"
              className="ui-input pl-9"
              placeholder="Tìm tỉnh, vd. can tho, soc trang"
              autoFocus={picking}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(query.trim() || picking) && (
            <ul className="ui-scroll mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1" aria-label="Danh sách tỉnh">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    className={`flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left transition hover:bg-zinc-50 ${
                      p.id === provinceId ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => pickProvince(p.id)}
                  >
                    <span className="text-[13px] text-zinc-900">{p.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-zinc-400">{formatDegMin(p.lon0)}</span>
                  </button>
                </li>
              ))}
              {provinceId && (
                <li>
                  <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-500 hover:bg-zinc-50" onClick={() => pickProvince('')}>
                    Bỏ chọn (tự đoán)
                  </button>
                </li>
              )}
              {results.length === 0 && <li className="px-2.5 py-1.5 text-[13px] text-zinc-400">Không tìm thấy tỉnh.</li>}
            </ul>
            )}
          </div>
        )}
        {props.hint && <p className="mt-2 text-xs leading-relaxed text-amber-700">{props.hint}</p>}
      </div>

      {/* Candidates */}
      {!props.target && (
      <div>
        <span className="ui-label">Phương án gợi ý</span>
        {candidates.length === 0 ? (
          <p className="text-xs text-zinc-400">Mở bản vẽ để xem gợi ý.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((c, i) => {
              const active = isActive(c.crs);
              const code = epsgForProj4(c.crs.proj4);
              return (
                <li key={`${c.label}-${i}`}>
                  <button
                    disabled={busy || disabled}
                    onClick={() => props.onApplyCandidate(c)}
                    title={c.reason}
                    className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
                      active ? 'border-blue-500 bg-blue-50/50 ring-4 ring-blue-500/10' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        active ? 'border-blue-600 bg-blue-600 text-white' : 'border-zinc-300'
                      }`}
                    >
                      {active && <IconCheck width={10} height={10} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-medium text-zinc-900">{c.label}</span>
                        {code && <span className="ui-chip">EPSG:{code}</span>}
                        {i === 0 && <span className="ui-chip bg-blue-50 text-blue-700">Đề xuất</span>}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        {c.reason} · {c.center[1].toFixed(4)}°N {c.center[0].toFixed(4)}°E
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {candidates.length > 3 && (
          <button className="ui-btn-ghost mt-1.5" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Thu gọn' : `Xem thêm ${candidates.length - 3} phương án`}
          </button>
        )}
      </div>
      )}

      {/* Manual (or the DXF target CRS in target mode) */}
      <details className="group rounded-lg border border-zinc-200" open={props.target || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-zinc-700 [&::-webkit-details-marker]:hidden">
          {props.target ? 'Hệ tọa độ của file DXF' : 'Thiết lập thủ công'}
          <IconChevron className="ml-auto text-zinc-400 transition-transform group-open:rotate-90" />
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-zinc-100 p-3">
          <label className="col-span-2">
            <span className="ui-label">Hệ tọa độ</span>
            <select className="ui-input" value={form.mode} onChange={(e) => set('mode', e.target.value as CrsMode)}>
              <option value="vn2000">VN-2000 (TM)</option>
              <option value="utm">UTM (WGS84)</option>
              <option value="wgs84">WGS84 kinh độ/vĩ độ</option>
              <option value="epsg">Mã EPSG (VN-2000, UTM…)</option>
              <option value="proj4">Tùy chỉnh (EPSG / proj4 / WKT)</option>
            </select>
          </label>
          {form.mode === 'vn2000' && (
            <>
              <label>
                <span className="ui-label">Kinh tuyến trục</span>
                <select className="ui-input" value={form.lon0} onChange={(e) => set('lon0', Number(e.target.value))}>
                  {lon0Options.map((l) => (
                    <option key={l} value={l}>
                      {formatDegMin(l)}
                      {province?.lon0Candidates?.includes(l) ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="ui-label">Múi chiếu</span>
                <select className="ui-input" value={form.zone} onChange={(e) => set('zone', Number(e.target.value) as 3 | 6)}>
                  <option value={3}>3° (k=0,9999)</option>
                  <option value={6}>6° (k=0,9996)</option>
                </select>
              </label>
            </>
          )}
          {form.mode === 'utm' && (
            <label className="col-span-2">
              <span className="ui-label">Múi UTM</span>
              <select className="ui-input" value={form.utmZone} onChange={(e) => set('utmZone', Number(e.target.value))}>
                <option value={48}>48N (EPSG:32648)</option>
                <option value={49}>49N (EPSG:32649)</option>
              </select>
            </label>
          )}
          {form.mode === 'epsg' && (
            <label className="col-span-2">
              <span className="ui-label">Mã EPSG</span>
              <select className="ui-input" value={form.epsg} onChange={(e) => set('epsg', Number(e.target.value))}>
                {EPSG_TABLE.map((e) => (
                  <option key={e.code} value={e.code}>
                    EPSG:{e.code} — {e.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {form.mode === 'proj4' && (
            <label className="col-span-2">
              <span className="ui-label">Mã EPSG, chuỗi proj4 hoặc WKT</span>
              <textarea
                className="ui-input font-mono text-xs"
                rows={3}
                value={form.proj4}
                placeholder="VD: EPSG:9209 hoặc +proj=tmerc +lat_0=0 +lon_0=105.5 …"
                onChange={(e) => set('proj4', e.target.value)}
              />
              {customResult && (
                <span className={`mt-1.5 flex items-start gap-1 text-xs ${customResult.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  {customResult.ok ? (
                    <IconCheck className="mt-px shrink-0" width={14} height={14} />
                  ) : (
                    <IconAlert className="mt-px shrink-0" width={14} height={14} />
                  )}
                  {customResult.ok ? customResult.label : customResult.error}
                </span>
              )}
            </label>
          )}
          {form.mode !== 'wgs84' && (
            <label>
              <span className="ui-label">Đơn vị bản vẽ</span>
              <select className="ui-input" value={form.unitScale} onChange={(e) => set('unitScale', Number(e.target.value))}>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2.5 text-[13px] text-zinc-700">
            <input type="checkbox" className="ui-check" checked={form.swapXY} onChange={(e) => set('swapXY', e.target.checked)} />
            Đổi X/Y
          </label>
          <label>
            <span className="ui-label">Dịch Đông (m)</span>
            <input
              type="number"
              step={1}
              className="ui-input tabular-nums"
              value={form.offsetE}
              onChange={(e) => set('offsetE', Number(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && props.onApplyForm()}
            />
          </label>
          <label>
            <span className="ui-label">Dịch Bắc (m)</span>
            <input
              type="number"
              step={1}
              className="ui-input tabular-nums"
              value={form.offsetN}
              onChange={(e) => set('offsetN', Number(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && props.onApplyForm()}
            />
          </label>
          <p className="col-span-2 break-all rounded-md bg-zinc-50 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-zinc-500">
            {formEpsg ? `EPSG:${formEpsg} · ` : ''}
            {formCrs.proj4 || '—'}
          </p>
          {!props.target && (
            <button className="ui-btn-primary col-span-2" disabled={busy || disabled || !formCrs.proj4} onClick={props.onApplyForm}>
              Áp dụng
            </button>
          )}
        </div>
      </details>

      {/* Location check + zoom */}
      <div>
        <div className="grid grid-cols-2 gap-2">
          <button className="ui-btn" disabled={disabled} onClick={props.onCheck}>
            <IconCheck />
            Kiểm tra vị trí
          </button>
          <button className="ui-btn" disabled={disabled || !props.onZoom} onClick={props.onZoom}>
            <IconTarget />
            Tới bản vẽ
          </button>
        </div>
        {props.check && (
          <p
            className={`mt-2 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed ${
              props.check.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {props.check.ok ? (
              <IconCheck className="mt-px shrink-0" width={14} height={14} />
            ) : (
              <IconAlert className="mt-px shrink-0" width={14} height={14} />
            )}
            {props.check.message}
          </p>
        )}
      </div>
    </div>
  );
}
