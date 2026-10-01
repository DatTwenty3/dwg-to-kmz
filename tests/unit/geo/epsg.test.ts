import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/lib/cad/types';
import { buildUtm, buildVn2000, EPSG_TABLE, epsgForProj4, resolveCrsInput, transformDocument } from '@/lib/geo';

describe('EPSG lookup', () => {
  it('resolves EPSG:9209 in every accepted spelling to VN-2000 TM-3 105°30′', () => {
    for (const s of ['9209', 'EPSG:9209', 'epsg:9209', ' EPSG 9209 ']) {
      const r = resolveCrsInput(s);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.proj4).toBe(buildVn2000(105.5, 3));
        expect(r.label).toContain('105-30');
      }
    }
  });

  it('maps app-built definitions back to their EPSG codes', () => {
    expect(epsgForProj4(buildVn2000(105.5, 3))).toBe(9209);
    expect(epsgForProj4(buildVn2000(105, 3))).toBe(5897);
    expect(epsgForProj4(buildVn2000(105.75, 3))).toBe(9210);
    expect(epsgForProj4(buildUtm(48))).toBe(32648);
    expect(epsgForProj4(buildVn2000(105, 6))).toBeUndefined();
  });

  it('has unique codes and every definition is accepted by proj4', () => {
    expect(new Set(EPSG_TABLE.map((e) => e.code)).size).toBe(EPSG_TABLE.length);
    for (const e of EPSG_TABLE) expect(resolveCrsInput(e.proj4).ok, `EPSG:${e.code}`).toBe(true);
  });

  it('accepts proj4 strings (incl. epsg.io "+type=crs") and WKT, rejects junk with a Vietnamese message', () => {
    const r = resolveCrsInput(`${buildVn2000(105.5, 3)} +type=crs`);
    expect(r.ok && r.epsg).toBe(9209);
    const wkt =
      'PROJCS["VN-2000 / TM-3 105-30",GEOGCS["VN-2000",DATUM["Vietnam_2000",SPHEROID["WGS 84",6378137,298.257223563],' +
      'TOWGS84[-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278]],' +
      'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],' +
      'PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",105.5],PARAMETER["scale_factor",0.9999],' +
      'PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]';
    expect(resolveCrsInput(wkt).ok).toBe(true);
    const bad = resolveCrsInput('abc');
    expect(bad.ok).toBe(false);
    const unknown = resolveCrsInput('EPSG:2154');
    expect(!unknown.ok && unknown.error).toContain('epsg.io/2154');
  });

  it('transformDocument accepts an EPSG code directly', () => {
    const doc: CadDocument = {
      units: 'm',
      crs: null,
      layers: [{ name: '0', color: '#ffffff', visible: true }],
      entities: [{ kind: 'point', layer: '0', color: '#ffffff', position: [553000, 1065000] }],
      bbox: [
        [553000, 1065000],
        [553000, 1065000],
      ],
      warnings: [],
    };
    const viaCode = transformDocument(doc, { proj4: 'EPSG:9209', swapXY: false, unitScale: 1 });
    const viaProj4 = transformDocument(doc, { proj4: buildVn2000(105.5, 3), swapXY: false, unitScale: 1 });
    expect(viaCode.entities[0]).toEqual(viaProj4.entities[0]);
    const [lng, lat] = (viaCode.entities[0] as { position: [number, number] }).position;
    expect(lng).toBeCloseTo(105.98, 1); // Sóc Trăng area
    expect(lat).toBeCloseTo(9.63, 1);
  });
});
