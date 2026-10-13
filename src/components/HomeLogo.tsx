// The logo in a tool page's toolbar: back to the home page "/", where all the tools are (there is no top bar).
import Link from 'next/link';
import { Logo } from './icons';

export default function HomeLogo({ wordmark = true }: { wordmark?: boolean }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 rounded-lg" aria-label="Về trang chủ LEDAT-GIS" title="Trang chủ">
      <Logo className="h-7 w-7" />
      {wordmark && (
        <span className="ui-wordmark hidden text-[15px] leading-none md:inline">
          LEDAT-<span className="ui-shimmer">GIS</span>
        </span>
      )}
    </Link>
  );
}
