'use client';
// Phones: one "layers" button instead of the basemap pill; it opens a 2×2 grid of basemaps, each previewed with
// a tile of the area currently in view (like Google Maps' layer picker).
import { useEffect, useRef, useState } from 'react';
import { BASEMAPS, basemapThumbUrl } from '@/lib/map';
import { IconLayers } from './icons';

const NAME: Record<string, string> = {
  'google-hybrid': 'Hybrid',
  'google-satellite': 'Vệ tinh',
  'google-roadmap': 'Đường phố',
  'esri-imagery': 'Esri (dự phòng)',
};

export default function BasemapPicker({
  basemapId,
  onChange,
  view,
}: {
  basemapId: string;
  onChange: (id: string) => void;
  /** Current map centre / zoom, read when the picker opens (for the previews). */
  view: () => { lng: number; lat: number; zoom: number } | null;
}) {
  const [open, setOpen] = useState<{ lng: number; lat: number; zoom: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div ref={boxRef} className="absolute right-3 top-3 z-20">
      <button
        className={`ui-floating ui-drop-in flex h-10 w-10 items-center justify-center transition ${open ? 'text-blue-600' : 'text-zinc-700'}`}
        style={{ animationDelay: '0.3s' }}
        aria-label="Chọn bản đồ nền"
        aria-expanded={!!open}
        onClick={() => setOpen((o) => (o ? null : (view() ?? { lng: 106, lat: 16, zoom: 5 })))}
      >
        <IconLayers width={19} height={19} />
      </button>

      {open && (
        <div className="ui-floating ui-pop-in absolute right-0 top-12 w-[15.5rem] p-3" role="dialog" aria-label="Bản đồ nền">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Bản đồ nền</p>
          <div className="grid grid-cols-2 gap-2.5">
            {BASEMAPS.map((b) => {
              const active = b.id === basemapId;
              // A notch below the current zoom so the preview shows the surroundings.
              const z = Math.max(3, Math.min(16, Math.floor(open.zoom) - 1));
              return (
                <button
                  key={b.id}
                  className="group flex flex-col items-center gap-1.5 text-[12px]"
                  aria-pressed={active}
                  onClick={() => {
                    onChange(b.id);
                    setOpen(null);
                  }}
                >
                  <span
                    className={`block h-[4.5rem] w-full overflow-hidden rounded-xl bg-zinc-100 ring-2 transition ${
                      active ? 'ring-blue-600' : 'ring-transparent group-active:ring-zinc-300'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a raw map tile, not a page image */}
                    <img
                      src={basemapThumbUrl(b, open.lng, open.lat, z)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />
                  </span>
                  <span className={active ? 'font-semibold text-blue-700' : 'text-zinc-700'}>{NAME[b.id] ?? b.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
