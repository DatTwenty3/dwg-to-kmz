// State of one file open on the map (the map page can stack several).
import type { CadDocument, CrsOptions } from '@/lib/cad/types';
import type { LayerStyles } from '@/lib/cad/style';
import type { LocationCheck } from '@/lib/geo';
import type { ProvinceGuess } from '@/lib/map';
import { DEFAULT_FORM, type CrsForm } from './crsForm';

export type FileStatus = 'parsing' | 'transforming' | 'ready' | 'error';

export interface OpenFile {
  /** Stable id; also the worker `docId` and the deck layer-id prefix. */
  id: string;
  fileName: string;
  /** Colour tag in the file list. */
  tag: string;
  /** Parsed document in drawing coordinates (CAD) or WGS84 (KML/KMZ). */
  rawDoc: CadDocument | null;
  /** Document in WGS84 for the map. */
  doc: CadDocument | null;
  activeCrs: CrsOptions | null;
  form: CrsForm;
  provinceId: string;
  provinceGuess: ProvinceGuess | null;
  check: LocationCheck | null;
  /** Visible CAD layers. */
  visible: Set<string>;
  styles: LayerStyles;
  /** 0..1 */
  opacity: number;
  /** File-level eye toggle. */
  shown: boolean;
  timing: { parse?: number; transform?: number };
  status: FileStatus;
  error: string | null;
  progress: { stage: string; percent: number } | null;
  /** A file added later got its CRS automatically: the user should confirm (note says how it was chosen). */
  needsConfirm: boolean;
  crsNote: string | null;
}

export function createOpenFile(id: string, fileName: string, tag: string): OpenFile {
  return {
    id,
    fileName,
    tag,
    rawDoc: null,
    doc: null,
    activeCrs: null,
    form: DEFAULT_FORM,
    provinceId: '',
    provinceGuess: null,
    check: null,
    visible: new Set(),
    styles: {},
    opacity: 1,
    shown: true,
    timing: {},
    status: 'parsing',
    error: null,
    progress: { stage: 'Đọc file', percent: 0 },
    needsConfirm: false,
    crsNote: null,
  };
}

/** Short name of a drawing CRS for measurement rows ("VN-2000", "UTM", ...). */
export function drawingCrsLabel(crs: CrsOptions | null): string {
  if (!crs) return 'hệ bản vẽ';
  if (/\+k=0\.9999\b/.test(crs.proj4) && /\+towgs84=-191\.9/.test(crs.proj4)) return 'VN-2000';
  if (/\+proj=utm/.test(crs.proj4)) return 'UTM';
  return 'hệ bản vẽ';
}
