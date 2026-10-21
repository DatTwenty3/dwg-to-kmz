// Pieces of QGIS 3 project XML shared by qgis.ts (the geodatabase layers) and qgisCad.ts (the CAD drawing layers).
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** <Option type="Map"> with string values + the same as <prop k v> (older QGIS). */
export function opts(o: Record<string, string>): string {
  const map = Object.entries(o)
    .map(([k, v]) => `<Option name="${esc(k)}" value="${esc(v)}" type="QString"/>`)
    .join('');
  const props = Object.entries(o)
    .map(([k, v]) => `<prop k="${esc(k)}" v="${esc(v)}"/>`)
    .join('');
  return `<Option type="Map">${map}</Option>${props}`;
}

/** A data-defined property: the value of a field, or of an expression. */
export type DataDefined = { field: string } | { expr: string };

/** <data_defined_properties> of a symbol layer (or <dd_properties> of labeling) — empty when there is nothing defined. */
export function dataDefined(props: Record<string, DataDefined> = {}, tag = 'data_defined_properties'): string {
  const body = Object.entries(props)
    .map(([name, d]) => {
      const [kind, val, type] = 'field' in d ? (['field', d.field, 2] as const) : (['expression', d.expr, 3] as const);
      return (
        `<Option name="${esc(name)}" type="Map"><Option name="active" value="true" type="bool"/>` +
        `<Option name="${kind}" value="${esc(val)}" type="QString"/><Option name="type" value="${type}" type="int"/></Option>`
      );
    })
    .join('');
  return (
    `<${tag}><Option type="Map"><Option name="name" value="" type="QString"/>` +
    `${body ? `<Option name="properties" type="Map">${body}</Option>` : '<Option name="properties"/>'}` +
    `<Option name="type" value="collection" type="QString"/></Option></${tag}>`
  );
}

export const DDP = dataDefined();

export const symbolOpen = (type: 'fill' | 'line' | 'marker', name: string) =>
  `<symbol type="${type}" name="${esc(name)}" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0">${DDP}`;

export const layerXml = (cls: string, o: Record<string, string>, inner = '', dd: Record<string, DataDefined> = {}) =>
  `<layer class="${cls}" enabled="1" locked="0" pass="0">${opts(o)}${dataDefined(dd)}${inner}</layer>`;

export interface VectorLayerInput {
  id: string;
  name: string;
  /** "./HienTrang.gdb|layername=…" */
  source: string;
  /** Layer geometry: A polygon, L line, P point. */
  geom: 'A' | 'L' | 'P';
  /** Project coordinate system (<spatialrefsys>). */
  srs: string;
  /** <xmin>…<ymax> */
  extent: string;
  /** <renderer-v2>…</renderer-v2> */
  renderer: string;
  /** <labeling>…</labeling> or ''. */
  labeling?: string;
  previewExpression?: string;
}

const GEOM = { A: ['Polygon', 'MultiPolygon'], L: ['Line', 'MultiLineString'], P: ['Point', 'Point'] } as const;

/** One <maplayer> of an OGR vector source. */
export function vectorLayerXml(l: VectorLayerInput): string {
  const [geometry, wkb] = GEOM[l.geom];
  const lbl = l.labeling ?? '';
  return (
    `<maplayer type="vector" geometry="${geometry}" wkbType="${wkb}" autoRefreshMode="Disabled" autoRefreshTime="0" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" hasScaleBasedVisibilityFlag="0" minScale="100000000" maxScale="0" readOnly="0" simplifyAlgorithm="0" simplifyDrawingHints="1" simplifyDrawingTol="1" simplifyLocal="1" simplifyMaxScale="1" styleCategories="AllStyleCategories" symbologyReferenceScale="-1" labelsEnabled="${lbl ? 1 : 0}" legendPlaceholderImage="">` +
    `<extent>${l.extent}</extent><id>${l.id}</id><datasource>${esc(l.source)}</datasource><keywordList><value></value></keywordList>` +
    `<layername>${esc(l.name)}</layername><srs>${l.srs}</srs><resourceMetadata><identifier></identifier><parentidentifier></parentidentifier><language></language><type>dataset</type><title>${esc(l.name)}</title><abstract></abstract><links/><fees></fees><encoding></encoding><crs>${l.srs}</crs><extent/></resourceMetadata>` +
    `<provider encoding="UTF-8">ogr</provider><vectorjoins/><layerDependencies/><dataDependencies/><expressionfields/>` +
    `<map-layer-style-manager current="default"><map-layer-style name="default"/></map-layer-style-manager><auxiliaryLayer/><metadataUrls/><flags><Identifiable>1</Identifiable><Removable>1</Removable><Searchable>1</Searchable><Private>0</Private></flags>` +
    `${l.renderer}${lbl}<blendMode>0</blendMode><featureBlendMode>0</featureBlendMode><layerOpacity>1</layerOpacity>` +
    `<previewExpression>${esc(l.previewExpression ?? '')}</previewExpression><mapTip enabled="1"></mapTip><layerGeometryType>${l.geom === 'A' ? 2 : l.geom === 'L' ? 1 : 0}</layerGeometryType>` +
    `</maplayer>`
  );
}
