// Xrefs of a planning folder. The main maps often hold little of their own: the road network of QH07 lives in
// "Xr_nen giao thong.dwg", the survey base of QH02 in "Xr_Nen Hien Trang.dwg"… Each referenced file is read once
// and given to ONE main drawing (its "owner"), whose role then applies to its layers: the one whose kind matches
// the xref's own name ("Xr_nen giao thong" → the giao thông map), else a land use map, else the first one.
import type { CadDocument, CadEntity, Vec2, XrefInsert } from '@/lib/cad/types';
import { foldVietnamese } from '@/lib/geo/provinces';
import { guessRole, roleById, type RoleId } from './roles';

export interface FolderFile {
  id: string;
  /** File name ("Xr_Mat nuoc.dwg"). */
  name: string;
  /** Path in the dropped folder ("4. QH_HA TANG/Xr_Mat nuoc.dwg"). */
  path: string;
  /** Bytes; copies of the same xref in several sub-folders (same name and size) are read once. */
  size?: number;
}

const dirOf = (p: string) => p.replace(/[^/]*$/, '');
export const fileStem = (name: string) => foldVietnamese(name.replace(/^.*[\\/]/, '').replace(/\.(dwg|dxf)$/i, ''));

/** The file an xref name points to: same folder as the host first, else anywhere in the folder. */
export function resolveXref(xrefName: string, hostPath: string, files: FolderFile[]): FolderFile | null {
  const want = fileStem(xrefName);
  const same = files.filter((f) => /\.dwg$/i.test(f.name) && fileStem(f.name) === want);
  const hit = same.find((f) => dirOf(f.path) === dirOf(hostPath)) ?? same[0] ?? null;
  // The same file copied into several sub-folders: always the first copy.
  return (hit && hit.size !== undefined && same.find((f) => f.size === hit.size)) || hit;
}

/** Role suggested by the xref's own name, without its "Xr_" prefix ("Xr_nen giao thong" → giao thông). */
export function xrefNameRole(name: string): RoleId {
  const bare = name.replace(/\.(dwg|dxf)$/i, '').replace(/^(xref|xr)[\s_-]*/i, '');
  return guessRole(bare, []).role;
}

export interface MainDrawing {
  id: string;
  role: RoleId;
  year: number | null;
}

/**
 * Owner of each xref file. `reach` = xref file id → main drawings that load it (directly or through another xref).
 */
export function xrefOwners(reach: Map<string, MainDrawing[]>, xrefFiles: Map<string, FolderFile>): Map<string, MainDrawing> {
  const out = new Map<string, MainDrawing>();
  for (const [id, mains] of reach) {
    const f = xrefFiles.get(id);
    const useful = mains.filter((m) => roleById(m.role).db);
    if (!f || !useful.length) continue;
    const named = xrefNameRole(f.name);
    const hien = /hien ?trang/.test(foldVietnamese(f.name));
    const score = (m: MainDrawing) =>
      (m.role === named ? 100 : 0) + (m.role === (hien ? 'ht-sdd' : 'qh-sdd') ? 50 : 0) + (m.role === 'ht-sdd' || m.role === 'qh-sdd' ? 20 : 0) + (m.year ?? 0) / 1000;
    out.set(id, [...useful].sort((a, b) => score(b) - score(a))[0]);
  }
  return out;
}

const isIdentity = (x: XrefInsert) =>
  Math.hypot(x.position[0], x.position[1]) < 0.01 && Math.abs(x.scale[0] - 1) < 1e-9 && Math.abs(x.scale[1] - 1) < 1e-9 && Math.abs(x.rotation % 360) < 1e-9;

/** The xref content placed by its INSERT (unchanged when attached at 0,0 scale 1 — the usual case). */
export function placeXref(doc: CadDocument, ins: XrefInsert): CadDocument {
  if (isIdentity(ins)) return doc;
  const r = (ins.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const f = ([x, y]: Vec2): Vec2 => {
    const sx = x * ins.scale[0];
    const sy = y * ins.scale[1];
    return [ins.position[0] + sx * cos - sy * sin, ins.position[1] + sx * sin + sy * cos];
  };
  const s = Math.sqrt(Math.abs(ins.scale[0] * ins.scale[1]));
  const map = (e: CadEntity): CadEntity => {
    switch (e.kind) {
      case 'polyline':
        return { ...e, points: e.points.map(f) };
      case 'polygon':
        return { ...e, rings: e.rings.map((ring) => ring.map(f)) };
      case 'text':
        return { ...e, position: f(e.position), height: e.height * s, rotation: e.rotation + ins.rotation };
      case 'point':
        return { ...e, position: f(e.position) };
      case 'table':
        return { ...e, origin: f(e.origin), rotation: e.rotation + ins.rotation };
    }
  };
  return { ...doc, entities: doc.entities.map(map), bbox: [f(doc.bbox[0]), f(doc.bbox[1])] };
}
