// Raw DXF group-code entities, captured through dxf-parser's entity-handler extension point.
import type DxfArrayScanner from 'dxf-parser/dist/DxfArrayScanner';
import type { IGroup } from 'dxf-parser/dist/DxfArrayScanner';

export type GroupValue = string | number | boolean;

export interface Group {
  code: number;
  value: GroupValue;
}

/** What our handler returns to dxf-parser for every entity type. */
export interface RawEntity {
  type: string;
  /** Set by dxf-parser's ensureHandle when the entity has no handle (we keep our own copy). */
  handle?: string | number;
  groups: Group[];
}

/** Codes whose string values must keep leading/trailing spaces (text and MTEXT chunks). */
const UNTRIMMED_CODES = new Set([1, 3]);

interface ScannerInternals {
  _data?: string[];
  _pointer?: number;
}

/**
 * dxf-parser trims every value; text chunks (e.g. MTEXT group 3 split at 250 chars) may legitimately
 * end with a space. Recover the untrimmed line from the scanner's line buffer when available.
 */
function untrimmed(scanner: DxfArrayScanner, fallback: GroupValue): GroupValue {
  const s = scanner as unknown as ScannerInternals;
  if (Array.isArray(s._data) && typeof s._pointer === 'number') {
    const line = s._data[s._pointer - 1];
    if (typeof line === 'string' && line.trim() === String(fallback)) return line;
  }
  return fallback;
}

/** Handler class compatible with `DxfParser.registerEntityHandler`. */
export function makeRawHandler(name: string) {
  return class RawHandler {
    ForEntityName = name;
    parseEntity(scanner: DxfArrayScanner, curr: IGroup): RawEntity {
      const groups: Group[] = [];
      const entity: RawEntity = { type: String(curr.value), groups };
      let g = scanner.next();
      while (!scanner.isEOF() && g.code !== 0) {
        groups.push({ code: g.code, value: UNTRIMMED_CODES.has(g.code) ? untrimmed(scanner, g.value) : g.value });
        if (g.code === 5 && entity.handle === undefined) entity.handle = String(g.value);
        g = scanner.next();
      }
      return entity;
    }
  };
}

/** Sequential reader over an entity's groups. */
export class Cursor {
  i = 0;
  constructor(readonly g: Group[]) {}
  get done(): boolean {
    return this.i >= this.g.length;
  }
  peek(): Group | undefined {
    return this.g[this.i];
  }
  next(): Group | undefined {
    return this.g[this.i++];
  }
  /** Consume the current group if it has `code`. */
  take(code: number): GroupValue | undefined {
    const g = this.g[this.i];
    if (g && g.code === code) {
      this.i++;
      return g.value;
    }
    return undefined;
  }
  num(code: number, d = 0): number {
    const v = this.take(code);
    return toNum(v, d);
  }
  /** Advance until a group with one of `codes` is current (not consumed). Returns false at end. */
  seek(...codes: number[]): boolean {
    while (this.i < this.g.length) {
      if (codes.includes(this.g[this.i].code)) return true;
      this.i++;
    }
    return false;
  }
}

export function toNum(v: GroupValue | undefined, d = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return d;
}

/** First-occurrence lookup table. */
export function firstValues(groups: Group[]): Map<number, GroupValue> {
  const m = new Map<number, GroupValue>();
  for (const g of groups) if (!m.has(g.code)) m.set(g.code, g.value);
  return m;
}
