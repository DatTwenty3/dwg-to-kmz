'use client';
// Start screen of every tool (Bản đồ, Kiểm tra CSDL, Bóc tách DWG): the moving backdrop of the home page,
// the logo top-left (back to the home page — there is no top bar), a short title, the drop zone, and an animated
// isometric illustration of what the tool does. Few words on purpose.
import Link from 'next/link';
import type { HTMLAttributes, ReactNode } from 'react';
import Backdrop from './Backdrop';
import { IconUpload, Logo } from './icons';

type Art = 'map' | 'check' | 'extract';

/** Isometric slab: top face a diamond centred on (cx, y), half-width w, half-height w/2, thickness t. */
function slab(cx: number, y: number, w: number, t: number) {
  const h = w / 2;
  return {
    top: `${cx - w},${y} ${cx},${y - h} ${cx + w},${y} ${cx},${y + h}`,
    left: `${cx - w},${y} ${cx},${y + h} ${cx},${y + h + t} ${cx - w},${y + t}`,
    right: `${cx},${y + h} ${cx + w},${y} ${cx + w},${y + t} ${cx},${y + h + t}`,
    /** Maps the unit square onto the top face, for drawing map content on it. */
    face: `matrix(${w},${-h},${w},${h},${cx - w},${y})`,
  };
}

const PARCELS = [
  'M0.06 0.08 L0.42 0.06 L0.45 0.38 L0.08 0.42 Z',
  'M0.5 0.06 L0.92 0.1 L0.9 0.4 L0.52 0.36 Z',
  'M0.08 0.5 L0.44 0.46 L0.46 0.92 L0.1 0.9 Z',
  'M0.54 0.44 L0.9 0.48 L0.92 0.92 L0.56 0.94 Z',
];
const ROADS = ['M0 0.3 C0.3 0.24 0.6 0.4 1 0.32', 'M0.62 0 C0.58 0.4 0.72 0.7 0.66 1', 'M0 0.76 C0.35 0.7 0.55 0.82 1 0.74', 'M0.2 0 C0.24 0.3 0.16 0.6 0.22 1'];
const POINTS: [number, number][] = [
  [0.22, 0.24],
  [0.72, 0.22],
  [0.27, 0.7],
  [0.74, 0.7],
  [0.5, 0.5],
];

/** The map viewer: a CAD sheet settles onto the satellite base map, a pin drops on it. */
function MapArt() {
  const base = slab(210, 330, 140, 14);
  const sheet = slab(210, 330, 140, 2);
  return (
    <svg viewBox="40 80 340 380" className="h-full w-full overflow-visible" aria-hidden>
      <ellipse cx="210" cy="420" rx="150" ry="22" fill="#0e1f3b" opacity="0.06" />
      {/* Base map: imagery-like patches. */}
      <polygon points={base.left} fill="#a7c4a0" />
      <polygon points={base.right} fill="#8fb38a" />
      <polygon points={base.top} fill="#d9e8d2" stroke="#fff" strokeWidth="1.5" />
      <g transform={base.face}>
        <path d="M0 0 H0.55 C0.5 0.3 0.62 0.5 0.4 1 H0 Z" fill="#bcd6b2" />
        <path d="M0.7 0 H1 V0.6 C0.85 0.55 0.75 0.3 0.7 0 Z" fill="#c9dfc0" />
        <path d="M0 0.62 C0.3 0.58 0.6 0.72 1 0.66" fill="none" stroke="#7fb3d5" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.8" />
        <path d="M0.3 0 C0.34 0.4 0.26 0.7 0.32 1" fill="none" stroke="#fff" strokeWidth="3" vectorEffect="non-scaling-stroke" opacity="0.9" />
      </g>
      {/* The drawing: floats above, settles on the map, lifts again. */}
      <g transform="translate(0 -150)">
      <g className="ui-ts-explode" style={{ ['--lift' as string]: '150px' }}>
        <polygon points={sheet.top} fill="#dbeafe" fillOpacity="0.35" stroke="#2563eb" strokeOpacity="0.5" strokeWidth="1.5" />
        <g transform={sheet.face}>
          {PARCELS.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#1d4ed8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          ))}
          {ROADS.slice(0, 2).map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#ef4444" strokeOpacity="0.8" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      </g>
      </g>
      {/* Pin */}
      <g className="ui-ts-lift" style={{ ['--lift' as string]: '-14px' }}>
        <g transform="translate(236 268)">
          <ellipse cx="0" cy="62" rx="12" ry="5" fill="#0e1f3b" opacity="0.15" />
          <path d="M0 58 C-6 40 -26 26 -26 4 A26 26 0 0 1 26 4 C26 26 6 40 0 58 Z" fill="#0e1f3b" />
          <circle cx="0" cy="4" r="9" fill="#fff" />
        </g>
      </g>
    </svg>
  );
}

/** The checker: four geodatabases stacked, a scan beam passing, a verdict popping beside each one. */
function CheckArt() {
  const layers = [
    { y: 330, top: '#e0e7ff', side: '#c7d2fe', ink: '#6366f1' },
    { y: 255, top: '#e0f2fe', side: '#bae6fd', ink: '#0284c7' },
    { y: 180, top: '#dbeafe', side: '#bfdbfe', ink: '#2563eb' },
    { y: 105, top: '#f1f5f9', side: '#cbd5e1', ink: '#0e1f3b' },
  ];
  return (
    <svg viewBox="45 20 360 440" className="h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="ts-beam" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3b82f6" stopOpacity="0" />
          <stop offset="0.5" stopColor="#3b82f6" stopOpacity="0.35" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
        <clipPath id="ts-stack">
          <rect x="60" y="40" width="300" height="380" />
        </clipPath>
      </defs>
      <ellipse cx="210" cy="420" rx="150" ry="22" fill="#0e1f3b" opacity="0.06" />
      {layers.map((l, k) => {
        const s = slab(210, l.y, 140, 14);
        return (
          <g key={k} className="ui-ts-lift" style={{ ['--lift' as string]: `${-(3 - k) * 6}px`, animationDelay: `${-k * 0.4}s` }}>
            <polygon points={s.left} fill={l.side} />
            <polygon points={s.right} fill={l.side} opacity="0.8" />
            <polygon points={s.top} fill={l.top} stroke="#fff" strokeWidth="1.5" />
            <g transform={s.face}>
              {k % 2 === 0
                ? PARCELS.map((d, i) => (
                    <path key={i} d={d} fill={l.ink} fillOpacity={0.12 + i * 0.05} stroke={l.ink} strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />
                  ))
                : ROADS.map((d, i) => (
                    <path key={i} d={d} fill="none" stroke={l.ink} strokeOpacity="0.55" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  ))}
            </g>
          </g>
        );
      })}
      <g clipPath="url(#ts-stack)">
        <rect x="60" y="0" width="300" height="70" fill="url(#ts-beam)" className="ui-ts-scan" />
      </g>
      {layers.map((l, k) => {
        const warn = k === 1;
        return (
          <g
            key={k}
            transform={`translate(372 ${l.y + 6})`}
          >
            <g className="ui-ts-badge" style={{ animationDelay: `${(0.45 + ((l.y - 35) / 390) * 2.7).toFixed(2)}s` }}>
              <circle r="15" fill={warn ? '#f59e0b' : '#10b981'} />
              {warn ? (
                <path d="M0 -7 V2 M0 6.5 V7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              ) : (
                <path d="M-6 0 L-2 4 L6 -5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** The extractor: one CAD drawing comes apart into area / line / point layers (the _A _L _P of TT16). */
function ExtractArt() {
  const layers = [
    { lift: 0, tag: '_P', top: '#f1f5f9', side: '#cbd5e1', ink: '#0e1f3b' },
    { lift: -125, tag: '_L', top: '#e0f2fe', side: '#bae6fd', ink: '#0284c7' },
    { lift: -250, tag: '_A', top: '#dbeafe', side: '#bfdbfe', ink: '#2563eb' },
  ];
  const s = slab(200, 372, 124, 12);
  return (
    <svg viewBox="40 40 370 420" className="h-full w-full overflow-visible" aria-hidden>
      <ellipse cx="200" cy="440" rx="140" ry="20" fill="#0e1f3b" opacity="0.06" />
      {layers.map((l, k) => (
        <g key={k} className="ui-ts-explode" style={{ ['--lift' as string]: `${l.lift}px` }}>
          <polygon points={s.left} fill={l.side} opacity={k === 0 ? 1 : 0.9} />
          <polygon points={s.right} fill={l.side} opacity={k === 0 ? 0.8 : 0.7} />
          <polygon points={s.top} fill={l.top} fillOpacity={k === 0 ? 1 : 0.55} stroke="#fff" strokeWidth="1.5" />
          <g transform={s.face}>
            {k === 2 &&
              PARCELS.map((d, i) => (
                <path key={i} d={d} fill={l.ink} fillOpacity={0.14 + i * 0.06} stroke={l.ink} strokeOpacity="0.6" vectorEffect="non-scaling-stroke" />
              ))}
            {k === 1 &&
              ROADS.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={l.ink} strokeOpacity="0.7" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ))}
            {k === 0 && POINTS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="0.035" fill={l.ink} />)}
          </g>
          <g className="ui-ts-tag" transform="translate(372 378)">
            <rect x="-22" y="-13" width="44" height="26" rx="8" fill="#fff" stroke={l.side} />
            <text x="0" y="5" textAnchor="middle" fontSize="13" fontWeight="700" fill={l.ink} fontFamily="ui-monospace, monospace">
              {l.tag}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}

export default function ToolStart({
  art,
  title,
  subtitle,
  prompt,
  hint,
  label,
  actions,
  over,
  onActivate,
  zoneProps,
  children,
  footer,
  after,
  panel,
}: {
  art: Art;
  title: ReactNode;
  subtitle: ReactNode;
  prompt: string;
  /** Small line under the prompt (accepted formats). */
  hint?: string;
  /** Accessible name of the drop zone. */
  label: string;
  actions?: ReactNode;
  over: boolean;
  /** Enter / Space on the drop zone. */
  onActivate: () => void;
  zoneProps?: HTMLAttributes<HTMLDivElement>;
  /** Hidden file inputs. */
  children?: ReactNode;
  /** Buttons in the same card, under the drop zone (centred). */
  footer?: ReactNode;
  /** Messages under the card. */
  after?: ReactNode;
  /** Shown instead of the drop zone and the illustration (e.g. the map tool's coordinate-system step). */
  panel?: ReactNode;
}) {
  const home = (
    <Link
      href="/"
      className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-white/70 sm:left-5 sm:top-4"
      aria-label="Về trang chủ LEDAT-GIS"
      title="Trang chủ"
    >
      <Logo className="h-7 w-7" />
      <span className="ui-wordmark text-[15px] leading-none">
        LEDAT-<span className="ui-shimmer">GIS</span>
      </span>
    </Link>
  );
  if (panel)
    return (
      <main className="relative flex flex-1 overflow-hidden">
        <Backdrop />
        {home}
        <div className="relative mx-auto w-full max-w-2xl px-4 pb-10 pt-20 sm:px-6">
          <h1 className="ui-fade-up text-3xl font-bold tracking-[-0.03em] text-zinc-900 sm:text-[2.75rem] sm:leading-[1.05]">{title}</h1>
          <div className="mt-6">{panel}</div>
        </div>
      </main>
    );
  return (
    <main className="relative flex flex-1 items-center overflow-hidden">
      <Backdrop />
      {home}
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-6 px-4 pb-10 pt-20 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-16">
        <div className="ui-fade-up order-2 w-full lg:order-1">
          {/* Planpoint-like headline: large, bold, tight tracking — reads like a drawing title block. */}
          <h1 className="text-[2.4rem] font-bold leading-[1.04] tracking-[-0.035em] text-zinc-900 sm:text-[3.4rem] [&_span]:whitespace-nowrap">{title}</h1>
          <div className="mt-4 text-base text-zinc-600 sm:text-[17px]">{subtitle}</div>
          {/* One card: the drop zone and, under it, the other ways to start. */}
          <div className="mt-8 rounded-[2rem] border border-zinc-200 bg-white/80 p-2 shadow-[0_20px_60px_rgba(11,53,88,0.06),0_1px_2px_rgba(11,53,88,0.05)] backdrop-blur-md">
          <div
            {...zoneProps}
            role="button"
            tabIndex={0}
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onActivate();
            }}
            className={`group relative rounded-[1.6rem] border-2 border-dashed px-5 py-9 text-center transition sm:py-10 ${
              over ? 'border-blue-500 bg-blue-50/80' : 'border-zinc-300/70 bg-white/60 hover:border-blue-300 hover:bg-white'
            }`}
          >
            <span className="relative mx-auto flex h-14 w-14 items-center justify-center">
              <span className="ui-pulse-ring absolute inset-0 rounded-2xl bg-blue-500/30" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-900 to-blue-700 text-white shadow-lg transition group-hover:-translate-y-0.5">
                <IconUpload width={22} height={22} />
              </span>
            </span>
            <p className="mt-4 text-[15px] font-medium text-zinc-900">{prompt}</p>
            {hint && <p className="mt-1.5 text-[12.5px] tracking-wide text-zinc-400">{hint}</p>}
            {actions && <div className="ui-pills mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
            {children}
          </div>
          {footer && <div className="ui-pills flex flex-wrap items-center justify-center gap-2.5 px-3 pb-2 pt-3">{footer}</div>}
          </div>
          {after && <div className="mt-4">{after}</div>}
        </div>
        {/* The illustration, centred in its column on a soft halo so both columns carry the same weight. */}
        <div className="ui-fade-up relative order-1 mx-auto flex h-44 w-full max-w-[22rem] items-center justify-center sm:h-60 lg:order-2 lg:h-[30rem] lg:max-w-[30rem]" style={{ animationDelay: '0.15s' }}>
          <div aria-hidden className="absolute inset-[6%] rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(191,219,254,0.75),rgba(224,231,255,0.35)_45%,transparent_70%)]" />
          <div className="relative h-full w-full">
            {art === 'map' ? <MapArt /> : art === 'check' ? <CheckArt /> : <ExtractArt />}
          </div>
        </div>
      </div>
    </main>
  );
}
