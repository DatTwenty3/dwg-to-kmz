// One letter of the LEDAT-GIS wordmark when the letters move one by one. The motion and the "GIS" shimmer must
// sit on different elements: one element has only one `animation`, so putting both on it let one of them win
// (the GIS letters then moved out of step with LEDAT-, or not at all with reduced motion).
import type { ReactNode } from 'react';

/** Index of the first shimmering letter ("G" of LEDAT-GIS). */
const GIS_FROM = 6;

export function wordmarkLetter(ch: string, k: number, motionClass: string, delay: number): ReactNode {
  return (
    <span key={k} aria-hidden className={`${motionClass} inline-block`} style={{ animationDelay: `${delay}s` }}>
      {k >= GIS_FROM ? (
        // The highlight travels G → I → S: later letters lag in phase.
        <span className="ui-shimmer" style={{ animationDelay: `${-1.2 + (k - GIS_FROM) * 0.3}s` }}>
          {ch}
        </span>
      ) : (
        ch
      )}
    </span>
  );
}
