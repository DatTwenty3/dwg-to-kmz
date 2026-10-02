// "GEOSPATIAL SOLUTIONS" spread letter by letter to exactly the width of the wordmark above it, as in the
// logo artwork. The parent must stretch it to that width (flex column with items-stretch).
import type { CSSProperties } from 'react';

const TAGLINE = 'Geospatial Solutions';

export default function Tagline({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={`ui-tagline flex justify-between ${className}`} style={style} aria-label={TAGLINE}>
      {[...TAGLINE].map((ch, i) => (
        <span key={i} aria-hidden>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
}
