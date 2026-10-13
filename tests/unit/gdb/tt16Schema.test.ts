// The TT16 data structure (src/lib/gdb/tt16-schema.json) is extracted from the Bộ Xây dựng template geodatabases
// (templete/…, not committed, never shipped): groups, classes, class aliases, fields (order, type, length, alias,
// domain) and coded value domains. With the template present this test checks the JSON is still in sync; run with
// TT16_SCHEMA_WRITE=1 to regenerate it. Without the template it only checks the committed JSON is coherent.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectGdbs, readCatalog, readTable, type GdbEntry } from '@/lib/gdb';
import { TT16_SCHEMA, type Tt16Schema } from '@/lib/gdb/tt16Schema';

const TPL = 'templete/86.VinhLong.CTDL_QuyHoachDTNT_TT16_VN2000_105-30_gdb_template';
const OUT = 'src/lib/gdb/tt16-schema.json';
const SYSTEM = new Set(['objectid', 'shape', 'shape_length', 'shape_area']);
const TYPES: Record<string, string> = { string: 'string', float32: 'float32', float64: 'float64', int16: 'int16', int32: 'int32', datetime: 'datetime' };

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

async function extract(): Promise<Tt16Schema> {
  const entries: GdbEntry[] = walk(TPL).map((p) => ({ path: relative(TPL, p).split(sep).join('/'), read: async () => readFileSync(p) }));
  const schema: Tt16Schema = { source: '86.VinhLong.CTDL_QuyHoachDTNT_TT16 — mẫu cấu trúc dữ liệu của Bộ Xây dựng', databases: {}, domains: {} };
  for (const g of collectGdbs(entries).gdbs.sort((a, b) => a.name.localeCompare(b.name))) {
    const db = g.name.replace(/\.gdb$/i, '');
    const cat = await readCatalog(g);
    const items = readTable(await g.files.get('a00000004.gdbtable')!.read(), await g.files.get('a00000004.gdbtablx')!.read());
    const defs = new Map<string, string>();
    for (const r of items.rows()) defs.set(String(r.Path ?? ''), String(r.Definition ?? ''));
    for (const r of items.rows()) {
      const def = String(r.Definition ?? '');
      if (!def.includes('CodedValueDomain')) continue;
      const fieldType = /<FieldType>esriFieldType(\w+)<\/FieldType>/.exec(def)?.[1] ?? 'String';
      const values = [...def.matchAll(/<Name>([^<]*)<\/Name>\s*<Code[^>]*>([^<]*)<\/Code>/g)].map((m) => [m[2], m[1]] as [string, string]);
      (schema.domains[db] ??= {})[String(r.Name)] = { fieldType, values };
    }
    const datasets = [...cat.datasets].sort();
    schema.databases[db] = datasets.map((ds) => ({
      name: ds,
      classes: cat.classes
        .filter((c) => c.dataset === ds)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => {
          const def = defs.get(c.path) ?? '';
          const domainOf = new Map(
            [...def.matchAll(/<GPFieldInfoEx[\s\S]*?<\/GPFieldInfoEx>/g)].map((m) => [/<Name>([^<]+)/.exec(m[0])?.[1] ?? '', /<DomainName>([^<]+)/.exec(m[0])?.[1] ?? '']),
          );
          const alias = /<\/GPFieldInfoExs>[\s\S]*?<AliasName>([^<]*)<\/AliasName>/.exec(def)?.[1] ?? c.alias;
          return {
            name: c.name,
            alias,
            geom: c.geom!,
            fields: c.fields
              .filter((f) => !SYSTEM.has(f.name.toLowerCase()) && f.type !== 'geometry' && f.type !== 'objectid')
              .map((f) => {
                const t = TYPES[f.type];
                if (!t) throw new Error(`${c.name}.${f.name}: type ${f.type}`);
                const d = domainOf.get(f.name);
                return { name: f.name, alias: f.alias, type: t, ...(t === 'string' ? { length: f.length } : {}), ...(d ? { domain: d } : {}) } as Tt16Schema['databases'][string][number]['classes'][number]['fields'][number];
              }),
          };
        }),
    }));
  }
  return schema;
}

describe('TT16 data structure (Bộ Xây dựng template)', () => {
  it.skipIf(!existsSync(TPL))('is in sync with the template', async () => {
    const s = await extract();
    if (process.env.TT16_SCHEMA_WRITE) writeFileSync(OUT, JSON.stringify(s, null, 1) + '\n');
    expect(JSON.parse(readFileSync(OUT, 'utf8'))).toEqual(s);
  }, 120_000);

  it('describes 4 databases, 153 classes and the domains their fields use', () => {
    const count = Object.values(TT16_SCHEMA.databases).reduce((t, ds) => t + ds.reduce((u, d) => u + d.classes.length, 0), 0);
    expect(Object.keys(TT16_SCHEMA.databases).sort()).toEqual(['HienTrang', 'MocGioi', 'NenDiaHinh', 'QuyHoach']);
    expect(count).toBe(153);
    for (const ds of Object.values(TT16_SCHEMA.databases))
      for (const d of ds)
        for (const c of d.classes)
          for (const f of c.fields) if (f.domain) expect(Object.values(TT16_SCHEMA.domains).some((x) => x[f.domain!]), `${c.name}.${f.name}`).toBe(true);
  });
});
