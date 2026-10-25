// A flat picture of a drawing (SVG) for the eye: the planner looking at a drawing before and after cleaning it.
// Hatches are light fills, lines keep colour, width and the dash pattern of their line type, texts are drawn small.
// `colorBy: 'layer'` gives every layer its own colour and a legend of the biggest ones — the picture that tells which
// layer is the cadastral base, which the roads, which a survey remains. Pure: no DOM, no image library.
import { dotGlyph } from '@/lib/cad/lineTypeDots';
import type { CadDocument, CadEntity, LineTypeDef, Vec2 } from '@/lib/cad/types';

export interface PreviewOptions {
  /** Width in pixels (default 2400). */
  px?: number;
  /** Area to show [x0, y0, x1, y1]; default the bbox of the document. */
  box?: [number, number, number, number];
  colorBy?: 'entity' | 'layer';
  /** Draw only these entities (index in doc.entities). */
  include?: (i: number) => boolean;
  /** Draw texts (default true). */
  texts?: boolean;
  /** Most entities drawn: beyond it the short lines are thinned out (default 250 000). */
  limit?: number;
  /** Title written in the top-left corner. */
  title?: string;
}

export interface PreviewLegendItem {
  layer: string;
  color: string;
  count: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A colour per layer name, the same each time. */
export function layerColor(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  const light = 38 + ((h >>> 9) % 20);
  return `hsl(${hue} 80% ${light}%)`;
}

/** Dash array (pixels) of a line type at a scale; undefined for continuous or too fine to show. */
function dashArray(def: LineTypeDef | undefined, scale: number, sc: number): string | undefined {
  if (!def) return undefined;
  const parts = def.elements.map((el) => Math.max(0.6, Math.abs(el.length) * scale * sc));
  if (parts.length < 2 || !def.elements.some((el) => el.length < 0)) return undefined;
  const total = parts.reduce((t, v) => t + v, 0);
  if (total < 2.5 || total > 4000) return undefined;
  return (parts.length % 2 ? [...parts, ...parts] : parts).map((v) => v.toFixed(1)).join(' ');
}

/**
 * The round dots a line type writes as a letter (the planning boundary: "l" of Wingdings, "●" once cleaned), in pixels:
 * where each sits along one pattern period, its diameter and the period. A dash array cannot show them (they are text),
 * so they are laid as round-capped zero-length dashes of their own.
 */
function dotMarks(def: LineTypeDef | undefined, scale: number, sc: number): { at: number; d: number; period: number }[] {
  if (!def) return [];
  const period = def.elements.reduce((t, el) => t + Math.abs(el.length), 0) * scale * sc;
  if (!(period >= 2.5) || period > 4000) return [];
  const marks: { at: number; d: number; period: number }[] = [];
  let s = 0;
  for (const el of def.elements) {
    const g = el.text ? dotGlyph(el.text) : null;
    if (g && el.textScale) marks.push({ at: (s + (el.offset?.[0] ?? 0) + g.cx * el.textScale) * scale * sc, d: Math.max(2, g.d * el.textScale * scale * sc), period });
    s += Math.abs(el.length);
  }
  return marks;
}

export function previewSvg(doc: CadDocument, o: PreviewOptions = {}): { svg: string; legend: PreviewLegendItem[]; height: number } {
  const px = o.px ?? 2400;
  const [x0, y0, x1, y1] = o.box ?? [doc.bbox[0][0], doc.bbox[0][1], doc.bbox[1][0], doc.bbox[1][1]];
  const sc = px / Math.max(1e-9, x1 - x0);
  const H = Math.max(1, Math.round((y1 - y0) * sc));
  const X = (x: number) => ((x - x0) * sc).toFixed(1);
  const Y = (y: number) => ((y1 - y) * sc).toFixed(1);
  const inBox = (pts: readonly Vec2[]) => pts.some((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1);
  const byLayer = o.colorBy === 'layer';
  const pick = (e: CadEntity) => (byLayer ? layerColor(e.layer) : /^#?f{6}$/i.test(e.color) ? '#222222' : e.color);
  const counts = new Map<string, number>();
  const wanted: number[] = [];
  doc.entities.forEach((e, i) => {
    if (o.include && !o.include(i)) return;
    const pts: readonly Vec2[] = e.kind === 'polyline' ? e.points : e.kind === 'polygon' ? (e.rings[0] ?? []) : e.kind === 'table' ? [e.origin] : [e.position];
    if (pts.length && inBox(pts)) {
      wanted.push(i);
      counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
    }
  });
  // Too many objects for a picture: keep every hatch and text, thin out the short lines.
  const limit = o.limit ?? 250_000;
  const keep = wanted.length > limit ? wanted.filter((i, k) => doc.entities[i].kind !== 'polyline' || (doc.entities[i] as { points: unknown[] }).points.length > 6 || k % Math.ceil(wanted.length / limit) === 0) : wanted;

  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>`];
  for (const i of keep) {
    const e = doc.entities[i];
    if (e.kind === 'polygon') {
      const d = e.rings.map((r) => `${r.map((p, k) => `${k ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('')}Z`).join('');
      out.push(`<path d="${d}" fill="${pick(e)}" fill-opacity="${byLayer ? 0.35 : 0.55}" fill-rule="evenodd"/>`);
    }
  }
  for (const i of keep) {
    const e = doc.entities[i];
    if (e.kind !== 'polyline') continue;
    const d = e.points.map((p, k) => `${k ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('') + (e.closed ? 'Z' : '');
    const dash = e.lineType ? dashArray(doc.lineTypes?.[e.lineType], e.lineScale ?? 1, sc) : undefined;
    out.push(`<path d="${d}" fill="none" stroke="${pick(e)}" stroke-width="${Math.max(0.8, (e.width ?? 0) * sc).toFixed(1)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    if (e.lineType)
      for (const m of dotMarks(doc.lineTypes?.[e.lineType], e.lineScale ?? 1, sc))
        out.push(`<path d="${d}" fill="none" stroke="${pick(e)}" stroke-width="${m.d.toFixed(1)}" stroke-linecap="round" stroke-dasharray="0.01 ${(m.period - 0.01).toFixed(2)}" stroke-dashoffset="${(-m.at).toFixed(2)}"/>`);
  }
  if (o.texts !== false)
    for (const i of keep) {
      const e = doc.entities[i];
      if (e.kind !== 'text') continue;
      const x = X(e.position[0]);
      const y = Y(e.position[1]);
      out.push(`<text x="${x}" y="${y}" font-size="${Math.max(7, e.height * sc).toFixed(1)}" font-family="Arial" fill="${byLayer ? pick(e) : '#111'}" transform="rotate(${-e.rotation} ${x} ${y})">${esc(e.text)}</text>`);
    }
  for (const i of keep) {
    const e = doc.entities[i];
    if (e.kind === 'point') out.push(`<circle cx="${X(e.position[0])}" cy="${Y(e.position[1])}" r="2" fill="${pick(e)}"/>`);
  }
  const legend = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28).map(([layer, count]) => ({ layer, color: layerColor(layer), count }));
  if (byLayer || o.title) {
    const rows = byLayer ? legend : [];
    const h = 34 + rows.length * 22;
    out.push(`<rect x="8" y="8" width="520" height="${h}" fill="#fff" fill-opacity="0.9" stroke="#999"/>`);
    out.push(`<text x="18" y="30" font-size="18" font-family="Arial" font-weight="bold" fill="#000">${esc(o.title ?? '')}</text>`);
    rows.forEach((r, k) => {
      out.push(`<rect x="18" y="${42 + k * 22}" width="16" height="14" fill="${r.color}"/>`);
      out.push(`<text x="42" y="${54 + k * 22}" font-size="15" font-family="Arial" fill="#000">${esc(r.layer.slice(0, 48))} — ${r.count.toLocaleString('en-US')}</text>`);
    });
  }
  out.push('</svg>');
  return { svg: out.join(''), legend, height: H };
}
