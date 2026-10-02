'use client';
// Phone-sized viewport (below Tailwind's `sm`, 640 px): the control panel becomes a bottom sheet there.
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 639.98px)';

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
