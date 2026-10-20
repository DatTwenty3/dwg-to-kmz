'use client';
// The home page "/": the brand, large — the mark draws its outline and fills, then LEDAT-GIS and GEOSPATIAL
// SOLUTIONS appear in turn — and below it one drop zone for every tool (the dropped files go to the tool that reads them). No top bar anywhere: every tool page has the logo
// in its top-left corner, which leads back here.
import { useEffect } from 'react';
import Backdrop from './Backdrop';
import { BRAND_NAVY, LOGO_PATH, LOGO_VIEWBOX } from './brand';
import { wordmarkLetter } from './shimmerLetter';
import Tagline from './Tagline';
import HomeDrop from './HomeDrop';

const BRAND = 'LEDAT-GIS';

export default function BrandHome() {
  // Old shared links pointed at "/" (?t=…#m=…, ?sample=…): they belong to the map tool now.
  useEffect(() => {
    const { search, hash } = window.location;
    if (/[#&]m=/.test(hash) || /[?&]sample=/.test(search)) window.location.replace(`/ban-do${search}${hash}`);
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-white">
      <Backdrop />
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12 text-center sm:px-6">
        {/* Brand lockup: mark on the left (draws, then fills), wordmark + tagline on the right. */}
        <div className="flex items-center gap-3 sm:gap-7">
          <span className="relative shrink-0">
            <span className="ui-intro-halo absolute inset-0 rounded-full bg-blue-500/20" aria-hidden />
            <svg viewBox={LOGO_VIEWBOX} className="relative h-14 w-14 sm:h-36 sm:w-36" aria-hidden>
              <path d={LOGO_PATH} fill="none" stroke={BRAND_NAVY} strokeWidth={8} strokeLinejoin="round" pathLength={1} className="ui-intro-draw" />
              <path d={LOGO_PATH} fill={BRAND_NAVY} fillRule="evenodd" className="ui-intro-fill" />
            </svg>
          </span>
          <div className="flex flex-col items-stretch text-left">
            <h1 className="ui-wordmark whitespace-nowrap text-[2.4rem] leading-none sm:text-8xl" aria-label={BRAND}>
              {[...BRAND].map((ch, k) => wordmarkLetter(ch, k, 'ui-intro-letter', 1.25 + k * 0.07))}
            </h1>
            <Tagline className="ui-intro-tagline mt-2 pl-[0.12em] text-[10px] sm:mt-4 sm:text-2xl" />
          </div>
        </div>

        <HomeDrop />
      </main>
      <footer className="ui-intro-card relative z-10 px-6 py-5 text-center text-[11px] text-zinc-400" style={{ animationDelay: '2.6s' }}>
        © LEDAT
      </footer>
    </div>
  );
}
