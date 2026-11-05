import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import UnlockForm from '@/components/UnlockForm';
import { gateEnabled, safeNext } from '@/lib/server/accessGate';

export const metadata: Metadata = {
  title: 'Mở khóa · LEDAT-GIS',
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (!gateEnabled()) redirect(next);
  return <UnlockForm next={next} />;
}
