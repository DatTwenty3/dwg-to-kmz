// Link-preview metadata for a shared map (title + /og image), used by `/?t=…` and `/s/<id>`.
import type { Metadata } from 'next';
import { SHARE_TITLE_PARAM } from '@/lib/cad/share';

export function sharedMapMetadata(title: string): Metadata {
  const description = 'Bản đồ được chia sẻ trên LEDAT-GIS — bấm để xem trên nền ảnh vệ tinh.';
  // Must match the URL ShareDialog pre-warms (same URLSearchParams encoding).
  const image = `/og?${new URLSearchParams({ [SHARE_TITLE_PARAM]: title })}`;
  return {
    title: `${title} · LEDAT-GIS`,
    description,
    openGraph: {
      type: 'website',
      siteName: 'LEDAT-GIS',
      locale: 'vi_VN',
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
