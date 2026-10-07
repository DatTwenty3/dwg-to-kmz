// Flat, numbered list of everything the checker found (UI table, CSV and PDF reports share it).
import type { ClassReport, DatasetReport, GdbReport, Level, SubmissionReport } from './check';

/** Pseudo dataset key for classes outside every feature dataset. */
export const ROOT = '(ngoài nhóm)';

/** Scope: the whole geodatabase, one dataset, or one class. */
export type Selection = { ds: string | null; cls: string | null };

export interface Row {
  level: Level;
  /** "Feature Class" / "Feature Dataset" / "Geodatabase" / "Hồ sơ". */
  kind: string;
  name: string;
  field?: string;
  text: string;
  ds: string | null;
  cls: string | null;
}

function classRows(c: ClassReport, ds: string | null): Row[] {
  const name = c.actualName ?? c.name;
  if (c.status === 'absent')
    return [{ level: 'info', kind: 'Feature Class', name: c.name, text: 'chưa có (lớp trong danh mục tham khảo, không bắt buộc).', ds, cls: c.name }];
  const out: Row[] = c.issues.map((i) => ({ level: i.level, kind: 'Feature Class', name, text: i.text, ds, cls: c.name }));
  for (const f of c.fields)
    for (const i of f.issues) out.push({ level: i.level, kind: 'Feature Class', name, field: f.actual?.name ?? f.name, text: i.text, ds, cls: c.name });
  return out;
}

export function rowsFor(rep: SubmissionReport, g: GdbReport, sel: Selection): Row[] {
  const out: Row[] = [];
  const dsKey = (d: DatasetReport) => d.actualName ?? d.name;
  if (!sel.ds && !sel.cls) {
    for (const i of rep.issues) out.push({ level: i.level, kind: 'Hồ sơ', name: rep.folder?.name ?? 'HoSoGIS', text: i.text, ds: null, cls: null });
    for (const i of g.issues) out.push({ level: i.level, kind: 'Geodatabase', name: g.fileName, text: i.text, ds: null, cls: null });
  }
  for (const d of g.datasets) {
    if (sel.ds && sel.ds !== dsKey(d)) continue;
    if (!sel.cls) for (const i of d.issues) out.push({ level: i.level, kind: 'Feature Dataset', name: dsKey(d), text: i.text, ds: dsKey(d), cls: null });
    for (const c of d.classes) if (!sel.cls || sel.cls === c.name) out.push(...classRows(c, dsKey(d)));
  }
  if (!sel.ds || sel.ds === ROOT) for (const c of g.rootClasses) if (!sel.cls || sel.cls === c.name) out.push(...classRows(c, ROOT));
  return out;
}
