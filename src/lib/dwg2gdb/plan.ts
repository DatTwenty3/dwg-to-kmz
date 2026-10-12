// Writing the extracted features: one GeoJSON per class → ogr2ogr into <CSDL>.gdb (stage 1, only the classes
// with data, the three free fields), then the stage-1 geodatabases go through "Chuẩn hóa TT16"
// (src/lib/gdb/normalize.ts) which adds every required group / class, the two codes and maDoiTuong — so the
// result follows exactly the same rules as a normalised upload.
import { pascalName, type NormalizePlan, type NormalizeStep } from '@/lib/gdb/normalize';
import type { ClassData } from './features';

/**
 * ESRI WKT of VN-2000 TM, as ArcGIS writes it in the sample HoSoGIS ("VN_2000_Tra_Vinh_3deg"). The check reads
 * the central meridian and scale factor from it; the 7 parameters to WGS84 are a separate ArcGIS transformation.
 */
export function vn2000EsriWkt(lon0: number, zone: 3 | 6, place?: string | null): string {
  const tag = place ? pascalName(place).replace(/([a-z])([A-Z])/g, '$1_$2') : `KTT_${Math.floor(lon0)}_${String(Math.round((lon0 % 1) * 60)).padStart(2, '0')}`;
  const name = `VN_2000_${tag}_${zone}deg`;
  return (
    `PROJCS["${name}",GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000",SPHEROID["WGS_1984",6378137.0,298.257223563]],` +
    `PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],` +
    `PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${lon0}],` +
    `PARAMETER["Scale_Factor",${zone === 6 ? '0.9996' : '0.9999'}],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`
  );
}

/** GeoJSON text of a class (coordinates in VN-2000 metres; the CRS is assigned with -a_srs). */
export function classGeoJson(c: ClassData): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: c.features.map((f, i) => ({
      type: 'Feature',
      id: i + 1,
      properties: { tenDoiTuong: f.tenDoiTuong ?? '', phanLoai: f.phanLoai ?? '', ghiChu: f.ghiChu ?? '' },
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
  return { steps, inputs, outputs: [...started], notes: [] };
}
