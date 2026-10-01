// Generates the small hand-made DXF fixtures used by tests/unit/cad. Run: node tests/fixtures/make-dxf-fixtures.mjs
// Each fixture targets one feature; expected values are asserted in tests/unit/cad/dxf.test.ts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

/** Build DXF text from [code, value] pairs. */
const dxf = (pairs) => pairs.map(([c, v]) => `${String(c).padStart(3, ' ')}\n${v}`).join('\n') + '\n';
const pt = (c, x, y) => [
  [c, x],
  [c + 10, y],
  [c + 20, 0],
];

function header(ver, extra = []) {
  return [
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, ver],
    [9, '$INSUNITS'],
    [70, 6],
    ...extra,
    [0, 'ENDSEC'],
  ];
}

function tables(layers, styles = [['Standard', 'arial.ttf']]) {
  const out = [
    [0, 'SECTION'],
    [2, 'TABLES'],
    [0, 'TABLE'],
    [2, 'LAYER'],
    [70, layers.length],
  ];
  for (const [name, color, rgb] of layers) {
    out.push([0, 'LAYER'], [2, name], [70, 0], [62, color], [6, 'Continuous']);
    if (rgb !== undefined) out.push([420, rgb]);
  }
  out.push([0, 'ENDTAB'], [0, 'TABLE'], [2, 'STYLE'], [70, styles.length]);
  for (const [name, font] of styles) out.push([0, 'STYLE'], [2, name], [70, 0], [40, 0], [41, 1], [3, font], [4, '']);
  out.push([0, 'ENDTAB'], [0, 'ENDSEC']);
  return out;
}

const block = (name, base, ents) => [
  [0, 'BLOCK'],
  [8, '0'],
  [2, name],
  [70, 0],
  ...pt(10, base[0], base[1]),
  [3, name],
  ...ents,
  [0, 'ENDBLK'],
  [8, '0'],
];

const section = (name, body) => [[0, 'SECTION'], [2, name], ...body, [0, 'ENDSEC']];
const eof = [[0, 'EOF']];

// ---------------------------------------------------------------- basic.dxf (R2013, UTF-8)
{
  const ents = [
    // Square with a semicircular (bulge 1) top edge: vertices (0,0) (10,0) (10,10) (0,10), bulge on vertex 2
    [0, 'LWPOLYLINE'], [5, '100'], [8, 'Đất ở'], [100, 'AcDbPolyline'], [90, 4], [70, 1],
    [10, 0], [20, 0], [10, 10], [20, 0], [10, 10], [20, 10], [42, 1], [10, 0], [20, 10],
    // Open polyline with a negative bulge (clockwise half circle from (20,0) to (30,0))
    [0, 'LWPOLYLINE'], [5, '101'], [8, 'Đất ở'], [62, 1], [100, 'AcDbPolyline'], [90, 2], [70, 0],
    [10, 20], [20, 0], [42, -1], [10, 30], [20, 0],
    [0, 'LINE'], [5, '102'], [8, 'HIDDEN'], ...pt(10, 0, 0), ...pt(11, 5, 5),
    [0, 'CIRCLE'], [5, '103'], [8, '0'], [62, 5], ...pt(10, 50, 50), [40, 5],
    [0, 'ARC'], [5, '104'], [8, '0'], ...pt(10, 50, 50), [40, 10], [50, 0], [51, 90],
    [0, 'POINT'], [5, '105'], [8, '0'], ...pt(10, 7, 8),
    [0, 'ELLIPSE'], [5, '106'], [8, '0'], ...pt(10, 100, 0), ...pt(11, 20, 0), [40, 0.5], [41, 0], [42, 6.283185307179586],
    // Centre-aligned rotated TEXT (Unicode)
    [0, 'TEXT'], [5, '107'], [8, 'Đất ở'], [100, 'AcDbText'], ...pt(10, 0, 0), [40, 2.5], [1, 'Xin chào Việt Nam'],
    [50, 30], [7, 'Standard'], [72, 1], ...pt(11, 40, 40), [100, 'AcDbText'], [73, 0],
    // MTEXT with formatting codes, middle-center
    [0, 'MTEXT'], [5, '108'], [8, '0'], [100, 'AcDbMText'], ...pt(10, 60, 70), [40, 3], [71, 5], [72, 1],
    [3, '{\\fArial|b1|i0|c0|p34;BẢN ĐỒ QUY '], [1, 'HOẠCH}\\PDòng 2'], [7, 'Standard'], ...pt(11, 0, 1),
    // Solid hatch: outer square (0..100) with square hole (25..75) + separate circle made of 2 arc edges
    [0, 'HATCH'], [5, '109'], [8, 'HATCH'], [62, 3], [100, 'AcDbHatch'], ...pt(10, 0, 0),
    [210, 0], [220, 0], [230, 1], [2, 'SOLID'], [70, 1], [71, 0], [91, 3],
    [92, 3], [72, 0], [73, 1], [93, 4], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 100], [10, 0], [20, 100], [97, 0],
    [92, 2], [72, 0], [73, 1], [93, 4], [10, 25], [20, 25], [10, 75], [20, 25], [10, 75], [20, 75], [10, 25], [20, 75], [97, 0],
    [92, 1], [93, 2],
    [72, 2], [10, 300], [20, 50], [40, 20], [50, 0], [51, 180], [73, 1],
    [72, 2], [10, 300], [20, 50], [40, 20], [50, 180], [51, 360], [73, 1],
    [97, 0],
    [75, 0], [76, 1], [98, 0],
    // Pattern hatch → boundary only + warning
    [0, 'HATCH'], [5, '10A'], [8, 'HATCH'], [100, 'AcDbHatch'], ...pt(10, 0, 0), [210, 0], [220, 0], [230, 1],
    [2, 'ANSI31'], [70, 0], [71, 0], [91, 1],
    [92, 3], [72, 0], [73, 1], [93, 3], [10, 0], [20, 0], [10, 10], [20, 0], [10, 0], [20, 10], [97, 0],
    [75, 0], [76, 1], [52, 0], [41, 1], [77, 0], [78, 0], [98, 0],
    // Unsupported
    [0, 'WIPEOUT'], [5, '10B'], [8, '0'], [100, 'AcDbWipeout'], ...pt(10, 0, 0),
    [0, 'OLE2FRAME'], [5, '10C'], [8, '0'],
    // Paper space entity must be dropped
    [0, 'LINE'], [5, '10D'], [67, 1], [8, '0'], ...pt(10, -500, -500), ...pt(11, -600, -600),
    // SOLID (4 corners, DXF order 1-2-3-4 → drawn 1-2-4-3)
    [0, 'SOLID'], [5, '10E'], [8, '0'], [62, 1], ...pt(10, 0, 0), ...pt(11, 1, 0), ...pt(12, 0, 1), ...pt(13, 1, 1),
    // True colour line (orange)
    [0, 'LINE'], [5, '10F'], [8, '0'], [62, 30], [420, 0xff8000], ...pt(10, 0, 0), ...pt(11, 1, 1),
  ];
  const text = dxf([
    ...header('AC1027', [[9, '$DWGCODEPAGE'], [3, 'ANSI_1252']]),
    ...tables([
      ['0', 7],
      ['Đất ở', 3],
      ['HIDDEN', -2],
      ['HATCH', 4],
    ]),
    ...section('BLOCKS', [...block('*Model_Space', [0, 0], []), ...block('*Paper_Space', [0, 0], [])]),
    ...section('ENTITIES', ents),
    ...eof,
  ]);
  writeFileSync(dir + 'basic.dxf', text, 'utf8');
}

// ---------------------------------------------------------------- blocks.dxf (3-level nesting)
{
  // A: unit line on layer 0 / ByBlock + a TEXT on layer 0; base point (0,0)
  const A = block('A', [0, 0], [
    [0, 'LINE'], [8, '0'], [62, 0], ...pt(10, 0, 0), ...pt(11, 1, 0),
    [0, 'TEXT'], [8, '0'], [62, 0], ...pt(10, 0, 0), [40, 1], [1, 'A'], [50, 0],
    [0, 'LINE'], [8, 'FIXED'], [62, 1], ...pt(10, 0, 0), ...pt(11, 0, 1),
  ]);
  // B: inserts A at (10,0) rotated 90°; base point (1,1)
  const B = block('B', [1, 1], [[0, 'INSERT'], [8, '0'], [62, 0], [2, 'A'], ...pt(10, 10, 0), [50, 90]]);
  // C: inserts B with negative X scale (mirror) and 45° rotation at (5,5)
  const C = block('C', [0, 0], [[0, 'INSERT'], [8, '0'], [62, 0], [2, 'B'], ...pt(10, 5, 5), [41, -1], [42, 1], [50, 45]]);
  const ents = [
    [0, 'INSERT'], [5, '200'], [8, 'OUTER'], [62, 2], [66, 1], [2, 'C'], ...pt(10, 1000, 2000), [41, 2], [42, 2], [50, 0],
    [0, 'ATTRIB'], [5, '201'], [8, 'ATT'], [62, 0], [100, 'AcDbText'], ...pt(10, 1001, 2001), [40, 1.5], [1, 'Lô A1'],
    [100, 'AcDbAttribute'], [2, 'TAG'], [70, 0],
    [0, 'ATTRIB'], [5, '202'], [8, 'ATT'], [100, 'AcDbText'], ...pt(10, 1001, 2003), [40, 1.5], [1, 'hidden'],
    [100, 'AcDbAttribute'], [2, 'TAG2'], [70, 1],
    [0, 'SEQEND'], [8, 'OUTER'],
    // Plain MINSERT of A: 2 columns × 3 rows, spacing 10 × 20
    [0, 'INSERT'], [5, '203'], [8, 'GRID'], [2, 'A'], ...pt(10, 0, 0), [70, 2], [71, 3], [44, 10], [45, 20],
    // Mirrored via OCS extrusion (0,0,-1): OCS x → WCS -x
    [0, 'INSERT'], [5, '204'], [8, 'MIRROR'], [2, 'A'], ...pt(10, 50, 0), [210, 0], [220, 0], [230, -1],
  ];
  const text = dxf([
    ...header('AC1027'),
    ...tables([
      ['0', 7],
      ['OUTER', 2],
      ['FIXED', 1],
      ['GRID', 5],
      ['MIRROR', 6],
      ['ATT', 4],
    ]),
    ...section('BLOCKS', [...block('*Model_Space', [0, 0], []), ...A, ...B, ...C]),
    ...section('ENTITIES', ents),
    ...eof,
  ]);
  writeFileSync(dir + 'blocks.dxf', text, 'utf8');
}

// ---------------------------------------------------------------- table.dxf (ACAD_TABLE with merged cells)
{
  const cell = (text, colSpan = 1, rowSpan = 1, merged = 0) => [
    [171, 1], [172, 0], [173, merged], [174, 0], [175, colSpan], [176, rowSpan], [91, 0], [178, 0], [145, 0],
    [92, 0], [301, 'CELL_VALUE'], ...(text ? [[1, text]] : []), [7, 'Standard'],
  ];
  const tableEnts = [
    [0, 'ACAD_TABLE'], [5, '300'], [8, 'TABLE'], [100, 'AcDbEntity'], [100, 'AcDbBlockReference'], [2, '*T1'],
    ...pt(10, 100, 200), [100, 'AcDbTable'], [280, 0], [11, 1], [21, 0], [31, 0],
    [90, 22], [91, 3], [92, 3], [93, 0], [94, 0], [95, 0], [96, 0],
    [141, 10], [141, 8], [141, 8], [142, 30], [142, 20], [142, 25],
    // Row 0: title merged over 3 columns
    ...cell('BẢNG THỐNG KÊ', 3, 1, 1), ...cell('', 1, 1, 1), ...cell('', 1, 1, 1),
    // Row 1: header; first cell spans 2 rows
    ...cell('Loại đất', 1, 2, 1), ...cell('Diện tích', 1, 1, 0), ...cell('Tỷ lệ', 1, 1, 0),
    // Row 2
    ...cell('', 1, 1, 1), ...cell('{\\fArial;12,5} ha'), ...cell('45%'),
    // Unreadable table (no row heights / widths) → fallback to its *T2 block
    [0, 'ACAD_TABLE'], [5, '301'], [8, 'TABLE'], [100, 'AcDbBlockReference'], [2, '*T2'], ...pt(10, 0, 0),
    [100, 'AcDbTable'], [11, 1], [21, 0], [31, 0], [91, 2], [92, 2],
  ];
  const T1 = block('*T1', [0, 0], [[0, 'LINE'], [8, '0'], ...pt(10, 100, 200), ...pt(11, 175, 200)]);
  const T2 = block('*T2', [0, 0], [
    [0, 'LINE'], [8, '0'], ...pt(10, 0, 0), ...pt(11, 40, 0),
    [0, 'LINE'], [8, '0'], ...pt(10, 0, -10), ...pt(11, 40, -10),
    [0, 'MTEXT'], [8, '0'], ...pt(10, 2, -2), [40, 2], [71, 1], [1, 'Ô dự phòng'],
  ]);
  const text = dxf([
    ...header('AC1021'),
    ...tables([
      ['0', 7],
      ['TABLE', 7],
    ]),
    ...section('BLOCKS', [...block('*Model_Space', [0, 0], []), ...T1, ...T2]),
    ...section('ENTITIES', tableEnts),
    ...eof,
  ]);
  writeFileSync(dir + 'table.dxf', text, 'utf8');
}

// ---------------------------------------------------------------- legacy-vni.dxf (R2000, 8-bit VNI bytes)
{
  const ents = [
    [0, 'TEXT'], [5, '400'], [8, 'VNI'], ...pt(10, 0, 0), [40, 2], [1, 'ÑAÁT ÔÛ'], [7, 'VNI-HELVE'],
    [0, 'TEXT'], [5, '401'], [8, 'VNI'], ...pt(10, 0, 5), [40, 2], [1, 'ÑAÁT TRÖÔØNG MAÀM NON'], [7, 'VNI-HELVE'],
    [0, 'TEXT'], [5, '402'], [8, 'VNI'], ...pt(10, 0, 10), [40, 2], [1, 'P. THÔÙI BÌNH'], [7, 'VNI-HELVE'],
  ];
  const text = dxf([
    ...header('AC1015', [[9, '$DWGCODEPAGE'], [3, 'ANSI_1252']]),
    ...tables(
      [
        ['0', 7],
        ['VNI', 1],
      ],
      [
        ['Standard', 'txt'],
        ['VNI-HELVE', 'VNI-Helve.ttf'],
      ],
    ),
    ...section('ENTITIES', ents),
    ...eof,
  ]);
  // Write as windows-1252 bytes (all chars here are Latin-1).
  writeFileSync(dir + 'legacy-vni.dxf', Buffer.from(text, 'latin1'));
}

console.log('DXF fixtures written to', dir);
