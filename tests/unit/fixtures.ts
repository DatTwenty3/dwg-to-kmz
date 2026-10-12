import { fileURLToPath } from 'node:url';

/** Real-world acceptance fixture (see CLAUDE.md → "Fixture thật"). */
export const FIXTURE_DWG = fileURLToPath(new URL('../../dwg/10-QHPK Ninh Kieu - SDĐ (1).dwg', import.meta.url));

/** Directory holding libredwg-web.wasm for Node-side tests. */
export const WASM_DIR = fileURLToPath(new URL('../../node_modules/@mlightcad/libredwg-web/wasm/', import.meta.url));

/** HoSoGIS sample (Thông tư 16/2025/TT-BXD checker) — user data in /gdb, not committed. */
export const FIXTURE_HOSOGIS = fileURLToPath(
  new URL('../../gdb/CSDL_QHC_XANHILONG_TINHVINHLONG_DENNAM2050/CSDL_QHC_XANHILONG_TINHVINHLONG_DENNAM2050/HoSoGIS', import.meta.url),
);

/** Second HoSoGIS sample (xã Hàm Giang, Vĩnh Long) — user data in /gdb, not committed. */
export const FIXTURE_HAMGIANG = fileURLToPath(
  new URL('../../gdb/GIS_HAMGIANG_VINHLONG/GIS_HAMGIANG_VINHLONG/HoSoGIS_XaHamGiang_VinhLong', import.meta.url),
);
