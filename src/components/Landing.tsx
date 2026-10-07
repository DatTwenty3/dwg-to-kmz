'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { filesFromDrop } from './dropFiles';
import Tagline from './Tagline';
import { IconAlert, IconArrowRight, IconCheck, IconDatabaseCheck, IconPen, IconUpload, Logo } from './icons';
import { useFileAccept } from './useFileAccept';

/** Formats cycled in the headline, in the order the app reads them. */
const FORMATS = ['.dwg', '.dxf', '.kmz', '.kml', '.gdb'];
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

/** A horizontal wave as a path: quadratic half-waves from x0, long enough to slide one `period` and loop. */
function wavePath(y: number, amp: number, period: number) {
  const half = period / 2;
  const n = Math.ceil((1200 + 3 * period) / half);
  return `M${-period * 1.5} ${y} q${half / 2} ${-2 * amp} ${half} 0` + ` t${half} 0`.repeat(n);
}

/** Flowing contour lines: [y, amplitude, period, seconds per period, colour, direction]. */
const WAVES: [number, number, number, number, string, 1 | -1][] = [
  [110, 26, 520, 26, '#bfdbfe', 1],
  [170, 34, 640, 34, '#d4d4d8', -1],
  [235, 22, 460, 22, '#c7d2fe', 1],
  [520, 30, 600, 30, '#bfdbfe', -1],
  [585, 38, 720, 38, '#d4d4d8', 1],
  [650, 26, 540, 28, '#c7d2fe', -1],
  [715, 32, 680, 36, '#bfdbfe', 1],
];

/** Survey traverse (dashed polygon) with a point travelling along it. */
const TRAVERSE = 'M210 300 L 380 640 L 760 600 L 930 250 Z';
const STATIONS: [number, number, number][] = [
  [210, 300, 0],
  [930, 250, 0.8],
  [760, 600, 1.6],
  [380, 640, 2.2],
];

/**
 * Light map-like backdrop: soft aurora colour fields, a faint grid, contour lines flowing sideways, a survey
 * traverse with marching dashes and a travelling point, and a slight parallax that follows the pointer.
 * Under prefers-reduced-motion the waves and colour fields keep moving, only much slower; the travelling point
 * and the parallax are off.
 */
function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--mx', (e.clientX / window.innerWidth - 0.5).toFixed(3));
        el.style.setProperty('--my', (e.clientY / window.innerHeight - 0.5).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Aurora: large blurred colour fields drifting slowly. */}
      <div className="ui-parallax absolute inset-0" style={{ ['--depth' as string]: '-28px' }}>
        <div className="ui-aurora ui-aurora-a" />
        <div className="ui-aurora ui-aurora-b" />
        <div className="ui-aurora ui-aurora-c" />
      </div>

      <div className="ui-parallax absolute -inset-12" style={{ ['--depth' as string]: '14px' }}>
        <svg className="ui-drift h-full w-full" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="#f1f5f9" strokeWidth="1" />
            </pattern>
            <radialGradient id="fade" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#fff" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1200" height="760" fill="url(#grid)" />
          {WAVES.map(([y, amp, period, secs, color, dir], k) => (
            <g key={k} className="ui-draw-in" style={{ animationDelay: `${0.15 + k * 0.15}s` }}>
              <path
                d={wavePath(y, amp, period)}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                className="ui-wave"
                style={{
                  ['--period' as string]: `${dir * period}px`,
                  animationDuration: `${secs}s`,
                  animationDelay: `${-k * 3}s`,
                }}
              />
            </g>
          ))}
          <path d={TRAVERSE} fill="none" stroke="#bfdbfe" strokeDasharray="4 6" strokeWidth="1.2" className="ui-march" />
          <g className="ui-traveller">
            <circle r="9" fill="#2563eb" opacity="0.15" />
            <circle r="3.5" fill="#2563eb" />
            <animateMotion dur="16s" repeatCount="indefinite" path={TRAVERSE} />
          </g>
          {STATIONS.map(([x, y, delay]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="5" fill="#3b82f6" className="ui-ping" style={{ animationDelay: `${delay}s` }} />
              <circle cx={x} cy={y} r="4" fill="#fff" stroke="#2563eb" strokeWidth="2" />
            </g>
          ))}
          <rect width="1200" height="760" fill="url(#fade)" />
        </svg>
      </div>
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
  onBlankMap,
}: {
  onFile: (file: File) => void;
  busy: boolean;
  progress: { stage: string; percent: number } | null;
  error: string | null;
  /** A drawing is already loaded: offer to go back to it. */
  resumeName?: string;
  onResume?: () => void;
  /** Open an empty map to draw on (no file needed). */
  onBlankMap?: () => void;
  /** Shown in place of the drop zone (e.g. the coordinate-system step) while keeping the hero. */
  panel?: ReactNode;
}) {
  const fileAccept = useFileAccept();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => !busy && inputRef.current?.click();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-y-auto bg-white">
      <Backdrop />

      <header className="relative z-10 flex items-center gap-2.5 px-6 py-5 sm:px-10">
        <span className="ml-auto text-xs text-zinc-400">
          Tác giả <span className="font-medium text-zinc-600">LEDAT</span>
        </span>
      </header>

      <main className={`relative z-10 flex flex-1 flex-col items-center px-6 pb-16 text-center ${panel ? 'pt-4' : 'justify-center pt-6'}`}>
        {/* Brand lockup as in the logo artwork: mark on the left, wordmark + tagline on the right. */}
        <div className="flex items-center gap-3 sm:gap-5" style={{ viewTransitionName: 'ledat-title' }}>
          <Logo
            className={`ui-rise shrink-0 transition-[width,height] duration-500 ${panel ? 'h-12 w-12 sm:h-20 sm:w-20' : 'h-14 w-14 sm:h-28 sm:w-28'}`}
          />
          <div className="flex flex-col items-stretch">
            <h1
              className={`ui-wordmark whitespace-nowrap leading-none transition-[font-size] duration-500 ${panel ? 'text-3xl sm:text-6xl' : 'text-4xl sm:text-7xl'}`}
              aria-label={BRAND}
            >
              {[...BRAND].map((ch, k) => (
                <span
                  key={k}
                  aria-hidden
                  className={`ui-rise inline-block ${k >= 6 ? 'ui-shimmer' : ''}`}
                  style={{ animationDelay: `${0.1 + k * 0.06}s` }}
                >
                  {ch}
                </span>
              ))}
            </h1>
            <Tagline
              className={`ui-fade-up mt-2 pl-[0.12em] transition-[font-size] duration-500 sm:mt-3 ${panel ? 'text-[9px] sm:text-lg' : 'text-[11px] sm:text-[21px]'}`}
              style={{ animationDelay: '0.55s' }}
            />
          </div>
        </div>

        <p
          className="ui-fade-up mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-lg text-zinc-600 sm:text-2xl"
          style={{ animationDelay: '0.7s', viewTransitionName: 'ledat-subtitle' }}
        >
          <span>Đưa các định dạng</span>
          <FormatTyper />
          <span>của bạn lên bản đồ</span>
        </p>

        {panel ? (
          <div className="mt-10 w-full max-w-2xl text-left">{panel}</div>
        ) : (
          <>
          <div className="ui-fade-up mt-10 w-full max-w-xl" style={{ animationDelay: '0.95s' }}>
            <div
              role="button"
              tabIndex={0}
              aria-label="Chọn hoặc kéo thả file DWG, DXF, KMZ, KML, thư mục geodatabase (.gdb) hoặc phiên làm việc LDG"
              onClick={open}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') open();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setOver(false);
                if (busy) return;
                // A dropped .gdb / HoSoGIS folder arrives as one zip.
                const [f] = await filesFromDrop(e.dataTransfer);
                if (f) onFile(f);
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
                    hoặc <span className="font-medium text-blue-600">chọn file</span> · .dwg .dxf .kmz .kml .ldg · thư mục .gdb hoặc .zip
                  </span>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={fileAccept}
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

            {onBlankMap && !busy && (
              <div className="mt-5 flex items-center gap-3 text-xs text-zinc-400">
                <span className="h-px flex-1 bg-zinc-200" />
                hoặc
                <span className="h-px flex-1 bg-zinc-200" />
              </div>
            )}
            {onBlankMap && !busy && (
              <button className="ui-cta group mx-auto mt-4" onClick={onBlankMap}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
                  <IconPen width={15} height={15} className="transition-transform duration-300 group-hover:-rotate-12" />
                </span>
                <span>
                  Tạo bản đồ mới
                  <span className="font-normal text-white/80"> — vẽ và chia sẻ</span>
                </span>
                <IconArrowRight width={16} height={16} className="transition-transform duration-300 group-hover:translate-x-1" />
              </button>
            )}

            {!busy && (
              <Link href="/kiem-tra-gdb" className="ui-btn-ghost mx-auto mt-3 text-[13px]">
                <IconDatabaseCheck width={15} height={15} />
                Kiểm tra CSDL GIS (.gdb) theo Thông tư 16/2025/TT-BXD
                <IconArrowRight width={14} height={14} />
              </Link>
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
