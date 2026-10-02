import { describe, expect, it } from 'vitest';
import {
  buildShareUrl,
  decodeSharedMap,
  encodeSharedMap,
  fromWire,
  sharePayloadOf,
  SHARE_HASH_PREFIX,
  SHARE_TITLE_PARAM,
  cleanShareTitle,
  type SharedMap,
} from '@/lib/cad/share';
import type { SketchFeature } from '@/lib/cad/sketch';

const features: SketchFeature[] = [
  {
    id: 'a',
    kind: 'line',
    name: 'Tuyến ống cấp nước',
    points: [
      [105.7712345, 10.0301234],
      [105.7756789, 10.0323456],
      [105.7801234, 10.0298765],
    ],
    style: { color: '#2563eb', width: 3, dash: 'dashed' },
    label: 'Ống HDPE Ø110',
    labelSize: 6,
  },
  {
    id: 'b',
    kind: 'polygon',
    name: 'Khu đất đề xuất',
    points: [
      [105.77, 10.02],
      [105.775, 10.02],
      [105.775, 10.025],
    ],
    style: { color: '#e11d48', width: 2, fillOpacity: 0.35 },
    label: 'ĐẤT Ở MỚI',
  },
  { id: 'c', kind: 'point', name: 'Mốc 1', points: [[105.772, 10.022]], style: { color: '#16a34a' }, hidden: true },
];
const map: SharedMap = {
  title: 'Phương án tuyến ống – P. An Khánh',
  description: 'Bản nháp gửi anh Nam góp ý',
  basemap: 'google-satellite',
  features,
};

describe('shared map links', () => {
  it('round-trips title, description, basemap, geometry (≈1 cm), styles and Vietnamese labels', async () => {
    const back = (await decodeSharedMap(await encodeSharedMap(map)))!;
    expect(back.title).toBe(map.title);
    expect(back.description).toBe(map.description);
    expect(back.basemap).toBe('google-satellite');
    expect(back.features).toHaveLength(3);
    back.features.forEach((f, i) => {
      const o = features[i];
      expect(f.kind).toBe(o.kind);
      expect(f.name).toBe(o.name);
      expect(f.style).toEqual(o.style);
      expect(f.label).toBe(o.label);
      expect(f.hidden).toBe(o.hidden);
      f.points.forEach((p, j) => {
        expect(Math.abs(p[0] - o.points[j][0])).toBeLessThan(1e-7);
        expect(Math.abs(p[1] - o.points[j][1])).toBeLessThan(1e-7);
      });
    });
    expect(back.features[0].labelSize).toBe(6);
  });

  it('stays short: a few features give a link of a few hundred characters', async () => {
    const url = await buildShareUrl('https://ledat-gis.vercel.app/?t=cũ#old', map);
    // Title in the query (for link previews), map in the fragment.
    expect(new URL(url).searchParams.get(SHARE_TITLE_PARAM)).toBe(map.title);
    expect(url).toContain(`#${SHARE_HASH_PREFIX.slice(1)}`);
    expect(url.length).toBeLessThan(700);
    expect(sharePayloadOf(new URL(url).hash)).toBe(await encodeSharedMap(map));
    expect(sharePayloadOf('#other')).toBeNull();
  });

  it('handles a larger drawing (200 features × 20 vertices) compactly', async () => {
    const many: SketchFeature[] = Array.from({ length: 200 }, (_, i) => ({
      id: `x${i}`,
      kind: 'line',
      name: `Đường ${i + 1}`,
      points: Array.from({ length: 20 }, (_, j) => [105.7 + i * 1e-3 + j * 1e-4, 10 + j * 1e-4] as [number, number]),
      style: { color: '#e11d48', width: 3 },
    }));
    const payload = await encodeSharedMap({ title: 'Nhiều nét', features: many });
    expect((await decodeSharedMap(payload))!.features).toHaveLength(200);
    expect(payload.length).toBeLessThan(40_000);
  });

  it('rejects damaged or hostile links without throwing', async () => {
    expect(await decodeSharedMap('not-base64!!')).toBeNull();
    expect(await decodeSharedMap('AAAA')).toBeNull();
    expect(fromWire({ v: 2, f: [] })).toBeNull();
    const cleaned = fromWire({
      v: 1,
      t: 'x'.repeat(1000),
      b: '<script>',
      f: [
        { k: 9, n: 'bad kind', c: 'ff0000', p: [1, 2] },
        { k: 0, n: 'bad colour', c: 'red', p: [1, 2, 3, 4] },
        { k: 0, n: 'too few', c: 'ff0000', p: [1, 2] },
        { k: 2, n: 'ok', c: 'FF0000', p: [1_057_700_000, 100_200_000], w: 999 },
        { k: 2, n: 'ok', c: '00ff00', p: [1_057_700_000, 100_200_000] },
      ],
    })!;
    expect(cleaned.title).toHaveLength(160);
    expect(cleaned.basemap).toBeUndefined();
    expect(cleaned.features.map((f) => f.name)).toEqual(['ok', 'ok (2)']);
    expect(cleaned.features[0].style).toEqual({ color: '#ff0000', width: 20 });
  });

  it('cleans the title taken from the query string', () => {
    expect(cleanShareTitle('  Tuyến\u0000 ống   cấp nước ')).toBe('Tuyến ống cấp nước');
    expect(cleanShareTitle('Chu\u0300a')).toBe('Ch\u00f9a'); // decomposed -> NFC
    expect(cleanShareTitle('x'.repeat(200))).toHaveLength(80);
    expect(cleanShareTitle('   ')).toBeNull();
    expect(cleanShareTitle(['a'])).toBeNull();
  });
});
