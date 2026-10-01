// Basemaps and deck.gl layers. Owned by agent `map-ui`.
export type { Basemap } from './basemaps';
export {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  FALLBACK_BASEMAP_ID,
  getBasemap,
  isGoogleBasemap,
  TileErrorMonitor,
} from './basemaps';
export type {
  BuildLayersOptions,
  PickRef,
  PathItem,
  PolygonItem,
  TextItem,
  PointItem,
  PreparedDocument,
  VisibleData,
  RGBA,
} from './layers';
export {
  buildLayers,
  prepareDocument,
  visibleData,
  documentBounds,
  hexToRgba,
  pathWidthPx,
  dashPattern,
  CAP_HEIGHT_RATIO,
  DEFAULT_MIN_TEXT_PIXELS,
  DEFAULT_FONT_FAMILY,
} from './layers';
export { TextSizeCullExtension } from './text-cull';
export type { ProvinceGuess } from './provinceGuess';
export { guessProvinceFromText } from './provinceGuess';
export type { FileRender, SharedRenderOptions } from './multi';
export {
  createFileLayerCache,
  FILE_TAG_COLORS,
  fileIdOfLayerId,
  fileLayerPrefix,
  moveById,
  nextTagColor,
  orderFileLayers,
  shownBounds,
  unionBounds,
} from './multi';
export type { BuildMeasureOptions, MeasureAnim, MeasureDraft, Measurement, MeasureTool, SegmentInfo } from './measureTool';
export {
  buildMeasureLayers,
  centroidOf,
  fmtLngLat,
  nearestSnap,
  segmentsOf,
  snapCandidatesOf,
} from './measureTool';
