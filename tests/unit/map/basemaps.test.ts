import { describe, expect, it } from 'vitest';
import { basemapThumbUrl, getBasemap } from '@/lib/map';

describe('basemapThumbUrl', () => {
  it('gives the XYZ tile containing the point (Ninh Kiều, z 14)', () => {
    // lng 105.74 / lat 10.013 at z 14 → tile x 13004, y 7733.
    const url = basemapThumbUrl(getBasemap('google-hybrid'), 105.74, 10.013, 14);
    expect(url).toMatch(/lyrs=y&hl=vi&x=13004&y=7733&z=14$/);
  });

  it('uses the {z}/{y}/{x} order of Esri and clamps the zoom to the basemap', () => {
    const url = basemapThumbUrl(getBasemap('esri-imagery'), 105.74, 10.013, 25);
    expect(url).toMatch(/\/tile\/19\/\d+\/\d+$/);
  });
});
