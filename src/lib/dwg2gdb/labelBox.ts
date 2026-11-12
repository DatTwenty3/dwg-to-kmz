// A rectangle drawn round a label ("khoanh nhãn tên"): the drafter boxes the name of a facility ("TRƯỜNG TH ĐÔN XUÂN A", "CHỢ XÃ")
// with a hatched or outlined rectangle on a land-use layer, often over the real parcels. Read as hatch / closed outline it becomes a
// parcel (Đôn Châu: ~70 boxes on QHDD_DAT_XD_Dato became "Đất ở"). Pure: no DOM.
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { distanceToRing, pointInRing, ringArea } from './geometry';

/** Letters of a CAD text are about this wide / this far apart in height (× text height) — an estimate, the font is not known. */
const CHAR_WIDTH = 0.6;
const LINE_HEIGHT = 1.25;
/**
 * A box sized for its text: its area is between these multiples of the text's estimated area, and the text lies in it or touches it
 * (gap along the text ≤ 0,6 × text height, across ≤ 1,5 × text height — MTEXT wrapping moves the real text a little off the estimate).
 */
const FIT_MIN = 0.4;
const FIT_MAX = 6;
const GAP_ALONG = 0.6;
const GAP_ACROSS = 1.5;
/** A tighter size fit lets the text sit further off in the box's column (MTEXT wrapped differently from the estimate). */
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

type Text = Extract<CadEntity, { kind: 'text' }>;
type Extent = { c: Vec2; w: number; h: number; a: number };

/** Four corners of a rectangle (right angles within ~2°), else null. A closing vertex equal to the first is dropped. */
export function rectangleOf(ring: Vec2[] | undefined): Vec2[] | null {
  if (!ring) return null;
  let p = ring;
  if (p.length === 5 && p[0][0] === p[4][0] && p[0][1] === p[4][1]) p = p.slice(0, 4);
  if (p.length !== 4) return null;
  const e = p.map((q, i) => {
    const n = p[(i + 1) % 4];
    return [n[0] - q[0], n[1] - q[1]] as Vec2;
  });
  const len = e.map((v) => Math.hypot(v[0], v[1]));
  if (len.some((l) => l < 1e-6)) return null;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (Math.abs((e[i][0] * e[j][0] + e[i][1] * e[j][1]) / (len[i] * len[j])) > 0.035) return null;
  }
  return p;
}

/** Estimated extent of a text (the anchor depends on the alignment): centre, size and angle in radians. */
function textExtent(t: Text): Extent {
  const lines = t.text.split(/\r?\n/);
  // An MTEXT carries the real size of its block (DWG extentsWidth/extentsHeight, DXF groups 42/43): use it, estimate otherwise.
  const w = t.box?.w ?? Math.max(...lines.map((l) => l.trim().length)) * t.height * CHAR_WIDTH;
  const h = t.box?.h ?? lines.length * t.height * LINE_HEIGHT;
  const ox = t.hAlign === 'left' ? w / 2 : t.hAlign === 'right' ? -w / 2 : 0;
  const oy = t.vAlign === 'top' ? -h / 2 : t.vAlign === 'middle' ? 0 : h / 2;
  const a = (t.rotation * Math.PI) / 180;
  return { c: [t.position[0] + ox * Math.cos(a) - oy * Math.sin(a), t.position[1] + ox * Math.sin(a) + oy * Math.cos(a)], w, h, a };
}

/** Share of a text's estimated extent that lies inside a ring (a grid of sample points). */
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

/** Bounding box of a ring grown by `pad`. */
function extentOf(ring: Vec2[], pad: number): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** Same size (sides to 1 m) and same direction (to 1°): the template box copied to several places. */
function sizeKey(ring: Vec2[]): string {
  const w = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
  const h = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
  const turn = Math.round((((Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]) * 180) / Math.PI) % 90 + 90) % 90);
  return w >= h ? `${Math.round(w)}x${Math.round(h)}@${turn}` : `${Math.round(h)}x${Math.round(w)}@${(turn + 90) % 90}`;
}

/**
 * A strip as tall as a few lines of text (short side ≤ 40 m, long side ≥ 2,5 × it) is named by its short side and direction:
 * the boxes of one drawing are drawn with the same height whatever the length of the name they hold.
 */
function stripKey(ring: Vec2[]): string | null {
  const w = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
  const h = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
  const [short, long] = [Math.min(w, h), Math.max(w, h)];
  if (short > 40 || long < 2.5 * short) return null;
  const turn = Math.round((((Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]) * 180) / Math.PI) % 90 + 90) % 90);
  return `${Math.round(short)}@${w >= h ? turn : (turn + 90) % 90}`;
}

interface Rect {
  i: number;
  ring: Vec2[];
  area: number;
  mid: Vec2;
  /** The nearest text the box is sized for, if any. */
  fits?: string;
  /** A text lying mostly inside the box (the box may be roomier). */
  holds?: { text: string; ratio: number };
}

/**
 * Objects of the drawing that are a box round a label: a rectangle (hatch, or closed outline of 4 corners) sized for a text that
 * lies in it or touches it (`FIT_*`, `GAP_*`), or that holds a text lying mostly inside while it lies over a polygon at least
 * 1,5 × its size (land-use polygons do not overlap, so a parcel does not sit on another parcel); then the copies of such a box
 * (same corners) and the rectangles overlapping a box (a callout drawn as stacked boxes). A small real parcel with a name too
 * long for it does not qualify: its text sticks out. Index in `doc.entities` → the text it frames. Only objects with `inside`
 * set are looked at.
 */
export function findLabelBoxes(doc: Pick<CadDocument, 'entities'>, inside: ArrayLike<number>): Map<number, string> {
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
  if (!texts.length) return new Map();

  const rects: Rect[] = [];
  doc.entities.forEach((e, i) => {
    if (!inside[i]) return;
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
    const r: Rect = { i, ring, area, mid };
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
  if (!rects.length) return new Map();

  // Bigger polygons that are not boxes themselves (what a box may lie over).
  const boxish = new Set(rects.filter((r) => r.fits !== undefined || r.holds).map((r) => r.i));
  const polys: { ring: Vec2[]; box: [number, number, number, number]; area: number }[] = [];
  doc.entities.forEach((e, i) => {
    if (e.kind !== 'polygon' || !inside[i] || boxish.has(i) || !e.rings[0] || e.rings[0].length < 3) return;
    const xs = e.rings[0].map((q) => q[0]);
    const ys = e.rings[0].map((q) => q[1]);
    polys.push({ ring: e.rings[0], box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], area: ringArea(e.rings[0]) });
  });
  const over = (r: Rect) => polys.some((p) => p.area >= UNDER_RATIO * r.area && r.mid[0] >= p.box[0] && r.mid[0] <= p.box[2] && r.mid[1] >= p.box[1] && r.mid[1] <= p.box[3] && pointInRing(r.mid, p.ring));

  const out = new Map<number, string>();
  const byKey = new Map<string, string>();
  for (const r of rects) {
    const text = r.fits ?? (r.holds && over(r) ? r.holds.text : undefined);
    if (text === undefined) continue;
    out.set(r.i, text);
    byKey.set(boxKey(r.ring), text);
  }
  // Copies of a box (the same rectangle drawn again, on another layer or in another colour) are boxes too.
  for (const r of rects) {
    const same = byKey.get(boxKey(r.ring));
    if (same !== undefined && !out.has(r.i)) out.set(r.i, same);
  }
  // The template box copied to several places (a rectangle of the same size and direction as a box is a box), and a callout drawn
  // as stacked rectangles (those touching a box — and not bigger than it — are boxes too): a few rounds, each feeding the other.
  // Only within one layer: the boxes of a land-use layer are not the parcels of the cadastral base.
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
      // Flagged boxes by the grid cells their (nearby) extent covers: a neighbour test looks only at the cells around a rectangle,
      // not at every flagged box of the layer (a survey base holds tens of thousands of rectangles).
      const near = new Map<string, Rect[]>();
      const order = new Map<Rect, number>(flagged.map((f, n) => [f, n]));
      for (const r of flagged) {
        bySize.set(sizeKey(r.ring), out.get(r.i)!);
        const s = stripKey(r.ring);
        if (s) byStrip.set(s, out.get(r.i)!);
        const [x0, y0, x1, y1] = extentOf(r.ring, STACK_GAP);
        for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
          for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
            const k = `${gx}|${gy}`;
            const list = near.get(k);
            if (list) list.push(r);
            else near.set(k, [r]);
          }
      }
      for (const r of group) {
        if (out.has(r.i)) continue;
        const same = bySize.get(sizeKey(r.ring));
        const strip = same === undefined ? byStrip.get(stripKey(r.ring) ?? '') : undefined;
        let q: Rect | undefined;
        if (same === undefined && strip === undefined) {
          const [x0, y0, x1, y1] = extentOf(r.ring, STACK_GAP);
          const seen = new Set<Rect>();
          // The first flagged box (in the order of the layer) that is close, as a plain scan would find.
          for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
            for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++)
              for (const f of near.get(`${gx}|${gy}`) ?? []) {
                if (seen.has(f)) continue;
                seen.add(f);
                if ((q === undefined || order.get(f)! < order.get(q)!) && r.area <= 1.5 * f.area && closeTo(r.ring, f.ring, STACK_GAP)) q = f;
              }
        }
        const text = same ?? strip ?? (q ? out.get(q.i) : undefined);
        if (text !== undefined) {
          out.set(r.i, text);
          grew = true;
        }
      }
      if (!grew) break;
    }
  }
  return out;
}

/** The reason written beside a row / a decision. */
export const LABEL_BOX_REASON = 'nghi vùng khoanh nhãn tên (hình chữ nhật cỡ vừa chữ, nằm sát chữ hoặc chồng lên vùng khác)';

/** Layer of the cleaned drawing that holds these boxes (the name starts with "khung", so the web app does not read it as data). */
export const LABEL_BOX_LAYER = 'KHUNG_Nhan_Ten';

/**
 * `findLabelBoxes` over several drawings that share one coordinate system (a map and its xrefs, the maps of one dossier): the
 * boxes of an xref are matched with the texts of the map that loads it, and the other way round. One result per drawing, in order.
 */
export function findLabelBoxesAcross(items: { doc: Pick<CadDocument, 'entities'>; inside: ArrayLike<number> }[]): Map<number, string>[] {
  if (items.length === 1) return [findLabelBoxes(items[0].doc, items[0].inside)];
  const entities: CadEntity[] = [];
  const total = items.reduce((n, it) => n + it.doc.entities.length, 0);
  const inside = new Uint8Array(total);
  const starts: number[] = [];
  for (const it of items) {
    starts.push(entities.length);
    for (let i = 0; i < it.doc.entities.length; i++) {
      inside[entities.length] = it.inside[i] ? 1 : 0;
      entities.push(it.doc.entities[i]);
    }
  }
  const all = findLabelBoxes({ entities }, inside);
  const out = items.map(() => new Map<number, string>());
  for (const [k, text] of all) {
    let d = starts.length - 1;
    while (d > 0 && starts[d] > k) d--;
    out[d].set(k - starts[d], text);
  }
  return out;
}
