'use client';
// The home page "/": the brand, large — the mark draws its outline and fills, then LEDAT-GIS and GEOSPATIAL
// SOLUTIONS appear in turn — and below it one card per tool. No top bar anywhere: every tool page has the logo
// in its top-left corner, which leads back here.
import Link from 'next/link';
import { useEffect } from 'react';
import Backdrop from './Backdrop';
import { BRAND_NAVY, LOGO_PATH, LOGO_VIEWBOX } from './brand';
import { wordmarkLetter } from './shimmerLetter';
import Tagline from './Tagline';
import { IconArrowRight, IconDatabaseCheck, IconGlobe, IconLayers, IconShare } from './icons';

const BRAND = 'LEDAT-GIS';

const TOOLS = [
  {
    href: '/ban-do',
    name: 'Bản đồ CAD',
    desc: 'Mở DWG, DXF, KMZ, GDB trên nền ảnh vệ tinh. Đo đạc, xuất KMZ / DXF.',
    Icon: IconGlobe,
  },
  {
    href: '/ban-do#moi',
    name: 'Vẽ & chia sẻ',
    desc: 'Vẽ ghi chú lên bản đồ, gửi cho người khác bằng link hoặc mã QR.',
    Icon: IconShare,
  },
  {
    href: '/kiem-tra',
    name: 'Kiểm tra CSDL GIS',
    desc: 'Đối chiếu HoSoGIS với Thông tư 16, chuẩn hóa theo mẫu, báo cáo PDF.',
    Icon: IconDatabaseCheck,
  },
  {
    href: '/boc-tach',
    name: 'Bóc tách DWG',
    desc: 'Từ thư mục bản vẽ quy hoạch ra HoSoGIS theo Thông tư 16.',
    Icon: IconLayers,
  },
] as const;

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

        <nav className="mt-10 grid w-full max-w-5xl gap-2.5 sm:mt-20 sm:gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Công cụ">
          {TOOLS.map(({ href, name, desc, Icon }, k) => (
            <Link
              key={href}
              href={href}
              className="ui-intro-card group flex gap-3.5 rounded-3xl border border-zinc-200 bg-white/80 p-4 text-left sm:flex-col sm:gap-0 sm:p-6 shadow-[0_1px_2px_rgba(11,53,88,0.05),0_12px_32px_rgba(11,53,88,0.06)] backdrop-blur-md transition hover:-translate-y-1 hover:border-blue-300 hover:bg-white hover:shadow-[0_18px_44px_rgba(11,53,88,0.12)]"
              style={{ animationDelay: `${2.15 + k * 0.1}s` }}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-900 to-blue-700 text-white shadow-md transition group-hover:scale-105">
                <Icon width={20} height={20} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-base font-bold tracking-[-0.01em] text-zinc-900 sm:mt-5">
                  {name}
                  <IconArrowRight width={15} height={15} className="text-zinc-400 transition group-hover:translate-x-1 group-hover:text-blue-600" />
                </span>
                <span className="mt-1 block text-[13.5px] leading-relaxed text-zinc-600 sm:mt-2">{desc}</span>
              </span>
            </Link>
          ))}
        </nav>
      </main>
      <footer className="ui-intro-card relative z-10 px-6 py-5 text-center text-[11px] text-zinc-400" style={{ animationDelay: '2.6s' }}>
        © LEDAT
      </footer>
    </div>
  );
}
