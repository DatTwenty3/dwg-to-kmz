// Coordinate systems (VN-2000, UTM) and IR transform to WGS84. Owned by agent `geo-crs`.
export type { Province, FormerProvince, LngLatBox } from './provinces';
export { PROVINCES, FORMER_PROVINCES, getProvince, searchProvinces, foldVietnamese } from './provinces';
export {
  buildVn2000,
  buildUtm,
  isGeographic,
  formatDegMin,
  unitScaleFor,
  CANDIDATE_LON0,
  VN2000_TOWGS84,
  WGS84_PROJ4,
  UTM48N_PROJ4,
  UTM49N_PROJ4,
} from './crs';
export type { CrsCandidate, LocationCheck } from './sanity';
export { suggestCrs, checkLocation, isInVietnam, drawingCenter, VN_ENVELOPE, VN_MAINLAND } from './sanity';
export type { PointTransformer } from './transform';
export { transformDocument, createPointTransformer, metresPerDegree } from './transform';
export type { EpsgEntry, CrsInputResult } from './epsg';
export { EPSG_TABLE, getEpsg, resolveCrsInput, epsgForProj4 } from './epsg';
export type { InversePointTransformer } from './project';
export { createInversePointTransformer, projectDocument } from './project';
