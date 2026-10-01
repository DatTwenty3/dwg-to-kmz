import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectFormat } from '@/lib/cad';
import { FIXTURE_DWG } from './fixtures';

describe('detectFormat', () => {
  it('recognises the real fixture as DWG by its magic bytes', () => {
    const buf = readFileSync(FIXTURE_DWG);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    expect(detectFormat('x.bin', data)).toBe('dwg');
  });

  it('falls back to DXF for text files', () => {
    const data = new TextEncoder().encode('0\nSECTION\n').buffer;
    expect(detectFormat('a.dxf', data)).toBe('dxf');
  });
});
