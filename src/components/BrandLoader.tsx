'use client';
// Full-screen wait screen shown whenever the app works (reading files, projecting, checking geodatabases, GDAL,
// exports…): the LEDAT-GIS mark draws itself and fills, the wordmark letters wave with the shimmer of "GIS",
// and the current stage + progress sit underneath. Fades in after 0.12 s so instant operations do not flash.
import { BRAND_NAVY, LOGO_PATH, LOGO_VIEWBOX } from './brand';
import { wordmarkLetter } from './shimmerLetter';
import Tagline from './Tagline';

const BRAND = 'LEDAT-GIS';

export default function BrandLoader({
  show,
  stage,
  percent,
}: {
  show: boolean;
  /** What is going on ("Đọc QH06…", "Ghi QuyHoach.gdb…"). */
  stage?: string | null;
  /** 0–100 when known; otherwise an indeterminate bar. */
  percent?: number | null;
}) {
  if (!show) return null;
  const known = typeof percent === 'number' && Number.isFinite(percent);
  const pct = known ? Math.max(0, Math.min(100, percent as number)) : 0;
  return (
    <div role="status" aria-live="polite" aria-busy className="ui-loader fixed inset-0 z-[80] flex items-center justify-center bg-white/80 backdrop-blur-md">
      <div className="flex w-full max-w-sm flex-col items-center px-6 text-center">
        <div className="relative h-24 w-24 sm:h-28 sm:w-28">
          <span className="ui-logo-halo absolute inset-0 rounded-full bg-blue-500/15" aria-hidden />
          <svg viewBox={LOGO_VIEWBOX} className="relative h-full w-full" aria-hidden>
            <path d={LOGO_PATH} fill="none" stroke={BRAND_NAVY} strokeWidth={9} strokeLinejoin="round" pathLength={1} className="ui-logo-draw" />
            <path d={LOGO_PATH} fill={BRAND_NAVY} fillRule="evenodd" className="ui-logo-fill" />
          </svg>
        </div>
        <div className="mt-5 flex flex-col items-stretch">
          <p className="ui-wordmark whitespace-nowrap text-3xl leading-none sm:text-4xl" aria-label={BRAND}>
            {[...BRAND].map((ch, k) => wordmarkLetter(ch, k, 'ui-loader-letter', k * 0.09))}
          </p>
          <Tagline className="mt-2 pl-[0.12em] text-[10px] text-zinc-500 sm:text-[11.5px]" />
        </div>
        <div className="mt-7 h-1.5 w-full max-w-[16rem] overflow-hidden rounded-full bg-zinc-200/80">
          {known ? (
            <div className="h-full rounded-full bg-gradient-to-r from-zinc-900 to-blue-600 transition-[width] duration-300" style={{ width: `${Math.max(4, pct)}%` }} />
          ) : (
            <div className="ui-indeterminate h-full w-1/3 rounded-full bg-gradient-to-r from-zinc-900 to-blue-600" />
          )}
        </div>
        <p className="mt-3 min-h-[1.25rem] max-w-full truncate text-[13px] text-zinc-600">
          {stage || 'Đang xử lý'}
          {known && <span className="tabular-nums text-zinc-400"> · {Math.round(pct)}%</span>}
        </p>
      </div>
    </div>
  );
}
