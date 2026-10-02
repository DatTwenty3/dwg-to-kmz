'use client';
// `accept` for the file pickers. iOS / iPadOS (and some Android pickers) only enable file types the system
// knows: .kmz is registered (Google Earth) but .dwg / .dxf / .ldg are not, so they show greyed out and cannot
// be picked. On touch devices the picker therefore accepts any file; the extension is checked after picking
// (ACCEPTED_EXT in handleFile). Desktop browsers keep the filter.
import { useSyncExternalStore } from 'react';

export const FILE_ACCEPT = '.dwg,.dxf,.kmz,.kml,.ldg';

const isTouchDevice = () =>
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac.
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const noop = () => () => {};

export function useFileAccept(): string | undefined {
  return useSyncExternalStore(
    noop,
    () => (isTouchDevice() ? undefined : FILE_ACCEPT),
    () => FILE_ACCEPT,
  );
}
