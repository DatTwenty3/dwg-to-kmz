// Rectangles that look like the box of a label but are not the exact boundary of an MTEXT (`labelBox.ts`): suspects. They are
// only SUGGESTED — gathered in one list of the page, where the user looks at them on the map and chooses which to delete — never
// left out by themselves. The rules are guesses from the look of the drawing (a rectangle sized for a text and lying beside it, or
// over a bigger polygon, the copies / the same-size boxes / the stacked boxes / the strips of one height of such a rectangle).
// Pure: no DOM.
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { distanceToRing, pointInRing, ringArea } from './geometry';
import { mergeDrawings, rectangleOf } from './labelBox';

/** Letters of a CAD text are about this wide / this far apart in height (× text height) — an estimate, the font is not known. */
const CHAR_WIDTH = 0.6;
const LINE_HEIGHT = 1.25;
/**
 * A box sized for its text: its area is between these multiples of the text's area, and the text lies in it or touches it
 * (gap along the text ≤ 0,6 × text height, across ≤ 1,5 × text height — MTEXT wrapping moves the real text a little off).
 */
const FIT_MIN = 0.4;
const FIT_MAX = 6;
const GAP_ALONG = 0.6;
const GAP_ACROSS = 1.5;
/** A tighter size fit lets the text sit further off in the box's column. */
const COLUMN_MIN = 0.6;
const COLUMN_MAX = 4;
const COLUMN_SHIFT = 0.3;
const COLUMN_GAP = 8;
/** A box that holds a text lying mostly inside it may be roomier when it lies over a bigger polygon. */
const OVER_SHARE = 0.5;
const OVER_RATIO = 25;
/** A box lies over a polygon at least this much bigger than itself. */
const UNDER_RATIO = 1.5;
/** Stacked boxes of one callout touch or lie a few metres apart. */
const STACK_GAP = 6;
const CELL = 100;

/** Why a rectangle is a suspect (the rule that found it). */
export type SuspectWhy = 'fit' | 'over' | 'copy' | 'size' | 'strip' | 'stack';

export const SUSPECT_WHY_LABEL: Record<SuspectWhy, string> = {
  fit: 'Cỡ vừa chữ, nằm sát chữ',
  over: 'Ôm chữ, chồng lên vùng khác',
  copy: 'Bản sao của một ô nghi ngờ',
  size: 'Cùng cỡ với một ô nghi ngờ',
  strip: 'Dải cùng bề cao với một ô nghi ngờ',
  stack: 'Xếp chồng lên một ô nghi ngờ',
};

export interface Suspect {
  /** The nearest text it is sized for (or the text it holds), "" for the ones found through another suspect. */
  text: string;
  why: SuspectWhy;
  /** Sides of the rectangle (drawing units, w ≥ h). */
  w: number;
  h: number;
}

type Text = Extract<CadEntity, { kind: 'text' }>;
type Extent = { c: Vec2; w: number; h: number; a: number };

/** Estimated (or, for an MTEXT, stored) extent of a text: centre, size and angle in radians. */
function textExtent(t: Text): Extent {
  const lines = t.text.split(/\r?\n/);
  const w = t.box?.w ?? Math.max(...lines.map((l) => l.trim().length)) * t.height * CHAR_WIDTH;
  const h = t.box?.h ?? lines.length * t.height * LINE_HEIGHT;
  const ox = t.hAlign === 'left' ? w / 2 : t.hAlign === 'right' ? -w / 2 : 0;
  const oy = t.vAlign === 'top' ? -h / 2 : t.vAlign === 'middle' ? 0 : h / 2;
  const a = (t.rotation * Math.PI) / 180;
  return { c: [t.position[0] + ox * Math.cos(a) - oy * Math.sin(a), t.position[1] + ox * Math.sin(a) + oy * Math.cos(a)], w, h, a };
}

/** Share of a text's extent that lies inside a ring (a grid of sample points). */
function shareInside(x: Extent, ring: Vec2[]): number {
  const cos = Math.cos(x.a);
  const sin = Math.sin(x.a);
  const N = 9;
  const M = 5;
  let inside = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const u = ((i + 0.5) / N - 0.5) * x.w;
      const v = ((j + 0.5) / M - 0.5) * x.h;
      if (pointInRing([x.c[0] + u * cos - v * sin, x.c[1] + u * sin + v * cos], ring)) inside++;
    }
  return inside / (N * M);
}

/** Identity of a rectangle independent of the corner order, to find its copies (centre to 0,5 m, sides to 1 m). */
function boxKey(ring: Vec2[]): string {
  const side = (a: Vec2, b: Vec2) => Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));
  const [s1, s2] = [side(ring[0], ring[1]), side(ring[1], ring[2])].sort((x, y) => x - y);
  return `${Math.round(((ring[0][0] + ring[2][0]) / 2) * 2)}|${Math.round(((ring[0][1] + ring[2][1]) / 2) * 2)}|${s1}|${s2}`;
}

/** Same size (sides to 1 m) and same direction (to 1°): the template box copied to several places. */
function sizeKey(ring: Vec2[]): string {
  const w = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
  const h = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
  const turn = Math.round((((Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]) * 180) / Math.PI) % 90 + 90) % 90);
  return w >= h ? `${Math.round(w)}x${Math.round(h)}@${turn}` : `${Math.round(h)}x${Math.round(w)}@${(turn + 90) % 90}`;
}

/** A strip as tall as a few lines of text (short side ≤ 40 m, long side ≥ 2,5 × it), named by its short side and direction. */
function stripKey(ring: Vec2[]): string | null {
  const w = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
  const h = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
  const [short, long] = [Math.min(w, h), Math.max(w, h)];
  if (short > 40 || long < 2.5 * short) return null;
  const turn = Math.round((((Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]) * 180) / Math.PI) % 90 + 90) % 90);
  return `${Math.round(short)}@${w >= h ? turn : (turn + 90) % 90}`;
}

/** Angle difference of two directions in degrees, folded to [0, 90]. */
const fold90 = (a: number, b: number) => {
  const d = (((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};

/** Whether two rectangles overlap or lie within `tol` of each other (vertices, edge midpoints and centres of one against the other). */
function closeTo(a: Vec2[], b: Vec2[], tol: number): boolean {
  const probes = (r: Vec2[]): Vec2[] => [
    ...r,
    ...r.map((p, i): Vec2 => [(p[0] + r[(i + 1) % 4][0]) / 2, (p[1] + r[(i + 1) % 4][1]) / 2]),
    [(r[0][0] + r[2][0]) / 2, (r[0][1] + r[2][1]) / 2],
  ];
  const near = (p: Vec2, r: Vec2[]) => pointInRing(p, r) || distanceToRing(p, r) <= tol;
  return probes(a).some((p) => near(p, b)) || probes(b).some((p) => near(p, a));
}

/** Grid cells (`CELL`) a rectangle, grown by `pad`, touches. */
function cellsOf(ring: Vec2[], pad: number): string[] {
  const xs = ring.map((q) => q[0]);
  const ys = ring.map((q) => q[1]);
  const out: string[] = [];
  for (let gx = Math.floor((Math.min(...xs) - pad) / CELL); gx <= Math.floor((Math.max(...xs) + pad) / CELL); gx++)
    for (let gy = Math.floor((Math.min(...ys) - pad) / CELL); gy <= Math.floor((Math.max(...ys) + pad) / CELL); gy++) out.push(`${gx}|${gy}`);
  return out;
}

interface Rect {
  i: number;
  ring: Vec2[];
  area: number;
  mid: Vec2;
  w: number;
  h: number;
  /** The nearest text the box is sized for, if any. */
  fits?: string;
  /** A text lying mostly inside the box (the box may be roomier). */
  holds?: { text: string; ratio: number };
}

/**
 * Rectangles of the drawing that look like the box of a label, apart from `exact` (the exact boundaries of an MTEXT, which are
 * left out already). Index in `doc.entities` → what makes it suspect. Only objects with `inside` set are looked at.
 */
export function findSuspectBoxes(doc: Pick<CadDocument, 'entities'>, inside: ArrayLike<number>, exact: ReadonlyMap<number, unknown> = new Map()): Map<number, Suspect> {
  const texts: { t: Text; x: Extent }[] = [];
  const grid = new Map<string, number[]>();
  doc.entities.forEach((e, i) => {
    if (e.kind !== 'text' || !inside[i] || !e.text.trim() || !(e.height > 0)) return;
    const x = textExtent(e);
    texts.push({ t: e, x });
    const k = `${Math.floor(x.c[0] / CELL)}|${Math.floor(x.c[1] / CELL)}`;
    const list = grid.get(k);
    if (list) list.push(texts.length - 1);
    else grid.set(k, [texts.length - 1]);
  });
  const out = new Map<number, Suspect>();
  if (!texts.length) return out;

  const rects: Rect[] = [];
  doc.entities.forEach((e, i) => {
    if (!inside[i] || exact.has(i)) return;
    const raw = e.kind === 'polygon' ? e.rings[0] : e.kind === 'polyline' && e.points.length <= 5 && (e.closed || (e.points.length === 5 && e.points[0][0] === e.points[4][0] && e.points[0][1] === e.points[4][1])) ? e.points : undefined;
    const ring = rectangleOf(raw);
    if (!ring) return;
    const xs = ring.map((q) => q[0]);
    const ys = ring.map((q) => q[1]);
    const area = ringArea(ring);
    const mid: Vec2 = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2];
    const W = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
    const H = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
    const ang = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
    const cos = Math.cos(-ang);
    const sin = Math.sin(-ang);
    const r: Rect = { i, ring, area, mid, w: Math.max(W, H), h: Math.min(W, H) };
    let bestGap = Infinity;
    const seen = new Set<number>();
    for (let gx = Math.floor((Math.min(...xs) - 60) / CELL); gx <= Math.floor((Math.max(...xs) + 60) / CELL); gx++)
      for (let gy = Math.floor((Math.min(...ys) - 60) / CELL); gy <= Math.floor((Math.max(...ys) + 60) / CELL); gy++)
        for (const ti of grid.get(`${gx}|${gy}`) ?? []) {
          if (seen.has(ti)) continue;
          seen.add(ti);
          const { t, x } = texts[ti];
          const text = t.text.replace(/\s+/g, ' ').trim();
          const ratio = area / (x.w * x.h);
          if (shareInside(x, ring) >= OVER_SHARE && ratio <= OVER_RATIO && (!r.holds || ratio < r.holds.ratio)) r.holds = { text, ratio };
          // Sized for this text, and the text lies in the box or just beside it.
          if (ratio < FIT_MIN || ratio > FIT_MAX) continue;
          const turn = fold90((ang * 180) / Math.PI, t.rotation);
          const quarter = turn <= 8 ? 0 : Math.abs(turn - 90) <= 8 ? 1 : -1;
          if (quarter < 0) continue;
          const dx = (x.c[0] - mid[0]) * cos - (x.c[1] - mid[1]) * sin;
          const dy = (x.c[0] - mid[0]) * sin + (x.c[1] - mid[1]) * cos;
          const [tw, th] = quarter ? [x.h, x.w] : [x.w, x.h];
          const gapX = Math.max(0, Math.abs(dx) - (W + tw) / 2);
          const gapY = Math.max(0, Math.abs(dy) - (H + th) / 2);
          // Beside the box, or in its column (the text starts / is centred over the box) a few lines above or below it.
          const column = ratio >= COLUMN_MIN && ratio <= COLUMN_MAX && Math.abs(dx) <= COLUMN_SHIFT * W && gapY <= COLUMN_GAP * t.height;
          if (((gapX <= GAP_ALONG * t.height && gapY <= GAP_ACROSS * t.height) || column) && gapX + gapY < bestGap) {
            bestGap = gapX + gapY;
            r.fits = text;
          }
        }
    rects.push(r);
  });
  if (!rects.length) return out;

  // Bigger polygons that are not boxes themselves (what a box may lie over).
  const boxish = new Set(rects.filter((r) => r.fits !== undefined || r.holds).map((r) => r.i));
  const polys: { ring: Vec2[]; box: [number, number, number, number]; area: number }[] = [];
  doc.entities.forEach((e, i) => {
    if (e.kind !== 'polygon' || !inside[i] || boxish.has(i) || exact.has(i) || !e.rings[0] || e.rings[0].length < 3) return;
    const xs = e.rings[0].map((q) => q[0]);
    const ys = e.rings[0].map((q) => q[1]);
    polys.push({ ring: e.rings[0], box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], area: ringArea(e.rings[0]) });
  });
  const over = (r: Rect) => polys.some((p) => p.area >= UNDER_RATIO * r.area && r.mid[0] >= p.box[0] && r.mid[0] <= p.box[2] && r.mid[1] >= p.box[1] && r.mid[1] <= p.box[3] && pointInRing(r.mid, p.ring));

  const byKey = new Map<string, string>();
  for (const r of rects) {
    let text: string | undefined;
    let why: SuspectWhy = 'fit';
    if (r.fits !== undefined) text = r.fits;
    else if (r.holds && over(r)) {
      text = r.holds.text;
      why = 'over';
    }
    if (text === undefined) continue;
    out.set(r.i, { text, why, w: r.w, h: r.h });
    byKey.set(boxKey(r.ring), text);
  }
  // Copies of a box (the same rectangle drawn again, on another layer or in another colour) are suspects too.
  for (const r of rects) {
    const same = byKey.get(boxKey(r.ring));
    if (same !== undefined && !out.has(r.i)) out.set(r.i, { text: same, why: 'copy', w: r.w, h: r.h });
  }
  // The template box copied to several places (same size and direction), and a callout drawn as stacked rectangles (touching a
  // suspect, not bigger than it): a few rounds, each feeding the other — only within one layer.
  const layers = new Map<string, Rect[]>();
  for (const r of rects) {
    const l = doc.entities[r.i].layer;
    const list = layers.get(l);
    if (list) list.push(r);
    else layers.set(l, [r]);
  }
  for (const group of layers.values()) {
    for (let round = 0; round < 4; round++) {
      let grew = false;
      const flagged = group.filter((r) => out.has(r.i));
      if (!flagged.length || flagged.length === group.length) break;
      const bySize = new Map<string, string>();
      const byStrip = new Map<string, string>();
      for (const r of flagged) {
        bySize.set(sizeKey(r.ring), out.get(r.i)!.text);
        const s = stripKey(r.ring);
        if (s) byStrip.set(s, out.get(r.i)!.text);
      }
      // The flagged rectangles by grid cell: a stack candidate looks only at those round it (a drawing may hold 40 000 rectangles).
      const near = new Map<string, Rect[]>();
      for (const f of flagged) for (const k of cellsOf(f.ring, STACK_GAP)) (near.get(k) ?? near.set(k, []).get(k)!).push(f);
      for (const r of group) {
        if (out.has(r.i)) continue;
        const same = bySize.get(sizeKey(r.ring));
        const strip = same === undefined ? byStrip.get(stripKey(r.ring) ?? '') : undefined;
        const q = same === undefined && strip === undefined ? cellsOf(r.ring, 0).flatMap((k) => near.get(k) ?? []).find((f) => r.area <= 1.5 * f.area && closeTo(r.ring, f.ring, STACK_GAP)) : undefined;
        const found = same ?? strip ?? (q ? out.get(q.i)!.text : undefined);
        if (found === undefined) continue;
        out.set(r.i, { text: found, why: same !== undefined ? 'size' : strip !== undefined ? 'strip' : 'stack', w: r.w, h: r.h });
        grew = true;
      }
      if (!grew) break;
    }
  }
  return out;
}

/** `findSuspectBoxes` over drawings that share one coordinate system (a map and its xrefs); one result per drawing, in order. */
export function findSuspectBoxesAcross(
  items: { doc: Pick<CadDocument, 'entities'>; inside: ArrayLike<number> }[],
  exact: readonly Map<number, unknown>[],
): Map<number, Suspect>[] {
  if (items.length === 1) return [findSuspectBoxes(items[0].doc, items[0].inside, exact[0])];
  const m = mergeDrawings(items);
  // The exact boundaries, in the merged numbering.
  const ex = new Map<number, unknown>();
  let start = 0;
  items.forEach((it, k) => {
    for (const i of exact[k]?.keys() ?? []) ex.set(start + i, true);
    start += it.doc.entities.length;
  });
  return m.split(findSuspectBoxes(m.doc, m.inside, ex));
}
