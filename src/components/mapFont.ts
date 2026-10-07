'use client';
import { DEFAULT_FONT_FAMILY } from '@/lib/map';
import { VIETNAMESE_CHARSET } from '@/lib/text';

/** Resolve the real (hashed) family name next/font gives Roboto and wait until its glyphs are loaded. */
export async function loadTextFont(): Promise<string> {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-roboto').trim();
  const family = v || 'Roboto';
  try {
    // Requesting the Vietnamese characters forces the unicode-range subsets to download.
    await document.fonts.load(`500 64px ${family}`, VIETNAMESE_CHARSET.join(''));
    await document.fonts.ready;
  } catch {
    /* fall back to whatever is available */
  }
  return v ? `${v}, Arial, sans-serif` : DEFAULT_FONT_FAMILY;
}
