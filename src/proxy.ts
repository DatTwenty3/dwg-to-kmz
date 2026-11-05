// Password gate for the Kiểm tra CSDL / Bóc tách DWG tools (see lib/server/accessGate.ts). A device that has
// already entered the password carries a signed cookie and passes; any other is sent to /khoa. The heavy files these
// tools load (GDAL, sql.js, the Phụ lục I symbols) are behind the same gate. Off when ACCESS_PASSWORD is not set.
import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, gateEnabled, tokenOk } from '@/lib/server/accessGate';

const ASSET = /^\/(gdal|sqljs|tt16-svg)\//;

export async function proxy(request: NextRequest) {
  if (!gateEnabled()) return NextResponse.next();
  if (await tokenOk(request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (ASSET.test(pathname)) return new NextResponse('Cần nhập mật khẩu để dùng công cụ này.', { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const url = request.nextUrl.clone();
  url.pathname = '/khoa';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/kiem-tra/:path*', '/boc-tach/:path*', '/gdal/:path*', '/sqljs/:path*', '/tt16-svg/:path*'],
};
