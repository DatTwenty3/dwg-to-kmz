// Minimal reader for Esri File Geodatabase (ArcGIS 10.x / Pro, table format version 3) — pure, no DOM.
// Enough to list feature datasets, feature classes, their fields and attribute values; geometries are skipped.
// Format notes follow the OpenFileGDB reverse-engineering (GDAL `filegdbtable.cpp`):
//   aXXXXXXXX.gdbtable  = header (40 B) + rows; field description section at the offset in the header.
//   aXXXXXXXX.gdbtablx  = row offsets (16 B header, `offsetSize` bytes per row, 0 = deleted row).
//   a00000001 = GDB_SystemCatalog (table id → name), a00000004 = GDB_Items (datasets/classes + XML definitions).

export type GdbFieldType =
  | 'int16'
  | 'int32'
  | 'float32'
  | 'float64'
  | 'string'
  | 'datetime'
  | 'objectid'
  | 'geometry'
  | 'binary'
  | 'raster'
  | 'guid'
  | 'globalid'
  | 'xml'
  | 'int64'
  | 'date'
  | 'time'
  | 'datetimeoffset';

const TYPE_CODES: GdbFieldType[] = [
  'int16',
  'int32',
  'float32',
  'float64',
  'string',
  'datetime',
  'objectid',
  'geometry',
  'binary',
  'raster',
  'guid',
  'globalid',
  'xml',
  'int64',
  'date',
  'time',
  'datetimeoffset',
];

export interface GdbField {
  name: string;
  alias: string;
  type: GdbFieldType;
  /** Max characters for strings, else 0. */
  length: number;
  nullable: boolean;
}

export type GdbValue = string | number | null;

export interface GdbTable {
  fields: GdbField[];
  /** Number of live (non-deleted) rows from the header. */
  rowCount: number;
  /** Rows as objects keyed by field name (ObjectID included, geometry/binary/raster omitted). */
  rows(limit?: number): Generator<Record<string, GdbValue>>;
}

export class GdbFormatError extends Error {}

class Cursor {
  constructor(
    readonly v: DataView,
    public p = 0,
  ) {}
  need(n: number) {
    if (this.p + n > this.v.byteLength) throw new GdbFormatError('Hết dữ liệu khi đọc bảng (file .gdb bị cắt cụt?)');
  }
  u8() {
    this.need(1);
    return this.v.getUint8(this.p++);
  }
  u16() {
    this.need(2);
    const x = this.v.getUint16(this.p, true);
    this.p += 2;
    return x;
  }
  i16() {
    this.need(2);
    const x = this.v.getInt16(this.p, true);
    this.p += 2;
    return x;
  }
  u32() {
    this.need(4);
    const x = this.v.getUint32(this.p, true);
    this.p += 4;
    return x;
  }
  i32() {
    this.need(4);
    const x = this.v.getInt32(this.p, true);
    this.p += 4;
    return x;
  }
  f32() {
    this.need(4);
    const x = this.v.getFloat32(this.p, true);
    this.p += 4;
    return x;
  }
  f64() {
    this.need(8);
    const x = this.v.getFloat64(this.p, true);
    this.p += 8;
    return x;
  }
  i64() {
    this.need(8);
    const x = Number(this.v.getBigInt64(this.p, true));
    this.p += 8;
    return x;
  }
  /** Unsigned LEB128 (7 bits per byte, little end first). */
  varuint() {
    let shift = 0;
    let x = 0;
    for (;;) {
      const b = this.u8();
      x += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return x;
      shift += 7;
      if (shift > 49) throw new GdbFormatError('Số nguyên mã hóa không hợp lệ');
    }
  }
  skip(n: number) {
    this.need(n);
    this.p += n;
  }
  utf16(chars: number) {
    this.need(chars * 2);
    let s = '';
    for (let i = 0; i < chars; i++) s += String.fromCharCode(this.v.getUint16(this.p + i * 2, true));
    this.p += chars * 2;
    return s;
  }
  utf8(bytes: number) {
    this.need(bytes);
    const s = utf8Decoder.decode(new Uint8Array(this.v.buffer, this.v.byteOffset + this.p, bytes));
    this.p += bytes;
    return s;
  }
  guid() {
    this.need(16);
    const b = new Uint8Array(this.v.buffer, this.v.byteOffset + this.p, 16);
    this.p += 16;
    const h = (i: number) => b[i].toString(16).padStart(2, '0');
    return `{${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}}`.toUpperCase();
  }
}

const utf8Decoder = new TextDecoder('utf-8');

function view(buf: ArrayBuffer | Uint8Array): DataView {
  return buf instanceof Uint8Array ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf);
}

/** Field description section. Throws GdbFormatError on unsupported layouts. */
function readFields(c: Cursor): GdbField[] {
  c.u32(); // section length
  const version = c.u32();
  if (version !== 4 && version !== 3) throw new GdbFormatError(`Phiên bản bảng ${version} chưa hỗ trợ`);
  c.u32(); // geometry type + flags
  const n = c.u16();
  const fields: GdbField[] = [];
  for (let i = 0; i < n; i++) {
    const name = c.utf16(c.u8());
    const alias = c.utf16(c.u8());
    const code = c.u8();
    const type = TYPE_CODES[code];
    if (!type) throw new GdbFormatError(`Kiểu trường ${code} (trường ${name}) chưa hỗ trợ`);
    let length = 0;
    let nullable = true;
    if (type === 'string') {
      length = c.i32();
      const flags = c.u8();
      nullable = (flags & 1) !== 0;
      if (flags & 4) c.skip(c.varuint());
    } else if (type === 'objectid' || type === 'binary' || type === 'guid' || type === 'globalid' || type === 'xml') {
      c.u8();
      nullable = (c.u8() & 1) !== 0;
    } else if (type === 'geometry') {
      c.u8();
      nullable = (c.u8() & 1) !== 0;
      skipGeometryDescription(c);
    } else if (type === 'raster') {
      c.u8();
      nullable = (c.u8() & 1) !== 0;
      c.utf16(c.u8()); // raster column
      const wkt = c.u16();
      c.skip(wkt);
      const flags = c.u8();
      if (flags) {
        // origin/scale/tolerance like geometry, without extent
        c.skip(8 * 3 + ((flags & 2) !== 0 ? 16 : 0) + ((flags & 4) !== 0 ? 16 : 0) + 8 + ((flags & 2) !== 0 ? 8 : 0) + ((flags & 4) !== 0 ? 8 : 0));
      }
      c.u8(); // raster type
    } else {
      c.u8(); // width
      const flags = c.u8();
      nullable = (flags & 1) !== 0;
      const defLen = c.u8();
      if (flags & 4) c.skip(defLen);
    }
    fields.push({ name, alias, type, length, nullable });
  }
  return fields;
}

function skipGeometryDescription(c: Cursor) {
  c.skip(c.u16()); // WKT (UTF-16, length in bytes)
  const flags = c.u8();
  const hasM = (flags & 2) !== 0;
  const hasZ = (flags & 4) !== 0;
  c.skip(24); // x/y origin, xy scale
  if (hasM) c.skip(16);
  if (hasZ) c.skip(16);
  c.skip(8); // xy tolerance
  if (hasM) c.skip(8);
  if (hasZ) c.skip(8);
  c.skip(32); // extent
  // Optional z/m ranges, then a 0 byte and 1–3 spatial-grid sizes. Probe instead of trusting the flags.
  for (const extra of [0, 16, 32]) {
    const at = c.p + extra;
    if (at + 5 > c.v.byteLength) break;
    const n = c.v.getUint32(at + 1, true);
    if (c.v.getUint8(at) === 0 && n >= 1 && n <= 3 && at + 5 + n * 8 <= c.v.byteLength) {
      c.p = at + 5 + n * 8;
      return;
    }
  }
  throw new GdbFormatError('Không đọc được mô tả trường hình học');
}

/** Row offsets from the .gdbtablx (handles the sparse-block bitmap of large tables). */
function readOffsets(tablx: DataView): number[] {
  const c = new Cursor(tablx);
  c.u32();
  const blocks = c.u32();
  const total = c.u32();
  const size = c.u32();
  if (size < 4 || size > 6) throw new GdbFormatError('Chỉ mục dòng (.gdbtablx) không hợp lệ');
  const read = (i: number) => {
    const at = 16 + i * size;
    let x = 0;
    for (let k = size - 1; k >= 0; k--) x = x * 256 + tablx.getUint8(at + k);
    return x;
  };
  const stored = blocks * 1024;
  const out: number[] = [];
  // Trailer after the offset array: bitmap of which 1024-row blocks are present (absent when dense).
  const trailer = 16 + stored * size;
  const bitmapWords = trailer + 4 <= tablx.byteLength ? tablx.getUint32(trailer, true) : 0;
  if (!bitmapWords || stored >= total) {
    for (let i = 0; i < Math.min(total, stored); i++) out.push(read(i));
    return out;
  }
  let slot = 0;
  const bits = trailer + 16;
  for (let block = 0; block * 1024 < total; block++) {
    const present = (tablx.getUint8(bits + (block >> 3)) >> (block & 7)) & 1;
    for (let k = 0; k < 1024 && block * 1024 + k < total; k++) out.push(present ? read(slot * 1024 + k) : 0);
    if (present) slot++;
  }
  return out;
}

export function readTable(tableBuf: ArrayBuffer | Uint8Array, tablxBuf: ArrayBuffer | Uint8Array): GdbTable {
  const tv = view(tableBuf);
  const head = new Cursor(tv);
  const magic = head.u32();
  if (magic !== 3) throw new GdbFormatError(magic === 4 ? 'Bảng dạng 64-bit (ArcGIS Pro 3.2+) chưa hỗ trợ' : 'Không phải file .gdbtable');
  const rowCount = head.u32();
  head.skip(24);
  const fieldsAt = Number(tv.getBigUint64(32, true));
  const fields = readFields(new Cursor(tv, fieldsAt));
  const offsets = readOffsets(view(tablxBuf));
  const nullableCount = fields.filter((f) => f.nullable && f.type !== 'objectid').length;

  function* rows(limit = Infinity): Generator<Record<string, GdbValue>> {
    let yielded = 0;
    for (let i = 0; i < offsets.length && yielded < limit; i++) {
      const off = offsets[i];
      if (!off) continue;
      const c = new Cursor(tv, off);
      c.u32(); // row size
      const flagsAt = c.p;
      c.skip(Math.ceil(nullableCount / 8));
      let bit = 0;
      const row: Record<string, GdbValue> = {};
      for (const f of fields) {
        if (f.type === 'objectid') {
          row[f.name] = i + 1;
          continue;
        }
        if (f.nullable) {
          const isNull = (tv.getUint8(flagsAt + (bit >> 3)) >> (bit & 7)) & 1;
          bit++;
          if (isNull) {
            row[f.name] = null;
            continue;
          }
        }
        switch (f.type) {
          case 'int16':
            row[f.name] = c.i16();
            break;
          case 'int32':
            row[f.name] = c.i32();
            break;
          case 'float32':
            row[f.name] = c.f32();
            break;
          case 'float64':
          case 'datetime':
          case 'date':
          case 'time':
            row[f.name] = c.f64();
            break;
          case 'int64':
            row[f.name] = c.i64();
            break;
          case 'datetimeoffset':
            row[f.name] = c.f64();
            c.skip(2);
            break;
          case 'string':
          case 'xml':
            row[f.name] = c.utf8(c.varuint());
            break;
          case 'guid':
          case 'globalid':
            row[f.name] = c.guid();
            break;
          case 'geometry':
          case 'binary':
            c.skip(c.varuint());
            break;
          case 'raster':
            throw new GdbFormatError('Bảng có trường raster chưa hỗ trợ');
        }
      }
      yielded++;
      yield row;
    }
  }

  return { fields, rowCount, rows };
}

/** Physical file name of table #id: a00000001, a0000006f… */
export const tableFileName = (id: number) => `a${id.toString(16).padStart(8, '0')}`;
