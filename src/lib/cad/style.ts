// Applies user layer styles to a document. Pure; shared by the map and the exporters.
import type { CadDocument, CadEntity, LayerStyle } from './types';

export type LayerStyles = Record<string, LayerStyle>;

/** True when the style changes nothing. */
export function isEmptyStyle(s: LayerStyle | undefined): boolean {
  return !s || (s.color === undefined && s.width === undefined && s.dash === undefined && s.fillOpacity === undefined);
}

/**
 * Returns a document where each styled layer carries `style`, its colour (and every entity's colour)
 * is replaced by `style.color`, and its polygons use `style.fillOpacity`. Unstyled layers and their
 * entities are returned by reference, so an empty `styles` costs almost nothing.
 */
export function applyLayerStyles(doc: CadDocument, styles: LayerStyles): CadDocument {
  const active = Object.entries(styles).filter(([, s]) => !isEmptyStyle(s));
  if (active.length === 0) return doc;
  const byLayer = new Map(active);

  const layers = doc.layers.map((l) => {
    const s = byLayer.get(l.name);
    return s ? { ...l, color: s.color ?? l.color, style: { ...s } } : l;
  });

  const entities = doc.entities.map((e): CadEntity => {
    const s = byLayer.get(e.layer);
    if (!s) return e;
    if (e.kind === 'polygon') {
      return { ...e, color: s.color ?? e.color, fillOpacity: s.fillOpacity ?? e.fillOpacity };
    }
    return s.color ? { ...e, color: s.color } : e;
  });

  return { ...doc, layers, entities };
}
