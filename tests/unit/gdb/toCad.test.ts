import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import type { GdbEntry } from '@/lib/gdb';
import { decodeShape, groupRings, ringArea } from '@/lib/gdb/shape';
import { crsFromWkt, gdbToCad } from '@/lib/gdb/toCad';
import { WGS84_PROJ4 } from '@/lib/geo/crs';
import { FIXTURE_HOSOGIS } from '../fixtures';

function walk(dir: string, root: string, out: GdbEntry[] = []): GdbEntry[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else out.push({ path: relative(root, p).replace(/\\/g, '/'), read: async () => readFileSync(p) });
  }
  return out;
}

const G = { xOrigin: -5122600, yOrigin: -10001100, xyScale: 10000, hasZ: false, hasM: false };
/** Unsigned LEB128. */
const vu = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
};
/** FileGDB signed varint (sign in bit 6 of the first byte). */
const vs = (n: number): number[] => {
  const neg = n < 0;
  let a = Math.abs(n);
  const out = [(a & 0x3f) | (neg ? 0x40 : 0)];
  a = Math.floor(a / 64);
  if (a > 0) out[0] |= 0x80;
  while (a > 0) {
    let b = a % 128;
    a = Math.floor(a / 128);
    if (a > 0) b |= 0x80;
    out.push(b);
  }
  return out;
};
const enc = (x: number, origin: number) => Math.round((x - origin) * G.xyScale);

describe('decodeShape', () => {
  it('decodes a point', () => {
    const blob = new Uint8Array([...vu(1), ...vu(enc(580000, G.xOrigin) + 1), ...vu(enc(1107000, G.yOrigin) + 1)]);
    const s = decodeShape(blob, G)!;
    expect(s.type).toBe('point');
    if (s.type === 'point') {
      expect(s.points[0][0]).toBeCloseTo(580000, 3);
      expect(s.points[0][1]).toBeCloseTo(1107000, 3);
    }
  });

  it('decodes a two-part polyline (delta-encoded, part sizes)', () => {
    const pts = [
      [580000, 1107000],
      [580010, 1107005],
      [580020, 1107000],
      [580100, 1107100],
      [580090, 1107090],
    ];
    const bytes = [...vu(3), ...vu(pts.length), ...vu(2), 0, 0, 0, 0, ...vu(3)];
    let px = 0;
    let py = 0;
    for (const [x, y] of pts) {
      const ex = enc(x, G.xOrigin);
      const ey = enc(y, G.yOrigin);
      bytes.push(...vs(ex - px), ...vs(ey - py));
      [px, py] = [ex, ey];
    }
    const s = decodeShape(new Uint8Array(bytes), G)!;
    expect(s.type).toBe('line');
    if (s.type === 'line') {
      expect(s.parts.map((p) => p.length)).toEqual([3, 2]);
      expect(s.parts[1][1][0]).toBeCloseTo(580090, 3);
      expect(s.parts[0][1][1]).toBeCloseTo(1107005, 3);
    }
  });

  it('groups clockwise outer rings with their counter-clockwise holes', () => {
    const outer: [number, number][] = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ]; // clockwise
    const hole: [number, number][] = [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
      [2, 2],
    ]; // counter-clockwise
    expect(ringArea(outer)).toBeLessThan(0);
    expect(groupRings([outer, hole])).toEqual([[outer, hole]]);
    expect(groupRings([outer, outer.map(([x, y]) => [x + 20, y] as [number, number])])).toHaveLength(2);
  });

  it('maps VN-2000 WKT to the app proj4 definition', () => {
    const wkt =
      'PROJCS["VN_2000_Tra_Vinh_3deg",GEOGCS["GCS_VN_2000"],PROJECTION["Transverse_Mercator"],PARAMETER["Central_Meridian",105.5],PARAMETER["Scale_Factor",0.9999]]';
    expect(crsFromWkt(wkt)).toMatch(/\+lon_0=105.5 \+k=0.9999/);
  });
});

describe.skipIf(!existsSync(FIXTURE_HOSOGIS))('gdbToCad on the real HoSoGIS', () => {
  it('draws every geodatabase in VN-2000 105°30\' at Nhị Long', async () => {
    const doc = await gdbToCad(walk(FIXTURE_HOSOGIS, join(FIXTURE_HOSOGIS, '..')));
    expect(doc.crs).toMatch(/\+lon_0=105.5/);
    expect(doc.layers.map((l) => l.name)).toContain('HienTrang · ChucNangSuDungDat_A');
    const land = doc.entities.filter((e) => e.layer === 'HienTrang · ChucNangSuDungDat_A');
    expect(land.length).toBeGreaterThanOrEqual(892);
    expect(land.every((e) => e.kind === 'polygon')).toBe(true);
    const first = land[0];
    expect(first.attrs?.find(([k]) => k === 'maHoSoQH')?.[1]).toBe('00000_');
    // Everything inside the class extents, and on the ground at Nhị Long (≈10.0°N, 106.26°E).
    const [lng, lat] = proj4(doc.crs!, WGS84_PROJ4).forward([(doc.bbox[0][0] + doc.bbox[1][0]) / 2, (doc.bbox[0][1] + doc.bbox[1][1]) / 2]);
    expect(lat).toBeGreaterThan(9.9);
    expect(lat).toBeLessThan(10.1);
    expect(lng).toBeGreaterThan(106.1);
    expect(lng).toBeLessThan(106.4);
    // Point names become labels.
    expect(doc.entities.some((e) => e.kind === 'text' && e.text === 'ẤP THẠNH HIỆP')).toBe(true);
    expect(doc.entities.filter((e) => e.kind === 'point' && e.layer === 'NenDiaHinh · DiemDoCao_P')).toHaveLength(4415);
  });
});
