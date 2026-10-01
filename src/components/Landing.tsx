'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconAlert, IconArrowRight, IconCheck, IconUpload, Logo } from './icons';

/** Formats cycled in the headline, in the order the app reads them. */
const FORMATS = ['.dwg', '.dxf', '.kmz', '.kml'];
const BRAND = 'LEDAT-GIS';

const FEATURES = [
  'Giữ nguyên chữ tiếng Việt (Unicode, VNI, TCVN3)',
  'VN-2000 theo tỉnh, UTM, mã EPSG',
  'Xuất KMZ, KML và DXF',
];

const TYPE_MS = 110;
const DELETE_MS = 60;
const HOLD_MS = 1300;
const GAP_MS = 350;

/**
 * Typewriter: types a format, holds, deletes it character by character, then types the next one.
 * Runs even with prefers-reduced-motion: it only changes text in place (no movement), and the
 * owner wants it visible on machines where Windows "Animation effects" is off.
 */
function FormatTyper() {
  const [i, setI] = useState(0);
  const [len, setLen] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const word = FORMATS[i];

  useEffect(() => {
    let delay: number;
    let next: () => void;
    if (!deleting && len < word.length) {
      delay = TYPE_MS;
      next = () => setLen(len + 1);
    } else if (!deleting) {
      delay = HOLD_MS;
      next = () => setDeleting(true);
    } else if (len > 0) {
      delay = DELETE_MS;
      next = () => setLen(len - 1);
    } else {
      delay = GAP_MS;
      next = () => {
        setDeleting(false);
        setI((v) => (v + 1) % FORMATS.length);
      };
    }
    const t = setTimeout(next, delay);
    return () => clearTimeout(t);
  }, [i, len, deleting, word]);

  return (
    <span className="inline-flex h-[1.45em] min-w-[3.6em] items-center rounded-lg bg-blue-50 px-2 font-mono font-semibold leading-none text-blue-600 ring-1 ring-blue-100">
      <span className="sr-only">{FORMATS.join(', ')}</span>
      <span aria-hidden>{word.slice(0, len)}</span>
      <span aria-hidden className="ui-caret ml-px inline-block h-[1em] w-[2px] rounded-full bg-blue-600" />
    </span>
  );
}

/** Light map-like backdrop: a faint grid, contour lines that draw themselves and pulsing survey points. */
function Backdrop() {
  const contours = [
    'M-50 520 C 180 430, 330 610, 560 500 S 940 380, 1250 470',
    'M-50 580 C 200 500, 360 680, 590 560 S 960 450, 1250 540',
    'M-50 640 C 220 570, 390 740, 620 620 S 980 520, 1250 610',
    'M-50 180 C 150 260, 320 90, 520 170 S 900 300, 1250 200',
    'M-50 120 C 170 200, 340 30, 540 110 S 920 240, 1250 140',
  ];
  const points: [number, number, number][] = [
    [210, 300, 0],
    [930, 250, 0.8],
    [760, 600, 1.6],
    [380, 640, 2.2],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="ui-drift absolute -inset-12 h-[calc(100%+6rem)] w-[calc(100%+6rem)]" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#f4f4f5" strokeWidth="1" />
          </pattern>
          <radialGradient id="fade" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.92" />
            <stop offset="60%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1200" height="760" fill="url(#grid)" />
        {contours.map((d, k) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke={k % 2 ? '#e4e4e7' : '#dbeafe'}
            strokeWidth="1.4"
            className="ui-draw"
            style={{ animationDelay: `${0.2 + k * 0.25}s` }}
          />
        ))}
        <path d="M210 300 L 380 640 L 760 600 L 930 250 Z" fill="none" stroke="#bfdbfe" strokeDasharray="4 6" strokeWidth="1.2" />
        {points.map(([x, y, delay]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="5" fill="#3b82f6" className="ui-ping" style={{ animationDelay: `${delay}s` }} />
            <circle cx={x} cy={y} r="4" fill="#fff" stroke="#2563eb" strokeWidth="2" />
          </g>
        ))}
        <rect width="1200" height="760" fill="url(#fade)" />
      </svg>
    </div>
  );
}

export default function Landing({
  onFile,
  busy,
  progress,
  error,
  resumeName,
  onResume,
  panel,
}: {
  onFile: (file: File) => void;
  busy: boolean;
  progress: { stage: string; percent: number } | null;
  error: string | null;
  /** A drawing is already loaded: offer to go back to it. */
  resumeName?: string;
  onResume?: () => void;
  /** Shown in place of the drop zone (e.g. the coordinate-system step) while keeping the hero. */
  panel?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => !busy && inputRef.current?.click();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-y-auto bg-white">
      <Backdrop />

      <header className="relative z-10 flex items-center gap-2.5 px-6 py-5 sm:px-10">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight text-zinc-900">{BRAND}</span>
        <span className="ml-auto text-xs text-zinc-400">
          Tác giả <span className="font-medium text-zinc-600">LEDAT</span>
        </span>
      </header>

      <main className={`relative z-10 flex flex-1 flex-col items-center px-6 pb-16 text-center ${panel ? 'pt-4' : 'justify-center pt-6'}`}>
        <h1
          className={`font-bold tracking-tighter text-zinc-900 transition-[font-size] duration-500 ${panel ? 'text-5xl sm:text-7xl' : 'text-6xl sm:text-8xl'}`}
          aria-label={BRAND}
        >
          {[...BRAND].map((ch, k) => (
            <span
              key={k}
              aria-hidden
              className={`ui-rise inline-block ${k >= 6 ? 'ui-shimmer' : ''}`}
              style={{ animationDelay: `${k * 0.06}s` }}
            >
              {ch}
            </span>
          ))}
        </h1>

        <p
          className="ui-fade-up mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-lg text-zinc-600 sm:text-2xl"
          style={{ animationDelay: '0.7s' }}
        >
          <span>Đưa các định dạng</span>
          <FormatTyper />
          <span>của bạn lên bản đồ</span>
        </p>

        {panel ? (
          <div className="ui-fade-up mt-10 w-full max-w-2xl text-left">{panel}</div>
        ) : (
          <>
          <div className="ui-fade-up mt-10 w-full max-w-xl" style={{ animationDelay: '0.95s' }}>
            <div
              role="button"
              tabIndex={0}
              aria-label="Chọn hoặc kéo thả file DWG, DXF, KMZ, KML"
              onClick={open}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') open();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f && !busy) onFile(f);
              }}
              className={`group flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-white/80 px-6 py-10 shadow-[0_8px_32px_rgba(15,23,42,0.06)] backdrop-blur transition ${
                busy
                  ? 'cursor-progress border-zinc-200'
                  : over
                    ? 'cursor-pointer border-blue-500 bg-blue-50/70 ring-8 ring-blue-500/10'
                    : 'cursor-pointer border-zinc-300 hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-[0_12px_40px_rgba(15,23,42,0.10)]'
              }`}
            >
              {busy && progress ? (
                <div className="w-full max-w-sm" aria-live="polite">
                  <p className="text-sm font-medium text-zinc-900">{progress.stage}…</p>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-zinc-900 transition-[width]" style={{ width: `${Math.max(4, progress.percent)}%` }} />
                  </div>
                  <p className="mt-2 text-xs tabular-nums text-zinc-400">{Math.round(progress.percent)}%</p>
                </div>
              ) : (
                <>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm transition group-hover:scale-105">
                    <IconUpload width={20} height={20} />
                  </span>
                  <span className="text-base font-medium text-zinc-900">Thả file vào đây để bắt đầu</span>
                  <span className="text-sm text-zinc-500">
                    hoặc <span className="font-medium text-blue-600">chọn file</span> · .dwg .dxf .kmz .kml
                  </span>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".dwg,.dxf,.kmz,.kml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = '';
                }}
              />
            </div>

            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-left text-xs leading-relaxed text-red-700">
                <IconAlert className="mt-px shrink-0" width={14} height={14} />
                {error}
              </p>
            )}

            {resumeName && onResume && !busy && (
              <button className="ui-btn-ghost mx-auto mt-3" onClick={onResume}>
                Tiếp tục với {resumeName}
                <IconArrowRight width={14} height={14} />
              </button>
            )}

            <p className="mt-4 text-xs text-zinc-400">File được xử lý ngay trên trình duyệt — không tải lên máy chủ.</p>
          </div>

          <ul className="ui-fade-up mt-12 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-zinc-500" style={{ animationDelay: '1.2s' }}>
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <IconCheck className="text-blue-600" width={15} height={15} />
                {f}
              </li>
            ))}
          </ul>
          </>
        )}
      </main>

      <footer className="relative z-10 px-6 py-5 text-center text-[11px] text-zinc-400">
        © LEDAT · Ảnh nền © Google / © Esri · Mã nguồn GPL-3.0
      </footer>
    </div>
  );
}
