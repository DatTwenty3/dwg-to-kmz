import { describe, expect, it } from 'vitest';
import { BUILDING_LAYER, floorsForArea, heightForArea, viewHasBuildings } from '@/lib/map/buildings';

describe('3D buildings', () => {
  it('estimates floors from the footprint area', () => {
    expect(floorsForArea(45)).toBe(1);
    expect(floorsForArea(79.9)).toBe(1);
    expect(floorsForArea(80)).toBe(2);
    expect(floorsForArea(200)).toBe(2);
    expect(floorsForArea(201)).toBe(3);
    expect(heightForArea(50)).toBeCloseTo(4);
    expect(heightForArea(150)).toBeCloseTo(7.6);
    expect(heightForArea(500)).toBeCloseTo(11.2);
  });

  it('the map expression follows the same steps as heightForArea', () => {
    const expr = BUILDING_LAYER.type === 'fill-extrusion' ? (BUILDING_LAYER.paint?.['fill-extrusion-height'] as unknown as unknown[]) : [];
    // ['step', input, h0, 80, h1, 200.5, h2]
    expect(expr[0]).toBe('step');
    expect(expr[2]).toBeCloseTo(heightForArea(10));
    expect(expr[4]).toBeCloseTo(heightForArea(150));
    expect(expr[6]).toBeCloseTo(heightForArea(300));
    // Integer areas: 200 is still 2 floors, 201 is 3.
    expect(expr[5]).toBeGreaterThan(200);
    expect(expr[5]).toBeLessThan(201);
  });

  it('knows where there is building data', () => {
    expect(viewHasBuildings([105.9, 9.95, 105.95, 10.0])).toBe(true); // Trà Ôn
    expect(viewHasBuildings([105.95, 10.24, 106.0, 10.28])).toBe(false); // TP. Vĩnh Long: north of the data
    expect(viewHasBuildings([105.7, 10.0, 105.8, 10.1])).toBe(true); // overlaps the west edge
    expect(viewHasBuildings([105.8, 20.9, 106.0, 21.1])).toBe(false); // Hà Nội
  });
});
