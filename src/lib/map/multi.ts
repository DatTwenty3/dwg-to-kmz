// Several documents stacked on one map: layer ids, draw order, per-file memoisation. Pure (no DOM).
import type { Layer } from '@deck.gl/core';
import type { CadDocument, Vec2 } from '@/lib/cad/types';
import { buildLayers, documentBounds } from './layers';

/** Separator between the file id and the deck layer name (`f1:cad-paths`). */
const SEP = ':';

export const fileLayerPrefix = (fileId: string) => `${fileId}${SEP}`;

/** File id a (possibly sub-)layer id belongs to, or null for layers without a prefix. */
export function fileIdOfLayerId(layerId: string | undefined): string | null {
  if (!layerId) return null;
  const i = layerId.indexOf(SEP);
  return i > 0 ? layerId.slice(0, i) : null;
}

/** Colour tags that tell files apart in the list (and in the popup). */
export const FILE_TAG_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#e11d48', '#0891b2', '#65a30d', '#c026d3'] as const;

/** First palette colour not used by `used` (cycles when every colour is taken). */
export function nextTagColor(used: readonly string[]): string {
  const free = FILE_TAG_COLORS.find((c) => !used.includes(c));
  return free ?? FILE_TAG_COLORS[used.length % FILE_TAG_COLORS.length];
}

/** Move the item with `id` one step up (-1) or down (+1) in the list; returns the same array when it cannot move. */
export function moveById<T extends { id: string }>(list: readonly T[], id: string, dir: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list as T[];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Union of several [[w,s],[e,n]] boxes. */
export function unionBounds(boxes: ([Vec2, Vec2] | null | undefined)[]): [Vec2, Vec2] | null {
  let out: [Vec2, Vec2] | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out
      ? [
          [Math.min(out[0][0], b[0][0]), Math.min(out[0][1], b[0][1])],
          [Math.max(out[1][0], b[1][0]), Math.max(out[1][1], b[1][1])],
        ]
      : [b[0], b[1]];
  }
  return out;
}

export interface FileRender {
  id: string;
  doc: CadDocument | null;
  visibleLayers: Set<string>;
  opacity: number;
  shown: boolean;
  highlightHandle?: string;
}

export interface SharedRenderOptions {
  fontFamily?: string;
  showText?: boolean;
}

/**
 * Per-file layer memo: a file whose inputs did not change gets back the very same Layer[] (same
 * instances), so touching one file's opacity / style / visibility never rebuilds the others.
 */
export function createFileLayerCache() {
  const cache = new Map<string, { sig: unknown[]; layers: Layer[] }>();
  return {
    get(f: FileRender, shared: SharedRenderOptions): Layer[] {
      if (!f.doc || !f.shown) return [];
      const sig = [f.doc, f.visibleLayers, f.opacity, f.highlightHandle, shared.fontFamily, shared.showText];
      const hit = cache.get(f.id);
      if (hit && hit.sig.length === sig.length && hit.sig.every((v, i) => v === sig[i])) return hit.layers;
      const layers = buildLayers(f.doc, {
        visibleLayers: f.visibleLayers,
        highlightHandle: f.highlightHandle,
        fontFamily: shared.fontFamily,
        showText: shared.showText,
        idPrefix: fileLayerPrefix(f.id),
        opacity: f.opacity,
      });
      cache.set(f.id, { sig, layers });
      return layers;
    },
    drop(id: string) {
      cache.delete(id);
    },
    clear() {
      cache.clear();
    },
  };
}

/**
 * Flatten per-file layers for deck.gl. The file list is top-first (top of the list is drawn on top);
 * deck draws later layers over earlier ones, so the list is walked bottom-up.
 */
export function orderFileLayers(files: readonly FileRender[], get: (f: FileRender) => Layer[]): Layer[] {
  const out: Layer[] = [];
  for (let i = files.length - 1; i >= 0; i--) out.push(...get(files[i]));
  return out;
}

/** Bounds of every shown file with a usable WGS84 document. */
export function shownBounds(files: readonly { doc: CadDocument | null; shown: boolean }[]): [Vec2, Vec2] | null {
  return unionBounds(files.filter((f) => f.shown && f.doc).map((f) => documentBounds(f.doc!)));
}
