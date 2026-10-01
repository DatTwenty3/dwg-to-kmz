import { describe, expect, it } from 'vitest';
import type { CadDocument, CadEntity, PolygonEntity, PolylineEntity, TextEntity, PointEntity } from '@/lib/cad/types';
import { labelScale, toKml, toKmzBytes, type ExportOptions } from '@/lib/export';
import { parseCoordinates, parseKmlFile, parseKmlString } from '@/lib/kml';
import { parseXml } from '@/lib/kml/xml';
import { WGS84_PROJ4 } from '@/lib/geo/crs';

const VN = 'Đường điện 0,4kV – Cột BTLT';
const LAYER_VN = 'NKIEU-KT-QHCT_Đất quân sự';
const opts: ExportOptions = { name: 'Ninh Kiều', textAsLabels: true, tableAsHtml: true };

function sample(): CadDocument {
  return {
    units: 'm',
    crs: WGS84_PROJ4,
    layers: [
      { name: LAYER_VN, color: '#ff8000', visible: true },
      { name: 'DIEN', color: '#00ff00', visible: true },
    ],
    entities: [
      {
        kind: 'polygon',
        layer: LAYER_VN,
        color: '#ff8000',
        fillOpacity: 0.4,
        rings: [
          [[105.74, 10.01], [105.742, 10.01], [105.742, 10.012], [105.74, 10.012]],
          [[105.7405, 10.0105], [105.7408, 10.0105], [105.7408, 10.0108], [105.7405, 10.0108]],
        ],
      },
      { kind: 'polyline', layer: 'DIEN', color: '#00ff00', points: [[105.74, 10.013], [105.741, 10.0135], [105.742, 10.013]], closed: false },
      { kind: 'polyline', layer: 'DIEN', color: '#00ff00', points: [[105.74, 10.02], [105.741, 10.02], [105.741, 10.021]], closed: true },
      { kind: 'text', layer: 'DIEN', color: '#0000ff', text: VN, position: [105.7411, 10.0131], height: 12, rotation: 0, hAlign: 'left', vAlign: 'baseline' },
      { kind: 'text', layer: 'DIEN', color: '#ff0000', text: 'Dòng một\nDòng hai & <ba>', position: [105.7412, 10.0132], height: 3, rotation: 0, hAlign: 'left', vAlign: 'baseline' },
      { kind: 'point', layer: 'DIEN', color: '#112233', position: [105.7413, 10.0133] },
      {
        kind: 'table',
        layer: 'DIEN',
        color: '#abcdef',
        origin: [105.75, 10.03],
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
      },
    ],
    bbox: [[0, 0], [1, 1]],
    warnings: [],
  };
}

const ofKind = <K extends CadEntity['kind']>(d: CadDocument, k: K): Extract<CadEntity, { kind: K }>[] =>
  d.entities.filter((e): e is Extract<CadEntity, { kind: K }> => e.kind === k);

describe('XML reader', () => {
  it('handles entities, CDATA, comments, namespaces, self-closing tags and bad nesting', () => {
    const root = parseXml(
      '﻿<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><kml:kml xmlns:kml="k"><!-- c <x> -->' +
        '<a id=\'1\' b="x &gt; y"><name>A &amp; B &#7845; &#x1EA5; &unknown;</name><d><![CDATA[<b>&amp;</b>]]></d><e/></a></kml:kml>',
    );
    const kml = root.children[0];
    expect(kml.name).toBe('kml');
    const a = kml.children[0];
    expect(a.attrs).toEqual({ id: '1', b: 'x > y' });
    expect(a.children[0].text).toBe('A & B ấ ấ &unknown;');
    expect(a.children[1].text).toBe('<b>&amp;</b>');
    expect(a.children[2].name).toBe('e');
    const bad = parseXml('<a><b><c>t</b>x</a>');
    expect(bad.children[0].children[0].children[0].text).toBe('t');
  });

  it('parses coordinates tolerantly', () => {
    const r = parseCoordinates('\n 105.1,10.2,0   105.2,10.3\n105.3,xx,0 200,10,0 foo');
    expect(r.points).toEqual([[105.1, 10.2], [105.2, 10.3]]);
    expect(r.bad).toBe(3);
  });
});

describe('round trip with our own KML export', () => {
  const src = sample();
  const back = parseKmlString(toKml(src, opts));

  it('is WGS84 degrees with a robust bbox', () => {
    expect(back.crs).toBe(WGS84_PROJ4);
    expect(back.units).toBe('deg');
    expect(back.bbox[0][0]).toBeCloseTo(105.74, 6);
    expect(back.bbox[1][1]).toBeCloseTo(10.03, 3);
  });

  it('keeps layers in order, Vietnamese names, table folder', () => {
    expect(back.layers).toHaveLength(3);
    expect(back.layers[0].name).toBe(LAYER_VN);
    expect(back.layers[1].name).toBe('DIEN');
    expect(back.layers[2].name).toMatch(/^Bảng/);
    expect(back.layers[0].color).toBe('#ff8000');
    expect(back.layers[1].color).toBe('#00ff00');
  });

  it('polygon: rings, colour and fill opacity round-trip', () => {
    const [p] = ofKind(back, 'polygon') as PolygonEntity[];
    expect(p.layer).toBe(LAYER_VN);
    expect(p.rings).toHaveLength(2);
    expect(p.rings[0]).toHaveLength(4);
    expect(p.rings[1][0][0]).toBeCloseTo(105.7405, 7);
    expect(p.color).toBe('#ff8000');
    expect(p.fillOpacity).toBeCloseTo(0.4, 2);
  });

  it('polylines: open and closed, colour exact', () => {
    const pl = (ofKind(back, 'polyline') as PolylineEntity[]).filter((e) => e.layer === 'DIEN');
    const open = pl.find((e) => !e.closed)!;
    const closed = pl.find((e) => e.closed)!;
    expect(open.points).toHaveLength(3);
    expect(open.color).toBe('#00ff00');
    expect(open.points[1][0]).toBeCloseTo(105.741, 8);
    expect(open.points[1][1]).toBeCloseTo(10.0135, 8);
    expect(closed.points).toHaveLength(3);
  });

  it('text: exact UTF-8 name, colour, multi-line restored, height from label scale', () => {
    const texts = ofKind(back, 'text') as TextEntity[];
    const t = texts.find((x) => x.text === VN)!;
    expect(t).toBeTruthy();
    expect(t.color).toBe('#0000ff');
    expect(t.height).toBeCloseTo(3 * labelScale(12) ** 2, 9); // scale 2 → 12 m
    expect(t.height).toBe(12);
    expect(t.hAlign).toBe('left');
    expect(t.vAlign).toBe('middle');
    const m = texts.find((x) => x.text.startsWith('Dòng một'))!;
    expect(m.text).toBe('Dòng một\nDòng hai & <ba>');
    expect(m.height).toBe(3);
    expect(m.color).toBe('#ff0000');
    // label placemarks (icon scale 0) do not also create points
    expect((ofKind(back, 'point') as PointEntity[]).filter((p) => p.layer === 'DIEN')).toHaveLength(1);
  });

  it('table becomes grid polylines + cell texts; the HTML placemark is dropped', () => {
    const layer = back.layers.find((l) => l.name.startsWith('Bảng'))!.name;
    const inTable = back.entities.filter((e) => e.layer === layer);
    expect(inTable.some((e) => e.kind === 'polyline')).toBe(true);
    const txt = inTable
      .filter((e): e is TextEntity => e.kind === 'text')
      .map((t) => t.text)
      .sort();
    expect(txt).toEqual(['12,5 ha', 'Bảng thống kê', 'Đất ở'].sort());
    expect(inTable.some((e) => e.kind === 'point')).toBe(false);
    expect(back.entities.some((e) => e.kind === 'text' && e.text.includes('HTML'))).toBe(false);
  });

  it('KMZ: zip with doc.kml parses identically; plain .kml too', async () => {
    const bytes = await toKmzBytes(src, opts);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const fromZip = await parseKmlFile(ab, 'x.kmz');
    expect(fromZip.entities).toEqual(back.entities);
    const kmlBytes = new TextEncoder().encode(toKml(src, opts));
    const plain = await parseKmlFile(kmlBytes.buffer.slice(0) as ArrayBuffer, 'x.kml');
    expect(plain.entities).toEqual(back.entities);
  });
});

describe('foreign KML', () => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document><name>Tài liệu</name>
 <Style id="red"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle><PolyStyle><color>800000ff</color></PolyStyle></Style>
 <Style id="nofill"><LineStyle><color>ff00ff00</color></LineStyle><PolyStyle><fill>0</fill><color>ffffffff</color></PolyStyle></Style>
 <Style id="n"><IconStyle><color>ffff0000</color><scale>1</scale></IconStyle><LabelStyle><color>ff00ffff</color><scale>2</scale></LabelStyle></Style>
 <StyleMap id="sm"><Pair><key>normal</key><styleUrl>#red</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#nofill</styleUrl></Pair></StyleMap>
 <Placemark><name>Gốc</name><Point><coordinates>105.0,10.0,0</coordinates></Point></Placemark>
 <Folder><name>Lớp A</name>
  <Folder><name></name>
   <Placemark><styleUrl>#sm</styleUrl><LineString><coordinates>105,10 105.1,10.1</coordinates></LineString></Placemark>
  </Folder>
  <Placemark><styleUrl>#sm</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>105,10 105.1,10 105.1,10.1 105,10</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  <Placemark><styleUrl>#nofill</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>105,10 105.1,10 105.1,10.1 105,10</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>105.02,10.01 105.05,10.01 105.05,10.03</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Cột &amp; trụ</name><styleUrl>#n</styleUrl><Point><coordinates>105.5,10.5</coordinates></Point></Placemark>
  <Placemark><name>anon</name><MultiGeometry><Point><coordinates>105.6,10.6</coordinates></Point><LineString><coordinates>105,10 105.2,10.2</coordinates></LineString></MultiGeometry></Placemark>
  <Placemark><gx:Track><gx:coord>1 2 3</gx:coord></gx:Track></Placemark>
  <Placemark><Model><Location/></Model></Placemark>
  <GroundOverlay><name>img</name></GroundOverlay>
 </Folder>
 <Placemark><Point><coordinates>105.7,10.7</coordinates></Point></Placemark>
</Document></kml>`;
  const d = parseKmlString(kml);

  it('layer = innermost named folder, Document name as fallback', () => {
    expect(d.layers.map((l) => l.name)).toEqual(['Tài liệu', 'Lớp A']);
    expect(d.entities[0].layer).toBe('Tài liệu');
    expect(d.entities.filter((e) => e.layer === 'Tài liệu')).toHaveLength(3); // text + point + last point
  });

  it('resolves StyleMap normal pair and colours (aabbggrr → #rrggbb)', () => {
    const line = (d.entities.filter((e) => e.kind === 'polyline') as PolylineEntity[]).find(
      (e) => !e.closed && e.points.length === 2 && e.layer === 'Lớp A',
    )!;
    expect(line.color).toBe('#ff0000');
    const polys = d.entities.filter((e) => e.kind === 'polygon') as PolygonEntity[];
    expect(polys).toHaveLength(1);
    expect(polys[0].color).toBe('#ff0000');
    expect(polys[0].fillOpacity).toBeCloseTo(0x80 / 255, 6);
    expect(polys[0].rings[0]).toHaveLength(3);
  });

  it('fill=0 polygons become closed polylines (outer + hole)', () => {
    const closed = (d.entities.filter((e) => e.kind === 'polyline') as PolylineEntity[]).filter((e) => e.closed);
    expect(closed).toHaveLength(2);
    expect(closed[0].color).toBe('#00ff00');
  });

  it('named point → text (label scale 2 → 12 m, colour) + point', () => {
    const texts = d.entities.filter((e) => e.kind === 'text') as TextEntity[];
    const t = texts.find((x) => x.text === 'Cột & trụ')!;
    expect(t.height).toBe(12);
    expect(t.color).toBe('#ffff00');
    const pts = d.entities.filter((e) => e.kind === 'point') as PointEntity[];
    expect(pts.find((p) => p.position[0] === 105.5)!.color).toBe('#0000ff');
    expect(texts.find((x) => x.text === 'Gốc')!.height).toBe(3);
  });

  it('MultiGeometry is recursed; tracks / models / overlays give one warning each type', () => {
    expect(d.entities.some((e) => e.kind === 'point' && e.position[0] === 105.6)).toBe(true);
    expect(d.warnings.filter((w) => w.includes('gx:Track'))).toHaveLength(1);
    expect(d.warnings.filter((w) => w.includes('Model'))).toHaveLength(1);
    expect(d.warnings.filter((w) => w.includes('GroundOverlay'))).toHaveLength(1);
  });

  it('empty / garbage input gives a warning, not an exception', () => {
    expect(parseKmlString('').warnings.length).toBeGreaterThan(0);
    const g = parseKmlString('<kml><Placemark><name>x</name><Point><coordinates>zz</coordinates></Point></Placemark>');
    expect(g.entities).toHaveLength(0);
  });
});

describe('performance', () => {
  it('parses ~15k placemarks / >10 MB KML in < 1.5 s', () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 12000; i++) {
      const pts: [number, number][] = [];
      for (let k = 0; k < 40; k++) pts.push([105.7 + i * 1e-5 + k * 1e-6, 10 + k * 1.5e-6 + i * 1e-6]);
      entities.push({ kind: 'polyline', layer: 'L' + (i % 50), color: '#336699', points: pts, closed: false });
    }
    for (let i = 0; i < 3000; i++) {
      entities.push({ kind: 'text', layer: 'T', color: '#ffffff', text: 'Đường ' + i, position: [105.7 + i * 1e-5, 10.1], height: 3, rotation: 0, hAlign: 'left', vAlign: 'baseline' });
    }
    const doc: CadDocument = { units: 'm', crs: WGS84_PROJ4, layers: [], entities, bbox: [[0, 0], [0, 0]], warnings: [] };
    const kml = toKml(doc, opts);
    expect(kml.length).toBeGreaterThan(10_000_000);
    const t0 = performance.now();
    const back = parseKmlString(kml);
    const ms = performance.now() - t0;
    expect(back.entities).toHaveLength(15000);
    console.log(`parse ${(kml.length / 1e6).toFixed(1)} MB in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});
