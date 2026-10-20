import { describe, expect, it } from 'vitest';
import { classifyDrop, mapFilePaths } from '@/lib/launch/classify';

describe('classifyDrop', () => {
  it('one or several loose drawings / KMZ / sessions → map', () => {
    expect(classifyDrop(['ninh-kieu.dwg'])).toBe('map');
    expect(classifyDrop(['a.dxf', 'b.kmz'])).toBe('map');
    expect(classifyDrop(['x.KML'])).toBe('map');
    expect(classifyDrop(['phien.ldg'])).toBe('map');
  });
  it('a geodatabase folder or HoSoGIS → check', () => {
    expect(classifyDrop(['HoSoGIS/HienTrang.gdb/a00000001.gdbtable', 'HoSoGIS/HienTrang.gdb/a00000001.gdbtablx'])).toBe('check');
    expect(classifyDrop(['QuyHoach.gdb/A00000001.GDBTABLE'])).toBe('check');
  });
  it('a loose .zip → check; .kmz stays a map file', () => {
    expect(classifyDrop(['HoSoGIS.zip'])).toBe('check');
    expect(classifyDrop(['x.kmz'])).toBe('map');
  });
  it('a dossier folder with several drawings → extract', () => {
    expect(classifyDrop(['Dossier/QH01.dwg', 'Dossier/QH02.dwg', 'Dossier/Xr_nen.dwg', 'Dossier/readme.txt'])).toBe('extract');
  });
  it('a folder with a single drawing → map', () => {
    expect(classifyDrop(['Dossier/QH01.dwg', 'Dossier/readme.txt'])).toBe('map');
    expect(mapFilePaths(['Dossier/QH01.dwg', 'Dossier/readme.txt'])).toEqual(['Dossier/QH01.dwg']);
  });
  it('a geodatabase wins over drawings in the same drop', () => {
    expect(classifyDrop(['Hồ sơ/QH01.dwg', 'Hồ sơ/QH02.dwg', 'Hồ sơ/HienTrang.gdb/a00000001.gdbtable'])).toBe('check');
  });
  it('unknown → null', () => {
    expect(classifyDrop(['anh.png', 'ghi-chu.docx'])).toBeNull();
    expect(classifyDrop([])).toBeNull();
  });
  it('Windows separators', () => {
    expect(classifyDrop(['Dossier\\QH01.dwg', 'Dossier\\QH02.dwg'])).toBe('extract');
  });
});
