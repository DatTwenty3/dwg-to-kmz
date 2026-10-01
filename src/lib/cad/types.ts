// Shared data contract (IR) between parser, text, geo, map and export modules.
// Owned by architect-lead: change only together with every consumer.

/** [x, y] in drawing units before transform; [lng, lat] (WGS84) after transform. */
export type Vec2 = [number, number];

export type DashStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

/**
 * User display overrides for a layer (set in the UI, honoured by the map and by every exporter).
 * Absent fields mean "as in the drawing". Colours are already applied to entities by
 * `applyLayerStyles`; width and dash are read from `layer.style` by renderers / exporters.
 */
export interface LayerStyle {
  /** #rrggbb — replaces the colour of every entity on the layer. */
  color?: string;
  /** Line width in screen pixels (map, KML) — DXF maps it to the nearest lineweight. */
  width?: number;
  dash?: DashStyle;
  /** 0..1 fill opacity for polygons (hatches) on the layer. */
  fillOpacity?: number;
}

export interface CadLayer {
  name: string;
  /** #rrggbb */
  color: string;
  visible: boolean;
  style?: LayerStyle;
}

interface EntityBase {
  layer: string;
  /** #rrggbb, ByLayer/ByBlock already resolved */
  color: string;
  /** Source object handle (hex), for property popups. */
  handle?: string;
}

export interface PolylineEntity extends EntityBase {
  kind: 'polyline';
  points: Vec2[];
  closed: boolean;
  /** Constant width in drawing units, metres after transform (0/undefined = hairline). */
  width?: number;
}

/** HATCH / SOLID / filled regions. First ring is outer, the rest are holes. */
export interface PolygonEntity extends EntityBase {
  kind: 'polygon';
  rings: Vec2[][];
  /** 0..1 */
  fillOpacity: number;
  /** Hatch pattern name (e.g. 'CLAY', 'GRASS'); undefined for solid fills. Pattern hatches are drawn as a tint. */
  pattern?: string;
}

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'baseline' | 'bottom' | 'middle' | 'top';

export interface TextEntity extends EntityBase {
  kind: 'text';
  /** Unicode NFC, formatting codes removed, lines separated by "\n". */
  text: string;
  position: Vec2;
  /** Cap height in drawing units (metres after transform). */
  height: number;
  /** Degrees, counter-clockwise from +X (east after transform). */
  rotation: number;
  hAlign: HAlign;
  vAlign: VAlign;
}

export interface TableCell {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  /** Cell text height (drawing units / metres after transform), if the source provides it. */
  textHeight?: number;
}

export interface TableEntity extends EntityBase {
  kind: 'table';
  /** Top-left corner. */
  origin: Vec2;
  /** Degrees, counter-clockwise from +X (same convention as TextEntity). */
  rotation: number;
  rows: number;
  cols: number;
  rowHeights: number[];
  colWidths: number[];
  cells: TableCell[];
}

export interface PointEntity extends EntityBase {
  kind: 'point';
  position: Vec2;
}

export type CadEntity = PolylineEntity | PolygonEntity | TextEntity | TableEntity | PointEntity;

export interface CadDocument {
  /** e.g. 'm', 'mm', 'unitless' (from $INSUNITS). */
  units: string;
  /** proj4 definition of the current coordinates; null = drawing coordinates, CRS unknown. */
  crs: string | null;
  layers: CadLayer[];
  entities: CadEntity[];
  /** [min, max] computed from entities (robust, outliers excluded), not from header extents. */
  bbox: [Vec2, Vec2];
  /** Human-readable (Vietnamese) messages: skipped entity types, decode doubts, etc. */
  warnings: string[];
}

/** How to go from drawing coordinates to WGS84. */
export interface CrsOptions {
  /** proj4 definition of the drawing's coordinate system. */
  proj4: string;
  /** Drawing X is Northing and Y is Easting. */
  swapXY: boolean;
  /** Multiply drawing units by this to get metres (mm → 0.001). */
  unitScale: number;
  /** Manual fine-tune in metres, applied after unitScale, before projection. */
  offset?: Vec2;
}

export type InputFormat = 'dwg' | 'dxf' | 'kmz' | 'kml';

// ---- Worker protocol ----

// The worker keeps one raw (drawing-coordinate) document per `docId`, so several files can be open
// at once and each re-projected independently.
export type WorkerRequest =
  | { id: number; type: 'parse'; docId: string; fileName: string; data: ArrayBuffer }
  | { id: number; type: 'transform'; docId: string; crs: CrsOptions }
  | { id: number; type: 'release'; docId: string };

export type WorkerResponse =
  | { id: number; type: 'progress'; stage: string; percent: number }
  | { id: number; type: 'parsed'; doc: CadDocument }
  | { id: number; type: 'transformed'; doc: CadDocument }
  | { id: number; type: 'released' }
  | { id: number; type: 'error'; message: string };
