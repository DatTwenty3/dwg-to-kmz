// Classifying a hatch by its own colour (Phụ lục I): the "colour group" an entity belongs to inside its layer, what
// the group stands for, and the mapping suggestion that follows. The key is shared by the mapping table, the
// exporters and the editing view (inventory.ts entityRowKey), so all of them see the same groups.
import type { CadEntity } from '@/lib/cad/types';
import { isNeutral, matchColor, type ColorMatch } from './color';
import { roleById, type RoleId } from './roles';
import { targetPath, type Suggestion } from './suggest';
import { symbolsOfSection, type Tt16Symbol } from './tt16Symbols';

/** Only hatches of land-use maps are classified by colour (v1). */
export const colorRole = (role: RoleId) => role === 'ht-sdd' || role === 'qh-sdd';

export interface ColorContext {
  /** Mục of Phụ lục I in use (section.ts); null = colour classification off. */
  section: number | null;
  role: RoleId;
}

const cache = new Map<number, Map<string, ColorMatch>>();

/** What a hatch colour stands for in a Mục (cached by hex). Neutral colours are never classified. */
export function classifyColor(hex: string, section: number | null): ColorMatch {
  if (section === null || isNeutral(hex)) return { level: 'none' };
  let perHex = cache.get(section);
  if (!perHex) cache.set(section, (perHex = new Map()));
  let m = perHex.get(hex);
  if (!m) perHex.set(hex, (m = matchColor(hex, symbolsOfSection(section), 'A')));
  return m;
}

/**
 * Colour group of an entity inside its layer row: `''` (not split: not a hatch, a map without colours, neutral or
 * unknown colour) or `c<rrggbb>` — one group per real colour, so two near shades of one symbol stay visible.
 */
export function colorKey(e: Pick<CadEntity, 'kind' | 'color'>, ctx: ColorContext): string {
  if (e.kind !== 'polygon' || ctx.section === null || !colorRole(ctx.role)) return '';
  const hex = e.color.toLowerCase();
  return classifyColor(hex, ctx.section).level === 'none' ? '' : `c${hex.slice(1)}`;
}

/** '#rrggbb' of a colour group key ('' → null). */
export const keyColor = (key: string): string | null => (/^c[0-9a-f]{6}$/.test(key) ? `#${key.slice(1)}` : null);

export interface ColorInfo {
  level: Exclude<ColorMatch['level'], 'none'>;
  hex: string;
  /** AutoCAD index of the symbol colour ("Số 15"). */
  aci: number;
  /** Land use of the symbol (phanLoai). */
  landUse: string;
  /** Tên ký hiệu / loại chức năng. */
  name: string;
  /** The other candidate of an ambiguous colour. */
  alt?: { aci: number; landUse: string; name: string };
  dE: number;
  /** Short Vietnamese explanation (tooltip). */
  reason: string;
}

const symbolUse = (s: Tt16Symbol) => s.landUse ?? s.name;

/** Description of a colour group (null when the key has no classification). */
export function describeColorKey(key: string, section: number | null): ColorInfo | null {
  const hex = keyColor(key);
  if (!hex || section === null) return null;
  const m = classifyColor(hex, section);
  if (m.level === 'none' || !m.best) return null;
  const best = m.best;
  const dE = m.dE ?? 0;
  const alt = m.alt ? { aci: m.alt.aci, landUse: symbolUse(m.alt), name: m.alt.name } : undefined;
  let reason: string;
  if (m.level === 'exact') reason = `Màu số ${best.aci} — ${symbolUse(best)}`;
  else if (m.level === 'near') reason = `Màu gần số ${best.aci} (ΔE ${dE.toFixed(1)}) — ${symbolUse(best)}`;
  else if (alt && dE === 0) reason = `Màu số ${best.aci} dùng cho 2 loại đất: ${symbolUse(best)} / ${alt.landUse} — hãy chọn`;
  else if (alt) reason = `Màu nằm giữa số ${best.aci} (${symbolUse(best)}) và số ${alt.aci} (${alt.landUse}) — hãy chọn`;
  else reason = `Màu hao hao số ${best.aci} (ΔE ${dE.toFixed(1)}, ${symbolUse(best)}) — hãy xem lại`;
  return { level: m.level, hex, aci: best.aci, landUse: symbolUse(best), name: best.name, alt, dE, reason };
}

/** The land-use class of a land-use map of this kind (HienTrang / QuyHoach ChucNangSuDungDat_A), null for other maps. */
export function landUseTarget(role: RoleId): string | null {
  const r = roleById(role);
  return r.db && r.dataset && colorRole(role) ? targetPath(r.db, r.dataset, 'ChucNangSuDungDat_A') : null;
}

/**
 * Mapping suggestion of a colour group — null when the colour says nothing (the layer-name suggestion applies).
 * exact / near → the land use class with that land use; ambiguous → "cần xem" with the best candidate preselected.
 */
export function colorSuggestion(info: ColorInfo | null, role: RoleId): Suggestion | null {
  const target = landUseTarget(role);
  if (!info || !target) return null;
  if (info.level === 'ambiguous') return { target: null, phanLoai: info.landUse, reason: info.reason, unknown: true };
  return { target, phanLoai: info.landUse, reason: info.reason };
}
