'use client';
// The one top bar of every page: brand, the three tools as tabs, a short guide. On the map page `onHome`
// brings the map app back to its start screen instead of navigating.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconDatabaseCheck, IconGlobe, IconLayers, IconX, Logo } from './icons';

export const TOOLS = [
  {
    href: '/',
    label: 'Bản đồ',
    short: 'Bản đồ',
    long: 'Bản đồ & chuyển đổi',
    Icon: IconGlobe,
    desc: 'Mở DWG, DXF, KMZ, KML, thư mục .gdb trên nền Google; đo, vẽ, chia sẻ; xuất KMZ / KML / DXF.',
  },
  {
    href: '/kiem-tra-gdb',
    label: 'Kiểm tra CSDL',
    short: 'Kiểm tra',
    long: 'Kiểm tra CSDL GIS',
    Icon: IconDatabaseCheck,
    desc: 'Đối chiếu HoSoGIS với Thông tư 16/2025/TT-BXD, xem trên bản đồ, chuẩn hóa theo mẫu, báo cáo PDF.',
  },
  {
    href: '/bo-tach-dwg',
    label: 'Bóc tách DWG',
    short: 'Bóc tách',
    long: 'Bóc tách DWG → TT16',
    Icon: IconLayers,
    desc: 'Thả thư mục bản vẽ quy hoạch, ghép layer, biên tập rồi xuất HoSoGIS + tệp .qgz + bản vẽ tổng hợp .dxf.',
  },
] as const;

function Guide({ onClose }: { onClose: () => void }) {
  return (
    <div className="ui-floating ui-pop-in absolute right-0 top-[calc(100%+8px)] z-50 w-[min(22rem,calc(100vw-1.5rem))] p-4 text-left">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[13px] font-semibold text-zinc-900">LEDAT-GIS làm được gì?</p>
        <button className="ui-btn-ghost !p-1" onClick={onClose} aria-label="Đóng">
          <IconX width={14} height={14} />
        </button>
      </div>
      <ul className="mt-2 space-y-2.5">
        {TOOLS.map(({ href, long, Icon, desc }) => (
          <li key={href}>
            <Link href={href} onClick={onClose} className="group flex gap-2.5 rounded-lg p-1.5 -m-1.5 hover:bg-zinc-50">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white group-hover:bg-blue-600">
                <Icon width={15} height={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-zinc-900">{long}</span>
                <span className="block text-[11.5px] leading-snug text-zinc-500">{desc}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-zinc-100 pt-3 text-[11.5px] leading-relaxed text-zinc-500">
        Kéo thả file hoặc thư mục vào trang để bắt đầu. Mọi file được xử lý ngay trên trình duyệt của bạn — không tải lên máy chủ.
      </p>
    </div>
  );
}

export default function SiteHeader({ onHome, children }: { onHome?: () => void; children?: ReactNode }) {
  const path = usePathname() ?? '/';
  const [guide, setGuide] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!guide) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !guideRef.current?.contains(e.target as Node)) setGuide(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [guide]);

  const active = (href: string) => (href === '/' ? path === '/' || path.startsWith('/s/') : path.startsWith(href));
  const brand = (
    <>
      <Logo className="h-7 w-7 shrink-0" />
      <span className="ui-wordmark hidden text-[17px] leading-none md:inline">
        LEDAT-<span className="ui-shimmer">GIS</span>
      </span>
    </>
  );

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200/80 bg-white/85 px-3 backdrop-blur-md sm:gap-4 sm:px-5">
      {onHome ? (
        <button className="flex items-center gap-2.5 rounded-lg" onClick={onHome} aria-label="Về trang đầu">
          {brand}
        </button>
      ) : (
        <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Về trang chủ">
          {brand}
        </Link>
      )}
      <nav className="ui-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:justify-center" aria-label="Công cụ">
        {TOOLS.map(({ href, label, short, long, Icon }) => {
          const on = active(href);
          const cls = `flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] sm:px-3 sm:text-[13px] font-medium transition ${
            on ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
          }`;
          const inner = (
            <>
              <Icon width={15} height={15} />
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline lg:hidden">{label}</span>
              <span className="hidden lg:inline">{long}</span>
            </>
          );
          return on && href === '/' && onHome ? (
            <button key={href} className={cls} onClick={onHome} aria-current="page">
              {inner}
            </button>
          ) : (
            <Link key={href} href={href} className={cls} aria-current={on ? 'page' : undefined}>
              {inner}
            </Link>
          );
        })}
      </nav>
      {children}
      <div ref={guideRef} className="relative shrink-0">
        <button
          className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-semibold ring-1 ring-inset transition ${
            guide ? 'bg-zinc-900 text-white ring-zinc-900' : 'text-zinc-600 ring-zinc-200 hover:bg-zinc-50'
          }`}
          onClick={() => setGuide((v) => !v)}
          aria-expanded={guide}
          aria-label="Hướng dẫn"
          title="Hướng dẫn"
        >
          ?
        </button>
        {guide && <Guide onClose={() => setGuide(false)} />}
      </div>
    </header>
  );
}
