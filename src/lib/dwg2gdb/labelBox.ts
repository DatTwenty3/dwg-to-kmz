// The boundary of an MTEXT inside a hatch. When a hatch is made over an area, AutoCAD puts a rectangle round the text block of every
// MTEXT it finds inside: the block of the text (its extents) plus a small margin. Read as a loop of the hatch, that rectangle
// becomes a land parcel ("ô nền chữ": Đôn Châu QH05, ~70 boxes of QHDD_DAT_XD_Dato read as "Đất ở"). Only this exact signature is
// recognised — a rectangle (hatch loop or closed outline of 4 right-angled corners) that holds the block of an MTEXT with a margin
// of at most about one text height on every side. Nothing is guessed from the look of the drawing, so no real parcel is lost.
// Pure: no DOM.
import type { CadDocument, CadEntity, Vec2 } from '@/lib/cad/types';
import { pointInRing } from './geometry';

/** The margin AutoCAD leaves between the block of the text and the rectangle: from this to that many text heights (per side). */
const MARGIN_MIN = -0.15;
const MARGIN_MAX = 1.2;
/** The rectangle is at most this many times the area of the text block (a rectangle far bigger than its text is not its boundary). */
const MAX_AREA_RATIO = 3.5;
/** The rectangle and the text run in the same direction to within this many degrees (the text may be turned a quarter). */
const TURN_TOL = 3;
const CELL = 100;

type Text = Extract<CadEntity, { kind: 'text' }>;

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

/** The text block of an MTEXT (centre, size, angle in radians) — from its stored size and its anchor/alignment. */
function blockOf(t: Text): { c: Vec2; w: number; h: number; a: number } | null {
  if (!t.box) return null;
  const { w, h } = t.box;
  const ox = t.hAlign === 'left' ? w / 2 : t.hAlign === 'right' ? -w / 2 : 0;
  const oy = t.vAlign === 'top' ? -h / 2 : t.vAlign === 'middle' ? 0 : h / 2;
  const a = (t.rotation * Math.PI) / 180;
  return { c: [t.position[0] + ox * Math.cos(a) - oy * Math.sin(a), t.position[1] + ox * Math.sin(a) + oy * Math.cos(a)], w, h, a };
}

/** Angle difference of two directions in degrees, folded to [0, 90]. */
const fold90 = (a: number, b: number) => {
  const d = (((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};

/**
 * Objects of the drawing that are the boundary of an MTEXT: a rectangle holding the text block of an MTEXT, with a margin of
 * `MARGIN_MIN`…`MARGIN_MAX` text heights on every side and not much bigger than the block. Index in `doc.entities` → the text it
 * frames. Only objects with `inside` set are looked at; only MTEXTs that carry their block size (`TextEntity.box`) count.
 */
export function findLabelBoxes(doc: Pick<CadDocument, 'entities'>, inside: ArrayLike<number>): Map<number, string> {
  const texts: { t: Text; b: NonNullable<ReturnType<typeof blockOf>> }[] = [];
  const grid = new Map<string, number[]>();
  doc.entities.forEach((e, i) => {
    if (e.kind !== 'text' || !inside[i] || !e.text.trim() || !(e.height > 0)) return;
    const b = blockOf(e);
    if (!b) return;
    texts.push({ t: e, b });
    const k = `${Math.floor(b.c[0] / CELL)}|${Math.floor(b.c[1] / CELL)}`;
    const list = grid.get(k);
    if (list) list.push(texts.length - 1);
    else grid.set(k, [texts.length - 1]);
  });
  const out = new Map<number, string>();
  if (!texts.length) return out;

  doc.entities.forEach((e, i) => {
    if (!inside[i]) return;
    const raw = e.kind === 'polygon' ? e.rings[0] : e.kind === 'polyline' && e.points.length <= 5 && (e.closed || (e.points.length === 5 && e.points[0][0] === e.points[4][0] && e.points[0][1] === e.points[4][1])) ? e.points : undefined;
    const ring = rectangleOf(raw);
    if (!ring) return;
    const xs = ring.map((q) => q[0]);
    const ys = ring.map((q) => q[1]);
    const mid: Vec2 = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2];
    const W = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
    const H = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
    const ang = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
    const cos = Math.cos(-ang);
    const sin = Math.sin(-ang);
    const seen = new Set<number>();
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
      for (let gy = Math.floor(Math.min(...ys) / CELL); gy <= Math.floor(Math.max(...ys) / CELL); gy++)
        for (const ti of grid.get(`${gx}|${gy}`) ?? []) {
          if (seen.has(ti) || out.has(i)) continue;
          seen.add(ti);
          const { t, b } = texts[ti];
          if (!pointInRing(b.c, ring)) continue;
          const turn = fold90((ang * 180) / Math.PI, t.rotation);
          const quarter = turn <= TURN_TOL ? 0 : Math.abs(turn - 90) <= TURN_TOL ? 1 : -1;
          if (quarter < 0) continue;
          const [bw, bh] = quarter ? [b.h, b.w] : [b.w, b.h];
          if (W * H > MAX_AREA_RATIO * bw * bh) continue;
          // Margins on the four sides, in the rectangle's own axes (a negative one: the block sticks out of the rectangle).
          const dx = (b.c[0] - mid[0]) * cos - (b.c[1] - mid[1]) * sin;
          const dy = (b.c[0] - mid[0]) * sin + (b.c[1] - mid[1]) * cos;
          const left = W / 2 + dx - bw / 2;
          const right = W / 2 - dx - bw / 2;
          const bottom = H / 2 + dy - bh / 2;
          const top = H / 2 - dy - bh / 2;
          const lo = MARGIN_MIN * t.height;
          const hi = MARGIN_MAX * t.height;
          if ([left, right, bottom, top].every((m) => m >= lo && m <= hi)) out.set(i, t.text.replace(/\s+/g, ' ').trim());
        }
  });
  return out;
}

/** The reason written beside a row / a decision. */
export const LABEL_BOX_REASON = 'đường biên khung chữ của MTEXT trong hatch (hình chữ nhật bao quanh khối chữ), không phải thửa đất';

/** Layer of the cleaned drawing that holds these boxes (the name starts with "khung", so the web app does not read it as data). */
export const LABEL_BOX_LAYER = 'KHUNG_Nhan_Ten';

/** Several drawings that share one coordinate system as one list of entities (and how to split a result by index back per drawing). */
export function mergeDrawings(items: { doc: Pick<CadDocument, 'entities'>; inside: ArrayLike<number> }[]): {
  doc: { entities: CadEntity[] };
  inside: Uint8Array;
  split: <T>(all: Map<number, T>) => Map<number, T>[];
} {
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
  return {
    doc: { entities },
    inside,
    split: <T,>(all: Map<number, T>) => {
      const out = items.map(() => new Map<number, T>());
      for (const [k, v] of all) {
        let d = starts.length - 1;
        while (d > 0 && starts[d] > k) d--;
        out[d].set(k - starts[d], v);
      }
      return out;
    },
  };
}

/**
 * `findLabelBoxes` over several drawings that share one coordinate system (a map and its xrefs): the texts of one drawing frame the
 * boxes of another. One result per drawing, in order.
 */
export function findLabelBoxesAcross(items: { doc: Pick<CadDocument, 'entities'>; inside: ArrayLike<number> }[]): Map<number, string>[] {
  if (items.length === 1) return [findLabelBoxes(items[0].doc, items[0].inside)];
  const m = mergeDrawings(items);
  return m.split(findLabelBoxes(m.doc, m.inside));
}
