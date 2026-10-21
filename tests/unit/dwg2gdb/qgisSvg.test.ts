import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildQgs } from '@/lib/dwg2gdb';
import type { ClassData } from '@/lib/dwg2gdb/features';
import { hatchSvgFor, neededSvgFiles, pointSvgFor, svgToBase64, type SvgIndex, type SvgLibrary } from '@/lib/dwg2gdb/qgisSvg';

const read = (dir: string) => JSON.parse(readFileSync(`${dir}/index.json`, 'utf-8')) as never;
const index: SvgIndex = { hatch: read('tt16-hatch-svg'), point: read('tt16-point-svg') };
const svgOf = (dir: string, file: string) => readFileSync(`${dir}/${file}`, 'utf-8');

const feature = { tenDoiTuong: 'x', phanLoai: 'x', ghiChu: null, refs: [], geometry: { type: 'Point', coordinates: [0, 0] } } as never;
const cls = (over: Partial<ClassData>): ClassData => ({ target: 't', db: 'QuyHoach', dataset: 'd', cls: 'c', geom: 'A', features: [feature], styles: [], ...over });

describe('SVG symbols of Phụ lục I', () => {
  it('the hatch of a symbol is found by its Mục and colour', () => {
    const h = index.hatch.find((x) => x.layer === 'DAT_DD_Donvio')!;
    expect(hatchSvgFor({ symbol: { section: h.muc, aci: h.aci, layer: h.layer, name: h.label } }, index)?.file).toBe(h.file);
    expect(hatchSvgFor({ symbol: undefined }, index)).toBeNull();
    // A colour shared by two symbols: the layer name picks.
    const shared = index.hatch.filter((x) => x.muc === 2 && x.aci === 94);
    expect(shared.length).toBeGreaterThan(1);
    expect(hatchSvgFor({ symbol: { section: 2, aci: 94, layer: shared[1].layer, name: shared[1].label } }, index)?.file).toBe(shared[1].file);
  });

  it('points are found by phanLoai: exact or containing the label, stage by database, infrastructure vs function symbols', () => {
    expect(pointSvgFor('Trạm 110KV', 'P', 'HienTrang', index)?.file).toBe('M8_t104_Tram_110KV_ht.svg');
    expect(pointSvgFor('trạm 110kv', 'P', 'QuyHoach', index)?.file).toMatch(/Tram_110KV_(dd|dh)\.svg$/);
    // Polygons only take function symbols (Mục 2–7), at their centre.
    expect(pointSvgFor('Đất chợ', 'A', 'QuyHoach', index)?.file).toMatch(/^M[2-5]_t\d+_Cho\.svg$/);
    expect(pointSvgFor('Trạm 110KV', 'A', 'QuyHoach', index)).toBeNull();
    expect(pointSvgFor('Chợ', 'P', 'QuyHoach', index)).toBeNull();
    // Generic labels need an exact phanLoai; lines have no point symbol.
    expect(pointSvgFor('Đất ở tổng hợp', 'P', 'QuyHoach', index)).toBeNull();
    expect(pointSvgFor('Trạm 110KV', 'L', 'QuyHoach', index)).toBeNull();
    expect(pointSvgFor(null, 'P', 'QuyHoach', index)).toBeNull();
  });

  it('lists the files a project needs and embeds them in a well-formed QGIS project', () => {
    const h = index.hatch.find((x) => x.layer === 'DAT_DD_Donvio')!;
    const classes = [
      cls({ cls: 'ChucNangSuDungDat_A', styles: [{ phanLoai: 'Đất chợ', color: '#ff7f00', hatch: null, symbol: { section: h.muc, aci: h.aci, layer: h.layer, name: h.label }, count: 3 }, { phanLoai: 'Đất ở', color: '#ffff00', hatch: null, count: 1 }] }),
      cls({ db: 'HienTrang', cls: 'TramDien_P', geom: 'P', styles: [{ phanLoai: 'Trạm 110KV', color: '#000000', hatch: null, count: 2 }] }),
    ];
    const needed = neededSvgFiles(classes, index);
    expect(needed).toContain(`hatch/${h.file}`);
    expect(needed.some((k) => /^point\/M[2-5]_t\d+_Cho\.svg$/.test(k))).toBe(true);
    expect(needed).toContain('point/M8_t104_Tram_110KV_ht.svg');

    const files = new Map(needed.map((k) => [k, svgOf(k.startsWith('hatch/') ? 'tt16-hatch-svg' : 'tt16-point-svg', k.replace(/^[^/]+\//, ''))]));
    const svg: SvgLibrary = { index, files };
    const qgs = buildQgs({ name: 'T', title: 'T', classes, lon0: 105.5, zone: 3, extent: [0, 0, 1, 1], svg });
    createRequire(import.meta.url)('sax').parser(true).write(qgs).close(); // throws on malformed XML
    expect(qgs).toContain('class="SVGFill"');
    expect(qgs).toContain('class="CentroidFill"');
    expect(qgs).toContain('class="SvgMarker"');
    expect(qgs).toContain('base64:');
    // The tile keeps its natural size (no data-defined width).
    expect(qgs).not.toContain('sqrt(area($geometry))');
    // Transparent background under the SVG hatch: the SimpleFill under the first SVGFill has alpha 0.
    const before = qgs.slice(0, qgs.indexOf('class="SVGFill"'));
    expect(before.slice(before.lastIndexOf('class="SimpleFill"')).match(/name="color" value="[^"]*"/)?.[0]).toMatch(/,0"$/);
    // Without the library: the plain symbols.
    const plain = buildQgs({ name: 'T', title: 'T', classes, lon0: 105.5, zone: 3, extent: [0, 0, 1, 1] });
    expect(plain).not.toContain('SVGFill');
    expect(plain).not.toContain('SvgMarker');
  });

  it('base64 of an SVG round-trips (Vietnamese titles included)', () => {
    const text = '<svg><title>Chợ — Số 30</title></svg>';
    const b = svgToBase64(text);
    expect(b.startsWith('base64:')).toBe(true);
    expect(new TextDecoder().decode(Uint8Array.from(atob(b.slice(7)), (c) => c.charCodeAt(0)))).toBe(text);
  });
});
