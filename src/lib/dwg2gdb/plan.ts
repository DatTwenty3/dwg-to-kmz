// Writing the extracted features: one GeoJSON per class → ogr2ogr into <CSDL>.gdb (stage 1, only the classes
// with data, the three free fields), then the stage-1 geodatabases go through "Chuẩn hóa TT16"
// (src/lib/gdb/normalize.ts) which adds every required group / class, the two codes and maDoiTuong — so the
// result follows exactly the same rules as a normalised upload.
import type { NormalizePlan, NormalizeStep } from '@/lib/gdb/normalize';
import { domainCode, schemaClass } from '@/lib/gdb/tt16Schema';
import type { ClassData, GeoJsonGeometry, GisFeature } from './features';
import { LAND_USE_M1 } from './suggest';

/** Level of an administrative unit for the LoaiTenDVHC domain (1 tỉnh, 2 huyện, 3 xã); ấp/khu phố have none. */
function adminLevel(kind: string | null): string | null {
  const k = (kind ?? '').toLowerCase();
  if (/^(tỉnh|thành phố trực thuộc trung ương)$/.test(k)) return '1';
  if (/^(huyện|quận|thị xã|thành phố)$/.test(k)) return '2';
  if (/^(xã|phường|thị trấn|đặc khu)$/.test(k)) return '3';
  return null;
}

function lineLength(g: GeoJsonGeometry): number {
  if (g.type !== 'MultiLineString') return 0;
  let len = 0;
  for (const line of g.coordinates) for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return len;
}

/**
 * Template attributes the drawing gives (tt16Schema.ts): the code of every coded value domain field whose value list
 * names the phanLoai ("Đất ở" → chucNangSuDungDatMuc1 52, "Trung thế" → capDienThe 2), chieuDai of lines,
 * loaiTenDVHC of administrative units. dienTich, trangThaiQuyHoach and the codes are filled by the normalisation.
 */
export function templateAttributes(c: Pick<ClassData, 'db' | 'cls' | 'geom'>, f: GisFeature): Record<string, string | number> {
  const spec = schemaClass(c.db, c.cls);
  const out: Record<string, string | number> = {};
  if (!spec) return out;
  for (const field of spec.fields) {
    if (field.name === 'loaiTenDVHC') {
      const level = adminLevel(f.phanLoai);
      if (level) out[field.name] = level;
    } else if (field.name.toLowerCase() === 'chieudai' && c.geom === 'L') {
      // HienTrang writes "ChieuDai" for bridges, the other classes "chieuDai".
      out[field.name] = Math.round(lineLength(f.geometry) * 100) / 100;
    } else if (field.domain && f.phanLoai) {
      const label = field.domain === 'ChucNangSuDungDatM1' ? (LAND_USE_M1[f.phanLoai] ?? f.phanLoai) : f.phanLoai;
      const code = domainCode(c.db, field.domain, label);
      if (code !== null) out[field.name] = code;
    }
  }
  return out;
}

/** GeoJSON text of a class (coordinates in VN-2000 metres; the CRS is assigned with -a_srs). */
export function classGeoJson(c: ClassData): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: c.features.map((f, i) => ({
      type: 'Feature',
      id: i + 1,
      properties: { tenDoiTuong: f.tenDoiTuong ?? '', phanLoai: f.phanLoai ?? '', ghiChu: f.ghiChu ?? '', ...templateAttributes(c, f), ...f.attrs },
      geometry: f.geometry,
    })),
  });
}

const NLT = { A: 'MULTIPOLYGON', L: 'MULTILINESTRING', P: 'POINT' } as const;

export interface Stage1Input {
  /** Dataset key = file name without ".geojson". */
  key: string;
  fileName: string;
  json: string;
}

export interface Stage1Plan extends NormalizePlan {
  inputs: Stage1Input[];
}

export function planStage1(classes: ClassData[], wkt: string): Stage1Plan {
  const steps: NormalizeStep[] = [];
  const inputs: Stage1Input[] = [];
  const started = new Set<string>();
  const sorted = [...classes].sort((a, b) => a.db.localeCompare(b.db) || a.dataset.localeCompare(b.dataset) || a.cls.localeCompare(b.cls));
  sorted.forEach((c, i) => {
    const key = `c${i}`;
    inputs.push({ key, fileName: `${key}.geojson`, json: classGeoJson(c) });
    const args = [
      '-f',
      'OpenFileGDB',
      ...(started.has(c.db) ? ['-update'] : []),
      '-a_srs',
      wkt,
      '-nln',
      c.cls,
      '-nlt',
      NLT[c.geom],
      '-lco',
      `FEATURE_DATASET=${c.dataset}`,
    ];
    started.add(c.db);
    steps.push({ out: c.db, source: key, args, label: `${c.dataset} / ${c.cls}`, features: c.features.length });
  });
  return { steps, inputs, outputs: [...started], notes: [], schemas: [] };
}
