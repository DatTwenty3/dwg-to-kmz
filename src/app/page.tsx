import type { Metadata } from 'next';
import App from '@/components/App';
import { cleanShareTitle, SHARE_TITLE_PARAM } from '@/lib/cad/share';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Shared map links carry the map title in `?t=` (the map itself is in the fragment, which never reaches the
 * server), so chat apps show the map's name and a matching preview image instead of the generic site card.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const title = cleanShareTitle((await searchParams)[SHARE_TITLE_PARAM]);
  if (!title) return {};
  const description = 'Bản đồ được chia sẻ trên LEDAT-GIS — bấm để xem trên nền ảnh vệ tinh.';
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

export default function Home() {
  return <App />;
}
