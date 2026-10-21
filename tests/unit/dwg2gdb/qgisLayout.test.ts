import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildQgs } from '@/lib/dwg2gdb';
import type { ClassData } from '@/lib/dwg2gdb/features';
import { buildLayouts, chooseSheet, gridInterval, GUTTER, scaleBarSegment, windRoseSvg } from '@/lib/dwg2gdb/qgisLayout';

describe('sheet of the print layout', () => {
  it('always A0; a commune of 14 × 9 km gets 1:20.000 and its map fits the frame', () => {
    const s = chooseSheet(14_000, 9_000);
    expect(s).toMatchObject({ paper: 'A0', w: 1189, h: 841, scale: 20000 });
    expect((14_000 / s.scale) * 1000).toBeLessThanOrEqual(s.mapW);
    expect((9_000 / s.scale) * 1000).toBeLessThanOrEqual(s.mapH);
  });
  it('a smaller area gets a more detailed scale, still on A0', () => {
    expect(chooseSheet(5_000, 3_500)).toMatchObject({ paper: 'A0', scale: 10000 });
    expect(chooseSheet(800, 600)).toMatchObject({ paper: 'A0', scale: 1000 });
  });
  it('an extent too big for every listed scale still fits (rounded scale)', () => {
    const s = chooseSheet(900_000, 600_000);
    expect(s.paper).toBe('A0');
    expect((900_000 / s.scale) * 1000).toBeLessThanOrEqual(s.mapW);
    expect(s.scale % 1000).toBe(0);
  });
  it('scale bar segments are round lengths of about 3 cm', () => {
    expect(scaleBarSegment(10000)).toBe(250);
    expect(scaleBarSegment(25000)).toBe(500);
    expect(scaleBarSegment(2000)).toBe(50);
  });
});

describe('the layout in the project', () => {
  const f = { tenDoiTuong: 'x', phanLoai: 'x', ghiChu: null, refs: [], geometry: { type: 'Point', coordinates: [0, 0] } } as never;
  const classes: ClassData[] = [
    { target: 'QuyHoach/QuyHoachSuDungDat/ChucNangSuDungDat_A', db: 'QuyHoach', dataset: 'QuyHoachSuDungDat', cls: 'ChucNangSuDungDat_A', geom: 'A', features: [f], styles: [{ phanLoai: 'Đất ở', color: '#ffff00', hatch: null, count: 1 }, { phanLoai: 'Đất công cộng', color: '#ff0000', hatch: null, count: 1 }] },
    { target: 'QuyHoach/ViTriRanhGioi/TenDonViHanhChinh_P', db: 'QuyHoach', dataset: 'ViTriRanhGioi', cls: 'TenDonViHanhChinh_P', geom: 'P', features: [f], styles: [{ phanLoai: 'Ấp', color: '#000000', hatch: null, count: 1 }] },
  ];
  const qgs = buildQgs({ name: 'T', title: 'QUY HOẠCH CHUNG XÃ A & B', classes, lon0: 105.5, zone: 3, extent: [590000, 1070000, 600000, 1078000] });

  it('is well-formed and holds the frame, map, legend, scale bar and title block', () => {
    createRequire(import.meta.url)('sax').parser(true).write(qgs).close();
    expect(qgs).toContain('<Layouts><Layout name="Bản đồ quy hoạch"');
    for (const type of [65638, 65639, 65640, 65641, 65642, 65643, 65646]) expect(qgs).toContain(`type="${type}"`);
    expect(qgs).toContain('title="CHÚ GIẢI"');
    expect(qgs).toContain('QUY HOẠCH CHUNG XÃ A &amp; B');
    expect(qgs).toContain('item_variables(&apos;map&apos;)[&apos;map_scale&apos;]');
  });
  it('the legend lists the planning layers by their alias, without the names layer', () => {
    const l = buildLayouts({ name: 'n', title: 't', mapName: 'm', extent: [0, 0, 1000, 1000], srs: '<spatialrefsys/>', legend: [{ id: 'a', name: 'A', source: 's', title: 'Chức năng sử dụng đất' }] });
    expect(l).toContain('legend/title-label');
    expect(l).toContain('Chức năng sử dụng đất');
    expect(qgs).toContain('value="Chức năng sử dụng đất"');
    expect(qgs).not.toMatch(/legend\/title-label[^>]*Tên đơn vị hành chính/);
  });
  it('the map is centred on the extent at the sheet scale', () => {
    const m = /<Extent xmin="([0-9.]+)" ymin="([0-9.]+)" xmax="([0-9.]+)" ymax="([0-9.]+)"/.exec(qgs)!;
    expect((+m[1] + +m[3]) / 2).toBeCloseTo(595000, 0);
    expect((+m[2] + +m[4]) / 2).toBeCloseTo(1074000, 0);
  });
});

describe('wind rose (hoa gió)', () => {
  it('is a well-formed SVG with B, Đ, N, T on the main points, embedded in the layout', () => {
    const svg = windRoseSvg();
    createRequire(import.meta.url)('sax').parser(true).write(svg).close();
    for (const t of ['>B<', '>Đ<', '>N<', '>T<']) expect(svg).toContain(t);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(16);
  });
  it('has no outer ring, and sits at the top of the column with the scale bar centred under it, above the legend', () => {
    expect(windRoseSvg()).not.toContain('<circle');
    const l = buildLayouts({ name: 'n', title: 't', mapName: 'm', extent: [0, 0, 5000, 3500], srs: '<spatialrefsys/>', legend: [{ id: 'a', name: 'A', source: 's', title: 'x' }] });
    const at = (id: string) => {
      const m = new RegExp(`id="${id}"[^>]*?position="([0-9.]+),([0-9.]+),mm"[^>]*?size="([0-9.]+),([0-9.]+),mm"`).exec(l)!;
      return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
    };
    const rose = at('hoa_gio');
    const bar = at('thuoc_ty_le');
    const legend = at('chu_giai');
    expect(rose.y).toBeLessThan(bar.y);
    expect(bar.y + bar.h).toBeLessThan(legend.y);
    // The bar (without its label overhang) is centred on the rose, within a few mm.
    const barW = 4 * ((250 / 10000) * 1000);
    expect(Math.abs(bar.x + 3 + barW / 2 - (rose.x + rose.w / 2))).toBeLessThan(1);
  });
});

describe('coordinate grid (lưới tọa độ)', () => {
  it('interval is a round number giving lines about 6 cm apart', () => {
    expect(gridInterval(20000)).toBe(1000);
    expect(gridInterval(10000)).toBe(500);
    expect(gridInterval(5000)).toBe(250);
    expect(gridInterval(2000)).toBe(100);
  });
  it('is on the map with labels on the four sides, and the map leaves room for them inside the sheet frame', () => {
    const l = buildLayouts({ name: 'n', title: 't', mapName: 'm', extent: [590000, 1070000, 600000, 1078000], srs: '<spatialrefsys/>', legend: [] });
    expect(l).toContain('<ComposerMapGrid name="Lưới tọa độ VN-2000"');
    expect(l).toContain('intervalX="1000"');
    expect(l).toContain('annotationFormat="8"');
    expect(l).toContain('gridFrameSideFlags="15"');
    const s = chooseSheet(10_000, 8_000);
    expect(s.mapX).toBe(20 + GUTTER);
    expect(s.mapX + s.mapW + GUTTER).toBe(s.w - 10 - s.panel); // the gutter on the right of the map ends at the column
  });
});
