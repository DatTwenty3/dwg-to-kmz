'use client';
import { useMemo, useState } from 'react';
import type { CrsOptions } from '@/lib/cad/types';
import {
  CANDIDATE_LON0,
  EPSG_TABLE,
  PROVINCES,
  epsgForProj4,
  formatDegMin,
  resolveCrsInput,
  getProvince,
  type LocationCheck,
} from '@/lib/geo';
import { crsFromForm, type CrsForm, type CrsMode } from './crsForm';
import { IconAlert, IconCheck, IconChevron, IconTarget } from './icons';

interface UnitOption {
  key: string;
  provinceId: string;
  label: string;
  lon0: number;
}

/**
 * One group per current province; options are the provinces it was merged from (drawings made before
 * 2025 use their KTT), plus the current unit's own KTT when it differs (e.g. Lai Châu, TT 24/2025).
 */
const PROVINCE_GROUPS: { id: string; name: string; options: UnitOption[] }[] = PROVINCES.map((p) => {
  const units = p.formerUnits?.length ? p.formerUnits : [{ name: p.name, lon0: p.lon0 }];
  const options: UnitOption[] = units.map((u) => ({ key: `${p.id}|${u.name}`, provinceId: p.id, label: u.name, lon0: u.lon0 }));
  if (!units.some((u) => u.lon0 === p.lon0)) {
    options.push({ key: `${p.id}|*`, provinceId: p.id, label: `${p.name} (KTT hiện hành)`, lon0: p.lon0 });
  }
  return { id: p.id, name: p.name, options };
}).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

const UNIT_OPTIONS_BY_KEY = new Map(PROVINCE_GROUPS.flatMap((g) => g.options.map((o) => [o.key, o] as const)));

const UNIT_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'mét (m)' },
  { value: 0.001, label: 'milimét (mm)' },
  { value: 0.01, label: 'xentimét (cm)' },
];


export interface CrsPanelProps {
  provinceId: string;
  /** Note under the province picker (auto-detected province, or a reminder to choose one). */
  hint?: string;
  /** A province (former unit) was picked: apply VN-2000 with its KTT (3° zone). */
  onPickUnit: (provinceId: string, lon0: number) => void;
  activeCrs: CrsOptions | null;
  form: CrsForm;
  onFormChange: (f: CrsForm) => void;
  onApplyForm: () => void;
  onCheck: () => void;
  /** Target mode (KML/KMZ source): the form defines the DXF output CRS; no candidates, no Apply. */
  target?: boolean;
  /** Fit the map to the drawing; undefined while nothing is loaded. */
  onZoom?: () => void;
  /** Hide the "Tới bản vẽ" button (no map on the CRS step page). Default true. */
  showZoom?: boolean;
  check: LocationCheck | null;
  busy: boolean;
  disabled: boolean;
}

export default function CrsPanel(props: CrsPanelProps) {
  const { provinceId, activeCrs, form, onFormChange, busy, disabled } = props;
  /** Remembers which former unit was picked when two share a KTT (e.g. Cần Thơ / Hậu Giang, both 105°). */
  const [unitKey, setUnitKey] = useState('');
  const province = provinceId ? getProvince(provinceId) : undefined;
  const set = <K extends keyof CrsForm>(k: K, v: CrsForm[K]) => onFormChange({ ...form, [k]: v });

  const lon0Options = useMemo(() => {
    const s = new Set<number>([...(province?.lon0Candidates ?? []), ...CANDIDATE_LON0, form.lon0]);
    return [...s].sort((a, b) => a - b);
  }, [province, form.lon0]);

  const formCrs = crsFromForm(form);
  const customResult = form.mode === 'proj4' && form.proj4.trim() ? resolveCrsInput(form.proj4) : null;
  const formEpsg = formCrs.proj4 ? epsgForProj4(formCrs.proj4) : undefined;

  // Which option reflects the current state: same province and same KTT (VN-2000, 3° zone).
  const group = PROVINCE_GROUPS.find((g) => g.id === provinceId);
  const matching = form.mode === 'vn2000' && form.zone === 3 ? (group?.options.filter((o) => o.lon0 === form.lon0) ?? []) : [];
  const selectedKey = matching.find((o) => o.key === unitKey)?.key ?? matching[0]?.key ?? '';
  const activeEpsg = activeCrs ? epsgForProj4(activeCrs.proj4) : undefined;
  const activeLabel =
    form.mode === 'vn2000'
      ? `VN-2000 KTT ${formatDegMin(form.lon0)} múi ${form.zone}°${activeEpsg ? ` (EPSG:${activeEpsg})` : ''}`
      : activeEpsg
        ? `EPSG:${activeEpsg}`
        : 'thiết lập thủ công';

  return (
    <div className="flex flex-col gap-5">
      {/* Province (grouped by current unit, options are the pre-2025 provinces and their KTT) */}
      <div>
        <label className="ui-label" htmlFor="province-select">
          Tỉnh / thành của bản vẽ
        </label>
        <select
          id="province-select"
          className="ui-input cursor-pointer"
          value={selectedKey}
          disabled={disabled}
          onChange={(e) => {
            const opt = UNIT_OPTIONS_BY_KEY.get(e.target.value);
            if (!opt) return;
            setUnitKey(opt.key);
            props.onPickUnit(opt.provinceId, opt.lon0);
          }}
        >
          <option value="" disabled>
            — Chọn tỉnh / thành —
          </option>
          {PROVINCE_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label} · KTT {formatDegMin(o.lon0)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {props.hint && <p className="mt-2 text-xs leading-relaxed text-amber-700">{props.hint}</p>}
        {!props.target && activeCrs && (
          <p className="mt-2 text-xs text-zinc-500">
            Đang dùng: <span className="font-medium text-zinc-700">{activeLabel}</span>
          </p>
        )}
      </div>

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
        <div className={`grid gap-2 ${props.showZoom === false ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <button className="ui-btn" disabled={disabled} onClick={props.onCheck}>
            <IconCheck />
            Kiểm tra vị trí
          </button>
          {props.showZoom !== false && (
            <button className="ui-btn" disabled={disabled || !props.onZoom} onClick={props.onZoom}>
              <IconTarget />
              Tới bản vẽ
            </button>
          )}
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
