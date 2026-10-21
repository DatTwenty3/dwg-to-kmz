// The "Bản vẽ CAD" group of the QGIS project: the layers of BanVeCAD.gpkg (cadLayers.ts) drawn as AutoCAD draws
// them — widths in map units (metres), the colour of each object, solid fills, hatch line families, texts of the
// drawing height / rotation / alignment — all data-defined from the fields of the layers.
import { CAD_GPKG, CAD_TABLES, type CadTable } from './cadLayers';
import { dataDefined, esc, layerXml, symbolOpen, vectorLayerXml, type DataDefined } from './qgisXml';

const MAP_UNIT_SCALE = '3x:0,0,0,0,0,0';
const KEY = (n: number) => `{c4d00000-0000-4000-8000-${String(n).padStart(12, '0')}}`;

export interface CadLayerInfo {
  table: CadTable;
  id: string;
  name: string;
  source: string;
}

/** The CAD layers that have objects, top of the drawing order first (texts, points, lines, areas). */
export function cadLayerList(counts: Record<CadTable, number>): CadLayerInfo[] {
  const names: Record<CadTable, string> = { texts: 'Chữ', points: 'Điểm', lines: 'Đường và ký hiệu', areas: 'Vùng đặc và mẫu tô' };
  return (['texts', 'points', 'lines', 'areas'] as CadTable[])
    .filter((t) => counts[t] > 0)
    .map((table) => ({ table, id: `cad_${CAD_TABLES[table]}`, name: `CAD — ${names[table]}`, source: `./${CAD_GPKG}.gpkg|layername=${CAD_TABLES[table]}` }));
}

const hexRgba = (hex: string) => `${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0).join(',')},255`;
const colorOf: Record<string, DataDefined> = { outlineColor: { field: 'mau' } };

function lineSymbol(name: string, o: { width: string; unit: 'MapUnit' | 'MM'; cap: string; dd: Record<string, DataDefined>; color?: string }): string {
  return (
    symbolOpen('line', name) +
    layerXml(
      'SimpleLine',
      {
        line_color: o.color ? hexRgba(o.color) : '0,0,0,255',
        line_style: 'solid',
        line_width: o.width,
        line_width_unit: o.unit,
        line_width_map_unit_scale: MAP_UNIT_SCALE,
        capstyle: o.cap,
        joinstyle: 'miter',
        offset: '0',
        offset_unit: 'MM',
        use_custom_dash: '0',
        customdash: '5;2',
        customdash_unit: 'MM',
        draw_inside_polygon: '0',
      },
      '',
      o.dd,
    ) +
    '</symbol>'
  );
}

const rules = (items: { filter: string; symbol: number; label: string }[]) =>
  `<rules key="${KEY(0)}">${items
    .map((r, i) => `<rule key="${KEY(i + 1)}" filter="${esc(r.filter)}" symbol="${r.symbol}" label="${esc(r.label)}"/>`)
    .join('')}</rules>`;
const ruleRenderer = (rulesXml: string, symbols: string) =>
  `<renderer-v2 type="RuleRenderer" symbollevels="0" enableorderby="0" forceraster="0" referencescale="-1">${rulesXml}<symbols>${symbols}</symbols></renderer-v2>`;

function linesRenderer(): string {
  return ruleRenderer(
    rules([
      { filter: '"rong" > 0', symbol: 0, label: 'Nét có độ rộng (theo mét)' },
      { filter: 'ELSE', symbol: 1, label: 'Nét mảnh' },
    ]),
    // The width of a CAD polyline is in drawing units (metres): it grows with the map scale like in CAD; flat ends.
    lineSymbol('0', { width: '1', unit: 'MapUnit', cap: 'flat', dd: { ...colorOf, outlineWidth: { field: 'rong' } } }) +
      lineSymbol('1', { width: '0.15', unit: 'MM', cap: 'flat', dd: colorOf }),
  );
}

function areasRenderer(patternColors: string[]): string {
  const solid =
    symbolOpen('fill', '0') +
    layerXml(
      'SimpleFill',
      { color: '128,128,128,255', style: 'solid', outline_style: 'no', outline_color: '0,0,0,0', outline_width: '0', outline_width_unit: 'MM', joinstyle: 'miter', offset: '0,0', offset_unit: 'MM' },
      '',
      { fillColor: { field: 'mau' } },
    ) +
    '</symbol>';
  // Pattern hatch: parallel lines at the angle / spacing of the CAD pattern (spacing in map units = metres). The colour
  // of the lines is fixed per rule: a data-defined colour inside a pattern fill draws every other line in black.
  const pattern = (color: string, n: number) =>
    symbolOpen('fill', String(n)) +
    layerXml(
      'LinePatternFill',
      {
        angle: '45',
        distance: '5',
        distance_unit: 'MapUnit',
        distance_map_unit_scale: MAP_UNIT_SCALE,
        line_width: '0.15',
        line_width_unit: 'MM',
        color: '0,0,0,255',
        offset: '0',
        offset_unit: 'MapUnit',
        clip_mode: 'during_render',
        coordinate_reference: 'feature',
      },
      lineSymbol(`@${n}@0`, { width: '0.15', unit: 'MM', cap: 'flat', dd: {}, color }),
      { lineAngle: { field: 'goc' }, lineDistance: { field: 'cach' } },
    ) +
    '</symbol>';
  const colors = patternColors.slice(0, 60);
  return ruleRenderer(
    rules([
      { filter: '"cach" = 0', symbol: 0, label: 'Tô đặc' },
      ...colors.map((c, i) => ({ filter: `"cach" > 0 AND "mau" = '${c}'`, symbol: i + 1, label: `Mẫu tô ${c}` })),
    ]),
    solid + colors.map((c, i) => pattern(c, i + 1)).join(''),
  );
}

function pointsRenderer(visible: boolean): string {
  const size = visible ? '1.6' : '0.1';
  const marker =
    symbolOpen('marker', '0') +
    layerXml(
      'SimpleMarker',
      {
        name: 'circle',
        color: visible ? '0,0,0,255' : '0,0,0,0',
        outline_style: 'no',
        outline_color: '0,0,0,0',
        outline_width: '0',
        outline_width_unit: 'MM',
        size,
        size_unit: 'MM',
        angle: '0',
        offset: '0,0',
        offset_unit: 'MM',
        scale_method: 'diameter',
        horizontal_anchor_point: '1',
        vertical_anchor_point: '1',
        joinstyle: 'bevel',
      },
      '',
      visible ? { fillColor: { field: 'mau' } } : {},
    ) +
    '</symbol>';
  return `<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0" referencescale="-1"><symbols>${marker}</symbols><rotation/><sizescale/></renderer-v2>`;
}

/**
 * Texts of the drawing: font size = text height (map units; ×1.4 since a CAD height is the capital height of the
 * font), the rotation and alignment of the CAD text, its colour. All shown (CAD does not drop colliding texts); the
 * ones too small for the scale are skipped by the minimum pixel size.
 */
function textLabeling(): string {
  const dd = dataDefined(
    {
      Size: { expr: '"cao" * 1.4' },
      Color: { field: 'mau' },
      LabelRotation: { field: 'goc' },
      OffsetQuad: { field: 'canh' },
    },
    'dd_properties',
  );
  return (
    `<labeling type="simple"><settings calloutType="simple">` +
    `<text-style fieldName="chu" isExpression="0" fontFamily="Arial" namedStyle="Regular" fontSize="3" fontSizeUnit="MapUnit" fontSizeMapUnitScale="${MAP_UNIT_SCALE}" fontWeight="50" fontItalic="0" textColor="0,0,0,255" textOpacity="1" multilineHeight="1" allowHtml="0" capitalization="0" previewBkgrdColor="255,255,255,255" blendMode="0">` +
    `<families/><text-buffer bufferDraw="0" bufferSize="0" bufferSizeUnits="MM" bufferColor="255,255,255,255" bufferOpacity="1" bufferJoinStyle="128" bufferNoFill="1" bufferBlendMode="0"/>` +
    `<text-mask maskEnabled="0"/><background shapeDraw="0"/><shadow shadowDraw="0"/><substitutions/></text-style>` +
    `<text-format wrapChar="" autoWrapLength="0" useMaxLineLengthForAutoWrap="1" multilineAlign="3" leftDirectionSymbol="&lt;" rightDirectionSymbol="&gt;" addDirectionSymbol="0" placeDirectionSymbol="0" reverseDirectionSymbol="0" formatNumbers="0" decimals="3" plussign="0"/>` +
    `<placement placement="1" placementFlags="10" dist="0" distUnits="MM" offsetType="0" quadOffset="4" xOffset="0" yOffset="0" offsetUnits="MM" rotationAngle="0" rotationUnit="AngleDegrees" centroidWhole="0" centroidInside="0" fitInPolygonOnly="0" priority="5" repeatDistance="0" repeatDistanceUnits="MM" overrunDistance="0" overrunDistanceUnit="MM" maxCurvedCharAngleIn="25" maxCurvedCharAngleOut="-25" layerType="PointGeometry"/>` +
    `<rendering scaleVisibility="0" scaleMin="0" scaleMax="0" obstacle="0" obstacleType="1" obstacleFactor="1" upsidedownLabels="0" limitNumLabels="0" maxNumLabels="2000" displayAll="1" drawLabels="1" fontLimitPixelSize="1" fontMinPixelSize="4" fontMaxPixelSize="10000" labelPerPart="0" mergeLines="0" minFeatureSize="0" zIndex="0" unplacedVisibility="0"/>` +
    `${dd}</settings></labeling>`
  );
}

/** The <maplayer> of a CAD layer. */
export function cadMaplayerXml(l: CadLayerInfo, srs: string, extent: string, patternColors: string[] = []): string {
  const geom = l.table === 'lines' ? 'L' : l.table === 'areas' ? 'A' : 'P';
  const renderer = l.table === 'lines' ? linesRenderer() : l.table === 'areas' ? areasRenderer(patternColors) : pointsRenderer(l.table === 'points');
  return vectorLayerXml({ id: l.id, name: l.name, source: l.source, geom, srs, extent, renderer, labeling: l.table === 'texts' ? textLabeling() : '', previewExpression: l.table === 'texts' ? '"chu"' : '"lop"' });
}

/** <layer-tree-group> "Bản vẽ CAD" with its layers. */
export function cadTreeXml(layers: CadLayerInfo[]): string {
  const items = layers
    .map(
      (l) =>
        `<layer-tree-layer id="${l.id}" name="${esc(l.name)}" source="${esc(l.source)}" providerKey="ogr" checked="Qt::Checked" expanded="0" legend_exp="" patch_size="-1,-1" legend_split_behavior="0"><customproperties><Option/></customproperties></layer-tree-layer>`,
    )
    .join('');
  return `<layer-tree-group name="Bản vẽ CAD" checked="Qt::Checked" expanded="1" groupLayer=""><customproperties><Option type="Map"><Option name="title" value="Bản vẽ CAD (đường, ký hiệu, chữ như trong AutoCAD)" type="QString"/></Option></customproperties>${items}</layer-tree-group>`;
}
