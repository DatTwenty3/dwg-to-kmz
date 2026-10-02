import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readSession, SESSION_FORMAT, SessionError, writeSession, type Session } from '@/lib/cad/session';
import type { SketchFeature } from '@/lib/cad/sketch';

const features: SketchFeature[] = [
  { id: 'a', kind: 'line', name: 'Tuyến ống cấp nước', points: [[105.74, 10.01], [105.75, 10.02]], style: { color: '#e11d48', width: 3, dash: 'dashed' } },
  { id: 'b', kind: 'point', name: 'Trạm bơm', points: [[105.745, 10.015]], style: { color: '#2563eb' }, label: 'Trạm bơm số 1' },
];

const session: Session = {
  map: { title: 'Phương án – P. An Khánh', description: 'Mô tả tiếng Việt', basemap: 'google-hybrid', features },
  sketchLayer: { shown: true, opacity: 0.8 },
  files: [
    {
      name: 'Quy hoạch Ninh Kiều.dwg',
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
      crs: { proj4: '+proj=tmerc +lon_0=105 +k=0.9999 +x_0=500000', swapXY: false, unitScale: 1, offset: [1.5, -2] },
      provinceId: 'can-tho',
      visible: ['0', 'NKIEU-KT-QHCT_Đất quân sự'],
      styles: { '0': { color: '#ff0000', width: 2, dash: 'dotted', fillOpacity: 0.4 } },
      opacity: 0.6,
      shown: false,
    },
    { name: 'ranh.kmz', bytes: new Uint8Array([9, 9]), crs: null, provinceId: '', visible: [], styles: {}, opacity: 1, shown: true },
  ],
  active: 1,
  savedAt: '2026-10-02T03:00:00.000Z',
};

const roundTrip = async (s: Session) => readSession(await (await writeSession(s)).arrayBuffer());

describe('session file (.ldg)', () => {
  it('round-trips files (bytes, CRS, layers, styles, opacity), sketches and map info', async () => {
    const back = await roundTrip(session);
    expect(back.map.title).toBe(session.map.title);
    expect(back.map.description).toBe('Mô tả tiếng Việt');
    expect(back.map.basemap).toBe('google-hybrid');
    expect(back.map.features.map((f) => f.name)).toEqual(['Tuyến ống cấp nước', 'Trạm bơm']);
    expect(back.map.features[1].label).toBe('Trạm bơm số 1');
    expect(back.sketchLayer).toEqual({ shown: true, opacity: 0.8 });
    expect(back.active).toBe(1);
    expect(back.savedAt).toBe(session.savedAt);
    expect(back.files).toHaveLength(2);
    const [dwg, kmz] = back.files;
    expect(dwg.name).toBe('Quy hoạch Ninh Kiều.dwg');
    expect([...dwg.bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(dwg.crs).toEqual(session.files[0].crs);
    expect(dwg.visible).toEqual(session.files[0].visible);
    expect(dwg.styles).toEqual(session.files[0].styles);
    expect(dwg).toMatchObject({ provinceId: 'can-tho', opacity: 0.6, shown: false });
    expect(kmz).toMatchObject({ name: 'ranh.kmz', crs: null, shown: true });
  });

  it('rejects files that are not sessions with a Vietnamese message', async () => {
    await expect(readSession(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(SessionError);
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ format: 'something-else' }));
    await expect(readSession(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/không phải phiên làm việc/);
    const newer = new JSZip();
    newer.file('manifest.json', JSON.stringify({ format: SESSION_FORMAT, version: 99 }));
    await expect(readSession(await newer.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/phiên bản LEDAT-GIS mới hơn/);
  });

  it('sanitises an edited / hostile manifest', async () => {
    const zip = new JSZip();
    zip.file('files/0-x.dwg', new Uint8Array([7]));
    zip.file('files/1-evil.exe', new Uint8Array([7]));
    zip.file(
      'manifest.json',
      JSON.stringify({
        format: SESSION_FORMAT,
        version: 1,
        map: { v: 1, t: 'T', f: [] },
        files: [
          {
            name: 'x.dwg',
            path: 'files/0-x.dwg',
            crs: { proj4: 42 },
            visible: ['a', 3],
            styles: { a: { color: 'red', width: 999, dash: 'zigzag', fillOpacity: 5 }, b: 'nope' },
            opacity: 7,
          },
          { name: 'evil.exe', path: 'files/1-evil.exe' }, // not a drawing type
          { name: 'missing.dxf', path: 'files/9-missing.dxf' }, // no bytes in the archive
        ],
        active: 12,
      }),
    );
    const s = await readSession(await zip.generateAsync({ type: 'uint8array' }));
    expect(s.files).toHaveLength(1);
    expect(s.files[0]).toMatchObject({ crs: null, visible: ['a'], styles: { a: { width: 20, fillOpacity: 1 } }, opacity: 1, shown: true });
    expect(s.active).toBe(0);
    expect(s.map.title).toBe('T');
  });
});
