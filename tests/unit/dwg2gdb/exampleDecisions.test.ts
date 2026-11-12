// The example decision files shipped with the skill (.claude/skills/lam-sach-ban-ve-quy-hoach/references) must stay valid:
// they are what the next dossier is copied from.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = '.claude/skills/lam-sach-ban-ve-quy-hoach/references';
const files = readdirSync(DIR);
const KINDS = new Set(['polyline', 'polygon', 'text', 'point']);

describe('example quyet-dinh files', () => {
  for (const f of files.filter((n) => /^vi-du-quyet-dinh-.*\.json$/.test(n))) {
    it(f, () => {
      const raw = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as unknown;
      const list = (Array.isArray(raw) ? raw : (raw as { overrides?: unknown[] }).overrides ?? []) as Record<string, unknown>[];
      expect(list.length).toBeGreaterThan(0);
      for (const o of list) {
        expect(typeof o.layer).toBe('string');
        expect(['drop', 'keep']).toContain(o.action);
        if (o.action === 'keep') expect(typeof o.to).toBe('string');
        if (o.kind !== undefined) expect(KINDS.has(o.kind as string)).toBe(true);
        if (o.color !== undefined) expect(o.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(String(o.why ?? '').length).toBeGreaterThan(3); // every decision says why
      }
    });
  }
});

describe('example chap-nhan-lech files', () => {
  for (const f of files.filter((n) => /^vi-du-chap-nhan-lech-.*\.json$/.test(n))) {
    it(f, () => {
      const m = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as Record<string, string>;
      for (const [k, why] of Object.entries(m)) {
        // A class ("HienTrang/Nhom/Lop") or one of the counts the gate also compares ("chữ biển số").
        expect(k).toMatch(/^((HienTrang|QuyHoach|NenDiaHinh|MocGioi)\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+|chữ biển số)$/);
        expect(why.length).toBeGreaterThan(30); // a concrete reason, not "ok"
      }
    });
  }
});
