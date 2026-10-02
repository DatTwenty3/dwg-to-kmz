// LEDAT-GIS session file (.ldg): the whole working session in one portable file — open drawings (original
// DWG/DXF/KMZ/KML bytes, so they re-open exactly), each drawing's CRS / visible layers / styles / opacity, the
// sketches, map name, description and basemap. A ZIP (jszip, as for KMZ):
//   manifest.json      — SessionManifest
//   files/<i>-<name>   — original file bytes
// Opening a file someone sent is untrusted input: everything read back is validated and sanitised.
import JSZip from 'jszip';
import { fromWire, toWire, type SharedMap } from './share';
import type { LayerStyles } from './style';
import type { CrsOptions, DashStyle, LayerStyle } from './types';

export const SESSION_EXT = '.ldg';
export const SESSION_FORMAT = 'ledat-gis-session';
export const SESSION_VERSION = 1;
const MANIFEST = 'manifest.json';
const SOURCE_EXT = /\.(dwg|dxf|kmz|kml)$/i;
const MAX_FILES = 50;

export interface SessionFile {
  name: string;
  bytes: Uint8Array;
  /** CRS the drawing was shown with (null: not set yet; KML/KMZ are WGS84 already). */
  crs: CrsOptions | null;
  provinceId: string;
  /** Visible layer names. */
  visible: string[];
  styles: LayerStyles;
  opacity: number;
  shown: boolean;
}

export interface Session {
  /** Map name, description, basemap and sketches. */
  map: SharedMap;
  sketchLayer: { shown: boolean; opacity: number };
  /** Drawing order as in the file list (first = on top). */
  files: SessionFile[];
  /** Index of the file selected in the panel. */
  active: number;
  savedAt: string;
}

interface ManifestFile extends Omit<SessionFile, 'bytes'> {
  path: string;
  size: number;
}
interface SessionManifest {
  format: typeof SESSION_FORMAT;
  version: number;
  app: 'LEDAT-GIS';
  savedAt: string;
  map: ReturnType<typeof toWire>;
  sketchLayer: Session['sketchLayer'];
  files: ManifestFile[];
  active: number;
}

/** File-name-safe version of a name inside the archive. */
const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(-120) || 'file';

export async function writeSession(s: Session): Promise<Blob> {
  const zip = new JSZip();
  const files: ManifestFile[] = s.files.map((f, i) => {
    const path = `files/${i}-${safeName(f.name)}`;
    zip.file(path, f.bytes);
    const { bytes, ...rest } = f;
    return { ...rest, path, size: bytes.length };
  });
  const manifest: SessionManifest = {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    app: 'LEDAT-GIS',
    savedAt: s.savedAt,
    map: toWire(s.map),
    sketchLayer: s.sketchLayer,
    files,
    active: s.active,
  };
  zip.file(MANIFEST, JSON.stringify(manifest, null, 1));
  // Drawings are mostly compressible text/binary; level 6 keeps saving quick for 50 MB files.
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
}

export class SessionError extends Error {}

/** Reads a .ldg file. Throws `SessionError` with a Vietnamese message when it is not a valid session. */
export async function readSession(data: Blob | ArrayBuffer | Uint8Array): Promise<Session> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new SessionError('File .ldg bị hỏng hoặc không phải phiên làm việc LEDAT-GIS.');
  }
  const entry = zip.file(MANIFEST);
  if (!entry) throw new SessionError('File .ldg không có thông tin phiên làm việc (manifest.json).');
  let m: Partial<SessionManifest>;
  try {
    m = JSON.parse(await entry.async('string')) as Partial<SessionManifest>;
  } catch {
    throw new SessionError('Thông tin phiên làm việc trong file .ldg bị hỏng.');
  }
  if (m.format !== SESSION_FORMAT) throw new SessionError('File .ldg không phải phiên làm việc LEDAT-GIS.');
  if (typeof m.version !== 'number' || m.version > SESSION_VERSION) {
    throw new SessionError('File .ldg được tạo bởi phiên bản LEDAT-GIS mới hơn — hãy tải lại trang rồi thử lại.');
  }

  const map = fromWire(m.map) ?? { title: 'Bản đồ chưa đặt tên', features: [] };
  const files: SessionFile[] = [];
  for (const f of Array.isArray(m.files) ? m.files.slice(0, MAX_FILES) : []) {
    if (!f || typeof f !== 'object' || typeof f.path !== 'string' || typeof f.name !== 'string') continue;
    const bytes = await zip.file(f.path)?.async('uint8array');
    if (!bytes || !SOURCE_EXT.test(f.name)) continue;
    files.push({
      name: f.name.slice(0, 255),
      bytes,
      crs: cleanCrs(f.crs),
      provinceId: typeof f.provinceId === 'string' ? f.provinceId.slice(0, 64) : '',
      visible: Array.isArray(f.visible) ? f.visible.filter((v): v is string => typeof v === 'string') : [],
      styles: cleanStyles(f.styles),
      opacity: clamp01(f.opacity, 1),
      shown: f.shown !== false,
    });
  }
  const sl = m.sketchLayer as Partial<Session['sketchLayer']> | undefined;
  return {
    map,
    sketchLayer: { shown: sl?.shown !== false, opacity: clamp01(sl?.opacity, 1) },
    files,
    active: Number.isInteger(m.active) && (m.active as number) >= 0 && (m.active as number) < files.length ? (m.active as number) : 0,
    savedAt: typeof m.savedAt === 'string' ? m.savedAt : '',
  };
}

const clamp01 = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt);

function cleanCrs(raw: unknown): CrsOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<CrsOptions>;
  if (typeof c.proj4 !== 'string' || c.proj4.length > 2000 || !c.proj4.trim()) return null;
  const unitScale = typeof c.unitScale === 'number' && Number.isFinite(c.unitScale) && c.unitScale > 0 ? c.unitScale : 1;
  const offset =
    Array.isArray(c.offset) && c.offset.length === 2 && c.offset.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? ([c.offset[0], c.offset[1]] as [number, number])
      : undefined;
  return { proj4: c.proj4, swapXY: c.swapXY === true, unitScale, ...(offset ? { offset } : {}) };
}

const DASHES: DashStyle[] = ['solid', 'dashed', 'dotted', 'dashdot'];

function cleanStyles(raw: unknown): LayerStyles {
  const out: LayerStyles = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [layer, v] of Object.entries(raw as Record<string, unknown>).slice(0, 5000)) {
    if (!v || typeof v !== 'object') continue;
    const s = v as Record<string, unknown>;
    const style: LayerStyle = {};
    if (typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) style.color = s.color;
    if (typeof s.width === 'number' && Number.isFinite(s.width)) style.width = Math.min(20, Math.max(0.5, s.width));
    if (typeof s.dash === 'string' && DASHES.includes(s.dash as DashStyle)) style.dash = s.dash as DashStyle;
    if (typeof s.fillOpacity === 'number' && Number.isFinite(s.fillOpacity)) style.fillOpacity = clamp01(s.fillOpacity, 1);
    if (Object.keys(style).length) out[layer] = style;
  }
  return out;
}
