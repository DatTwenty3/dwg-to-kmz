// Short share link: /s/<id> → the stored map, opened in the app; metadata gives chat apps the map's title.
import type { Metadata } from 'next';
import { cache } from 'react';
import App from '@/components/App';
import { cleanShareTitle } from '@/lib/cad/share';
import { loadShortLink as load } from '@/lib/server/shortLinks';
import { sharedMapMetadata } from '../../share-metadata';

type Props = { params: Promise<{ id: string }> };

// One Redis read per request, shared by generateMetadata and the page.
const loadShortLink = cache(load);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const rec = await loadShortLink((await params).id);
  const title = cleanShareTitle(rec?.t);
  return rec ? sharedMapMetadata(title ?? 'Bản đồ được chia sẻ') : { title: 'Không tìm thấy bản đồ · LEDAT-GIS' };
}

export default async function SharedMapPage({ params }: Props) {
  const rec = await loadShortLink((await params).id);
  return <App sharedPayload={rec?.p ?? null} />;
}
