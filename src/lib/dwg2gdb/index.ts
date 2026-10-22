// "Bóc tách DWG → CSDL TT16": the drawings of a planning folder (lấy ý kiến Sở Xây dựng) → HoSoGIS.
//   1. loadFolder: every main drawing + the xrefs they load (xrefs.ts).
//   2. analyzeDrawings: role of each drawing (title / file name), planning boundary, entities inside it, layer rows.
//   3. initialMapping: each row → TT16 class + phanLoai, from the saved template, else the built-in suggestions.
//   4. buildFeatures (features.ts) → planStage1 (plan.ts) → GDAL → "Chuẩn hóa TT16" (gdb/normalize.ts).
// Pure functions (no DOM): the worker src/workers/dwgTt16.worker.ts runs them, tests run them in Node.
import type { CadDocument, Vec2, XrefInsert } from '@/lib/cad/types';
import { colorRole, colorSuggestion, type ColorContext } from './colorClass';
import { drawingTexts, findBoundary, insideFlags, layerRows, pickBoundary, type BoundaryCandidate, type LayerRow } from './inventory';
import { guessRole, roleById, type RoleId } from './roles';
import { pickSection } from './section';
import { domainCode } from '@/lib/gdb/tt16Schema';
import { compactName, LAND_USE_M1, layerLandUse, sameLandUse, suggest, type GeomKind } from './suggest';
import { retarget, templateLookup, type MappingEntry, type MappingTemplate, type TargetDb, type TemplateRule } from './template';
import { placeXref, resolveXref, xrefNameRole, xrefOwners, type FolderFile, type MainDrawing } from './xrefs';

export * from './cadLayers';
export * from './color';
export * from './coverage';
export * from './colorClass';
export * from './features';
export * from './inventory';
export * from './output';
export * from './place';
export * from './plan';
export * from './qgis';
export * from './roads';
export * from './roles';
export * from './section';
export * from './summary';
export * from './suggest';
export * from './sweep';
export * from './template';
export * from './tt16Symbols';
export * from './xrefs';

export interface ParsedDrawing {
  id: string;
  /** File name. */
  name: string;
  /** Path inside the dropped folder. */
  path: string;
  doc: CadDocument;
  /** Set for an xref file: the main drawing it is attached to (its role applies). */
  owner?: { id: string; name: string; role: RoleId };
}

export interface FolderInput extends FolderFile {
  read: () => Promise<ArrayBuffer>;
}

export interface LoadedFolder {
  drawings: ParsedDrawing[];
  /** Xref-like files nobody references (frames, title blocks…) — not read. */
  unused: FolderFile[];
  /** Xrefs not found in the folder: "QH07….dwg → Xr_nen giao thong". */
  missingXrefs: string[];
}

/**
 * Reads the drawings of a folder: every main drawing, then the xrefs they reference (nested ones too), each xref
 * file once and attached to one owner (xrefs.ts). Files named like xrefs that nobody references are not read.
 */
export async function loadFolder(
  files: FolderInput[],
  parse: (f: FolderInput, data: ArrayBuffer) => Promise<CadDocument>,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<LoadedFolder> {
  const cad = files.filter((f) => /\.(dwg|dxf)$/i.test(f.name));
  const isXrefName = (f: FolderFile) => guessRole(f.name, []).role === 'xref';
  const named = cad.filter((f) => !isXrefName(f));
  const docs = new Map<string, CadDocument>();
  let done = 0;
  let total = named.length;
  const read = async (f: FolderInput) => {
    onProgress?.(done, total, f.name);
    docs.set(f.id, await parse(f, await f.read()));
    done++;
  };
  for (const f of named) await read(f);

  // A file that is not named like an xref but is loaded as one by another drawing, and has no map kind of its own
  // ("NEN EXREF.dwg", "RANH AP XREF.dwg"), is an xref too — otherwise the drawing that loads it shows without its base.
  const asXref = new Set<string>();
  const namedIds = new Set(named.map((f) => f.id));
  for (const f of named)
    for (const x of docs.get(f.id)?.xrefs ?? []) {
      const t = resolveXref(x.name, f.path, cad);
      if (!t || t.id === f.id || !namedIds.has(t.id)) continue;
      // Two drawings loading each other: neither is demoted.
      if ((docs.get(t.id)?.xrefs ?? []).some((y) => resolveXref(y.name, t.path, cad)?.id === f.id)) continue;
      if (!roleById(guessRole(t.name, drawingTexts(docs.get(t.id)!)).role).db) asXref.add(t.id);
    }
  const mains = named.filter((f) => !asXref.has(f.id));
  const mainIds = new Set(mains.map((f) => f.id));

  // Xrefs, breadth first. reach = xref file → main drawings loading it; the first INSERT gives its placement.
  const reach = new Map<string, Set<string>>();
  const placement = new Map<string, XrefInsert>();
  const missing: string[] = [];
  const byId = new Map(cad.map((f) => [f.id, f]));
  const queue: { from: FolderInput; via: string[] }[] = mains.map((f) => ({ from: f, via: [f.id] }));
  while (queue.length) {
    const { from, via } = queue.shift()!;
    for (const x of docs.get(from.id)?.xrefs ?? []) {
      const target = resolveXref(x.name, from.path, cad);
      if (!target) {
        const m = `${from.name} → ${x.name}`;
        if (!missing.includes(m)) missing.push(m);
        continue;
      }
      if (target.id === from.id || mainIds.has(target.id)) continue;
      const set = reach.get(target.id) ?? new Set<string>();
      const before = set.size;
      via.forEach((m) => set.add(m));
      reach.set(target.id, set);
      if (!placement.has(target.id)) placement.set(target.id, x);
      if (!docs.has(target.id)) {
        total++;
        await read(byId.get(target.id)!);
      } else if (set.size === before) continue;
      queue.push({ from: byId.get(target.id)!, via: [...set] });
    }
  }
  onProgress?.(total, total, '');

  const main: ParsedDrawing[] = mains.map((f) => ({ id: f.id, name: f.name, path: f.path, doc: docs.get(f.id)! }));
  const info = new Map<string, MainDrawing>();
  for (const m of main) {
    const g = guessRole(m.name, drawingTexts(m.doc));
    info.set(m.id, { id: m.id, role: g.role, year: g.year });
  }
  const owners = xrefOwners(
    new Map([...reach].map(([id, set]) => [id, [...set].map((m) => info.get(m)!)])),
    new Map([...reach.keys()].map((id) => [id, byId.get(id)!])),
  );
  const xrefDrawings: ParsedDrawing[] = [];
  for (const [id, owner] of owners) {
    const f = byId.get(id)!;
    const host = main.find((m) => m.id === owner.id)!;
    // An xref named after a map kind of its own ("Xr_Nen Hien Trang" → hiện trạng) keeps that kind.
    const named = xrefNameRole(f.name);
    const role = roleById(named).db ? named : owner.role;
    xrefDrawings.push({
      id,
      name: f.name,
      path: f.path,
      doc: placeXref(docs.get(id)!, placement.get(id)!),
      owner: { id: owner.id, name: host.name, role },
    });
  }
  return {
    drawings: [...main, ...xrefDrawings],
    unused: cad.filter((f) => isXrefName(f) && !docs.has(f.id) && resolveXref(f.name, f.path, cad)?.id === f.id).map(({ id, name, path }) => ({ id, name, path })),
    missingXrefs: missing,
  };
}

export interface DrawingInfo {
  id: string;
  name: string;
  path: string;
  role: RoleId;
  title: string | null;
  year: number | null;
  /** Set for an xref: the main drawing that loads it. */
  owner: { id: string; name: string } | null;
  /** The user's choice of geodatabase for this drawing's data, instead of the one its map kind feeds (null: automatic). */
  dbOverride?: TargetDb | null;
  /** Used to build the geodatabases (default: drawings with a role, the latest year of a map kind). */
  included: boolean;
  /** Why it is left out by default. */
  note: string | null;
  entities: number;
  inside: number;
  bbox: [Vec2, Vec2];
}

export interface Analysis {
  drawings: DrawingInfo[];
  rows: LayerRow[];
  boundary: BoundaryCandidate | null;
  /** Drawing id → inside flags (aligned with doc.entities). */
  inside: Map<string, Uint8Array>;
  /** Mục of Phụ lục I the hatch colours are read against (null: colour classification off). */
  section: number | null;
  /** Why that Mục ("Tiêu đề: quy hoạch chung xã", "Bầu chọn: …", "Bạn đã chọn"). */
  sectionWhy: string;
}

/** Colour context of every drawing: its map kind at analysis time + the Mục in use. */
export function colorContexts(a: Pick<Analysis, 'drawings' | 'section'>): Map<string, ColorContext> {
  return new Map(a.drawings.map((d) => [d.id, { section: a.section, role: d.role }]));
}

/** Mapping rows of every drawing for one Mục (the rows split by colour group depend on it). */
export function analysisRows(parsed: ParsedDrawing[], a: Pick<Analysis, 'drawings' | 'inside' | 'section'>): LayerRow[] {
  const ctx = colorContexts(a);
  return parsed.flatMap((p) => layerRows(p.id, p.doc, a.inside.get(p.id)!, ctx.get(p.id)));
}

/**
 * `section` undefined = choose it (title of the drawings, else the hatch colours); a number or null = the user's choice.
 */
export function analyzeDrawings(parsed: ParsedDrawing[], section?: number | null): Analysis {
  const boundary = pickBoundary(parsed.map((p) => findBoundary(p.doc)));
  const drawings: DrawingInfo[] = [];
  const inside = new Map<string, Uint8Array>();
  // A "định hướng phát triển không gian" map holding the land-use layers of the plan, in a dossier without a land-use map
  // of its own (QH04 of a commune with only that map), is the land-use map: its hatches are read as land use, not dropped.
  const guessed = new Map(parsed.filter((p) => !p.owner).map((p) => [p.id, guessRole(p.name, drawingTexts(p.doc))]));
  const upgraded = new Set<string>();
  if (![...guessed.values()].some((g) => g.role === 'qh-sdd')) {
    for (const [id, g] of guessed) {
      if (g.role !== 'qh-ktcq') continue;
      let polygons = 0;
      let landUse = 0;
      // The hatches of the map itself (its xrefs are the survey base: buildings, parcels…).
      for (const e of parsed.find((p) => p.id === id)!.doc.entities) {
        if (e.kind !== 'polygon') continue;
        polygons++;
        if (layerLandUse(compactName(e.layer))) landUse++;
      }
      if (polygons >= 20 && landUse / polygons >= 0.4) upgraded.add(id);
    }
  }
  for (const p of parsed) {
    const g = p.owner
      ? { role: upgraded.has(p.owner.id) ? ('qh-sdd' as RoleId) : p.owner.role, title: null, year: null }
      : upgraded.has(p.id)
        ? { ...guessed.get(p.id)!, role: 'qh-sdd' as RoleId }
        : guessed.get(p.id)!;
    const flags = insideFlags(p.doc, boundary?.ring ?? null);
    inside.set(p.id, flags);
    let n = 0;
    for (const f of flags) n += f;
    const role = roleById(g.role);
    drawings.push({
      id: p.id,
      name: p.name,
      path: p.path,
      role: g.role,
      title: g.title,
      year: g.year,
      owner: p.owner ? { id: p.owner.id, name: p.owner.name } : null,
      included: !!role.db && n > 0,
      note: !role.db ? role.label : n === 0 ? 'Không có đối tượng nào trong ranh quy hoạch' : null,
      entities: p.doc.entities.length,
      inside: n,
      bbox: p.doc.bbox,
    });
  }
  // Several maps of the same kind (QH05 đến 2030 / QH06 đến 2050): keep the latest year.
  for (const d of drawings) {
    if (!d.included || d.year === null || d.owner) continue;
    const later = drawings.find((o) => o !== d && o.included && !o.owner && o.role === d.role && o.year !== null && o.year > d.year!);
    if (later) {
      d.included = false;
      d.note = `Đã có bản đồ năm ${later.year} (${later.name})`;
    }
  }
  // An xref follows its owner.
  for (const d of drawings) {
    const o = d.owner && drawings.find((x) => x.id === d.owner!.id);
    if (o && !o.included && d.included) {
      d.included = false;
      d.note = `${o.name} không được dùng`;
    }
  }

  // Mục of Phụ lục I: the user's choice, else the title blocks, else the vote of the hatch colours of the land-use maps.
  let chosen: { section: number | null; why: string };
  if (section !== undefined) chosen = { section, why: section === null ? 'Không dùng màu' : 'Bạn đã chọn' };
  else {
    const titles = parsed.filter((p) => !p.owner).flatMap((p) => drawingTexts(p.doc));
    const roleOf = new Map(drawings.map((d) => [d.id, d.role]));
    const counts = new Map<string, number>();
    for (const p of parsed) {
      if (!colorRole(roleOf.get(p.id)!)) continue;
      const flags = inside.get(p.id)!;
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || !flags[i]) return;
        const hex = e.color.toLowerCase();
        counts.set(hex, (counts.get(hex) ?? 0) + 1);
      });
    }
    chosen = pickSection(titles, counts);
  }
  const base = { drawings, inside, section: chosen.section };
  return { drawings, rows: analysisRows(parsed, base), boundary, inside, section: chosen.section, sectionWhy: chosen.why };
}

export interface MappingState extends MappingEntry {
  /** template = from the saved template; auto = built-in suggestion; manual = set by the user. */
  source: 'template' | 'auto' | 'manual';
  reason: string;
  /** Left unmapped because no rule applied (needs the user's eye). */
  unknown?: boolean;
  /** A class is chosen but the colour and the layer name disagree: worth a look. */
  review?: boolean;
}

/** Layers that have hatch rows in a drawing ("DrawingId|layer"), cached per rows array. */
const polygonLayerCache = new WeakMap<readonly LayerRow[], Set<string>>();
function polygonLayers(rows: readonly LayerRow[]): Set<string> {
  let set = polygonLayerCache.get(rows);
  if (!set) {
    set = new Set(rows.filter((r) => r.kind === 'A' && r.count > 0).map((r) => `${r.drawing}\u0001${r.layer}`));
    polygonLayerCache.set(rows, set);
  }
  return set;
}

/** Facts the suggestions need about a row (closed share, hatches on the same layer, numeric texts). */
function factsOf(row: LayerRow, rows: readonly LayerRow[]) {
  return {
    closedShare: row.kind === 'L' && row.count ? row.closed / row.count : 0,
    layerHasPolygons: polygonLayers(rows).has(`${row.drawing}\u0001${row.layer}`),
    numericShare: row.numericShare,
  };
}

const LAND_USE_CLASS = /\/ChucNangSuDungDat_A$/;

/**
 * A rule saved in the template whose land use is no value of Phụ lục (an older version put the layer name there when
 * it did not know the layer): the suggestion of today replaces it, or the mistake would stay for ever.
 */
function staleRule(t: MappingEntry): boolean {
  if (!t.target || !LAND_USE_CLASS.test(t.target)) return false;
  return domainCode('QuyHoach', 'ChucNangSuDungDatM1', LAND_USE_M1[t.phanLoai] ?? t.phanLoai) === null;
}

/**
 * Suggestion of a row: the layer name, and for a hatch colour group the colour of Phụ lục I (exact / near colours
 * are adopted, shared or in-between colours need a choice). Colour and name disagreeing is flagged for review —
 * unless both land uses end in the same ChucNangSuDungDatM1 value (giáo dục / công cộng): then the layer's more
 * specific label stays.
 */
export function suggestRow(row: LayerRow, role: RoleId, rows: readonly LayerRow[]): MappingState {
  const s = suggest(role, row.layer, row.kind, factsOf(row, rows));
  const byName: MappingState = { target: s.target, phanLoai: s.phanLoai, source: 'auto', reason: s.reason, unknown: s.unknown };
  const info = row.colorKey ? (row.colorMatch ?? null) : null;
  const c = colorSuggestion(info, role);
  if (!c || !info) return byName;
  const nameLand = !!s.target && LAND_USE_CLASS.test(s.target);
  // A decisive name rule (a building class, a deliberately dropped layer) is not overridden by a colour.
  if ((s.target && !nameLand) || (!s.target && !s.unknown)) return byName;
  const colour: MappingState = { target: c.target, phanLoai: c.phanLoai, source: 'auto', reason: c.reason, unknown: c.unknown };
  if (info.level === 'ambiguous') {
    const candidates = [info.landUse, info.alt?.landUse].filter((x): x is string => !!x);
    // The layer name settles a colour two land uses share.
    if (nameLand && candidates.some((u) => sameLandUse(u, s.phanLoai))) return { ...byName, reason: `${c.reason}; theo tên layer: ${s.phanLoai}` };
    return colour;
  }
  if (!nameLand) return colour;
  if (s.phanLoai === c.phanLoai) return colour;
  if (sameLandUse(s.phanLoai, c.phanLoai)) return { ...byName, reason: `${c.reason}; giữ theo tên layer: ${s.phanLoai}` };
  return { ...colour, review: true, reason: `${c.reason} (tên layer gợi ý "${s.phanLoai}")` };
}

/**
 * Mapping of one row: a saved template rule first (for a colour group only a rule saved for that colour, or a
 * colourless layer rule when the colour decides nothing), else the suggestion.
 */
export function resolveRow(row: LayerRow, role: RoleId, lookup: ReturnType<typeof templateLookup>, rows: readonly LayerRow[], db?: TargetDb | null): MappingState {
  const s = resolveByRole(row, role, lookup, rows);
  return db && db !== roleById(role).db ? retargetState(s, db) : s;
}

/** The same decision written to the other geodatabase: its class there, or a request to choose one. */
export function retargetState(s: MappingState, db: TargetDb): MappingState {
  if (!s.target) return s;
  const target = retarget(s.target, db);
  if (target === s.target) return s;
  if (target) return { ...s, target, reason: `${s.reason} — ghi vào ${db}.gdb theo lựa chọn` };
  const cls = s.target.split('/').pop();
  return { ...s, target: null, unknown: true, review: false, reason: `Lớp ${cls} chưa có trong ${db}.gdb — hãy chọn lớp khác` };
}

function resolveByRole(row: LayerRow, role: RoleId, lookup: ReturnType<typeof templateLookup>, rows: readonly LayerRow[]): MappingState {
  const fromTemplate = (t: MappingEntry): MappingState => ({ ...t, source: 'template', reason: 'Theo mẫu ghép đã lưu' });
  if (!roleById(role).db) return suggestRow(row, role, rows);
  const exact = lookup(role, row.layer, row.kind as GeomKind, row.colorKey ? row.color : undefined);
  if (exact && !staleRule(exact)) return fromTemplate(exact);
  const s = suggestRow(row, role, rows);
  if (row.colorKey && s.unknown) {
    const legacy = lookup(role, row.layer, row.kind as GeomKind);
    if (legacy && !staleRule(legacy)) return fromTemplate(legacy);
  }
  return s;
}

/** Mapping of every row: template first, else the built-in suggestion. */
export function initialMapping(a: Pick<Analysis, 'drawings' | 'rows'>, template: MappingTemplate | null): Map<string, MappingState> {
  const lookup = templateLookup(template);
  const roleOf = new Map(a.drawings.map((d) => [d.id, d.role]));
  const dbOf = new Map(a.drawings.map((d) => [d.id, d.dbOverride ?? null]));
  const out = new Map<string, MappingState>();
  for (const r of a.rows) out.set(r.key, resolveRow(r, roleOf.get(r.drawing) ?? 'other', lookup, a.rows, dbOf.get(r.drawing)));
  return out;
}

/** Rows the user should look at: inside the area, with data, no class chosen. */
export function unmappedRows(rows: LayerRow[], mapping: Map<string, MappingEntry>, minCount = 1): LayerRow[] {
  return rows.filter((r) => r.kind !== 'T' && r.count >= minCount && !mapping.get(r.key)?.target);
}

/**
 * Decisions worth keeping in the template: every row sent to a class, and the rows the user (or the template)
 * chose to leave out. Built-in "leave out" suggestions are not stored — the rules give them again.
 */
export function templateDecisions(drawings: Pick<DrawingInfo, 'id' | 'role' | 'dbOverride'>[], rows: LayerRow[], mapping: Map<string, MappingState>): TemplateRule[] {
  // A drawing written to another geodatabase than its map kind feeds is a one-off: its decisions are not learnt.
  const roleOf = new Map(drawings.filter((d) => !d.dbOverride || d.dbOverride === roleById(d.role).db).map((d) => [d.id, d.role]));
  const out: TemplateRule[] = [];
  for (const r of rows) {
    const role = roleOf.get(r.drawing);
    const m = mapping.get(r.key);
    if (!role || !roleById(role).db || !m || r.count === 0) continue;
    if (!m.target && m.source === 'auto') continue;
    out.push({ role, layer: compactName(r.layer), kind: r.kind, ...(r.colorKey ? { color: r.color.toLowerCase() } : {}), target: m.target, phanLoai: m.phanLoai });
  }
  return out;
}
