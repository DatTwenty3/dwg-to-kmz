import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDwg } from '@/lib/cad';
import type { CadDocument, CrsOptions, TextEntity } from '@/lib/cad/types';
import { buildVn2000, projectDocument, transformDocument } from '@/lib/geo';
import { FIXTURE_DWG, WASM_DIR } from '../fixtures';
import { makeDoc } from './helpers';

const VN105: CrsOptions = { proj4: buildVn2000(105, 3), swapXY: false, unitScale: 1 };

describe('projectDocument (WGS84 → drawing)', () => {
  let raw: CadDocument;
  beforeAll(async () => {
    const buf = readFileSync(FIXTURE_DWG);
    raw = await parseDwg(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { wasmBaseUrl: WASM_DIR });
  });

  it('round-trips the real fixture to < 1 mm, keeping text height and rotation', () => {
    const back = projectDocument(transformDocument(raw, VN105), VN105);
    expect(back.entities).toHaveLength(raw.entities.length);
    let worst = 0;
    raw.entities.forEach((e, i) => {
      const b = back.entities[i];
      if (e.kind === 'polyline' && b.kind === 'polyline') {
        e.points.forEach((p, j) => (worst = Math.max(worst, Math.hypot(p[0] - b.points[j][0], p[1] - b.points[j][1]))));
      }
    });
    expect(worst).toBeLessThan(0.001);
    const t0 = raw.entities.find((e): e is TextEntity => e.kind === 'text' && e.rotation > 1)!;
    const t1 = back.entities[raw.entities.indexOf(t0)] as TextEntity;
    expect(t1.height).toBeCloseTo(t0.height, 6);
    expect(t1.rotation).toBeCloseTo(t0.rotation, 3);
    expect(back.units).toBe('m');
    expect(back.crs).toBe(VN105.proj4);
  });

  it('inverts swapXY, unit scale and offset', () => {
    const crs: CrsOptions = { proj4: 'EPSG:9209', swapXY: true, unitScale: 0.001, offset: [12, -7] };
    const doc = makeDoc([{ kind: 'point', layer: '0', color: '#ffffff', position: [1065000_000, 553000_000] }]);
    const back = projectDocument(transformDocument(doc, crs), crs);
    const p = (back.entities[0] as { position: [number, number] }).position;
    expect(p[0]).toBeCloseTo(1065000_000, 0);
    expect(p[1]).toBeCloseTo(553000_000, 0);
    expect(back.units).toBe('mm');
  });
});
