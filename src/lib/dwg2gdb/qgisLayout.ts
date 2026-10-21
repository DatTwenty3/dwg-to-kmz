// The print layout of the QGIS project: "kẻ khung bản vẽ" (sheet frame), the map, the legend ("chú giải"), a scale bar
// and a title block ("khung tên"). Written as the <Layouts> element of the .qgs (QGIS 3 layout XML, only the attributes
// QGIS needs — the rest takes its defaults). Sizes in mm. Pure.

import { svgToBase64 } from './qgisSvg';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** The sheet of the planning maps: A0, landscape (mm). */
export const SHEET = { name: 'A0', w: 1189, h: 841 } as const;
/** Scales tried, the most detailed first. */
export const SCALES = [1000, 2000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 100000, 250000];

export interface Sheet {
  paper: string;
  /** Page size, mm (landscape). */
  w: number;
  h: number;
  scale: number;
  /** Width of the right column (legend + title block), mm. */
  panel: number;
  /** Map frame, mm: x from the page's left edge. */
  mapX: number;
  mapY: number;
  mapW: number;
  mapH: number;
}

/** Left margin of the frame (to bind) and the others, as on a standard drawing sheet. */
export const MARGIN_LEFT = 20;
export const MARGIN = 10;
const FILL = 0.96;
/** Room between the sheet frame and the map for the coordinate labels of the grid (mm). */
export const GUTTER = 18;

/** Type size factor of a sheet: A1 is the reference, never below 70 %. */
export const typeFactor = (width: number) => Math.max(0.7, Math.sqrt(width / 841));

/** Height of the title block and the scale bar (mm at A1). */
const TITLE_BLOCK = 86;
const SCALE_BAR = 24;

/**
 * The A0 sheet and the most detailed scale (1:1.000 … 1:250.000) at which the extent (metres) fits the map frame —
 * beyond the listed scales, the scale that fits rounded up to 1.000.
 */
export function chooseSheet(extentW: number, extentH: number): Sheet {
  const p = SHEET;
  const panel = Math.round(p.w * 0.22);
  const make = (scale: number): Sheet => ({ paper: p.name, w: p.w, h: p.h, scale, panel, mapX: MARGIN_LEFT + GUTTER, mapY: MARGIN + GUTTER, mapW: p.w - MARGIN_LEFT - MARGIN - panel - 2 * GUTTER, mapH: p.h - 2 * MARGIN - 2 * GUTTER });
  const base = make(1);
  for (const scale of SCALES) if ((extentW / scale) * 1000 <= base.mapW * FILL && (extentH / scale) * 1000 <= base.mapH * FILL) return make(scale);
  const need = Math.max((extentW * 1000) / (base.mapW * FILL), (extentH * 1000) / (base.mapH * FILL));
  return make(Math.ceil(need / 1000) * 1000);
}

/** A round length (m) of about 3 cm on the sheet, for the scale bar segments. */
export function scaleBarSegment(scale: number): number {
  const target = scale * 0.03;
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]);
}

/**
 * "Hoa gió" (compass rose) as SVG: eight two-tone points (no outer ring), B (Bắc) / Đ / N / T on the four main ones.
 * A plain direction symbol — it carries no wind data (a wind rose with frequencies comes from the climate data of
 * the plan, drawn by the office).
 */
export function windRoseSvg(): string {
  const c = 100;
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180; // 0° = north (up), clockwise
    return `${Math.round((c + r * Math.sin(a)) * 100) / 100},${Math.round((c - r * Math.cos(a)) * 100) / 100}`;
  };
  const points = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const main = deg % 90 === 0;
    const tip = main ? 76 : 54;
    const half = main ? 45 : 22.5;
    const base = main ? 17 : 15;
    return (
      `<polygon points="${c},${c} ${pt(deg, tip)} ${pt(deg - half, base)}" fill="#ffffff" stroke="#000000" stroke-width="1" stroke-linejoin="round"/>` +
      `<polygon points="${c},${c} ${pt(deg, tip)} ${pt(deg + half, base)}" fill="#000000" stroke="#000000" stroke-width="1" stroke-linejoin="round"/>`
    );
  });
  const letter = (t: string, x: number, y: number) =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial" font-size="20" font-weight="bold" fill="#000000">${t}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">` +
    `${points.join('')}${letter('B', 100, 18)}${letter('Đ', 187, 107)}${letter('N', 100, 196)}${letter('T', 13, 107)}</svg>`
  );
}

/** Grid interval (m): a round value giving lines about 6 cm apart on the sheet. */
export function gridInterval(scale: number): number {
  const target = scale * 0.06;
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000];
  return steps.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), steps[0]);
}

const uuid = (n: number) => `{00000000-0000-4000-8000-${String(n).padStart(12, '0')}}`;

const DDP = '<dataDefinedProperties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></dataDefinedProperties>';
const OBJ = `<LayoutObject>${DDP}<customproperties><Option/></customproperties></LayoutObject>`;
const SYMBOL_DDP = '<data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties>';
const COLORS = '<FrameColor alpha="255" blue="0" green="0" red="0"/><BackgroundColor alpha="255" blue="255" green="255" red="255"/>';

/** Common attributes of a layout item. */
function itemAttrs(type: number, id: string, n: number, x: number, y: number, w: number, h: number, z: number, extra = '', background = false, frame = false) {
  return (
    `<LayoutItem type="${type}" id="${esc(id)}" uuid="${uuid(n)}" templateUuid="${uuid(n)}" groupUuid="" background="${background}" frame="${frame}" frameJoinStyle="miter" ` +
    `blendMode="0" excludeFromExports="0" itemRotation="0" opacity="1" outlineWidthM="0.3,mm" positionLock="false" referencePoint="0" visibility="1" zValue="${z}" ` +
    `position="${num(x)},${num(y)},mm" positionOnPage="${num(x)},${num(y)},mm" size="${num(w)},${num(h)},mm"${extra ? ' ' + extra : ''}>`
  );
}

const textStyle = (pt: number, bold = false, italic = false) =>
  `<text-style fontFamily="Arial" fontSize="${num(pt)}" fontSizeUnit="Point" fontWeight="${bold ? 700 : 400}" fontItalic="${italic ? 1 : 0}" fontKerning="1" blendMode="0" capitalization="0" namedStyle="" textColor="0,0,0,255,rgb:0,0,0,1" textOpacity="1" multilineHeight="1" multilineHeightUnit="Percentage" textOrientation="horizontal"><families/></text-style>`;

const rectSymbol = (outline: number, fill = '0,0,0,0', style = 'solid') =>
  `<symbol alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0" name="" type="fill">${SYMBOL_DDP}` +
  `<layer class="SimpleFill" enabled="1" id="{0e47bb97-9b44-4da8-802b-235ac270f554}" locked="0" pass="0"><Option type="Map">` +
  `<Option name="color" type="QString" value="${fill}"/><Option name="joinstyle" type="QString" value="miter"/><Option name="offset" type="QString" value="0,0"/>` +
  `<Option name="offset_unit" type="QString" value="MM"/><Option name="outline_color" type="QString" value="0,0,0,255"/><Option name="outline_style" type="QString" value="${style}"/>` +
  `<Option name="outline_width" type="QString" value="${outline}"/><Option name="outline_width_unit" type="QString" value="MM"/><Option name="style" type="QString" value="solid"/></Option>${SYMBOL_DDP}</layer></symbol>`;

export interface LegendLayer {
  id: string;
  /** Name in the layer tree (as in the project). */
  name: string;
  source: string;
  /** Heading shown in the legend (the Thông tư alias). */
  title: string;
}

export interface LayoutInput {
  /** Layout name ("Bản đồ quy hoạch"). */
  name: string;
  /** Title of the planning project ("QUY HOẠCH CHUNG XÃ LONG HIỆP…"). */
  title: string;
  /** Name of the map in the title block ("BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT"). */
  mapName: string;
  /** Project extent [xmin, ymin, xmax, ymax] in VN-2000 metres. */
  extent: [number, number, number, number];
  /** <spatialrefsys> of the project (the grid is in its coordinates). */
  srs: string;
  legend: LegendLayer[];
}

/** The <Layouts> element for the project. */
export function buildLayouts(p: LayoutInput): string {
  const [x0, y0, x1, y1] = p.extent;
  const sheet = chooseSheet(x1 - x0, y1 - y0);
  const { w: W, h: H, scale, panel, mapX, mapY, mapW, mapH } = sheet;
  const k = typeFactor(W);
  const pt = (v: number) => Math.round(v * k * 10) / 10;
  const mm = (v: number) => Math.round(v * k * 10) / 10;

  const px = mapX + mapW + GUTTER; // left edge of the right column
  const items: string[] = [];
  let n = 1;
  let z = 1;

  const rect = (x: number, y: number, w: number, h: number, outline: number) =>
    items.push(`${itemAttrs(65643, '', ++n, x, y, w, h, z++, 'shapeType="1" cornerRadiusMeasure="0,mm"')}${COLORS}${OBJ}${rectSymbol(outline)}</LayoutItem>`);
  const label = (text: string, x: number, y: number, w: number, h: number, size: number, o: { bold?: boolean; italic?: boolean; h?: 'left' | 'center' | 'right'; id?: string } = {}) =>
    items.push(
      `${itemAttrs(65641, o.id ?? '', ++n, x, y, w, h, z++, `labelText="${esc(text)}" halign="${o.h === 'left' ? 1 : o.h === 'right' ? 2 : 4}" valign="128" marginX="1" marginY="0" htmlState="0"`)}${COLORS}${OBJ}${textStyle(size, o.bold, o.italic)}</LayoutItem>`,
    );

  // Map: fills the left part of the frame, centred on the project extent at the sheet's scale.
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = ((mapW / 1000) * scale) / 2;
  const hh = ((mapH / 1000) * scale) / 2;
  const mapUuid = uuid(1);
  // Coordinate grid ("lưới tọa độ VN-2000"): thin lines every `interval` m, a zebra frame with the values (1.074.000)
  // on the four sides, Northing on the left / right and Easting on top / bottom.
  const interval = gridInterval(scale);
  const gridXml =
    `<ComposerMapGrid name="Lưới tọa độ VN-2000" uuid="${uuid(900)}" show="1" showAnnotation="1" gridStyle="0" unit="0" intervalX="${interval}" intervalY="${interval}" offsetX="0" offsetY="0" ` +
    `crossLength="3" blendMode="0" annotationFormat="8" annotationPrecision="0" annotationExpression="${esc("replace(format_number(@grid_number, 0), ',', '.')")}" ` +
    `frameAnnotationDistance="${mm(1.5)}" gridFrameStyle="1" gridFrameWidth="${mm(2)}" gridFramePenThickness="0.25" gridFramePenColor="0,0,0,255" gridFrameSideFlags="15" gridFrameMargin="0" ` +
    `frameFillColor1="255,255,255,255" frameFillColor2="0,0,0,255" ` +
    `leftAnnotationPosition="1" rightAnnotationPosition="1" topAnnotationPosition="1" bottomAnnotationPosition="1" ` +
    `leftAnnotationDisplay="0" rightAnnotationDisplay="0" topAnnotationDisplay="0" bottomAnnotationDisplay="0" ` +
    `leftAnnotationDirection="1" rightAnnotationDirection="2" topAnnotationDirection="0" bottomAnnotationDirection="0" ` +
    `leftFrameDivisions="0" rightFrameDivisions="0" topFrameDivisions="0" bottomFrameDivisions="0" rotatedAnnotationsEnabled="0" rotatedTicksEnabled="0">` +
    `<lineStyle><symbol alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0" name="" type="line">${SYMBOL_DDP}` +
    `<layer class="SimpleLine" enabled="1" id="{4580dc12-9907-4296-b904-1bfae8f5dba1}" locked="0" pass="0"><Option type="Map"><Option name="capstyle" type="QString" value="flat"/>` +
    `<Option name="line_color" type="QString" value="90,90,90,255"/><Option name="line_style" type="QString" value="solid"/><Option name="line_width" type="QString" value="0.15"/>` +
    `<Option name="line_width_unit" type="QString" value="MM"/></Option>${SYMBOL_DDP}</layer></symbol></lineStyle>` +
    `${p.srs}${textStyle(pt(8))}${OBJ}</ComposerMapGrid>`;
  items.push(
    `${itemAttrs(65639, 'map', 1, mapX, mapY, mapW, mapH, z++, 'keepLayerSet="false" followPreset="false" followPresetName="" drawCanvasItems="true" mapRotation="0" mapFlags="0" isTemporal="0" enableZRange="0" labelMargin="0,mm"', true)}${COLORS}${OBJ}` +
      `<Extent xmin="${num(cx - hw)}" ymin="${num(cy - hh)}" xmax="${num(cx + hw)}" ymax="${num(cy + hh)}"/><LayerSet/>${gridXml}<AtlasMap atlasDriven="0" margin="0.1" scalingMode="2"/><labelBlockingItems/>` +
      `<atlasClippingSettings clippingType="1" enabled="0" forceLabelsInside="0" restrictLayers="0"><layersToClip/></atlasClippingSettings><itemClippingSettings clipSource="" clippingType="1" enabled="0" forceLabelsInside="0"/></LayoutItem>`,
  );

  // Frame of the sheet and the line between the map and the right column.
  rect(MARGIN_LEFT, MARGIN, W - MARGIN_LEFT - MARGIN, H - 2 * MARGIN, 0.7);
  rect(px, MARGIN, panel, H - 2 * MARGIN, 0.35);

  // The top of the column: the wind rose (hoa gió), the scale bar centred under it, then the legend.
  const rose = mm(46);
  const roseY = MARGIN + mm(5);
  const seg = scaleBarSegment(scale);
  const segments = 4;
  const segMm = (seg / scale) * 1000;
  const sbH = mm(SCALE_BAR - 10);
  const sbY = roseY + rose + mm(2);
  const legendY = sbY + sbH + mm(6);
  const colCx = px + panel / 2;

  // Legend ("chú giải") below them; its size follows its content.
  const lg = (name: string, pts: number, bold: boolean, extra = '') =>
    `<style name="${name}" alignment="1" indent="0"${extra}>${textStyle(pts, bold)}</style>`;
  const legendStyles =
    `<styles>${lg('title', pt(12), true, ' marginBottom="2"')}${lg('group', pt(9), true, ' marginTop="2"')}${lg('subgroup', pt(9), true, ' marginTop="3"')}` +
    `${lg('symbol', pt(8), false, ' marginTop="1.5"')}${lg('symbolLabel', pt(8), false, ' marginTop="1.5" marginLeft="2"')}</styles>`;
  const legendTree = p.legend
    .map(
      (l) =>
        `<layer-tree-layer id="${esc(l.id)}" name="${esc(l.name)}" source="${esc(l.source)}" providerKey="ogr" checked="Qt::Checked" expanded="1" legend_exp="" legend_split_behavior="0" patch_size="-1,-1">` +
        `<customproperties><Option type="Map"><Option name="legend/title-label" type="QString" value="${esc(l.title)}"/><Option name="legend/title-style" type="QString" value="subgroup"/></Option></customproperties></layer-tree-layer>`,
    )
    .join('');
  items.push(
    `${itemAttrs(65642, 'chu_giai', ++n, px + 3, legendY, panel - 6, 10, z++, `map_uuid="${mapUuid}" title="CHÚ GIẢI" titleAlignment="1" resizeToContents="1" boxSpace="2" columnCount="1" columnSpace="2" symbolWidth="${mm(7)}" symbolHeight="${mm(4)}" symbolAlignment="1" splitLayer="0" equalColumnWidth="0" legendFilterByAtlas="0" maxSymbolSize="0" minSymbolSize="0" wmsLegendWidth="50" wmsLegendHeight="25" rasterBorder="0" wrapChar=""`)}${COLORS}${OBJ}` +
      `${legendStyles}<layer-tree-group><customproperties><Option/></customproperties>${legendTree}<custom-order enabled="0">${p.legend.map((l) => `<item>${esc(l.id)}</item>`).join('')}</custom-order></layer-tree-group></LayoutItem>`,
  );

  // Title block ("khung tên") at the bottom of the column: project, map, scale and date, who drew it.
  const tbH = mm(TITLE_BLOCK);
  const ty = H - MARGIN - tbH;
  const rows = [mm(36), mm(16), mm(12), mm(22)];
  rect(px, ty, panel, tbH, 0.5);
  let ry = ty;
  rows.forEach((rh, i) => {
    if (i) rect(px, ry, panel, rh, 0.35);
    ry += rh;
  });
  ry = ty;
  label('ĐỒ ÁN', px, ry + 1, panel, mm(5), pt(8), { italic: true });
  label(p.title, px + 2, ry + mm(6), panel - 4, rows[0] - mm(8), pt(11), { bold: true });
  ry += rows[0];
  label(p.mapName, px + 2, ry, panel - 4, rows[1], pt(12), { bold: true });
  ry += rows[1];
  label("[% 'TỶ LỆ 1/' || replace(format_number(item_variables('map')['map_scale'], 0), ',', '.') %]", px, ry, panel / 2, rows[2], pt(10), { bold: true, id: 'ty_le' });
  label("[% 'NGÀY ' || format_date(now(), 'dd/MM/yyyy') %]", px + panel / 2, ry, panel / 2, rows[2], pt(10), { bold: true });
  ry += rows[2];
  label('Đơn vị lập: ............................................', px + 2, ry + mm(3), panel - 4, mm(8), pt(9), { h: 'left' });
  label('Chủ trì: ...................................................', px + 2, ry + mm(11), panel - 4, mm(8), pt(9), { h: 'left' });

  // Wind rose at the top of the column, centred.
  items.push(
    `${itemAttrs(65640, 'hoa_gio', ++n, colCx - rose / 2, roseY, rose, rose, z++, `file="${esc(svgToBase64(windRoseSvg()))}" mode="0" resizeMode="0" anchorPoint="0" pictureWidth="${num(rose)}" pictureHeight="${num(rose)}" pictureRotation="0" northMode="0" northOffset="0" mapUuid="" svgFillColor="255,255,255,255,rgb:1,1,1,1" svgBorderColor="0,0,0,255,rgb:0,0,0,1" svgBorderWidth="0.2"`)}${COLORS}${OBJ}</LayoutItem>`,
  );

  // Scale bar under the wind rose: the bar itself (not its labels) is centred on the rose.
  const barW = segments * segMm;
  items.push(
    `${itemAttrs(65646, 'thuoc_ty_le', ++n, colCx - barW / 2 - mm(2.5), sbY, barW + mm(24), sbH, z++, `mapUuid="${mapUuid}" style="Single Box" unitType="meters" unitLabel="m" numSegments="${segments}" numSegmentsLeft="0" numUnitsPerSegment="${seg}" numMapUnitsPerScaleBarUnit="1" numSubdivisions="1" segmentSizeMode="0" segmentMillimeters="${num(segMm)}" minBarWidth="20" maxBarWidth="${num(panel - 10)}" height="${mm(3)}" labelBarSpace="${mm(3)}" boxContentSpace="1" alignment="0" lineCapStyle="square" lineJoinStyle="miter" outlineWidth="0.3" subdivisionsHeight="1.5" method="HorizontalAverage"`)}${COLORS}${OBJ}${textStyle(pt(9))}</LayoutItem>`,
  );

  const page =
    `<PageCollection>${rectSymbol(0, '255,255,255,255', 'no')}` +
    `${itemAttrs(65638, '', 0, 0, 0, W, H, 0, '', true)}${COLORS}${OBJ}</LayoutItem><GuideCollection visible="1"/></PageCollection>`;

  return (
    `<Layouts><Layout name="${esc(p.name)}" units="mm" printResolution="300" worldFileMap="">` +
    `<Snapper snapToGrid="0" snapToGuides="1" snapToItems="1" tolerance="5"/><Grid offsetUnits="mm" offsetX="0" offsetY="0" resUnits="mm" resolution="10"/>` +
    `${page}${items.join('')}<customproperties><Option type="Map"><Option name="singleFile" type="bool" value="true"/></Option></customproperties>` +
    `<Atlas coverageLayer="" enabled="0" filenamePattern="'output_'||@atlas_featurenumber" filterFeatures="0" hideCoverage="0" pageNameExpression="" sortFeatures="0"/></Layout></Layouts>`
  );
}
