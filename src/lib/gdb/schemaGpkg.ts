// An empty GeoPackage holding the TT16 template structure of one geodatabase (tt16Schema.ts): one table per class
// with the template fields in order and their SQLite types (TEXT(n) / FLOAT / DOUBLE / SMALLINT / MEDIUMINT /
// DATETIME), Vietnamese aliases (gpkg_data_columns) and coded value domains (gpkg_data_column_constraints, enum).
// GDAL turns each table into a FileGDB feature class with the same fields, aliases and bound domains — gdal3.js
// cannot create those itself (no OGR API, read-only datasets), hence this SQLite file built with sql.js.
import type { Database, SqlJsStatic } from 'sql.js';
import { TT16_SCHEMA, type Tt16SchemaField } from './tt16Schema';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

const SQL_TYPE: Record<Tt16SchemaField['type'], (f: Tt16SchemaField) => string> = {
  string: (f) => `TEXT(${f.length ?? 255})`,
  float32: () => 'FLOAT',
  float64: () => 'DOUBLE',
  int16: () => 'SMALLINT',
  int32: () => 'MEDIUMINT',
  datetime: () => 'DATETIME',
};

const GEOM: Record<'A' | 'L' | 'P', string> = { A: 'MULTIPOLYGON', L: 'MULTILINESTRING', P: 'POINT' };

const BASE = `
PRAGMA application_id = 1196444487;
PRAGMA user_version = 10300;
CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
INSERT INTO gpkg_spatial_ref_sys VALUES('Undefined cartesian SRS',-1,'NONE',-1,'undefined',NULL);
INSERT INTO gpkg_spatial_ref_sys VALUES('Undefined geographic SRS',0,'NONE',0,'undefined',NULL);
INSERT INTO gpkg_spatial_ref_sys VALUES('WGS 84',4326,'EPSG',4326,'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',NULL);
CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
CREATE TABLE gpkg_extensions (table_name TEXT, column_name TEXT, extension_name TEXT NOT NULL, definition TEXT NOT NULL, scope TEXT NOT NULL, CONSTRAINT ge_tce UNIQUE (table_name, column_name, extension_name));
CREATE TABLE gpkg_data_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, name TEXT, title TEXT, description TEXT, mime_type TEXT, constraint_name TEXT, CONSTRAINT pk_gdc PRIMARY KEY (table_name, column_name));
CREATE TABLE gpkg_data_column_constraints (constraint_name TEXT NOT NULL, constraint_type TEXT NOT NULL, value TEXT, min NUMERIC, min_is_inclusive BOOLEAN, max NUMERIC, max_is_inclusive BOOLEAN, description TEXT, CONSTRAINT gdcc_ntv UNIQUE (constraint_name, constraint_type, value));
INSERT INTO gpkg_extensions VALUES('gpkg_data_columns',NULL,'gpkg_schema','http://www.geopackage.org/spec121/#extension_schema','read-write');
INSERT INTO gpkg_extensions VALUES('gpkg_data_column_constraints',NULL,'gpkg_schema','http://www.geopackage.org/spec121/#extension_schema','read-write');
`;

/** Table name of a class in the schema GeoPackage. */
export const schemaTable = (cls: string) => cls;

/** The schema GeoPackage of one geodatabase of the template (HienTrang, QuyHoach, MocGioi, NenDiaHinh). */
export function buildSchemaGpkg(SQL: SqlJsStatic, db: string): Uint8Array {
  const dbx: Database = new SQL.Database();
  try {
    dbx.run(BASE);
    const used = new Set<string>();
    for (const ds of TT16_SCHEMA.databases[db] ?? [])
      for (const c of ds.classes) {
        const t = schemaTable(c.name);
        const cols = c.fields.map((f) => `${ident(f.name)} ${SQL_TYPE[f.type](f)}`);
        dbx.run(`CREATE TABLE ${ident(t)} (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom ${GEOM[c.geom]}${cols.length ? ', ' + cols.join(', ') : ''})`);
        dbx.run(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, srs_id) VALUES (${q(t)}, 'features', ${q(t)}, ${q(c.alias)}, 0)`);
        dbx.run(`INSERT INTO gpkg_geometry_columns VALUES (${q(t)}, 'geom', '${GEOM[c.geom]}', 0, 0, 0)`);
        for (const f of c.fields) {
          if (!f.alias && !f.domain) continue;
          dbx.run(`INSERT INTO gpkg_data_columns VALUES (${q(t)}, ${q(f.name)}, ${q(f.alias || f.name)}, ${q(f.alias || f.name)}, NULL, NULL, ${f.domain ? q(f.domain) : 'NULL'})`);
          if (f.domain) used.add(f.domain);
        }
      }
    for (const name of used) {
      const d = TT16_SCHEMA.domains[db]?.[name];
      for (const [code, label] of d?.values ?? [])
        dbx.run(`INSERT INTO gpkg_data_column_constraints VALUES (${q(name)}, 'enum', ${q(code)}, NULL, NULL, NULL, NULL, ${q(label)})`);
    }
    return dbx.export();
  } finally {
    dbx.close();
  }
}
