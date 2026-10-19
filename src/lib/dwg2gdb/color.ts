// Colours of CAD objects against the colour table of Phụ lục I (tt16Symbols.ts). Pure: no DOM.
// CadEntity.color is '#rrggbb' with ByLayer/ByBlock already resolved, so the AutoCAD index is lost: a hex maps back to
// a *set* of indexes (1 and 10 are both #ff0000, 7 and 255 both #ffffff).
import { ACI_RGB, rgbToHex } from '@/lib/cad/normalize/aci';
import type { GeomKind } from './suggest';
import type { Tt16Symbol } from './tt16Symbols';

/**
 * Distance (CIE76 ΔE in Lab) up to which a colour counts as "the same colour, drawn by eye": a symbol colour is
 * adopted when it is within NEAR_MAX and the next different symbol colour is at least GAP_MIN further. Neighbouring
 * indexes of AutoCAD are different land uses (22 hỗn hợp / 24 THPT are ΔE ~ 26 apart), so the margins are narrow on
 * purpose. First values — tuned on a real folder in colorReport.test.ts.
 */
export const NEAR_MAX = 6;
export const GAP_MIN = 4;
/** A colour within this distance of a symbol colour (but not decisive) is offered as an alternative. */
export const AMBIGUOUS_MAX = 12;

const HEX = /^#[0-9a-f]{6}$/;

const byHex = new Map<string, number[]>();
for (let i = 1; i < 256; i++) {
  const h = rgbToHex(ACI_RGB[i]);
  const list = byHex.get(h);
  if (list) list.push(i);
  else byHex.set(h, [i]);
}

/** Every AutoCAD index 1..255 with exactly this colour. */
export const hexToAcis = (hex: string): number[] => byHex.get(hex.toLowerCase()) ?? [];

export const aciHex = (aci: number): string => rgbToHex(ACI_RGB[aci] ?? 0);

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Grey / white / black (no hue): the colours of frames, text and "layer 0" — not a land use. */
export function isNeutral(hex: string): boolean {
  if (!HEX.test(hex)) return true;
  const [r, g, b] = rgbOf(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12;
}

/** '#rrggbb' → CIE L*a*b* (D65). */
export function toLab(hex: string): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex).map(lin);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export type MatchLevel = 'exact' | 'near' | 'ambiguous' | 'none';

export interface ColorMatch {
  level: MatchLevel;
  /** The symbol the colour stands for (exact / near), or the closer of the two candidates (ambiguous). */
  best?: Tt16Symbol;
  /** The other candidate of an ambiguous colour. */
  alt?: Tt16Symbol;
  /** Distance to `best` (0 when exact). */
  dE?: number;
}

/** One entry per distinct colour of a symbol set: the symbols drawn in it (a colour shared by several land uses). */
interface Swatch {
  hex: string;
  symbols: Tt16Symbol[];
}

const swatchCache = new WeakMap<readonly Tt16Symbol[], Map<GeomKind, Swatch[]>>();

function swatchesOf(symbols: readonly Tt16Symbol[], kind: GeomKind): Swatch[] {
  let perKind = swatchCache.get(symbols);
  if (!perKind) swatchCache.set(symbols, (perKind = new Map()));
  let list = perKind.get(kind);
  if (!list) {
    const m = new Map<string, Tt16Symbol[]>();
    for (const s of symbols) {
      if (s.kind !== kind) continue;
      const h = aciHex(s.aci);
      const l = m.get(h);
      if (l) l.push(s);
      else m.set(h, [s]);
    }
    list = [...m].map(([hex, ss]) => ({ hex, symbols: ss }));
    perKind.set(kind, list);
  }
  return list;
}

/** Same land use under several layer names (Songsuoi / Matnuocbien): not a conflict. */
const distinctUses = (ss: Tt16Symbol[]) => [...new Set(ss.map((s) => s.landUse ?? s.name))];

/**
 * Which symbol of `symbols` (one Mục of Phụ lục I) a colour stands for, among those of geometry `kind`.
 *  - exact: the very colour of a symbol (several symbols of one land use count as one);
 *  - near: within NEAR_MAX of one colour and at least GAP_MIN closer to it than to any other colour;
 *  - ambiguous: the colour is shared by two land uses, or sits between two symbol colours;
 *  - none: far from every symbol colour.
 */
export function matchColor(hex: string, symbols: readonly Tt16Symbol[], kind: GeomKind): ColorMatch {
  const h = hex.toLowerCase();
  const sw = swatchesOf(symbols, kind);
  if (!sw.length) return { level: 'none' };
  const exact = sw.find((s) => s.hex === h);
  if (exact) {
    const uses = distinctUses(exact.symbols);
    if (uses.length === 1) return { level: 'exact', best: exact.symbols[0], dE: 0 };
    const other = exact.symbols.find((s) => (s.landUse ?? s.name) !== (exact.symbols[0].landUse ?? exact.symbols[0].name))!;
    return { level: 'ambiguous', best: exact.symbols[0], alt: other, dE: 0 };
  }
  const ranked = sw.map((s) => ({ s, dE: deltaE(h, s.hex) })).sort((a, b) => a.dE - b.dE);
  const [first, second] = ranked;
  if (first.dE <= NEAR_MAX && (!second || second.dE - first.dE >= GAP_MIN)) return { level: 'near', best: first.s.symbols[0], dE: first.dE };
  if (first.dE <= AMBIGUOUS_MAX) {
    // Close to a colour but not decisive: offer the runner-up when it is close too.
    const alt = second && second.dE <= AMBIGUOUS_MAX ? second.s.symbols[0] : undefined;
    return { level: 'ambiguous', best: first.s.symbols[0], alt, dE: first.dE };
  }
  return { level: 'none', dE: first.dE };
}
