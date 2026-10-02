import { describe, expect, it } from 'vitest';
import { buildVn2000, createPointTransformer, createSurveyPointTransformer, WGS84_PROJ4 } from '@/lib/geo';

describe('createSurveyPointTransformer (map convention X = Bắc, Y = Đông)', () => {
  const proj4 = buildVn2000(105, 3);
  // A point of the Ninh Kiều fixture: E 580 900 / N 1 107 400 in VN-2000, KTT 105°.
  const [lng, lat] = createPointTransformer({ proj4, swapXY: false, unitScale: 1 })(580_900, 1_107_400)!;

  it('gives X = Northing and Y = Easting in metres', () => {
    const [x, y] = createSurveyPointTransformer({ proj4, swapXY: false, unitScale: 1 })!(lng, lat)!;
    expect(x).toBeCloseTo(1_107_400, 2);
    expect(y).toBeCloseTo(580_900, 2);
  });

  it("ignores how the CAD file stores coordinates (axis swap, mm units, fine-tune offset)", () => {
    const t = createSurveyPointTransformer({ proj4, swapXY: true, unitScale: 0.001, offset: [12, -7] })!;
    const [x, y] = t(lng, lat)!;
    expect(x).toBeCloseTo(1_107_400, 2);
    expect(y).toBeCloseTo(580_900, 2);
  });

  it('has no X/Y for a geographic CRS', () => {
    expect(createSurveyPointTransformer({ proj4: WGS84_PROJ4, swapXY: false, unitScale: 1 })).toBeNull();
  });
});
