import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity, TableEntity } from '@/lib/cad/types';
import {
  buildKml,
  cdata,
  escapeXml,
  hexToKmlColor,
  kmlColorToHex,
  KMZ_MIME,
  labelScale,
  metresPerDegree,
  toKml,
  toKmz,
  toKmzBytes,
  type ExportOptions,
} from '@/lib/export';
import { checkXml, unescapeXml } from './xmlCheck';

const LNG = 105.74;
const LAT = 10.013;
const VN = 'Đường điện 0,4kV – Cột BTLT';
const LAYER_VN = 'NKIEU-KT-QHCT_Đất quân sự';

const opts: ExportOptions = { name: 'Ninh Kiều', textAsLabels: true, tableAsHtml: true };

function sampleDoc(): CadDocument {
  return {
    units: 'm',
    crs: 'EPSG:4326',
    layers: [
      { name: LAYER_VN, color: '#ff0000', visible: true },
      { name: 'DIEN', color: '#00ff00', visible: true },
      { name: 'AN', color: '#0000ff', visible: false },
    ],
    entities: [
      {
        kind: 'polygon',
        layer: LAYER_VN,
        color: '#ff8000',
        fillOpacity: 0.5,
        rings: [
          [[LNG, LAT], [LNG + 0.001, LAT], [LNG + 0.001, LAT + 0.001], [LNG, LAT + 0.001]],
          [[LNG + 0.0002, LAT + 0.0002], [LNG + 0.0004, LAT + 0.0002], [LNG + 0.0004, LAT + 0.0004]],
        ],
      },
      {
        kind: 'polyline',
        layer: 'DIEN',
        color: '#00ff00',
        width: 0.5,
        closed: true,
        points: [[LNG, LAT], [LNG + 0.001, LAT], [LNG + 0.001, LAT + 0.001]],
      },
      { kind: 'polyline', layer: 'DIEN', color: '#00ff00', closed: false, points: [[LNG, LAT], [LNG, LAT + 0.002]] },
      {
        kind: 'text',
        layer: 'DIEN',
        color: '#ffffff',
        text: VN + '\nTuyến 2',
        position: [LNG, LAT],
        height: 3,
        rotation: 0,
        hAlign: 'left',
        vAlign: 'baseline',
      },
      {
        kind: 'text',
        layer: 'DIEN',
        color: '#ffffff',
        text: `A & B <C> "D" 'E' ]]> end`,
        position: [LNG, LAT],
        height: 1,
        rotation: 0,
        hAlign: 'left',
        vAlign: 'baseline',
      },
      { kind: 'point', layer: 'DIEN', color: '#123456', position: [LNG, LAT] },
      { kind: 'point', layer: 'AN', color: '#123456', position: [LNG, LAT] },
    ],
    bbox: [[LNG, LAT], [LNG + 0.001, LAT + 0.002]],
    warnings: [],
  };
}

function table(): TableEntity {
  return {
    kind: 'table',
    layer: 'DIEN',
    color: '#000000',
    origin: [LNG, LAT],
    rotation: 0,
    rows: 3,
    cols: 3,
    rowHeights: [10, 10, 10],
    colWidths: [20, 20, 20],
    cells: [
      { r: 0, c: 0, rowSpan: 1, colSpan: 3, text: 'BẢNG CHỈ TIÊU' },
      { r: 1, c: 0, rowSpan: 2, colSpan: 1, text: 'Đất ở' },
      { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: 'Mật độ\n60%' },
      { r: 1, c: 2, rowSpan: 1, colSpan: 1, text: 'a<b' },
      { r: 2, c: 1, rowSpan: 1, colSpan: 2, text: 'Tầng cao 5' },
    ],
  };
}

const count = (s: string, sub: string): number => s.split(sub).length - 1;

describe('colour conversion', () => {
  it('converts #rrggbb + alpha to aabbggrr', () => {
    expect(hexToKmlColor('#ff8000')).toBe('ff0080ff');
    expect(hexToKmlColor('#123456', 0.5)).toBe('80563412');
    expect(hexToKmlColor('#abc')).toBe('ffccbbaa');
    expect(hexToKmlColor('bogus')).toBe('ffffffff');
  });
  it('round-trips', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#1a2b3c', '#c0ffee']) {
      for (const a of [0, 0.2, 0.5, 1]) {
        const back = kmlColorToHex(hexToKmlColor(hex, a));
        expect(back.hex).toBe(hex);
        expect(back.alpha).toBeCloseTo(a, 2);
      }
    }
  });
});

describe('escaping', () => {
  it('escapes & < > " \' and NFC-normalises', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
    const decomposed = 'Đất'; // "Đất" in NFD
    expect(escapeXml(decomposed)).toBe('Đất');
    expect(escapeXml('a\u0001b\uD800c' + String.fromCharCode(0xfffe) + 'FEF')).toBe('abcFEF');
    expect(escapeXml('😀')).toBe('😀');
  });
  it('guards ]]> in CDATA', () => {
    const c = cdata('x]]>y');
    expect(c).toBe('<![CDATA[x]]]]><![CDATA[>y]]>');
    checkXml(`<a>${c}</a>`);
  });
});

describe('toKml', () => {
  const kml = toKml(sampleDoc(), opts);

  it('is well-formed KML 2.2 with UTF-8 prolog', () => {
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    checkXml(kml);
  });

  it('has one Folder per visible layer with Vietnamese names', () => {
    expect(kml).toContain(`<Folder><name>${LAYER_VN}</name>`);
    expect(kml).toContain('<Folder><name>DIEN</name>');
    expect(kml).not.toContain('<name>AN</name>');
    expect(count(kml, '<Folder>')).toBe(2);
  });

  it('dedupes shared styles', () => {
    // poly(#ff8000,0.5), line(#00ff00,w=1.5), line(#00ff00,w=1), label x2 scales, point
    expect(count(kml, '<Style id=')).toBe(6);
    expect(kml).toContain('<PolyStyle><color>800080ff</color><fill>1</fill>');
    expect(kml).toContain('<LineStyle><color>ff00ff00</color><width>1.5</width>');
  });

  it('writes geometry correctly', () => {
    // polygon rings closed, outer + inner
    expect(count(kml, '<outerBoundaryIs>')).toBe(1);
    expect(count(kml, '<innerBoundaryIs>')).toBe(1);
    const outer = /<outerBoundaryIs><LinearRing><coordinates>([^<]*)</.exec(kml)![1].split(' ');
    expect(outer.length).toBe(5);
    expect(outer[0]).toBe(outer[4]);
    expect(outer[0]).toBe('105.74000000,10.01300000,0');
    // closed polyline repeats first point
    const ls = /<LineString><tessellate>1<\/tessellate><altitudeMode>clampToGround<\/altitudeMode><coordinates>([^<]*)</.exec(kml)![1].split(' ');
    expect(ls.length).toBe(4);
    expect(ls[0]).toBe(ls[3]);
    expect(count(kml, '<Point>')).toBe(3);
  });

  it('writes text labels with hidden icon, label style and multi-line description', () => {
    expect(kml).toContain(`<name>${VN} Tuyến 2</name>`);
    expect(kml).toContain(`<description><![CDATA[${VN}<br/>Tuyến 2]]></description>`);
    expect(kml).toMatch(/<IconStyle><scale>0<\/scale><Icon><href>[^<]+<\/href><\/Icon><\/IconStyle><LabelStyle><color>ffffffff<\/color><scale>1<\/scale>/);
    expect(kml).toContain('<name>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos; ]]&gt; end</name>');
  });

  it('drops text when textAsLabels is false', () => {
    const k = toKml(sampleDoc(), { ...opts, textAsLabels: false });
    expect(k).not.toContain(VN);
    checkXml(k);
  });

  it('encodes Vietnamese as correct UTF-8 bytes', () => {
    const bytes = new TextEncoder().encode(kml);
    const needle = Buffer.from(VN, 'utf8');
    expect(Buffer.from(bytes).includes(needle)).toBe(true);
    // Spot-check: Đ = C4 90, ư = C6 B0, – = E2 80 93, ộ = E1 BB 99
    expect([...Buffer.from('Đư–ộ', 'utf8')]).toEqual([0xc4, 0x90, 0xc6, 0xb0, 0xe2, 0x80, 0x93, 0xe1, 0xbb, 0x99]);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(kml);
  });

  it('filters layers with opts.layers (including hidden ones)', () => {
    const k = toKml(sampleDoc(), { ...opts, layers: ['AN'] });
    expect(count(k, '<Folder>')).toBe(1);
    expect(k).toContain('<Folder><name>AN</name>');
    expect(k).not.toContain(LAYER_VN);
    checkXml(k);
  });

  it('skips degenerate geometry', () => {
    const d = sampleDoc();
    d.entities = [
      { kind: 'polyline', layer: 'DIEN', color: '#000000', closed: false, points: [[LNG, LAT]] },
      { kind: 'point', layer: 'DIEN', color: '#000000', position: [NaN, LAT] },
    ];
    const r = buildKml(d, opts);
    expect(r.skipped).toBe(2);
    expect(r.placemarks).toBe(0);
    expect(r.kml).not.toContain('<Folder>');
    checkXml(r.kml);
  });
});

describe('labelScale', () => {
  it('follows sqrt(h/3) clamped to [0.5, 2]', () => {
    expect(labelScale(3)).toBe(1);
    expect(labelScale(12)).toBe(2);
    expect(labelScale(100)).toBe(2);
    expect(labelScale(0.1)).toBe(0.5);
    expect(labelScale(0)).toBe(1);
    expect(labelScale(NaN)).toBe(1);
  });
});

describe('tables', () => {
  const d = sampleDoc();
  d.entities = [table()];
  const kml = toKml(d, opts);

  it('is well-formed and in its own sub-folder', () => {
    checkXml(kml);
    expect(kml).toContain('<Folder><name>DIEN</name>\n<Folder><name>Bảng</name>');
  });

  it('emits HTML table with rowspan/colspan', () => {
    const m = /<description><!\[CDATA\[(<table[\s\S]*?<\/table>)\]\]><\/description>/.exec(kml);
    expect(m).not.toBeNull();
    const html = m![1];
    expect(html).toContain('<tr><td colspan="3">BẢNG CHỈ TIÊU</td></tr>');
    expect(html).toContain('<tr><td rowspan="2">Đất ở</td><td>Mật độ<br/>60%</td><td>a&lt;b</td></tr>');
    expect(html).toContain('<tr><td colspan="2">Tầng cao 5</td></tr>');
  });

  it('omits HTML when tableAsHtml is false', () => {
    const k = toKml(d, { ...opts, tableAsHtml: false });
    expect(k).not.toContain('<table');
    checkXml(k);
  });

  it('places cell labels at cell centres and draws merge-aware grid lines', () => {
    const m = metresPerDegree(LAT);
    // Cell (0,0) colspan 3: centre 30 m east, 5 m south of origin.
    const lng = (LNG + 30 / m.lng).toFixed(8);
    const lat = (LAT - 5 / m.lat).toFixed(8);
    expect(kml).toContain(`<name>BẢNG CHỈ TIÊU</name><styleUrl>#s1</styleUrl><Point><altitudeMode>clampToGround</altitudeMode><coordinates>${lng},${lat},0</coordinates>`);
    expect(kml).toContain('<name>Mật độ 60%</name>');
    const grid = /<name>Đường kẻ bảng<\/name>[\s\S]*?<\/Placemark>/.exec(kml)![0];
    // Horizontal: y0 (full), y1 (full), y2 (cols 1-2 only), y3 (full) = 4
    // Vertical: x0 (full), x1 (rows 1-2), x2 (row 1 only), x3 (full) = 4
    expect(count(grid, '<LineString>')).toBe(8);
  });

  it('uses cell.textHeight for label scale, else 40 % of row height', () => {
    const t = table();
    t.cells[0].textHeight = 12; // → scale 2
    t.cells[2].textHeight = 0; // invalid → fallback 0.4 * 10 = 4 m → scale 1.2
    const d2 = sampleDoc();
    d2.entities = [t];
    const k = toKml(d2, opts);
    const styleOf = (name: string): string => {
      const id = new RegExp(`<name>${name}</name>(?:<description>[\\s\\S]*?</description>)?<styleUrl>#(s\\d+)<`).exec(k)![1];
      return new RegExp(`<Style id="${id}">[\\s\\S]*?<LabelStyle><color>[0-9a-f]{8}</color><scale>([\\d.]+)</scale>`).exec(k)![1];
    };
    expect(styleOf('BẢNG CHỈ TIÊU')).toBe('2');
    expect(styleOf('Mật độ 60%')).toBe('1.2');
    expect(styleOf('Đất ở')).toBe('1.2');
  });

  it('respects rotation (90° → table extends northwards)', () => {
    const t = table();
    t.rotation = 90;
    const d2 = sampleDoc();
    d2.entities = [t];
    const k = toKml(d2, opts);
    const m = metresPerDegree(LAT);
    // local (30, 5) → east = 5, north = 30
    const lng = (LNG + 5 / m.lng).toFixed(8);
    const lat = (LAT + 30 / m.lat).toFixed(8);
    expect(k).toContain(`<coordinates>${lng},${lat},0</coordinates>`);
  });
});

describe('KMZ', () => {
  it('unzips to identical doc.kml', async () => {
    const doc = sampleDoc();
    const bytes = await toKmzBytes(doc, opts);
    expect(bytes[0]).toBe(0x50); // 'PK'
    expect(bytes[1]).toBe(0x4b);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(['doc.kml']);
    expect(await zip.file('doc.kml')!.async('string')).toBe(toKml(doc, opts));
  });

  it('returns a Blob with the KMZ mime type', async () => {
    const blob = await toKmz(sampleDoc(), opts);
    expect(blob.type).toBe(KMZ_MIME);
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    expect(unescapeXml(await zip.file('doc.kml')!.async('string'))).toContain(VN);
  });
});

describe('performance', () => {
  it('exports 50k entities in < 2 s', () => {
    const layers = Array.from({ length: 50 }, (_, i) => ({ name: `Lớp ${i}`, color: '#ff0000', visible: true }));
    const entities: CadEntity[] = [];
    for (let i = 0; i < 50_000; i++) {
      const layer = layers[i % 50].name;
      const x = LNG + (i % 1000) * 1e-5;
      const y = LAT + Math.floor(i / 1000) * 1e-5;
      const color = `#${(i % 16).toString(16).repeat(6)}`;
      switch (i % 4) {
        case 0:
          entities.push({ kind: 'polyline', layer, color, closed: false, points: Array.from({ length: 10 }, (_, k) => [x + k * 1e-6, y] as [number, number]) });
          break;
        case 1:
          entities.push({ kind: 'polygon', layer, color, fillOpacity: 0.4, rings: [[[x, y], [x + 1e-5, y], [x + 1e-5, y + 1e-5], [x, y + 1e-5]]] });
          break;
        case 2:
          entities.push({ kind: 'text', layer, color, text: `Thửa đất số ${i}`, position: [x, y], height: 2, rotation: 0, hAlign: 'left', vAlign: 'baseline' });
          break;
        default:
          entities.push({ kind: 'point', layer, color, position: [x, y] });
      }
    }
    const doc: CadDocument = { units: 'm', crs: null, layers, entities, bbox: [[LNG, LAT], [LNG + 0.01, LAT + 0.0005]], warnings: [] };
    const t0 = performance.now();
    const r = buildKml(doc, opts);
    const ms = performance.now() - t0;
    expect(r.placemarks).toBe(50_000);
    expect(count(r.kml, '<Style id=')).toBeLessThan(100);
    expect(ms).toBeLessThan(2000);
    checkXml(r.kml);
  });
});
