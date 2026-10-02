'use client';
// Map search: coordinates (lat/lng or VN-2000 X = Bắc / Y = Đông), provinces, text inside the drawings and
// sketches, and place names (OpenStreetMap Nominatim, only when nothing local matches well enough to stop).
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { FoundItem } from '@/lib/cad/find';
import type { CrsOptions, Vec2 } from '@/lib/cad/types';
import {
  createPointTransformer,
  isGeographic,
  locateVn2000,
  parseCoordinateQuery,
  resolveCrsInput,
  searchProvinces,
  VN2000_ZONES,
  zoneByKey,
  zoneKeyOf,
  zoneProj4,
} from '@/lib/geo';
import CoordCard, { type ZoneChoice } from './CoordCard';
import { IconChevron, IconFile, IconGlobe, IconPen, IconPin, IconSearch, IconSpinner, IconX } from './icons';

/** The search bar's VN-2000 zone (remembered on this device). */
const ZONE_KEY = 'ledat-gis:search-zone:v1';
function loadZone(): ZoneChoice {
  try {
    const z = window.localStorage.getItem(ZONE_KEY);
    return z && zoneByKey(z) ? z : 'auto';
  } catch {
    return 'auto';
  }
}

export interface GoTarget {
  label: string;
  /** Where to drop the pin (and fly to, unless `bounds`). */
  lngLat: Vec2;
  bounds?: [Vec2, Vec2];
  sketchId?: string;
}

interface Result extends GoTarget {
  key: string;
  group: string;
  sub: string;
  icon: typeof IconPin;
  /** A coordinate result: the zone its X/Y are read in (shown in the coordinate card after picking). */
  coordZone?: ZoneChoice;
}

const fmt = (n: number, d: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtLatLng = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
const KTT = (lon0: number) => {
  const d = Math.floor(lon0);
  const m = Math.round((lon0 - d) * 60);
  return `${d}°${m ? `${String(m).padStart(2, '0')}'` : ''}`;
};

interface OsmPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

export default function SearchBox({
  drawingCrs,
  find,
  onGo,
  onClear,
}: {
  /** CRS of the selected drawing: X/Y are read in it first when it is projected. */
  drawingCrs: CrsOptions | null;
  /** Text search in the drawings / sketches on the map. */
  find: (q: string) => FoundItem[];
  onGo: (t: GoTarget) => void;
  /** The query was cleared: remove the pin. */
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  /** Phones: the field is a button until tapped. */
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const [osm, setOsm] = useState<{ q: string; items: OsmPlace[] } | null>(null);
  const [osmBusy, setOsmBusy] = useState(false);
  /** VN-2000 zone for X/Y queries: 'auto' (drawing / province guess) or a fixed zone picked next to the field. */
  const [zone, setZone] = useState<ZoneChoice>(() => (typeof window === 'undefined' ? 'auto' : loadZone()));
  const fixedZone = zone === 'auto' ? null : zoneByKey(zone);
  /** Coordinates of the picked coordinate result (WGS84 + VN-2000, copyable). */
  const [card, setCard] = useState<{ lngLat: Vec2; zone: ZoneChoice; seq: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(q.trim());

  const coord = useMemo(() => parseCoordinateQuery(deferred), [deferred]);

  const local = useMemo<Result[]>(() => {
    const out: Result[] = [];
    if (!deferred) return out;
    if (coord?.kind === 'latlng') {
      out.push({
        key: 'll',
        group: 'Tọa độ',
        icon: IconPin,
        label: fmtLatLng(coord.lat, coord.lng),
        sub: 'Vĩ độ, kinh độ (WGS84)',
        lngLat: [coord.lng, coord.lat],
        coordZone: zone,
      });
    } else if (coord?.kind === 'xy') {
      const xy = `X ${fmt(coord.x, 2)} · Y ${fmt(coord.y, 2)}`;
      let drawingLon0: number | null = null;
      if (fixedZone) {
        // The zone picked next to the field: one answer, no guessing.
        try {
          const ll = createPointTransformer({ proj4: zoneProj4(fixedZone), swapXY: false, unitScale: 1 })(coord.y, coord.x);
          if (ll)
            out.push({
              key: `xy-z-${fixedZone.key}`,
              group: 'Tọa độ',
              icon: IconPin,
              label: xy,
              sub: `VN-2000 · ${fixedZone.label}`,
              lngLat: ll,
              coordZone: fixedZone.key,
            });
        } catch {
          /* invalid numbers for this zone */
        }
        return out;
      }
      if (drawingCrs) {
        const r = resolveCrsInput(drawingCrs.proj4);
        if (r.ok && !isGeographic(r.proj4)) {
          try {
            const ll = createPointTransformer({ proj4: drawingCrs.proj4, swapXY: false, unitScale: 1 })(coord.y, coord.x);
            if (ll) {
              out.push({
                key: 'xy-d',
                group: 'Tọa độ',
                icon: IconPin,
                label: xy,
                sub: 'Theo hệ tọa độ của bản vẽ đang chọn',
                lngLat: ll,
                coordZone: 'auto',
              });
              const m = /\+lon_0=([-\d.]+)/.exec(r.proj4);
              drawingLon0 = m ? Number(m[1]) : null;
            }
          } catch {
            /* fall back to the province guess */
          }
        }
      }
      for (const g of locateVn2000(coord.x, coord.y)) {
        if (g.lon0 === drawingLon0) continue;
        out.push({
          key: `xy-${g.lon0}`,
          group: 'Tọa độ',
          icon: IconPin,
          label: xy,
          sub: `VN-2000 KTT ${KTT(g.lon0)} — ${g.province}`,
          lngLat: [g.lng, g.lat],
          coordZone: zoneKeyOf(g) || 'auto',
        });
      }
    } else {
      for (const p of searchProvinces(deferred).slice(0, 3)) {
        const [w, s, e, n] = p.bbox;
        out.push({
          key: `p-${p.id}`,
          group: 'Tỉnh / thành',
          icon: IconGlobe,
          label: p.name,
          sub: p.aliases.length ? `Gồm ${p.aliases.slice(0, 3).join(', ')}${p.aliases.length > 3 ? '…' : ''}` : 'Tỉnh / thành phố',
          lngLat: [(w + e) / 2, (s + n) / 2],
          bounds: [
            [w, s],
            [e, n],
          ],
        });
      }
      for (const f of find(deferred).slice(0, 12)) {
        out.push({
          key: `t-${f.source}-${f.position[0]}-${f.position[1]}-${f.text}`,
          group: f.sketchId ? 'Nét vẽ' : 'Trong bản vẽ',
          icon: f.sketchId ? IconPen : IconFile,
          label: f.text,
          sub: f.source,
          lngLat: f.position,
          sketchId: f.sketchId,
        });
      }
    }
    return out;
  }, [deferred, coord, drawingCrs, find, zone, fixedZone]);

  // Place names from OpenStreetMap (Nominatim: ≤ 1 request/s, debounced, Vietnam only).
  useEffect(() => {
    if (!open || coord || deferred.length < 3) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setOsmBusy(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
          q: deferred,
          format: 'jsonv2',
          countrycodes: 'vn',
          'accept-language': 'vi',
          limit: '5',
        })}`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.ok) setOsm({ q: deferred, items: (await res.json()) as OsmPlace[] });
      } catch {
        /* offline / aborted: local results only */
      } finally {
        if (!ctrl.signal.aborted) setOsmBusy(false);
      }
    }, 700);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [deferred, coord, open]);

  const results = useMemo<Result[]>(() => {
    const places: Result[] =
      osm && osm.q === deferred && !coord
        ? osm.items.map((p) => {
            const lat = Number(p.lat);
            const lng = Number(p.lon);
            const bb = p.boundingbox?.map(Number);
            const [name, ...rest] = p.display_name.split(', ');
            return {
              key: `o-${p.place_id}`,
              group: 'Địa danh (OpenStreetMap)',
              icon: IconPin,
              label: name,
              sub: rest.slice(0, 3).join(', '),
              lngLat: [lng, lat] as Vec2,
              bounds:
                bb && bb.every(Number.isFinite) && (bb[1] - bb[0] > 0.002 || bb[3] - bb[2] > 0.002)
                  ? ([
                      [bb[2], bb[0]],
                      [bb[3], bb[1]],
                    ] as [Vec2, Vec2])
                  : undefined,
            };
          })
        : [];
    return [...local, ...places];
  }, [local, osm, deferred, coord]);

  // Keep the highlighted row inside the list ("adjust state during render").
  const [seen, setSeen] = useState(results);
  if (seen !== results) {
    setSeen(results);
    setActive(0);
  }

  // "/" or Ctrl/⌘+K focuses the search (not while typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setExpanded(true);
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false);
        if (!q) setExpanded(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, q]);

  const pick = (r: Result | undefined) => {
    if (!r) return;
    onGo({ label: r.label, lngLat: r.lngLat, bounds: r.bounds, sketchId: r.sketchId });
    setCard(r.coordZone !== undefined ? { lngLat: r.lngLat, zone: r.coordZone, seq: Date.now() } : null);
    setOpen(false);
    inputRef.current?.blur();
  };

  const clear = () => {
    setQ('');
    setOsm(null);
    setCard(null);
    onClear();
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[active] ?? results[0]);
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else {
        inputRef.current?.blur();
        if (!q) setExpanded(false);
      }
    }
  };

  const showList = open && deferred.length > 0;
  let lastGroup = '';

  return (
    <div ref={boxRef} className={`relative ${expanded ? 'w-[min(22rem,calc(100vw-80px))]' : ''} sm:w-96`}>
      {!expanded && (
        <button
          className="ui-floating flex h-10 w-10 items-center justify-center text-zinc-700 sm:hidden"
          aria-label="Tìm kiếm"
          onClick={() => {
            setExpanded(true);
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <IconSearch width={18} height={18} />
        </button>
      )}
      <div className={`ui-floating ${expanded ? 'flex' : 'hidden sm:flex'} h-10 items-center gap-2 pl-3 pr-1.5`}>
        <IconSearch className="shrink-0 text-zinc-400" width={16} height={16} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Tìm tọa độ, địa danh, chữ trong bản vẽ…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400"
          aria-label="Tìm kiếm trên bản đồ"
          role="combobox"
          aria-expanded={showList}
          aria-controls="map-search-results"
          aria-autocomplete="list"
          spellCheck={false}
        />
        {/* VN-2000 zone for X/Y searches: a native select under a compact chip. */}
        <label
          className={`relative flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-[11px] font-medium transition ${
            fixedZone ? 'bg-blue-50 text-blue-700' : 'bg-zinc-100 text-zinc-500 hover:text-zinc-800'
          }`}
          title={`Múi chiếu khi tìm theo X/Y VN-2000: ${fixedZone ? fixedZone.label : 'tự động (theo bản vẽ hoặc tỉnh)'}`}
        >
          <span className="max-w-[5.5rem] truncate">{fixedZone ? fixedZone.short : 'KTT'}</span>
          <IconChevron width={11} height={11} className="rotate-90" />
          <select
            className="absolute inset-0 cursor-pointer opacity-0"
            value={zone}
            onChange={(e) => {
              const z = e.target.value;
              setZone(z);
              try {
                window.localStorage.setItem(ZONE_KEY, z);
              } catch {
                /* preference only */
              }
              inputRef.current?.focus();
            }}
            aria-label="Múi chiếu VN-2000 khi tìm theo X/Y"
          >
            <option value="auto">Tự động (theo bản vẽ / tỉnh)</option>
            {VN2000_ZONES.map((z) => (
              <option key={z.key} value={z.key}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
        {osmBusy && <IconSpinner className="shrink-0 text-blue-600" width={14} height={14} />}
        {q ? (
          <button className="ui-icon-btn !h-7 !w-7 shrink-0" aria-label="Xóa tìm kiếm" onClick={clear}>
            <IconX width={14} height={14} />
          </button>
        ) : (
          <kbd className="mr-1 hidden shrink-0 rounded border border-zinc-200 px-1.5 text-[10px] text-zinc-400 sm:inline">/</kbd>
        )}
      </div>

      {!showList && card && (
        <CoordCard
          key={card.seq}
          lngLat={card.lngLat}
          zone={card.zone === 'auto' && fixedZone ? fixedZone.key : card.zone}
          drawingCrs={drawingCrs}
          onClose={() => setCard(null)}
        />
      )}

      {showList && (
        <div
          id="map-search-results"
          role="listbox"
          className="ui-floating ui-pop-in ui-scroll absolute left-0 right-0 top-12 max-h-[min(60vh,26rem)] overflow-y-auto py-1.5"
        >
          {results.length === 0 ? (
            <p className="px-3.5 py-3 text-xs leading-relaxed text-zinc-500">
              {osmBusy ? 'Đang tìm địa danh…' : 'Không tìm thấy. Thử tọa độ như “10.0129, 105.7402” hoặc “X 1107400 Y 580900”.'}
            </p>
          ) : (
            results.map((r, i) => {
              const header = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              return (
                <div key={r.key}>
                  {header && <p className="px-3.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">{header}</p>}
                  <button
                    role="option"
                    aria-selected={i === active}
                    className={`flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition ${i === active ? 'bg-blue-50' : 'hover:bg-zinc-50'}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(r)}
                  >
                    <r.icon className={`mt-0.5 shrink-0 ${i === active ? 'text-blue-600' : 'text-zinc-400'}`} width={15} height={15} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-900">{r.label}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{r.sub}</span>
                    </span>
                  </button>
                </div>
              );
            })
          )}
          {!coord && deferred.length >= 3 && <p className="px-3.5 pb-1 pt-2 text-[10px] text-zinc-400">Địa danh © OpenStreetMap</p>}
        </div>
      )}
    </div>
  );
}
