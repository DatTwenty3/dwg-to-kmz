'use client';
// The light, moving map-like backdrop of the start screens (home page and the two tools).
import { useEffect, useRef } from 'react';

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
export default function Backdrop() {
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
