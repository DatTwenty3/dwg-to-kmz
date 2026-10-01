// DXF → CadDocument. dxf-parser provides the section/block framework; every entity is captured as
// raw group codes by our own handlers (dxf-parser 1.1.2 lacks HATCH, ATTRIB, ACAD_TABLE, true colour…).
import * as DxfParserModule from 'dxf-parser';
import type { CadDocument } from '../types';
import { type BuildOptions, buildDocument } from '../normalize/build';
import { type SrcBlock, type SrcColor, type SrcDocument, type SrcLayer, insunitsToName } from '../normalize/source';
import { codepageToEncoding, decodeDxfBytes } from './bytes';
import { type ConvertContext, convertRawList } from './entities';
import { type RawEntity, makeRawHandler } from './groups';

export { decodeDxfBytes } from './bytes';
export { parseHatchLoops, parseTable } from './entities';

type DxfParserCtor = typeof DxfParserModule.DxfParser;
type HandlerCtor = Parameters<InstanceType<DxfParserCtor>['registerEntityHandler']>[0];

function parserCtor(): DxfParserCtor {
  const m = DxfParserModule as unknown as { DxfParser?: DxfParserCtor; default?: DxfParserCtor | { DxfParser?: DxfParserCtor } };
  if (typeof m.DxfParser === 'function') return m.DxfParser;
  if (typeof m.default === 'function') return m.default;
  if (m.default && typeof (m.default as { DxfParser?: DxfParserCtor }).DxfParser === 'function') {
    return (m.default as { DxfParser: DxfParserCtor }).DxfParser;
  }
  throw new Error('Không nạp được thư viện dxf-parser.');
}

const STRUCTURAL = new Set(['SECTION', 'ENDSEC', 'ENDBLK', 'EOF', 'BLOCK', 'TABLE', 'ENDTAB']);

interface Structure {
  entityNames: Set<string>;
  layers: { name: string; aci: number; rgb?: number; flags: number }[];
  styles: Map<string, string>;
  insunits?: number;
}

/** One pass over the group pairs: entity type names, LAYER and STYLE tables, $INSUNITS. */
function scanStructure(lines: string[]): Structure {
  const entityNames = new Set<string>();
  const layers: Structure['layers'] = [];
  const styles = new Map<string, string>();
  let insunits: number | undefined;
  let section = '';
  let expectSectionName = false;
  let record = '';
  let layer: Structure['layers'][number] | null = null;
  let style: { name: string; font: string; big: string } | null = null;
  let headerVar = '';
  const flush = () => {
    if (layer && layer.name) layers.push(layer);
    if (style && style.name) styles.set(style.name, (style.font || style.big).trim());
    layer = null;
    style = null;
  };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    const value = lines[i + 1].trim();
    if (code === 0) {
      flush();
      if (value === 'SECTION') {
        expectSectionName = true;
        continue;
      }
      if (value === 'ENDSEC') {
        section = '';
        continue;
      }
      if (value === 'EOF') break;
      record = value;
      if (section === 'TABLES') {
        if (value === 'LAYER') layer = { name: '', aci: 7, flags: 0 };
        else if (value === 'STYLE') style = { name: '', font: '', big: '' };
      } else if (section === 'ENTITIES' || section === 'BLOCKS') {
        if (!STRUCTURAL.has(value)) entityNames.add(value);
      }
      continue;
    }
    if (expectSectionName && code === 2) {
      section = value;
      expectSectionName = false;
      continue;
    }
    if (section === 'HEADER') {
      if (code === 9) headerVar = value;
      else if (headerVar === '$INSUNITS' && code === 70) insunits = parseInt(value, 10);
      continue;
    }
    if (section === 'TABLES') {
      if (record === 'LAYER' && layer) {
        if (code === 2) layer.name = value;
        else if (code === 62) layer.aci = parseInt(value, 10);
        else if (code === 420) layer.rgb = parseInt(value, 10) & 0xffffff;
        else if (code === 70) layer.flags = parseInt(value, 10);
      } else if (record === 'STYLE' && style) {
        if (code === 2) style.name = value;
        else if (code === 3) style.font = value;
        else if (code === 4) style.big = value;
      }
    }
  }
  flush();
  return { entityNames, layers, styles, insunits };
}

/** \U+XXXX escapes (used by R2000–R2004 for non-codepage characters in names). */
function unescapeUnicode(s: string): string {
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export async function parseDxfBuffer(data: ArrayBuffer, opts: BuildOptions = {}): Promise<CadDocument> {
  opts.onProgress?.('Đọc file DXF', 5);
  const decoded = decodeDxfBytes(data);
  const lines = decoded.text.split(/\r\n|\r|\n/g);
  const st = scanStructure(lines);

  // Names (layers) in legacy files are byte strings: decode them with the codepage for display.
  const enc = decoded.legacyBytes ? codepageToEncoding(decoded.codepage) ?? 'windows-1252' : undefined;
  const nameDecoder = enc ? new TextDecoder(enc) : null;
  const nameCache = new Map<string, string>();
  const layerName = (raw: string): string => {
    let v = nameCache.get(raw);
    if (v === undefined) {
      let t = raw;
      if (nameDecoder && /[\x80-\xff]/.test(raw)) {
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
        t = nameDecoder.decode(bytes);
      }
      v = unescapeUnicode(t).normalize('NFC');
      nameCache.set(raw, v);
    }
    return v;
  };

  const Parser = parserCtor();
  const parser = new Parser();
  for (const name of st.entityNames) parser.registerEntityHandler(makeRawHandler(name) as unknown as HandlerCtor);
  opts.onProgress?.('Phân tích DXF', 20);
  let dxf: ReturnType<InstanceType<DxfParserCtor>['parseSync']>;
  try {
    dxf = parser.parseSync(decoded.text);
  } catch (err) {
    throw new Error(`File DXF không hợp lệ: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!dxf) throw new Error('File DXF rỗng hoặc không hợp lệ.');

  const ctx: ConvertContext = { layerName, paperSpace: 0 };
  const blocks = new Map<string, SrcBlock>();
  for (const [key, b] of Object.entries(dxf.blocks ?? {})) {
    const name = b.name ?? key;
    if (/^\*(model|paper)_space/i.test(name)) continue;
    const ents = (b.entities ?? []) as unknown as RawEntity[];
    blocks.set(name, {
      name,
      base: [b.position?.x ?? 0, b.position?.y ?? 0],
      entities: convertRawList(ents, ctx, false),
    });
  }
  const entities = convertRawList((dxf.entities ?? []) as unknown as RawEntity[], ctx, true);

  const warnings: string[] = [];
  if (ctx.paperSpace > 0) {
    warnings.push(`Đã bỏ qua ${ctx.paperSpace} đối tượng ở Paper Space (layout/khung in) — chỉ hiển thị Model Space.`);
  }

  const layers: SrcLayer[] = st.layers.map((l) => {
    const color: SrcColor = l.rgb !== undefined ? { aci: Math.abs(l.aci) || 7, rgb: l.rgb } : { aci: Math.abs(l.aci) || 7 };
    return { name: layerName(l.name), color, visible: l.aci >= 0 && (l.flags & 1) === 0 };
  });

  const header = (dxf.header ?? {}) as Record<string, unknown>;
  const insunits = typeof header['$INSUNITS'] === 'number' ? (header['$INSUNITS'] as number) : st.insunits;
  const src: SrcDocument = {
    units: insunitsToName(insunits),
    codepage: decoded.codepage,
    legacyBytes: decoded.legacyBytes,
    layers,
    styles: st.styles,
    blocks,
    entities,
    warnings,
  };
  opts.onProgress?.('Chuyển đổi đối tượng', 50);
  return buildDocument(src, opts);
}
