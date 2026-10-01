import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDxf } from '@/lib/cad';
import { decodeDxfBytes } from '@/lib/cad/dxf';
import { PATTERN_FILL_OPACITY } from '@/lib/cad/normalize/build';
import type { CadDocument, PolygonEntity, PolylineEntity, TableEntity, TextEntity, Vec2 } from '@/lib/cad/types';

const FIX = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));
function load(name: string): ArrayBuffer {
  const b = readFileSync(FIX(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const parse = (name: string): Promise<CadDocument> => parseDxf(load(name), { wasmBaseUrl: '' });
const byHandle = <T>(d: CadDocument, h: string) => d.entities.filter((e) => e.handle === h) as T[];
const close = (a: Vec2, b: Vec2, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

describe('DXF basic.dxf (R2013 UTF-8)', async () => {
  const d = await parse('basic.dxf');

  it('reads units, layers (Unicode names, off layer) and drops paper space', () => {
    expect(d.units).toBe('m');
    expect(d.crs).toBeNull();
    expect(d.layers.map((l) => l.name)).toEqual(['0', 'Đất ở', 'HIDDEN', 'HATCH']);
    expect(d.layers.find((l) => l.name === 'Đất ở')?.color).toBe('#00ff00');
    expect(d.layers.find((l) => l.name === 'HIDDEN')?.visible).toBe(false);
    expect(byHandle(d, '10D')).toHaveLength(0);
    expect(d.warnings.some((w) => w.includes('Paper Space'))).toBe(true);
  });

  it('LWPOLYLINE with positive bulge bulges outward; negative bulge is clockwise', () => {
    const [sq] = byHandle<PolylineEntity>(d, '100');
    expect(sq.closed).toBe(true);
    expect(Math.max(...sq.points.map((p) => p[1]))).toBeCloseTo(15, 1); // semicircle on top edge
    const [open] = byHandle<PolylineEntity>(d, '101');
    expect(open.color).toBe('#ff0000');
    expect(Math.max(...open.points.map((p) => p[1]))).toBeCloseTo(5, 1);
    expect(Math.min(...open.points.map((p) => p[1]))).toBeGreaterThan(-1e-9);
  });

  it('tessellates circle / arc / ellipse', () => {
    const [circle] = byHandle<PolylineEntity>(d, '103');
    expect(circle.closed).toBe(true);
    expect(circle.points).toHaveLength(64);
    const [arc] = byHandle<PolylineEntity>(d, '104');
    close(arc.points[0], [60, 50]);
    close(arc.points[arc.points.length - 1], [50, 60]);
    const [ell] = byHandle<PolylineEntity>(d, '106');
    expect(Math.max(...ell.points.map((p) => p[1]))).toBeCloseTo(10, 6);
  });

  it('TEXT alignment point, rotation in degrees, Unicode content', () => {
    const [t] = byHandle<TextEntity>(d, '107');
    expect(t.text).toBe('Xin chào Việt Nam');
    expect(t.position).toEqual([40, 40]);
    expect(t.rotation).toBeCloseTo(30, 9);
    expect(t.hAlign).toBe('center');
    expect(t.height).toBe(2.5);
  });

  it('MTEXT: chunks joined (keeping spaces), format codes stripped, attachment 5', () => {
    const [m] = byHandle<TextEntity>(d, '108');
    expect(m.text).toBe('BẢN ĐỒ QUY HOẠCH\nDòng 2');
    expect(m).toMatchObject({ hAlign: 'center', vAlign: 'middle', height: 3 });
    expect(m.rotation).toBeCloseTo(90, 9);
  });

  it('solid HATCH → polygon with hole + separate arc-edge island', () => {
    const polys = byHandle<PolygonEntity>(d, '109');
    expect(polys).toHaveLength(2);
    const withHole = polys.find((p) => p.rings.length === 2)!;
    expect(withHole.rings[0]).toHaveLength(4);
    expect(withHole.rings[1]).toHaveLength(4);
    expect(withHole.color).toBe('#00ff00');
    const island = polys.find((p) => p.rings.length === 1)!;
    for (const p of island.rings[0]) expect(Math.hypot(p[0] - 300, p[1] - 50)).toBeCloseTo(20, 6);
  });

  it('pattern HATCH → tinted polygon + warning; SOLID → polygon; true colour', () => {
    const [b] = byHandle<PolygonEntity>(d, '10A');
    expect(b.kind).toBe('polygon');
    expect(b.pattern).toBeTruthy();
    expect(b.fillOpacity).toBe(PATTERN_FILL_OPACITY);
    expect(d.warnings.some((w) => w.includes('hatch dạng mẫu'))).toBe(true);
    const [solid] = byHandle<PolygonEntity>(d, '10E');
    expect(solid.rings[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(byHandle<PolylineEntity>(d, '10F')[0].color).toBe('#ff8000');
  });

  it('warns once per unsupported type', () => {
    expect(d.warnings.filter((w) => w.includes('WIPEOUT'))).toHaveLength(1);
    expect(d.warnings.filter((w) => w.includes('OLE2FRAME'))).toHaveLength(1);
  });

  it('computes the bbox from entities', () => {
    expect(d.bbox[0][0]).toBeCloseTo(0, 6);
    expect(d.bbox[1][0]).toBeCloseTo(320, 6);
    expect(d.bbox[1][1]).toBeCloseTo(100, 6);
  });
});

describe('DXF blocks.dxf (3-level nesting, rotation, negative scale, MINSERT, OCS)', async () => {
  const d = await parse('blocks.dxf');

  /** Independent re-computation of A-local → world for INSERT C → B → A. */
  const toWorld = (p: Vec2): Vec2 => {
    const rot = (q: Vec2, a: number): Vec2 => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
    let q = rot(p, Math.PI / 2);
    q = [q[0] + 10, q[1]]; // A in B
    q = [q[0] - 1, q[1] - 1]; // B base point
    q = [-q[0], q[1]]; // scale (-1, 1)
    q = rot(q, Math.PI / 4);
    q = [q[0] + 5, q[1] + 5]; // B in C
    return [q[0] * 2 + 1000, q[1] * 2 + 2000]; // C in world (scale 2)
  };

  it('applies the composed affine transform', () => {
    const [line, , fixed] = byHandle<PolylineEntity | TextEntity>(d, '200') as [PolylineEntity, TextEntity, PolylineEntity];
    close(line.points[0], toWorld([0, 0]));
    close(line.points[1], toWorld([1, 0]));
    close(fixed.points[1], toWorld([0, 1]));
  });

  it('inherits layer/colour for layer-0 + ByBlock, keeps explicit layer', () => {
    const ents = byHandle<PolylineEntity | TextEntity>(d, '200');
    expect(ents[0]).toMatchObject({ layer: 'OUTER', color: '#ffff00' });
    expect(ents[2]).toMatchObject({ layer: 'FIXED', color: '#ff0000' });
  });

  it('text in mirrored block stays readable, height scaled', () => {
    const t = byHandle<TextEntity>(d, '200').find((e) => e.kind === 'text')!;
    close(t.position, toWorld([0, 0]));
    expect(t.height).toBeCloseTo(2, 9);
    const r = ((t.rotation % 360) + 360) % 360;
    expect(r > 270 || r < 90).toBe(true);
  });

  it('ATTRIB → text with ByBlock colour from its INSERT; invisible ATTRIB dropped', () => {
    const atts = byHandle<TextEntity>(d, '201');
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ text: 'Lô A1', layer: 'ATT', color: '#ffff00', position: [1001, 2001] });
    expect(byHandle(d, '202')).toHaveLength(0);
  });

  it('MINSERT 2×3 grid', () => {
    const lines = byHandle<PolylineEntity>(d, '203').filter((e) => e.kind === 'polyline' && e.layer === 'GRID');
    expect(lines).toHaveLength(6);
    const starts = lines.map((l) => l.points[0].join(',')).sort();
    expect(starts).toEqual(['0,0', '0,20', '0,40', '10,0', '10,20', '10,40']);
  });

  it('INSERT with extrusion (0,0,-1) is mirrored in X', () => {
    const [line] = byHandle<PolylineEntity>(d, '204');
    close(line.points[0], [-50, 0]);
    close(line.points[1], [-51, 0]);
  });
});

describe('DXF table.dxf (ACAD_TABLE)', async () => {
  const d = await parse('table.dxf');

  it('reads rows, columns, sizes and merged cells', () => {
    const [t] = byHandle<TableEntity>(d, '300');
    expect(t).toMatchObject({ kind: 'table', rows: 3, cols: 3, origin: [100, 200], rotation: 0 });
    expect(t.rowHeights).toEqual([10, 8, 8]);
    expect(t.colWidths).toEqual([30, 20, 25]);
    expect(t.cells).toContainEqual({ r: 0, c: 0, rowSpan: 1, colSpan: 3, text: 'BẢNG THỐNG KÊ' });
    expect(t.cells).toContainEqual({ r: 1, c: 0, rowSpan: 2, colSpan: 1, text: 'Loại đất' });
    expect(t.cells).toContainEqual({ r: 2, c: 1, rowSpan: 1, colSpan: 1, text: '12,5 ha' });
    // covered cells are not emitted
    expect(t.cells.find((c) => c.r === 0 && c.c === 1)).toBeUndefined();
    expect(t.cells.find((c) => c.r === 2 && c.c === 0)).toBeUndefined();
    expect(t.cells).toHaveLength(6);
  });

  it('falls back to the *T block for an unreadable table and warns', () => {
    const fb = byHandle<PolylineEntity | TextEntity>(d, '301');
    expect(fb.filter((e) => e.kind === 'polyline')).toHaveLength(2);
    expect(fb.find((e) => e.kind === 'text')).toMatchObject({ text: 'Ô dự phòng' });
    expect(d.warnings.some((w) => w.includes('ACAD_TABLE'))).toBe(true);
  });
});

describe('DXF legacy-vni.dxf (R2000, 8-bit, $DWGCODEPAGE ANSI_1252)', async () => {
  it('keeps legacy text as raw bytes for the text module', () => {
    const dec = decodeDxfBytes(load('legacy-vni.dxf'));
    expect(dec).toMatchObject({ version: 'AC1015', codepage: 'ANSI_1252', legacyBytes: true });
  });

  it('decodes VNI through @/lib/text', async () => {
    const d = await parse('legacy-vni.dxf');
    const texts = (d.entities as TextEntity[]).map((t) => t.text);
    expect(texts).toEqual(['ĐẤT Ở', 'ĐẤT TRƯỜNG MẦM NON', 'P. THỚI BÌNH']);
  });
});

describe('DXF errors', () => {
  it('rejects binary DXF with a Vietnamese message', async () => {
    const bin = new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\x00').buffer;
    await expect(parseDxf(bin, { wasmBaseUrl: '' })).rejects.toThrow(/nhị phân/);
  });
});
