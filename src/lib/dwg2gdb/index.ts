// "Bóc tách DWG → CSDL TT16": the drawings of a planning folder (lấy ý kiến Sở Xây dựng) → HoSoGIS.
//   1. loadFolder: every main drawing + the xrefs they load (xrefs.ts).
//   2. analyzeDrawings: role of each drawing (title / file name), planning boundary, entities inside it, layer rows.
//   3. initialMapping: each row → TT16 class + phanLoai, from the saved template, else the built-in suggestions.
//   4. buildFeatures (features.ts) → planStage1 (plan.ts) → GDAL → "Chuẩn hóa TT16" (gdb/normalize.ts).
// Pure functions (no DOM): the worker src/workers/dwgTt16.worker.ts runs them, tests run them in Node.
import type { CadDocument, Vec2, XrefInsert } from '@/lib/cad/types';
import { drawingTexts, findBoundary, insideFlags, layerRows, pickBoundary, type BoundaryCandidate, type LayerRow } from './inventory';
import { guessRole, roleById, type RoleId } from './roles';
import { compactName, suggest } from './suggest';
import { templateLookup, type MappingEntry, type MappingTemplate, type TemplateRule } from './template';
import { placeXref, resolveXref, xrefNameRole, xrefOwners, type FolderFile, type MainDrawing } from './xrefs';

export * from './features';
export * from './inventory';
export * from './place';
export * from './plan';
export * from './qgis';
export * from './roles';
export * from './summary';
export * from './suggest';
export * from './template';
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
  const mains = cad.filter((f) => !isXrefName(f));
  const mainIds = new Set(mains.map((f) => f.id));
  const docs = new Map<string, CadDocument>();
  let done = 0;
  let total = mains.length;
  const read = async (f: FolderInput) => {
    onProgress?.(done, total, f.name);
    docs.set(f.id, await parse(f, await f.read()));
    done++;
  };
  for (const f of mains) await read(f);

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
}

export function analyzeDrawings(parsed: ParsedDrawing[]): Analysis {
  const boundary = pickBoundary(parsed.map((p) => findBoundary(p.doc)));
  const drawings: DrawingInfo[] = [];
  const rows: LayerRow[] = [];
  const inside = new Map<string, Uint8Array>();
  for (const p of parsed) {
    const g = p.owner ? { role: p.owner.role, title: null, year: null } : guessRole(p.name, drawingTexts(p.doc));
    const flags = insideFlags(p.doc, boundary?.ring ?? null);
    inside.set(p.id, flags);
    let n = 0;
    for (const f of flags) n += f;
    rows.push(...layerRows(p.id, p.doc, flags));
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
  return { drawings, rows, boundary, inside };
}

export interface MappingState extends MappingEntry {
  /** template = from the saved template; auto = built-in suggestion; manual = set by the user. */
  source: 'template' | 'auto' | 'manual';
  reason: string;
  /** Left unmapped because no rule applied (needs the user's eye). */
  unknown?: boolean;
}

/** Facts the suggestions need about a row (closed share, hatches on the same layer, numeric texts). */
function factsOf(row: LayerRow, rows: Map<string, LayerRow>) {
  const a = rows.get(`${row.drawing}\u0001${row.layer}\u0001A`);
  return {
    closedShare: row.kind === 'L' && row.count ? row.closed / row.count : 0,
    layerHasPolygons: !!a && a.count > 0,
    numericShare: row.numericShare,
  };
}

export function suggestRow(row: LayerRow, role: RoleId, rowsByKey: Map<string, LayerRow>): MappingState {
  const s = suggest(role, row.layer, row.kind, factsOf(row, rowsByKey));
  return { target: s.target, phanLoai: s.phanLoai, source: 'auto', reason: s.reason, unknown: s.unknown };
}

/** Mapping of every row: template first, else the built-in suggestion. */
export function initialMapping(a: Pick<Analysis, 'drawings' | 'rows'>, template: MappingTemplate | null): Map<string, MappingState> {
  const lookup = templateLookup(template);
  const roleOf = new Map(a.drawings.map((d) => [d.id, d.role]));
  const byKey = new Map(a.rows.map((r) => [r.key, r]));
  const out = new Map<string, MappingState>();
  for (const r of a.rows) {
    const role = roleOf.get(r.drawing) ?? 'other';
    const t = roleById(role).db ? lookup(role, r.layer, r.kind) : null;
    out.set(r.key, t ? { ...t, source: 'template', reason: 'Theo mẫu ghép đã lưu' } : suggestRow(r, role, byKey));
  }
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
export function templateDecisions(drawings: Pick<DrawingInfo, 'id' | 'role'>[], rows: LayerRow[], mapping: Map<string, MappingState>): TemplateRule[] {
  const roleOf = new Map(drawings.map((d) => [d.id, d.role]));
  const out: TemplateRule[] = [];
  for (const r of rows) {
    const role = roleOf.get(r.drawing);
    const m = mapping.get(r.key);
    if (!role || !roleById(role).db || !m || r.count === 0) continue;
    if (!m.target && m.source === 'auto') continue;
    out.push({ role, layer: compactName(r.layer), kind: r.kind, target: m.target, phanLoai: m.phanLoai });
  }
  return out;
}
