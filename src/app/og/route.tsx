// Link-preview image (Open Graph, 1200×630): brand lockup + the shared map's title from `?t=`, or the site
// tagline without it. Fonts are bundled (assets/fonts, SIL OFL). Be Vietnam Pro must be one full font file:
// with per-script subsets Satori renders whole words that contain a Vietnamese-only glyph in a fallback font.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND_NAVY, LOGO_PATH, LOGO_VIEWBOX } from '@/components/brand';
import { cleanShareTitle, SHARE_TITLE_PARAM } from '@/lib/cad/share';

const font = (file: string) => readFile(join(process.cwd(), 'assets/fonts', file));

export async function GET(req: Request) {
  const title = cleanShareTitle(new URL(req.url).searchParams.get(SHARE_TITLE_PARAM));
  const [vi, brand500, brand700] = await Promise.all([
    font('BeVietnamPro-SemiBold.ttf'),
    font('montserrat-latin-500-normal.woff'),
    font('montserrat-latin-700-normal.woff'),
  ]);

  const heading = title ?? 'Đưa bản vẽ DWG, DXF, KMZ, KML lên bản đồ';
  const kicker = title ? 'Bản đồ được chia sẻ' : 'Bản đồ trực tuyến · xử lý ngay trên trình duyệt';
  const size = heading.length > 48 ? 56 : heading.length > 28 ? 66 : 78;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: '#ffffff',
          color: BRAND_NAVY,
          fontFamily: 'Be Vietnam Pro',
          position: 'relative',
        }}
      >
        {/* Faint contour lines, as on the landing page. */}
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: 'absolute', left: 0, top: 0 }}>
          <path d="M-20 470 C 200 400, 380 560, 620 470 S 980 360, 1220 440" fill="none" stroke="#dbeafe" strokeWidth="3" />
          <path d="M-20 530 C 220 470, 400 620, 640 530 S 1000 430, 1220 500" fill="none" stroke="#e0e7ff" strokeWidth="3" />
          <path d="M-20 590 C 240 540, 420 680, 660 590 S 1020 500, 1220 560" fill="none" stroke="#eef2ff" strokeWidth="3" />
        </svg>

        {/* Brand lockup: mark + LEDAT-GIS / GEOSPATIAL SOLUTIONS (tagline spread to the wordmark's width). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <svg width="92" height="92" viewBox={LOGO_VIEWBOX}>
            <path d={LOGO_PATH} fill={BRAND_NAVY} fillRule="evenodd" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: 50, lineHeight: 1 }}>LEDAT-GIS</div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 10,
                fontFamily: 'Montserrat',
                fontWeight: 500,
                fontSize: 16,
              }}
            >
              {[...'GEOSPATIAL SOLUTIONS'].map((c, i) => (
                <span key={i}>{c === ' ' ? ' ' : c}</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1000 }}>
          <div style={{ fontSize: 26, color: '#2563eb' }}>{kicker}</div>
          <div style={{ fontSize: size, lineHeight: 1.15, letterSpacing: -1 }}>{heading}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 24, color: '#52525b' }}>
          <div style={{ width: 36, height: 6, borderRadius: 3, background: 'linear-gradient(90deg, #0e1f3b, #2563eb)' }} />
          Mở để xem trên nền ảnh vệ tinh
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Be Vietnam Pro', data: vi, weight: 600, style: 'normal' },
        { name: 'Montserrat', data: brand500, weight: 500, style: 'normal' },
        { name: 'Montserrat', data: brand700, weight: 700, style: 'normal' },
      ],
      // The title is part of the URL, so a given URL always renders the same image.
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    },
  );
}
