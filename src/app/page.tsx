import type { Metadata } from 'next';
import App from '@/components/App';
import { cleanShareTitle, SHARE_TITLE_PARAM } from '@/lib/cad/share';
import { sharedMapMetadata } from './share-metadata';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Long shared links carry the map title in `?t=` (the map itself is in the fragment, which never reaches the
 * server), so chat apps show the map's name and a matching preview image instead of the generic site card.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const title = cleanShareTitle((await searchParams)[SHARE_TITLE_PARAM]);
  return title ? sharedMapMetadata(title) : {};
}

export default function Home() {
  return <App />;
}
