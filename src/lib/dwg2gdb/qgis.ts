// QGIS project (.qgz) of the dossier — the "tệp tổng hợp <Tên ĐAQH>.qgz" Thông tư 16 asks for in HoSoGIS. It sits
// next to the geodatabases (relative sources "./QuyHoach.gdb|layername=…"), one layer per class with data, grouped
// by database and feature dataset; polygons/lines/points are coloured by phanLoai with the colours of the CAD
// drawing (pattern hatches → a line pattern fill), labels from tenDoiTuong. Written as QGIS 3 XML (symbol layers
// carry both the <Option> map of QGIS ≥ 3.26 and the older <prop> pairs).
import { formatDegMin } from '@/lib/geo/crs';
import { tt16Wkt } from '@/lib/gdb/tt16Schema';
import { foldVietnamese } from '@/lib/geo/provinces';
import { TT16_DATABASES } from '@/lib/gdb/tt16';
import type { ClassData, CategoryStyle } from './features';
import { pascalName } from '@/lib/gdb/normalize';
import { hatchSvgFor, pointSvgFor, ptToMm, svgToBase64, type PointSvg, type SvgLibrary } from './qgisSvg';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** File name of the project from the title block ("QUY HOẠCH CHUNG XÃ LONG HIỆP…" → "QHC_XaLongHiep"). */
export function projectNameFromTexts(texts: string[]): string | null {
  const KIND: Record<string, string> = { chung: 'QHC', 'phan khu': 'QPK', 'chi tiet': 'QCT' };
  for (const t of texts) {
    if (t.length > 300) continue;
    const f = foldVietnamese(`x ${t}`);
    const m = /quy hoach (chung|phan khu|chi tiet) (?:xay dung )?((?:xa|phuong|thi tran|thi xa|do thi|khu|thanh pho|huyen) [a-z0-9 ]+?)(?: tinh | thanh pho | den nam |$)/.exec(f);
    if (m) return `${KIND[m[1]]}_${pascalName(m[2])}`.slice(0, 80);
  }
  return null;
}

/** The unit a plan is about, from its title: "QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG…" → "XÃ LONG HIỆP". */
export function planUnitFromTitle(title: string | null | undefined): string | null {
  const m = /QUY HOẠCH (?:CHUNG|PHÂN KHU|CHI TIẾT)(?: XÂY DỰNG)? ((?:XÃ|PHƯỜNG|THỊ TRẤN) [^,]+?)(?:,| TỈNH | THÀNH PHỐ | ĐẾN NĂM|$)/.exec(
    (title ?? '').replace(/\s+/g, ' ').trim().normalize('NFC').toLocaleUpperCase('vi'),
  );
  return m ? m[1].trim() : null;
}

/** A safe file name: letters, digits, _ and -. */
export const cleanProjectName = (s: string) =>
  s
    .split(/[_-]+/)
    .filter((w) => w.trim())
    .map((w) => pascalName(w).replace(/^Lop(?=\d)/, ''))
    .join('_')
    .slice(0, 80) || 'DoAnQuyHoach';

function rgba(hex: string, a = 255): string {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '888888';
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a}`;
}
/** Near-white CAD colours (drawn on black in AutoCAD) are invisible on a light map: darken them. */
function visible(hex: string): string {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!h) return '#888888';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return r + g + b > 690 ? '#5a5a5a' : `#${h}`;
}

/** <Option type="Map"> with string values + the same as <prop k v> (older QGIS). */
function opts(o: Record<string, string>): string {
  const map = Object.entries(o)
    .map(([k, v]) => `<Option name="${esc(k)}" value="${esc(v)}" type="QString"/>`)
    .join('');
  const props = Object.entries(o)
    .map(([k, v]) => `<prop k="${esc(k)}" v="${esc(v)}"/>`)
    .join('');
  return `<Option type="Map">${map}</Option>${props}`;
}

const DDP = '<data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties>';
const symbolOpen = (type: 'fill' | 'line' | 'marker', name: string) =>
  `<symbol type="${type}" name="${esc(name)}" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0">${DDP}`;
const layerXml = (cls: string, o: Record<string, string>, inner = '') => `<layer class="${cls}" enabled="1" locked="0" pass="0">${opts(o)}${DDP}${inner}</layer>`;

function lineLayer(color: string, width: number, style = 'solid') {
  return layerXml('SimpleLine', {
    line_color: rgba(color),
    line_style: style,
    line_width: String(width),
    line_width_unit: 'MM',
    capstyle: 'round',
    joinstyle: 'round',
    offset: '0',
    offset_unit: 'MM',
    use_custom_dash: '0',
    customdash: '5;2',
    customdash_unit: 'MM',
    draw_inside_polygon: '0',
  });
}

/** An SVG marker of Phụ lục I, embedded in the project (base64), 3–7 mm at its natural size. */
function svgMarkerLayer(svg: string, pt: PointSvg) {
  return layerXml('SvgMarker', {
    name: svgToBase64(svg),
    color: '0,0,0,255',
    outline_color: '35,35,35,255',
    outline_width: '0',
    outline_width_unit: 'MM',
    size: String(Math.min(7, Math.max(3, ptToMm(Math.max(pt.width, pt.height))))),
    size_unit: 'MM',
    angle: '0',
    scale_method: 'diameter',
    offset: '0,0',
    offset_unit: 'MM',
    horizontal_anchor_point: '1',
    vertical_anchor_point: '1',
  });
}

/** What a class may take from the SVG library: its database picks the stage of the point symbols. */
interface SvgCtx {
  db: string;
  lib?: SvgLibrary;
}

function symbolFor(geom: 'A' | 'L' | 'P', s: Pick<CategoryStyle, 'color' | 'hatch' | 'phanLoai' | 'symbol'>, name: string, cls: string, ctx: SvgCtx): string {
  const color = visible(s.color);
  const lib = ctx.lib;
  const svgText = (dir: 'hatch' | 'point', file: string | undefined) => (file ? lib?.files.get(`${dir}/${file}`) : undefined);
  if (cls === 'RanhGioiQuyHoach_A')
    return `${symbolOpen('fill', name)}${layerXml('SimpleLine', {
      line_color: '255,0,0,255',
      line_style: 'dash',
      line_width: '0.8',
      line_width_unit: 'MM',
      capstyle: 'square',
      joinstyle: 'miter',
      offset: '0',
      offset_unit: 'MM',
      use_custom_dash: '0',
      customdash: '5;2',
      customdash_unit: 'MM',
      draw_inside_polygon: '0',
    })}</symbol>`;
  if (geom === 'L') return `${symbolOpen('line', name)}${lineLayer(color, 0.4)}</symbol>`;
  if (geom === 'P') {
    const pt = lib ? pointSvgFor(s.phanLoai, 'P', ctx.db, lib.index) : null;
    const text = svgText('point', pt?.file);
    if (pt && text) return `${symbolOpen('marker', name)}${svgMarkerLayer(text, pt)}</symbol>`;
  }
  if (geom === 'P')
    return `${symbolOpen('marker', name)}${layerXml('SimpleMarker', {
      name: 'circle',
      color: rgba(color),
      outline_color: '35,35,35,255',
      outline_style: 'solid',
      outline_width: '0.2',
      outline_width_unit: 'MM',
      size: '2',
      size_unit: 'MM',
      angle: '0',
      offset: '0,0',
      offset_unit: 'MM',
      scale_method: 'diameter',
      vertical_anchor_point: '1',
      horizontal_anchor_point: '1',
      joinstyle: 'bevel',
    })}</symbol>`;
  const hs = lib ? hatchSvgFor(s, lib.index) : null;
  const hatchText = svgText('hatch', hs?.file);
  const fill = layerXml('SimpleFill', {
    // An SVG hatch of Phụ lục I has a transparent background (only its strokes are coloured).
    color: rgba(color, hatchText ? 0 : s.hatch ? 90 : 170),
    style: 'solid',
    outline_color: rgba(color),
    outline_style: 'solid',
    outline_width: '0.15',
    outline_width_unit: 'MM',
    border_width_unit: 'MM',
    joinstyle: 'bevel',
    offset: '0,0',
    offset_unit: 'MM',
  });
  const pattern = hs && hatchText
    ? layerXml(
        'SVGFill',
        {
          angle: '0',
          svgFile: svgToBase64(hatchText),
          patternWidth: String(ptToMm(hs.width)),
          patternWidth_unit: 'MM',
          patternWidth_map_unit_scale: '3x:0,0,0,0,0,0',
          svgFillColor: '0,0,0,255',
          svgOutlineColor: '35,35,35,255',
          svgOutlineWidth: '0.2',
          svgOutlineWidth_unit: 'MM',
        },
        `${symbolOpen('line', `@${name}@1`)}${lineLayer(color, 0, 'no')}</symbol>`,
      )
    : s.hatch
    ? layerXml(
        'LinePatternFill',
        {
          angle: String(Math.round(s.hatch.angle * 100) / 100),
          distance: String(Math.round(Math.min(Math.max(s.hatch.distance, 0.5), 200) * 100) / 100),
          distance_unit: 'MapUnit',
          line_width: '0.2',
          line_width_unit: 'MM',
          color: rgba(color),
          offset: '0',
          offset_unit: 'MapUnit',
          clip_mode: 'during_render',
          coordinate_reference: 'feature',
        },
        `${symbolOpen('line', `@${name}@1`)}${lineLayer(color, 0.2)}</symbol>`,
      )
    : '';
  // Function symbols of Mục 2–7 ("Chợ", "Trường tiểu học"…) at the centre of the parcels of that category.
  const pt = lib ? pointSvgFor(s.phanLoai, 'A', ctx.db, lib.index) : null;
  const ptText = svgText('point', pt?.file);
  const centre =
    pt && ptText
      ? layerXml('CentroidFill', { point_on_surface: '1', clip_on_current_part_only: '0', clip_points: '0' }, `${symbolOpen('marker', `@${name}@2`)}${svgMarkerLayer(ptText, pt)}</symbol>`)
      : '';
  return `${symbolOpen('fill', name)}${fill}${pattern}${centre}</symbol>`;
}

function renderer(c: ClassData, lib?: SvgLibrary): string {
  const ctx: SvgCtx = { db: c.db, lib };
  const named = c.styles.filter((s) => s.phanLoai);
  if (named.length < 2 || c.cls === 'RanhGioiQuyHoach_A') {
    const s = c.styles.slice().sort((a, b) => b.count - a.count)[0] ?? { color: '#888888', hatch: null, phanLoai: null };
    return `<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0" referencescale="-1"><symbols>${symbolFor(c.geom, s, '0', c.cls, ctx)}</symbols><rotation/><sizescale/></renderer-v2>`;
  }
  const cats = c.styles
    .map((s, i) => `<category value="${esc(s.phanLoai ?? '')}" symbol="${i}" label="${esc(s.phanLoai ?? '(chưa phân loại)')}" render="true" type="string" uuid="{cat-${i}}"/>`)
    .join('');
  const syms = c.styles.map((s, i) => symbolFor(c.geom, s, String(i), c.cls, ctx)).join('');
  return `<renderer-v2 type="categorizedSymbol" attr="phanLoai" symbollevels="0" enableorderby="0" forceraster="0" referencescale="-1"><categories>${cats}</categories><symbols>${syms}</symbols><rotation/><sizescale/></renderer-v2>`;
}

function labeling(c: ClassData): string {
  if (!c.features.some((f) => f.tenDoiTuong)) return '';
  const placement = c.geom === 'A' ? 1 : c.geom === 'L' ? 2 : 0;
  return (
    `<labeling type="simple"><settings calloutType="simple">` +
    `<text-style fieldName="tenDoiTuong" isExpression="0" fontFamily="Arial" namedStyle="Regular" fontSize="8" fontSizeUnit="Point" fontWeight="50" fontItalic="0" textColor="20,20,20,255" textOpacity="1" multilineHeight="1" allowHtml="0" capitalization="0" previewBkgrdColor="255,255,255,255" blendMode="0">` +
    `<families/><text-buffer bufferDraw="1" bufferSize="0.8" bufferSizeUnits="MM" bufferColor="255,255,255,255" bufferOpacity="1" bufferJoinStyle="128" bufferNoFill="1" bufferBlendMode="0"/>` +
    `<text-mask maskEnabled="0"/><background shapeDraw="0"/><shadow shadowDraw="0"/><substitutions/></text-style>` +
    `<text-format wrapChar="" autoWrapLength="18" useMaxLineLengthForAutoWrap="1" multilineAlign="3" leftDirectionSymbol="&lt;" rightDirectionSymbol="&gt;" addDirectionSymbol="0" placeDirectionSymbol="0" reverseDirectionSymbol="0" formatNumbers="0" decimals="3" plussign="0"/>` +
    `<placement placement="${placement}" placementFlags="10" dist="0" distUnits="MM" offsetType="0" quadOffset="4" xOffset="0" yOffset="0" offsetUnits="MM" rotationAngle="0" centroidWhole="0" centroidInside="1" fitInPolygonOnly="0" priority="5" repeatDistance="0" repeatDistanceUnits="MM" overrunDistance="0" overrunDistanceUnit="MM" maxCurvedCharAngleIn="25" maxCurvedCharAngleOut="-25" layerType="${c.geom === 'A' ? 'PolygonGeometry' : c.geom === 'L' ? 'LineGeometry' : 'PointGeometry'}"/>` +
    `<rendering scaleVisibility="1" scaleMin="0" scaleMax="25000" obstacle="1" obstacleType="1" obstacleFactor="1" upsidedownLabels="0" limitNumLabels="0" maxNumLabels="2000" displayAll="0" drawLabels="1" fontLimitPixelSize="0" fontMinPixelSize="3" fontMaxPixelSize="10000" labelPerPart="0" mergeLines="0" minFeatureSize="0" zIndex="0" unplacedVisibility="0"/>` +
    `${DDP.replace(/data_defined_properties/g, 'dd_properties')}</settings></labeling>`
  );
}

export interface QgisProjectInput {
  /** Project file name without extension ("QHC_XaLongHiep"). */
  name: string;
  /** Title shown in QGIS. */
  title: string;
  classes: ClassData[];
  lon0: number;
  zone: 3 | 6;
  /** [xmin, ymin, xmax, ymax] in VN-2000 metres. */
  extent: [number, number, number, number];
  /** SVG symbols of Phụ lục I to embed (qgisSvg.ts): hatches of the land-use classes, points of the infrastructure classes. */
  svg?: SvgLibrary;
}

/**
 * The coordinate system of the HoSoGIS geodatabases, written exactly as in them (tt16Wkt: ESRI WKT
 * "VN-2000_TM-3_105-30", no TOWGS84, no EPSG code): with any other definition QGIS sees two different CRSs and
 * shifts the layers on the fly (datum transformation), so the project would not match its own data.
 */
function srsXml(lon0: number, zone: 3 | 6): string {
  const wkt = tt16Wkt(lon0, zone);
  const name = /^PROJCS\["([^"]+)"/.exec(wkt)?.[1] ?? `VN-2000 ${formatDegMin(lon0)}`;
  const proj4 = `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=${zone === 6 ? 0.9996 : 0.9999} +x_0=500000 +y_0=0 +ellps=WGS84 +units=m +no_defs`;
  return (
    `<spatialrefsys nativeFormat="Wkt"><wkt>${esc(wkt)}</wkt><proj4>${esc(proj4)}</proj4><srsid>0</srsid><srid>0</srid>` +
    `<authid></authid><description>${esc(name)}</description><projectionacronym>tmerc</projectionacronym>` +
    `<ellipsoidacronym>EPSG:7030</ellipsoidacronym><geographicflag>false</geographicflag></spatialrefsys>`
  );
}

const GEOM = { A: ['Polygon', 'MultiPolygon'], L: ['Line', 'MultiLineString'], P: ['Point', 'Point'] } as const;

/** The .qgs XML. */
export function buildQgs(p: QgisProjectInput): string {
  const srs = srsXml(p.lon0, p.zone);
  const [x0, y0, x1, y1] = p.extent;
  const ext = `<xmin>${x0}</xmin><ymin>${y0}</ymin><xmax>${x1}</xmax><ymax>${y1}</ymax>`;
  const alias = new Map<string, string>(TT16_DATABASES.flatMap((db) => db.datasets.flatMap((d) => d.classes.map((c) => [`${db.name}/${d.name}/${c.name}`, c.alias] as const))));
  const dsTitle = new Map(TT16_DATABASES.flatMap((db) => db.datasets.map((d) => [`${db.name}/${d.name}`, d.title] as const)));
  // Draw order inside a group: points, lines, then areas (the boundary on top of everything).
  const rank = (c: ClassData) => (c.cls === 'RanhGioiQuyHoach_A' ? -1 : c.geom === 'P' ? 0 : c.geom === 'L' ? 1 : 2);
  const dbOrder = ['QuyHoach', 'HienTrang', 'MocGioi'];
  const layers = p.classes
    .filter((c) => c.features.length)
    .sort((a, b) => dbOrder.indexOf(a.db) - dbOrder.indexOf(b.db) || a.dataset.localeCompare(b.dataset) || rank(a) - rank(b) || a.cls.localeCompare(b.cls))
    .map((c) => ({
      c,
      id: `${c.db}_${c.cls}_${c.dataset}`.replace(/[^A-Za-z0-9_]/g, '_'),
      name: `${c.cls} — ${alias.get(c.target) ?? c.cls}`,
      source: `./${c.db}.gdb|layername=${c.cls}`,
    }));

  const tree = dbOrder
    .filter((db) => layers.some((l) => l.c.db === db))
    .map((db) => {
      const sets = [...new Set(layers.filter((l) => l.c.db === db).map((l) => l.c.dataset))];
      const groups = sets
        .map((ds) => {
          const items = layers
            .filter((l) => l.c.db === db && l.c.dataset === ds)
            .map(
              (l) =>
                `<layer-tree-layer id="${l.id}" name="${esc(l.name)}" source="${esc(l.source)}" providerKey="ogr" checked="Qt::Checked" expanded="${l.c.styles.length > 1 ? 1 : 0}" legend_exp="" patch_size="-1,-1" legend_split_behavior="0"><customproperties><Option/></customproperties></layer-tree-layer>`,
            )
            .join('');
          return `<layer-tree-group name="${esc(ds)}" checked="Qt::Checked" expanded="0" groupLayer=""><customproperties><Option type="Map"><Option name="title" value="${esc(dsTitle.get(`${db}/${ds}`) ?? ds)}" type="QString"/></Option></customproperties>${items}</layer-tree-group>`;
        })
        .join('');
      // The existing-state database starts hidden: both on top of each other are unreadable.
      return `<layer-tree-group name="${db}" checked="${db === 'HienTrang' ? 'Qt::Unchecked' : 'Qt::Checked'}" expanded="1" groupLayer=""><customproperties><Option/></customproperties>${groups}</layer-tree-group>`;
    })
    .join('');

  const maplayers = layers
    .map(({ c, id, name, source }) => {
      const [geometry, wkb] = GEOM[c.geom];
      const lbl = labeling(c);
      return (
        `<maplayer type="vector" geometry="${geometry}" wkbType="${wkb}" autoRefreshMode="Disabled" autoRefreshTime="0" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" hasScaleBasedVisibilityFlag="0" minScale="100000000" maxScale="0" readOnly="0" simplifyAlgorithm="0" simplifyDrawingHints="1" simplifyDrawingTol="1" simplifyLocal="1" simplifyMaxScale="1" styleCategories="AllStyleCategories" symbologyReferenceScale="-1" labelsEnabled="${lbl ? 1 : 0}" legendPlaceholderImage="">` +
        `<extent>${ext}</extent><id>${id}</id><datasource>${esc(source)}</datasource><keywordList><value></value></keywordList>` +
        `<layername>${esc(name)}</layername><srs>${srs}</srs><resourceMetadata><identifier></identifier><parentidentifier></parentidentifier><language></language><type>dataset</type><title>${esc(name)}</title><abstract></abstract><links/><fees></fees><encoding></encoding><crs>${srs}</crs><extent/></resourceMetadata>` +
        `<provider encoding="UTF-8">ogr</provider><vectorjoins/><layerDependencies/><dataDependencies/><expressionfields/>` +
        `<map-layer-style-manager current="default"><map-layer-style name="default"/></map-layer-style-manager><auxiliaryLayer/><metadataUrls/><flags><Identifiable>1</Identifiable><Removable>1</Removable><Searchable>1</Searchable><Private>0</Private></flags>` +
        `${renderer(c, p.svg)}${lbl}<blendMode>0</blendMode><featureBlendMode>0</featureBlendMode><layerOpacity>1</layerOpacity>` +
        `<previewExpression>"tenDoiTuong"</previewExpression><mapTip enabled="1"></mapTip><layerGeometryType>${c.geom === 'A' ? 2 : c.geom === 'L' ? 1 : 0}</layerGeometryType>` +
        `</maplayer>`
      );
    })
    .join('');
  const order = layers.map((l) => `<layer id="${l.id}"/>`).join('');

  return (
    `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n` +
    `<qgis projectname="${esc(p.title)}" version="3.34.0-Prizren" saveUser="" saveUserFull="" saveDateTime="${new Date().toISOString().slice(0, 19)}">` +
    `<homePath path=""/><title>${esc(p.title)}</title><transaction mode="Disabled"/><projectFlags set=""/>` +
    `<projectCrs>${srs}</projectCrs>` +
    `<layer-tree-group><customproperties><Option/></customproperties>${tree}<custom-order enabled="0">${layers.map((l) => `<item>${l.id}</item>`).join('')}</custom-order></layer-tree-group>` +
    `<snapping-settings enabled="0" mode="2" type="1" tolerance="12" unit="1" intersection-snapping="0"/><relations/><polymorphicRelations/>` +
    `<mapcanvas annotationsVisible="1" name="theMapCanvas"><units>meters</units><extent>${ext}</extent><rotation>0</rotation><destinationsrs>${srs}</destinationsrs><rendermaptile>0</rendermaptile><expressionContextScope/></mapcanvas>` +
    `<projectModels/><legend updateDrawingOrder="true"/>` +
    `<projectlayers>${maplayers}</projectlayers><layerorder>${order}</layerorder>` +
    // Without SpatialRefSys/ProjectionsEnabled QGIS ignores <projectCrs>: the project CRS stays invalid and the
    // layers are drawn far from the basemap (checked with QGIS 4.2: Long Hiệp landed in Nigeria).
    `<properties><SpatialRefSys><ProjectionsEnabled type="int">1</ProjectionsEnabled></SpatialRefSys><Paths><Absolute type="bool">false</Absolute></Paths><Measurement><DistanceUnits type="QString">meters</DistanceUnits><AreaUnits type="QString">m2</AreaUnits></Measurement>` +
    `<PositionPrecision><Automatic type="bool">true</Automatic><DecimalPlaces type="int">2</DecimalPlaces></PositionPrecision></properties>` +
    `<visibility-presets/><transformContext/><projectMetadata><identifier></identifier><parentidentifier></parentidentifier><language>vi</language><type></type><title>${esc(p.title)}</title><abstract>Tệp tổng hợp HoSoGIS theo Thông tư 16/2025/TT-BXD — tạo bởi LEDAT-GIS</abstract><links/><author>LEDAT-GIS</author><creation></creation></projectMetadata>` +
    `<ProjectViewSettings UseProjectScales="0" rotation="0"><Scales/><DefaultViewExtent xmin="${x0}" ymin="${y0}" xmax="${x1}" ymax="${y1}">${srs}</DefaultViewExtent></ProjectViewSettings>` +
    `</qgis>\n`
  );
}
