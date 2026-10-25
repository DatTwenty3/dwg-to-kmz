import type { LineTypeElement } from './types';

/**
 * A line type can write a dot as a letter: the planning boundary of the Vietnamese drawings uses "l" of a symbol font
 * (Wingdings: a black circle). Arial has no such letter, so a cleaned drawing writes the circle "●" instead (U+25CF) —
 * both are drawn here as a real circle. Sizes are fractions of the text height, measured from the text origin.
 */
export interface DotGlyph {
  /** Diameter of the circle. */
  d: number;
  /** Centre of the circle, along the text and above its baseline. */
  cx: number;
  cy: number;
}

/** "l" in Wingdings. */
export const WINGDINGS_DOT: DotGlyph = { d: 0.7, cx: 0.4, cy: 0.45 };
/** "●" (U+25CF) in Arial: a circle of 881 units in a 2048 em, its centre at (618, 578). */
export const ARIAL_DOT: DotGlyph = { d: 881 / 2048, cx: 618 / 2048, cy: 578 / 2048 };

/** The dot a line type text stands for, or null when it is an ordinary text. */
export function dotGlyph(text: string): DotGlyph | null {
  return text === 'l' ? WINGDINGS_DOT : text === '●' ? ARIAL_DOT : null;
}

/**
 * The element as Arial can draw it: the Wingdings "l" becomes "●", enlarged and moved so that the circle keeps its size
 * and its place on the line. Any other element is returned as it is.
 */
export function arialDotElement(el: LineTypeElement): LineTypeElement {
  if (el.text !== 'l') return el;
  const h = el.textScale ?? 1;
  const h2 = (h * WINGDINGS_DOT.d) / ARIAL_DOT.d;
  const off = el.offset ?? [0, 0];
  const plain = !el.absolute && !(el.rotation ?? 0);
  return {
    ...el,
    text: '●',
    textScale: h2,
    ...(plain ? { offset: [off[0] + WINGDINGS_DOT.cx * h - ARIAL_DOT.cx * h2, off[1] + WINGDINGS_DOT.cy * h - ARIAL_DOT.cy * h2] as [number, number] } : {}),
  };
}
