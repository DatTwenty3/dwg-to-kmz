import { describe, expect, it } from 'vitest';
import { parseDxf } from '@/lib/cad';
import type { CadDocument, PolygonEntity, PolylineEntity, TextEntity } from '@/lib/cad/types';
import { nearestAci, sanitizeLayerName, toDxf } from '@/lib/export';

const VN = 'Đường điện 0,4kV – Cột BTLT';
const LAYER_VN = 'NKIEU-KT-QHCT_Đất quân sự';

function sample(): CadDocument {
  return {
    units: 'm',
    crs: null,
    layers: [
      { name: LAYER_VN, color: '#ff0000', visible: true },
      { name: 'A<B>:C/D', color: '#00ff00', visible: true },
      { name: 'A_B__C_D', color: '#0000ff', visible: true },
      { name: 'AN', color: '#ffffff', visible: false },
    ],
    entities: [
      { kind: 'polyline', layer: LAYER_VN, color: '#ff0000', points: [[580900, 1107400], [580950.5, 1107420.25], [581000, 1107400]], closed: false, width: 0.5, handle: '1' },
      { kind: 'polyline', layer: LAYER_VN, color: '#123456', points: [[580900, 1107400], [580910, 1107400], [580910, 1107410]], closed: true, handle: '2' },
      {
        kind: 'polygon',
        layer: 'A<B>:C/D',
        color: '#00ff00',
        fillOpacity: 0.4,
        rings: [
          [[580000, 1100000], [580100, 1100000], [580100, 1100100], [580000, 1100100], [580000, 1100000]],
          [[580020, 1100020], [580040, 1100020], [580040, 1100040], [580020, 1100040]],
        ],
        handle: '3',
      },
      { kind: 'text', layer: LAYER_VN, color: '#ff0000', text: VN, position: [580905.123456, 1107405.5], height: 2.5, rotation: 30, hAlign: 'left', vAlign: 'baseline', handle: '4' },
      { kind: 'text', layer: 'A_B__C_D', color: '#0000ff', text: 'Dòng một\nDòng hai {x} \\y', position: [580950, 1107450], height: 3, rotation: 0, hAlign: 'center', vAlign: 'middle', handle: '5' },
      { kind: 'point', layer: LAYER_VN, color: '#ff0000', position: [580999, 1107999], handle: '6' },
      { kind: 'point', layer: 'AN', color: '#ffffff', position: [1, 2], handle: '7' },
      {
        kind: 'table',
        layer: 'A_B__C_D',
        color: '#0000ff',
        origin: [580800, 1107300],
        rotation: 0,
        rows: 2,
        cols: 2,
        rowHeights: [5, 5],
        colWidths: [10, 20],
        cells: [
          { r: 0, c: 0, rowSpan: 1, colSpan: 2, text: 'Bảng thống kê' },
          { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: 'Đất ở' },
          { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: '12,5 ha' },
        ],
        handle: '8',
      },
    ],
    bbox: [[0, 0], [1, 1]],
    warnings: [],
  };
}

const parse = async (dxf: string): Promise<CadDocument> => {
  const bytes = new TextEncoder().encode(dxf);
  return parseDxf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { wasmBaseUrl: '' });
};

describe('toDxf structure', () => {
  const dxf = toDxf(sample(), {});
  const lines = dxf.split(/\r?\n/);

  it('has the standard sections, AC1021 and $INSUNITS 6', () => {
    for (const s of ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) {
      const i = lines.indexOf(s);
      expect(i, s).toBeGreaterThan(0);
      expect(lines[i - 1]).toBe('2');
      expect(lines[i - 2]).toBe('SECTION');
    }
    expect(lines[lines.length - 1]).toBe('EOF');
    const v = lines.indexOf('$ACADVER');
    expect(lines.slice(v + 1, v + 3)).toEqual(['1', 'AC1021']);
    const u = lines.indexOf('$INSUNITS');
    expect(lines.slice(u + 1, u + 3)).toEqual(['70', '6']);
    expect(lines).toContain('$EXTMIN');
    expect(lines).toContain('$EXTMAX');
  });

  it('keeps Vietnamese verbatim in UTF-8', () => {
    const bytes = new TextEncoder().encode(dxf);
    expect(Buffer.from(bytes).includes(Buffer.from(VN, 'utf8'))).toBe(true);
    expect(dxf).toContain(LAYER_VN);
    expect(dxf).toContain('Bảng thống kê');
  });

  it('declares a TrueType Unicode text style used by TEXT and MTEXT', () => {
    expect(dxf).toContain('VN-ARIAL');
    expect(lines).toContain('arial.ttf');
    // every group-7 value in entities is VN-ARIAL
    const ent = lines.indexOf('ENTITIES');
    const styles = lines.slice(ent).flatMap((l, i, a) => (l === '7' && i > 0 ? [a[i + 1]] : []));
    expect(styles.length).toBeGreaterThan(0);
    for (const s of styles) expect(s).toBe('VN-ARIAL');
  });

  it('sanitizes and dedupes layer names, skips hidden layers', () => {
    expect(sanitizeLayerName('A<B>:C/D')).toBe('A_B__C_D');
    expect(sanitizeLayerName('a,b=c`d')).toBe('a_b_c_d');
    expect(sanitizeLayerName('Đất ở')).toBe('Đất ở');
    const i = lines.indexOf('LAYER');
    expect(i).toBeGreaterThan(0);
    const layerNames: string[] = [];
    const tStart = lines.indexOf('TABLES');
    for (let k = tStart; k < lines.length - 1; k++) {
      if (lines[k] === '0' && lines[k + 1] === 'LAYER') {
        const j = lines.indexOf('2', k + 2);
        layerNames.push(lines[j + 1]);
      }
    }
    expect(layerNames).toContain(LAYER_VN);
    expect(layerNames).toContain('A_B__C_D');
    expect(layerNames).toContain('A_B__C_D_2');
    expect(layerNames).not.toContain('AN');
    expect(dxf).not.toContain('A<B>');
  });

  it('writes hatch with outer + hole path, solid, normal style, transparency', () => {
    const h = lines.indexOf('HATCH');
    expect(h).toBeGreaterThan(0);
    const body = lines.slice(h, lines.indexOf('0', h + 400) > 0 ? h + 400 : undefined).join('\n');
    expect(body).toMatch(/\n92\n3\n/); // outer: External|Polyline
    expect(body).toMatch(/\n92\n2\n/); // hole: Polyline
    expect(body).toMatch(/\n91\n2\n/); // two paths
    expect(body).toMatch(/\n70\n1\n/); // solid fill
    expect(body).toMatch(/\n75\n0\n/); // hatch style normal
    expect(body).toContain('\n440\n' + (0x02000000 | Math.round(0.4 * 255)) + '\n');
  });

  it('writes multi-line MTEXT with \\P and escaped braces / backslash', () => {
    expect(dxf).toContain('Dòng một\\PDòng hai \\{x\\} \\\\y');
    expect(lines).toContain('MTEXT');
  });

  it('never prints exponent notation or NaN', () => {
    expect(dxf).not.toMatch(/\n-?\d+(\.\d+)?e[-+]?\d+\n/i);
    expect(dxf).not.toContain('NaN');
    expect(dxf).not.toContain('undefined');
  });

  it('honours opts.layers and units', () => {
    const d2 = toDxf(sample(), { layers: ['A_B__C_D'], units: 'mm' });
    expect(d2).not.toContain(LAYER_VN);
    const l = d2.split('\n');
    const u = l.indexOf('$INSUNITS');
    expect(l[u + 2]).toBe('4');
  });
});

describe('toDxf round trip through parseDxf', () => {
  it('re-reads entity counts, texts and coordinates', async () => {
    const src = sample();
    const back = await parse(toDxf(src, {}));
    expect(back.units).toBe('m');
    const polylines = back.entities.filter((e): e is PolylineEntity => e.kind === 'polyline');
    // 2 polylines + 6 table grid lines (2x2 with a merged top row: 3 horizontal + 3 vertical runs)
    const own = polylines.filter((p) => p.points.length === 3);
    expect(own).toHaveLength(2);
    const open = own.find((p) => !p.closed)!;
    expect(open.width).toBeCloseTo(0.5, 6);
    expect(open.layer).toBe(LAYER_VN);
    open.points.forEach((p, i) => {
      expect(p[0]).toBeCloseTo((src.entities[0] as PolylineEntity).points[i][0], 6);
      expect(p[1]).toBeCloseTo((src.entities[0] as PolylineEntity).points[i][1], 6);
    });
    expect(own.find((p) => p.closed)!.color).toBe('#123456');

    const polys = back.entities.filter((e): e is PolygonEntity => e.kind === 'polygon');
    expect(polys).toHaveLength(1);
    expect(polys[0].rings).toHaveLength(2);
    expect(polys[0].layer).toBe('A_B__C_D');

    const texts = back.entities.filter((e): e is TextEntity => e.kind === 'text');
    const vn = texts.find((t) => t.text === VN);
    expect(vn).toBeTruthy();
    expect(vn!.position[0]).toBeCloseTo(580905.123456, 6);
    expect(vn!.position[1]).toBeCloseTo(1107405.5, 6);
    expect(vn!.height).toBeCloseTo(2.5, 6);
    expect(vn!.rotation).toBeCloseTo(30, 6);
    expect(texts.some((t) => t.text.includes('Dòng một') && t.text.includes('Dòng hai'))).toBe(true);
    for (const s of ['Bảng thống kê', 'Đất ở', '12,5 ha']) expect(texts.some((t) => t.text === s)).toBe(true);

    expect(back.entities.filter((e) => e.kind === 'point')).toHaveLength(1);
    expect(back.layers.map((l) => l.name)).toContain(LAYER_VN);
  });
});

describe('Defpoints', () => {
  it('renames a Defpoints layer (AutoCAD rejects it without plot flag)', () => {
    const doc: CadDocument = {
      units: 'm', crs: null, layers: [{ name: 'Defpoints', color: '#ffffff', visible: true }],
      entities: [{ kind: 'point', layer: 'Defpoints', color: '#ffffff', position: [1, 2] }],
      bbox: [[0, 0], [1, 1]], warnings: [],
    };
    const lines = toDxf(doc, {}).split(/\r?\n/);
    expect(lines).not.toContain('Defpoints');
    expect(lines).toContain('Defpoints_');
  });
});

describe('colour helpers', () => {
  it('maps to nearest ACI', () => {
    expect(nearestAci('#ff0000')).toBe(1);
    expect(nearestAci('#00ff00')).toBe(3);
    expect(nearestAci('#ffffff')).toBe(7);
    expect(nearestAci('#000000')).toBe(7);
    expect(nearestAci('#fe0101')).toBe(1);
  });
});
