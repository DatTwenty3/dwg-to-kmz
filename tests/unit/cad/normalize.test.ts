import { describe, expect, it } from 'vitest';
import type { CadEntity, PolylineEntity, TextEntity, Vec2 } from '@/lib/cad/types';
import {
  aciToHex,
  apply,
  arcSegmentCount,
  buildDocument,
  bulgePoints,
  circlePoints,
  ellipsePoints,
  expandBulges,
  loopToRing,
  multiply,
  nestRings,
  ocsMatrix,
  robustBBox,
  rotate,
  splinePoints,
  translate,
  type SrcDocument,
  type SrcEntity,
  type TextDecoderApi,
} from '@/lib/cad/normalize';

const close = (a: Vec2, b: Vec2, eps = 1e-6) => {
  expect(a[0]).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a[1]).toBeCloseTo(b[1], -Math.log10(eps));
};

/** Identity decoder so geometry tests do not depend on the text module. */
const passthrough: TextDecoderApi = {
  decodeStyleBatch: () => new Map(),
  decodeCadText: (i) => ({ text: String(i.raw), encoding: 'unicode', warnings: [] }),
};

function doc(entities: SrcEntity[], blocks: SrcDocument['blocks'] = new Map()): SrcDocument {
  return {
    units: 'm',
    layers: [
      { name: '0', color: { aci: 7 }, visible: true },
      { name: 'L1', color: { aci: 1 }, visible: true },
      { name: 'L2', color: { aci: 3 }, visible: false },
    ],
    styles: new Map(),
    blocks,
    entities,
    warnings: [],
  };
}

describe('colours', () => {
  it('maps ACI to hex', () => {
    expect(aciToHex(1)).toBe('#ff0000');
    expect(aciToHex(7)).toBe('#ffffff');
    expect(aciToHex(256)).toBe('#ffffff');
    expect(aciToHex(-3)).toBe('#00ff00');
  });
});

describe('tessellation', () => {
  it('uses 64 segments for a full circle and fewer for short arcs', () => {
    expect(circlePoints([0, 0], 1)).toHaveLength(64);
    expect(arcSegmentCount(Math.PI / 2)).toBe(16);
    expect(arcSegmentCount(0.01)).toBe(1);
    // chord error stays ≤ ~0.1 % of the radius
    const n = arcSegmentCount(2 * Math.PI);
    expect(1 - Math.cos(Math.PI / n)).toBeLessThan(0.0013);
  });

  it('positive bulge = CCW arc, negative = CW', () => {
    const ccw = bulgePoints([0, 0], [10, 0], 1); // half circle below the chord (CCW from (0,0) → (10,0))
    const cw = bulgePoints([0, 0], [10, 0], -1); // half circle above
    expect(ccw.length).toBeGreaterThan(5);
    expect(Math.min(...ccw.map((p) => p[1]))).toBeCloseTo(-5, 1);
    expect(Math.max(...cw.map((p) => p[1]))).toBeCloseTo(5, 1);
    for (const p of [...ccw, ...cw]) expect(Math.hypot(p[0] - 5, p[1])).toBeCloseTo(5, 6);
  });

  it('closes a bulged polyline through the last vertex bulge', () => {
    const pts = expandBulges(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10, bulge: 1 }, // closing edge (0,10) → (0,0) is a half circle bulging to x < 0
      ],
      true,
    );
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.length).toBeGreaterThan(4);
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(-5, 1);
  });

  it('ellipse honours the ratio and clockwise parameters', () => {
    const pts = ellipsePoints([0, 0], [10, 0], 0.5, 0, Math.PI / 2, true);
    close(pts[0], [10, 0]);
    close(pts[pts.length - 1], [0, 5]);
    const cw = ellipsePoints([0, 0], [10, 0], 0.5, 0, Math.PI / 2, false);
    close(cw[cw.length - 1], [0, -5]);
  });

  it('evaluates a clamped B-spline (quadratic Bézier)', () => {
    const pts = splinePoints({
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        [0, 0],
        [1, 2],
        [2, 0],
      ],
    });
    close(pts[0], [0, 0]);
    close(pts[pts.length - 1], [2, 0]);
    const mid = pts[Math.floor(pts.length / 2)];
    close(mid, [1, 1]);
  });

  it('falls back to fit points when knots are unusable', () => {
    const pts = splinePoints({ degree: 3, knots: [], controlPoints: [], fitPoints: [[0, 0], [1, 1], [2, 0]] });
    expect(pts).toEqual([[0, 0], [1, 1], [2, 0]]);
  });
});

describe('matrices', () => {
  it('composes translate·rotate', () => {
    const m = multiply(translate(10, 0), rotate(Math.PI / 2));
    close(apply(m, [1, 0]), [10, 1]);
  });

  it('OCS (0,0,-1) mirrors X', () => {
    close(apply(ocsMatrix({ x: 0, y: 0, z: -1 }), [3, 4]), [-3, 4]);
    expect(ocsMatrix({ x: 0, y: 0, z: 1 })).toEqual([1, 0, 0, 1, 0, 0]);
    expect(ocsMatrix(null)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('hatch', () => {
  it('clockwise arc edges use negated angles (verified on the real fixture)', () => {
    // Edge taken from fixture HATCH: line end (585422.0486, 1109876.8012) → arc → line start (585422.6647, 1109888.1686)
    const ring = loopToRing({
      kind: 'edges',
      edges: [{ type: 'arc', center: [585427.9698531313, 1109882.1806439857], radius: 8, start: 2.404101377692606, end: 3.987382407089549, ccw: false }],
    });
    close(ring[0], [585422.0486, 1109876.8012], 1e-3);
    close(ring[ring.length - 1], [585422.6647, 1109888.1686], 1e-1);
  });

  it('nests rings: outer + hole, separate island, island inside hole', () => {
    const sq = (x0: number, y0: number, s: number): Vec2[] => [
      [x0, y0],
      [x0 + s, y0],
      [x0 + s, y0 + s],
      [x0, y0 + s],
    ];
    const polys = nestRings([sq(0, 0, 100), sq(10, 10, 80), sq(40, 40, 10), sq(200, 0, 10)]);
    expect(polys).toHaveLength(3);
    const big = polys.find((p) => p[0][1][0] === 100)!;
    expect(big).toHaveLength(2); // outer + hole
    expect(polys.filter((p) => p.length === 1)).toHaveLength(2); // island in hole + separate square
  });
});

describe('robustBBox', () => {
  it('ignores a far outlier in large drawings', () => {
    const ents: CadEntity[] = [];
    for (let i = 0; i < 2000; i++) ents.push({ kind: 'point', layer: '0', color: '#fff', position: [580000 + (i % 100) * 10, 1100000 + Math.floor(i / 100) * 10] });
    ents.push({ kind: 'point', layer: '0', color: '#fff', position: [1175146, 2224052] });
    const [min, max] = robustBBox(ents);
    expect(min).toEqual([580000, 1100000]);
    expect(max).toEqual([580990, 1100190]);
  });
});

describe('buildDocument', () => {
  it('explodes nested blocks with ByBlock / layer-0 inheritance', () => {
    const blocks = new Map([
      [
        'INNER',
        {
          name: 'INNER',
          base: [0, 0] as Vec2,
          entities: [
            { type: 'line', layer: '0', color: { aci: 0 }, a: [0, 0], b: [1, 0] },
            { type: 'line', layer: 'L2', color: { aci: 256 }, a: [0, 0], b: [0, 1] },
          ] as SrcEntity[],
        },
      ],
      [
        'OUTER',
        {
          name: 'OUTER',
          base: [0, 0] as Vec2,
          entities: [
            { type: 'insert', layer: '0', color: { aci: 0 }, block: 'INNER', position: [5, 0], scale: [1, 1], rotation: 0, cols: 1, rows: 1, colSpacing: 0, rowSpacing: 0 },
          ] as SrcEntity[],
        },
      ],
    ]);
    const d = buildDocument(
      doc([{ type: 'insert', layer: 'L1', color: { aci: 5 }, handle: 'AB', block: 'OUTER', position: [100, 0], scale: [2, 2], rotation: Math.PI / 2, cols: 1, rows: 1, colSpacing: 0, rowSpacing: 0 }], blocks),
      { textDecoder: passthrough },
    );
    const lines = d.entities as PolylineEntity[];
    expect(lines).toHaveLength(2);
    // ByBlock/layer 0 → takes the outermost INSERT's layer and colour
    expect(lines[0]).toMatchObject({ layer: 'L1', color: '#0000ff', handle: 'AB' });
    close(lines[0].points[0], [100, 10]);
    close(lines[0].points[1], [100, 12]);
    // explicit layer keeps its own ByLayer colour
    expect(lines[1]).toMatchObject({ layer: 'L2', color: '#00ff00' });
    expect(d.layers.find((l) => l.name === 'L2')?.visible).toBe(false);
  });

  it('keeps mirrored text readable', () => {
    const blocks = new Map([
      ['T', { name: 'T', base: [0, 0] as Vec2, entities: [{ type: 'text', layer: '0', color: { aci: 7 }, raw: 'abc', style: 'S', isMText: false, position: [1, 0], height: 2, rotation: 0, hAlign: 'left', vAlign: 'baseline' }] as SrcEntity[] }],
    ]);
    const d = buildDocument(
      doc([{ type: 'insert', layer: '0', color: { aci: 7 }, block: 'T', position: [0, 0], scale: [-1, 1], rotation: 0, cols: 1, rows: 1, colSpacing: 0, rowSpacing: 0 }], blocks),
      { textDecoder: passthrough },
    );
    const t = d.entities[0] as TextEntity;
    expect(t.rotation).toBe(0);
    expect(t.hAlign).toBe('right');
    close(t.position, [-1, 0]);
    expect(t.height).toBeCloseTo(2);
  });

  it('counts unsupported entities per type and survives missing blocks / cycles', () => {
    const blocks = new Map([['LOOP', { name: 'LOOP', base: [0, 0] as Vec2, entities: [{ type: 'insert', layer: '0', color: { aci: 7 }, block: 'LOOP', position: [1, 0], scale: [1, 1], rotation: 0, cols: 1, rows: 1, colSpacing: 0, rowSpacing: 0 }] as SrcEntity[] }]]);
    const d = buildDocument(
      doc(
        [
          { type: 'unsupported', layer: '0', color: { aci: 7 }, name: 'WIPEOUT' },
          { type: 'unsupported', layer: '0', color: { aci: 7 }, name: 'WIPEOUT' },
          { type: 'unsupported', layer: '0', color: { aci: 7 }, name: 'OLE2FRAME' },
          { type: 'insert', layer: '0', color: { aci: 7 }, block: 'NOPE', position: [0, 0], scale: [1, 1], rotation: 0, cols: 1, rows: 1, colSpacing: 0, rowSpacing: 0 },
          { type: 'insert', layer: '0', color: { aci: 7 }, block: 'LOOP', position: [0, 0], scale: [1, 1], rotation: 0, cols: 1, rows: 1, colSpacing: 0, rowSpacing: 0 },
        ],
        blocks,
      ),
      { textDecoder: passthrough },
    );
    expect(d.warnings.some((w) => w.includes('2 đối tượng WIPEOUT'))).toBe(true);
    expect(d.warnings.some((w) => w.includes('1 đối tượng OLE2FRAME'))).toBe(true);
    expect(d.warnings.some((w) => w.includes('NOPE'))).toBe(true);
    expect(d.warnings.some((w) => w.includes('LOOP'))).toBe(true);
  });

  it('keeps raw text and warns when the text module throws', () => {
    const d = buildDocument(
      doc([{ type: 'text', layer: '0', color: { aci: 7 }, raw: 'Xin chào', style: 'S', isMText: false, position: [0, 0], height: 1, rotation: 0, hAlign: 'left', vAlign: 'baseline' }]),
      {
        textDecoder: {
          decodeStyleBatch: () => new Map(),
          decodeCadText: () => {
            throw new Error('boom');
          },
        },
      },
    );
    expect((d.entities[0] as TextEntity).text).toBe('Xin chào');
    expect(d.warnings.some((w) => w.includes('boom'))).toBe(true);
  });
});
