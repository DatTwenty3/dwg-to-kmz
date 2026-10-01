// Acceptance test on the real drawing (CLAUDE.md → "Fixture thật").
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { decodeCadText, decodeStyleBatch, VNI_LEFTOVER_RE, type VnEncoding } from '@/lib/text';
import { FIXTURE_DWG, WASM_DIR } from '../fixtures';

interface RawText {
  type: string;
  style: string;
  raw: string;
  isMText: boolean;
}

interface LooseEntity {
  type: string;
  text?: string | { text?: string; styleName?: string };
  styleName?: string;
  attribs?: LooseEntity[];
}

function collect(e: LooseEntity, out: RawText[]): void {
  if (e.type === 'TEXT' || e.type === 'MTEXT') {
    if (typeof e.text === 'string') out.push({ type: e.type, style: e.styleName ?? '', raw: e.text, isMText: e.type === 'MTEXT' });
  } else if (e.type === 'ATTRIB' && e.text && typeof e.text === 'object' && typeof e.text.text === 'string') {
    out.push({ type: 'ATTRIB', style: e.text.styleName ?? '', raw: e.text.text, isMText: false });
  }
  for (const a of e.attribs ?? []) collect(a, out);
}

// CLAUDE.md suggests /[ÑÖÙØÛÕÏ]/, but Ù and Õ are genuine Vietnamese letters (CHÙA, VÕ) →
// leftovers are Ñ Ö Ø Û Ï anywhere, or Ù/Õ glued after a vowel (an unconverted VNI tone mark).
const VNI_LEFTOVER = VNI_LEFTOVER_RE;

describe('fixture: QHPK Ninh Kiều', () => {
  let texts: RawText[] = [];
  let votes = new Map<string, VnEncoding>();
  let decoded: { item: RawText; text: string; encoding: VnEncoding }[] = [];

  beforeAll(async () => {
    const lib = await LibreDwg.create(WASM_DIR);
    const buf = readFileSync(FIXTURE_DWG);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const ptr = lib.dwg_read_data(data, Dwg_File_Type.DWG);
    if (ptr === undefined) throw new Error('cannot read fixture');
    const db = lib.convert(ptr);
    lib.dwg_free(ptr);
    const out: RawText[] = [];
    for (const e of db.entities as unknown as LooseEntity[]) collect(e, out);
    texts = out;
    votes = decodeStyleBatch(texts.map((t) => ({ style: t.style, raw: t.raw, isMText: t.isMText })));
    decoded = texts.map((item) => {
      const r = decodeCadText({ raw: item.raw, isMText: item.isMText, styleEncoding: votes.get(item.style) });
      return { item, text: r.text, encoding: r.encoding };
    });
  });

  it('reads TEXT, ATTRIB and MTEXT strings', () => {
    expect(texts.filter((t) => t.type === 'TEXT').length).toBeGreaterThan(1000);
    expect(texts.filter((t) => t.type === 'ATTRIB').length).toBeGreaterThan(1000);
    expect(texts.filter((t) => t.type === 'MTEXT').length).toBeGreaterThan(0);
  });

  it('VNI-heavy styles vote VNI', () => {
    const vniStyles = [...votes].filter(([, v]) => v === 'vni').map(([s]) => s);
    expect(vniStyles.length).toBeGreaterThan(0);
    expect(decoded.filter((d) => d.encoding === 'vni').length).toBeGreaterThan(900);
  });

  it('no VNI leftovers after decoding', () => {
    const bad = decoded.filter((d) => !/%%c/i.test(d.item.raw) && VNI_LEFTOVER.test(d.text));
    expect(bad.map((d) => `${d.item.style}: ${d.item.raw} → ${d.text}`)).toEqual([]);
  });

  it('strings with real Unicode are unchanged (apart from format codes)', () => {
    for (const d of decoded) {
      if (!/[Ā-￿]/.test(d.item.raw) || d.item.isMText) continue;
      expect(d.text).toBe(d.item.raw.replace(/%%[uUoO]/g, '').normalize('NFC'));
    }
  });

  it('known strings', () => {
    const all = new Set(decoded.map((d) => d.text.trim()));
    for (const s of ['ĐẤT TRƯỜNG MẦM NON', 'P. THỚI BÌNH', 'HỖN HỢP', 'BẢN ĐỒ QUY HOẠCH SỬ DỤNG ĐẤT', 'TỈNH VĨNH LONG', 'hải']) {
      expect([...all].some((t) => t.includes(s))).toBe(true);
    }
  });

  it('output is NFC and has no U+FFFD', () => {
    for (const d of decoded) {
      expect(d.text).toBe(d.text.normalize('NFC'));
      expect(d.text).not.toContain('�');
    }
  });
});
