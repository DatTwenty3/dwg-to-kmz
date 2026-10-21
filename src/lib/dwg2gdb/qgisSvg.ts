// SVG symbols of Phụ lục I (tt16-hatch-svg/, tt16-point-svg/ at the project root, copied to /tt16-svg/ by
// scripts/copy-wasm.mjs) for the QGIS project: which SVG a category of a class gets, which files a project needs,
// and the base64 form QGIS reads straight from the project ("base64:…", no file next to the .qgz). Pure.
import { foldVietnamese } from '@/lib/geo/provinces';
import type { CategoryStyle, ClassData } from './features';

export interface HatchSvg {
  file: string;
  /** Mục of Phụ lục I and AutoCAD colour of the symbol ("Số 30"). */
  muc: number;
  aci: number;
  layer: string;
  label: string;
  /** viewBox size in pt. */
  width: number;
  height: number;
}

export interface PointSvg {
  file: string;
  muc: number;
  label: string;
  /** "Hiện trạng" / "Quy hoạch đợt đầu" / "Quy hoạch dài hạn" (Mục 8) or "Ký hiệu chức năng (ghi chú)" (Mục 2–7). */
  stage: string;
  width: number;
  height: number;
}

export interface SvgIndex {
  hatch: HatchSvg[];
  point: PointSvg[];
}

/** The index plus the text of the SVG files the project uses (key "hatch/<file>" / "point/<file>"). */
export interface SvgLibrary {
  index: SvgIndex;
  files: ReadonlyMap<string, string>;
}

export const SVG_BASE = '/tt16-svg';
const FUNCTION_STAGE = 'Ký hiệu chức năng (ghi chú)';
/** Labels so generic they only count when the category is called exactly that. */
const GENERIC = new Set(['tong hop', 'hanh khach', 'hang hoa', 'chuyen dung', 'noi', 'chim']);

const fold = (s: string) =>
  foldVietnamese(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The hatch SVG of a category: the symbol of its Mục and colour (the layer name tells two symbols of one colour apart). */
export function hatchSvgFor(style: Pick<CategoryStyle, 'symbol'>, index: SvgIndex): HatchSvg | null {
  const s = style.symbol;
  if (!s) return null;
  const same = index.hatch.filter((h) => h.muc === s.section && h.aci === s.aci);
  if (same.length <= 1) return same[0] ?? null;
  return same.find((h) => s.layer && h.layer === s.layer) ?? same.find((h) => fold(h.label) === fold(s.name)) ?? same[0];
}

/**
 * The point SVG of a category, found by its phanLoai: equal to the symbol's label, or containing it (labels of five
 * letters or more). Points of infrastructure classes (Mục 8) take the stage of their database (HienTrang → existing,
 * else first phase); polygons only take the function symbols of Mục 2–7 ("Chợ", "Trường tiểu học"…), drawn at their centre.
 */
export function pointSvgFor(phanLoai: string | null, geom: ClassData['geom'], db: string, index: SvgIndex): PointSvg | null {
  if (!phanLoai || geom === 'L') return null;
  const p = fold(phanLoai);
  if (!p) return null;
  const wanted = db === 'HienTrang' ? 'Hiện trạng' : 'Quy hoạch đợt đầu';
  let best: PointSvg | null = null;
  let bestScore = 0;
  for (const s of index.point) {
    const infra = s.muc === 8;
    if (geom === 'P' ? !infra : infra) continue;
    const l = fold(s.label.replace(/[:.]+$/, ''));
    if (!l) continue;
    let score = 0;
    if (p === l || p === `dat ${l}`) score = 1000 + l.length;
    else if (!GENERIC.has(l) && l.length >= 5 && p.includes(l)) score = l.length;
    if (!score) continue;
    // Right stage first (a symbol exists in up to three phases).
    if (infra) score += s.stage === wanted ? 500 : s.stage === 'Quy hoạch đợt đầu' ? 100 : 0;
    else if (s.stage !== FUNCTION_STAGE) continue;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Keys ("hatch/<file>", "point/<file>") of the SVG files a project of these classes uses. */
export function neededSvgFiles(classes: readonly ClassData[], index: SvgIndex): string[] {
  const out = new Set<string>();
  for (const c of classes) {
    if (!c.features.length) continue;
    for (const s of c.styles) {
      if (c.geom === 'A') {
        const h = hatchSvgFor(s, index);
        if (h) out.add(`hatch/${h.file}`);
      }
      const p = pointSvgFor(s.phanLoai, c.geom, c.db, index);
      if (p) out.add(`point/${p.file}`);
    }
  }
  return [...out];
}

/** Text → "base64:…" the way QGIS embeds an SVG in a symbol layer. */
export function svgToBase64(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `base64:${btoa(bin)}`;
}

/** Size of an SVG tile in mm at its natural size (viewBox units are pt). */
export const ptToMm = (pt: number) => Math.round(pt * (25.4 / 72) * 100) / 100;

/** Reads the index files and the SVG files a project needs. Anything that cannot be fetched is left out (plain symbols are used). */
export async function loadSvgLibrary(classes: readonly ClassData[], origin: string, fetchFn: typeof fetch = fetch): Promise<SvgLibrary | null> {
  try {
    const [h, p] = await Promise.all(['hatch', 'point'].map((d) => fetchFn(`${origin}${SVG_BASE}/${d}/index.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))));
    const index: SvgIndex = { hatch: h as HatchSvg[], point: p as PointSvg[] };
    const keys = neededSvgFiles(classes, index);
    const files = new Map<string, string>();
    await Promise.all(
      keys.map(async (k) => {
        const r = await fetchFn(`${origin}${SVG_BASE}/${k}`);
        if (r.ok) files.set(k, await r.text());
      }),
    );
    return { index, files };
  } catch {
    return null;
  }
}
