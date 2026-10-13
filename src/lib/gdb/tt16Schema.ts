// The data structure of the Bộ Xây dựng template for Thông tư 16 HoSoGIS ("CTDL_QuyHoachDTNT_TT16"): for every
// geodatabase its feature datasets and classes, each class's alias and attribute fields in template order (name,
// Vietnamese alias, type, length, coded value domain), and the domains. Generated from the template by
// tests/unit/gdb/tt16Schema.test.ts (TT16_SCHEMA_WRITE=1); the template files themselves are not part of the app.
import schema from './tt16-schema.json';

export type Tt16FieldType = 'string' | 'float32' | 'float64' | 'int16' | 'int32' | 'datetime';

export interface Tt16SchemaField {
  name: string;
  alias: string;
  type: Tt16FieldType;
  /** Characters, strings only. */
  length?: number;
  /** Coded value domain name. */
  domain?: string;
}

export interface Tt16SchemaClass {
  name: string;
  alias: string;
  geom: 'A' | 'L' | 'P';
  /** Attribute fields (OBJECTID, Shape, Shape_Length, Shape_Area excluded), template order. */
  fields: Tt16SchemaField[];
}

export interface Tt16SchemaDataset {
  name: string;
  classes: Tt16SchemaClass[];
}

export interface Tt16Domain {
  /** esriFieldType… without the prefix: String, SmallInteger, Integer… */
  fieldType: string;
  /** [code, description] */
  values: [string, string][];
}

export interface Tt16Schema {
  source: string;
  databases: Record<string, Tt16SchemaDataset[]>;
  /** Per geodatabase: the same domain name can have different values in HienTrang and QuyHoach. */
  domains: Record<string, Record<string, Tt16Domain>>;
}

export const TT16_SCHEMA = schema as unknown as Tt16Schema;

/** Schema of a class (exact or case-insensitive name), or null. */
export function schemaClass(db: string, cls: string): (Tt16SchemaClass & { dataset: string }) | null {
  const want = cls.toLowerCase();
  for (const d of TT16_SCHEMA.databases[db] ?? []) for (const c of d.classes) if (c.name.toLowerCase() === want) return { ...c, dataset: d.name };
  return null;
}

/** Description of a coded value ("2" → "Trung thế"). */
export function domainLabel(db: string, domain: string, code: string): string | null {
  return TT16_SCHEMA.domains[db]?.[domain]?.values.find(([c]) => c === code)?.[1] ?? null;
}

/** Code of a description (exact, then diacritics-insensitive). */
export function domainCode(db: string, domain: string, label: string): string | null {
  const values = TT16_SCHEMA.domains[db]?.[domain]?.values ?? [];
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
  return values.find(([, n]) => n === label)?.[0] ?? values.find(([, n]) => fold(n) === fold(label))?.[0] ?? null;
}

/** Spatial reference precision of every class of the template (ArcGIS high precision defaults for VN-2000 TM). */
export const TT16_XY = { xOrigin: -5122600, yOrigin: -10001100, xyScale: 10000, xyTolerance: 0.001 } as const;

/** "105-30" for 105.5° (degrees-minutes, as in the template's spatial reference name). */
const dm = (lon0: number) => {
  let d = Math.floor(lon0 + 1e-9);
  let m = Math.round((lon0 - d) * 60);
  if (m === 60) {
    d++;
    m = 0;
  }
  return `${d}-${String(m).padStart(2, '0')}`;
};

/**
 * ESRI WKT of VN-2000 TM written like the template ("VN-2000_TM-3_105-30"); 6° zones "VN-2000_TM-6_105-00". The
 * 7 parameters to WGS84 are a separate ArcGIS transformation, not part of the WKT (as in the template).
 */
export function tt16Wkt(lon0: number, zone: 3 | 6): string {
  return (
    `PROJCS["VN-2000_TM-${zone}_${dm(lon0)}",GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000",SPHEROID["WGS_1984",6378137.0,298.257223563]],` +
    `PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],` +
    `PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${lon0}],` +
    `PARAMETER["Scale_Factor",${zone === 6 ? '0.9996' : '0.9999'}],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`
  );
}
