// Measurement (not an assertion test): how much more of a "dirty" folder four ideas could keep, on the owner's real
// folder (not committed — skipped without it). Prints tables:
//   1. legend mining — swatch + text outside the boundary give the drawing's own colour/pattern → land use
//   2. fingerprint propagation — (colour, pattern, layer) seen on recognised hatches labels the unrecognised ones
//   3. fusion — colour + layer name + label in polygon + fingerprint + legend voting together
//   4. open lines — rings recovered from open polylines with wider snap tolerances
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CadEntity, PolygonEntity, TextEntity, Vec2 } from '@/lib/cad/types';
import { parseDwg } from '@/lib/cad';
import {
  analysisRows,
  analyzeDrawings,
  colorContexts,
  compactName,
  entityRowKey,
  initialMapping,
  landUseOf,
  loadFolder,
  sameLandUse,
  targetOption,
  classifyColor,
  describeColorKey,
  colorRole,
  type Analysis,
  type LoadedFolder,
} from '@/lib/dwg2gdb';
import { bboxOf, chainRings, isClosedLine, PointGrid, pointInRing } from '@/lib/dwg2gdb/geometry';
import { labelIn, labelIndex } from '@/lib/dwg2gdb/geometry';
import { WASM_DIR } from '../fixtures';

const ROOT = process.env.CLEAN_ROOT ?? 'dwg_to_gdb/LAY Y KIEN SXD';
const walk = (d: string): string[] =>
  statSync(d).isFile() ? [d] : readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Pattern signature of a hatch: solid, or the angle / spacing / dash of its first families (scale-dependent but stable in one folder). */
function patternOf(e: PolygonEntity): string {
  const h = e.hatch;
  if (!h || !h.lines.length) return 'solid';
  const f = (l: (typeof h.lines)[number]) => {
    const a = (l.angle * Math.PI) / 180;
    const d = Math.abs(-l.offset[0] * Math.sin(a) + l.offset[1] * Math.cos(a));
    return `${Math.round(l.angle) % 180}/${d.toFixed(1)}/${l.dashes.length}`;
  };
  return h.lines.slice(0, 3).map(f).join('+');
}

const area = (ring: Vec2[]) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += (p[0] - ring[0][0]) * (q[1] - ring[0][1]) - (q[0] - ring[0][0]) * (p[1] - ring[0][1]);
  }
  return Math.abs(a) / 2;
};

describe.skipIf(!existsSync(ROOT))('Làm sạch — đo 4 hướng trên Long Hiệp', () => {
  let folder: LoadedFolder;
  let a: Analysis;

  beforeAll(async () => {
    const files = walk(ROOT).map((f, i) => ({
      id: `f${i}`,
      name: f.split(sep).pop()!,
      path: relative(ROOT, f).split(sep).join('/'),
      size: statSync(f).size,
      read: async () => {
        const b = readFileSync(f);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    }));
    folder = await loadFolder(files, (_f, data) => parseDwg(data, { wasmBaseUrl: WASM_DIR }));
    a = analyzeDrawings(folder.drawings);
    // CLEAN_FORCE_ROLE=qh-sdd: treat every main drawing as that map kind (role guessing is not what is measured here).
    if (process.env.CLEAN_FORCE_ROLE) {
      for (const d of a.drawings) if (!d.owner) Object.assign(d, { role: process.env.CLEAN_FORCE_ROLE, included: true, note: null });
      a.rows = analysisRows(folder.drawings, a);
    }
  }, 300_000);

  it('report', () => {
    const roleOf = new Map(a.drawings.map((d) => [d.id, d.role]));
    const included = new Set(a.drawings.filter((d) => d.included).map((d) => d.id));
    const sdd = folder.drawings.filter((p) => included.has(p.id) && colorRole(roleOf.get(p.id)!));
    const mapping = initialMapping(a, null);
    const ctx = colorContexts(a);
    console.log('Bản vẽ SDD:', sdd.map((p) => p.name).join('; '), '| Mục', a.section);

    // ---------- per-hatch signals ----------
    interface H {
      drawing: string;
      layer: string;
      color: string;
      pat: string;
      base: string | null; // current mapping (colour first, then layer name)
      colorUse: string | null;
      layerUse: string | null;
      labelUse: string | null;
      label: string | null;
    }
    const hs: H[] = [];
    for (const p of sdd) {
      const inside = a.inside.get(p.id)!;
      const grid = labelIndex({ doc: p.doc, inside });
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || !inside[i]) return;
        const key = entityRowKey(p.id, e, ctx.get(p.id))!;
        const m = mapping.get(key);
        const base = m?.target && /ChucNangSuDungDat_A$/.test(m.target) ? m.phanLoai : null;
        const hex = e.color.toLowerCase();
        const c = classifyColor(hex, a.section);
        const ci = c.level === 'exact' || c.level === 'near' ? describeColorKey('c' + hex.slice(1), a.section) : null;
        const label = labelIn(grid, e.rings);
        hs.push({
          drawing: p.id,
          layer: e.layer,
          color: hex,
          pat: patternOf(e),
          base,
          colorUse: ci?.landUse ?? null,
          layerUse: landUseOf(compactName(e.layer)),
          labelUse: label ? landUseOf(compactName(label)) : null,
          label,
        });
      });
    }
    const N = hs.length;
    const baseKnown = hs.filter((h) => h.base).length;
    console.log(`Vùng tô trong ranh: ${N} | hiện đã phân loại (màu → tên layer): ${baseKnown} (${((baseKnown / N) * 100).toFixed(1)}%) | chưa: ${N - baseKnown}`);
    const unknownBy = new Map<string, number>();
    for (const h of hs) if (!h.base) unknownBy.set(`${h.layer} ${h.color} ${h.pat}`, (unknownBy.get(`${h.layer} ${h.color} ${h.pat}`) ?? 0) + 1);
    console.log('Nhóm chưa phân loại (layer màu kiểu-hatch):');
    console.table([...unknownBy].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, n]) => ({ n, k })));

    // ---------- 1. legend mining ----------
    interface Legend { color: string; pat: string; text: string; use: string | null; drawing: string }
    const legend: Legend[] = [];
    for (const p of sdd) {
      const inside = a.inside.get(p.id)!;
      const texts: { p: Vec2; h: number; t: string }[] = [];
      const grid = new PointGrid<{ h: number; t: string }>(100);
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'text' || inside[i]) return;
        const t = (e as TextEntity).text.replace(/\s+/g, ' ').trim();
        if (t.length < 3 || !/\p{L}/u.test(t)) return;
        texts.push({ p: e.position, h: e.height, t });
        grid.add(e.position, { h: e.height, t });
      });
      let swatches = 0;
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || inside[i] || !e.rings[0] || e.rings[0].length < 3) return;
        const [x0, y0, x1, y1] = bboxOf(e.rings[0]);
        const w = x1 - x0;
        const h = y1 - y0;
        if (w <= 0 || h <= 0 || w > 400 || h > 400 || w / h > 8 || h / w > 8) return;
        // The text to the right of the swatch, vertically centred on it.
        const cy = (y0 + y1) / 2;
        const cand = grid.query([x1 - w * 0.1, cy - Math.max(h, 8), x1 + Math.max(w * 8, 120), cy + Math.max(h, 8)]);
        if (!cand.length) return;
        cand.sort((u, v) => u.p[0] - x1 - (v.p[0] - x1) + Math.abs(u.p[1] - cy) * 0.5 - Math.abs(v.p[1] - cy) * 0.5);
        const best = cand[0];
        swatches++;
        legend.push({ color: e.color.toLowerCase(), pat: patternOf(e), text: best.v.t, use: landUseOf(compactName(best.v.t)), drawing: p.name });
      });
      void texts;
      void swatches;
    }
    const legendKey = (c: string, pt: string) => `${c}|${pt}`;
    const legendUse = new Map<string, Map<string, number>>();
    for (const l of legend) {
      if (!l.use) continue;
      const m = legendUse.get(legendKey(l.color, l.pat)) ?? new Map();
      m.set(l.use, (m.get(l.use) ?? 0) + 1);
      legendUse.set(legendKey(l.color, l.pat), m);
    }
    console.log(`1. Chú giải: ${legend.length} ô mẫu có chữ bên cạnh, ${legend.filter((l) => l.use).length} đọc ra loại đất, ${legendUse.size} dấu vân tay (màu+kiểu hatch) khác nhau`);
    console.table(
      [...legendUse].slice(0, 30).map(([k, m]) => ({ key: k, use: [...m].sort((x, y) => y[1] - x[1])[0][0], n: [...m].reduce((t, [, v]) => t + v, 0) })),
    );
    const topUse = (m: Map<string, number> | undefined) => (m ? [...m].sort((x, y) => y[1] - x[1])[0][0] : null);
    // Does the legend agree with Phụ lục I where both speak?
    let agree = 0;
    let disagree = 0;
    for (const [k, m] of legendUse) {
      const [color] = k.split('|');
      const ci = describeColorKey('c' + color.slice(1), a.section);
      if (!ci || (ci.level !== 'exact' && ci.level !== 'near')) continue;
      if (sameLandUse(ci.landUse, topUse(m)!)) agree++;
      else disagree++;
    }
    console.log(`   Chú giải so với Phụ lục I (màu đã biết): giống ${agree} | khác ${disagree}`);
    // Legend recovers which unknown hatches?
    let byLegend = 0;
    const legendByGroup = new Map<string, number>();
    for (const h of hs) {
      if (h.base) continue;
      const u = topUse(legendUse.get(legendKey(h.color, h.pat))) ?? topUse(
        // colour alone, when the legend has a single use for it
        (() => {
          const merged = new Map<string, number>();
          for (const [k, m] of legendUse) if (k.startsWith(h.color + '|')) for (const [uu, n] of m) merged.set(uu, (merged.get(uu) ?? 0) + n);
          return merged.size ? merged : undefined;
        })(),
      );
      if (u) {
        byLegend++;
        const g = `${h.layer} ${h.color} → ${u}`;
        legendByGroup.set(g, (legendByGroup.get(g) ?? 0) + 1);
      }
    }
    console.log(`   => vùng chưa phân loại mà chú giải trả lời được: ${byLegend}/${N - baseKnown}`);
    console.table([...legendByGroup].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => ({ n, k })));

    // ---------- 2. fingerprint propagation ----------
    // Seeds: hatches whose class is certain by colour table or by layer name (labels agreeing when there is one).
    const seed = new Map<string, Map<string, number>>();
    const fp = (h: H) => `${h.color}|${h.pat}`;
    for (const h of hs) {
      const u = h.colorUse ?? h.layerUse;
      if (!u) continue;
      if (h.labelUse && !sameLandUse(h.labelUse, u)) continue;
      const m = seed.get(fp(h)) ?? new Map();
      m.set(u, (m.get(u) ?? 0) + 1);
      seed.set(fp(h), m);
    }
    let byFp = 0;
    const fpByGroup = new Map<string, number>();
    for (const h of hs) {
      if (h.base) continue;
      const m = seed.get(fp(h));
      if (!m) continue;
      const tot = [...m.values()].reduce((x, y) => x + y, 0);
      const [u, n] = [...m].sort((x, y) => y[1] - x[1])[0];
      if (tot >= 3 && n / tot >= 0.9) {
        byFp++;
        const g = `${h.layer} ${h.color} ${h.pat} → ${u}`;
        fpByGroup.set(g, (fpByGroup.get(g) ?? 0) + 1);
      }
    }
    console.log(`2. Dấu vân tay (màu+kiểu hatch) lan nhãn từ mẫu gốc: cứu được ${byFp}/${N - baseKnown} vùng chưa phân loại`);
    console.table([...fpByGroup].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => ({ n, k })));
    // Label-in-polygon alone on the unknown ones.
    const byLabel = hs.filter((h) => !h.base && h.labelUse).length;
    console.log(`   (chữ trong vùng một mình nhận ra loại đất cho ${byLabel}/${N - baseKnown} vùng chưa phân loại)`);

    // ---------- 3. fusion ----------
    const W = { color: 3, legend: 3, label: 2, layer: 2, fp: 1.5 };
    let covered = 0;
    let strong = 0;
    let conflict = 0;
    let changed = 0;
    let newly = 0;
    let weak = 0;
    const changedBy = new Map<string, number>();
    for (const h of hs) {
      const votes = new Map<string, number>();
      const add = (u: string | null, w: number) => u && votes.set(u, (votes.get(u) ?? 0) + w);
      add(h.colorUse, W.color);
      add(topUse(legendUse.get(legendKey(h.color, h.pat))), W.legend);
      add(h.labelUse, W.label);
      add(h.layerUse, W.layer);
      const m = seed.get(fp(h));
      if (m) {
        const tot = [...m.values()].reduce((x, y) => x + y, 0);
        const [u, n] = [...m].sort((x, y) => y[1] - x[1])[0];
        if (tot >= 3 && n / tot >= 0.9) add(u, W.fp);
      }
      if (!votes.size) continue;
      const ranked = [...votes].sort((x, y) => y[1] - x[1]);
      const [top, score] = ranked[0];
      const second = ranked[1]?.[1] ?? 0;
      const contradicting = ranked.slice(1).some(([u]) => !sameLandUse(u, top));
      covered++;
      if (contradicting && score - second < 1.5) {
        conflict++;
        continue;
      }
      if (score >= 3) strong++;
      else weak++;
      if (!h.base) newly++;
      else if (!sameLandUse(h.base, top)) {
        changed++;
        const k = `${h.layer} ${h.color}: ${h.base} → ${top}`;
        changedBy.set(k, (changedBy.get(k) ?? 0) + 1);
      }
    }
    console.log(
      `3. Gộp tín hiệu: có ít nhất 1 tín hiệu ${covered}/${N} (hiện ${baseKnown}) | chắc (điểm ≥ 3) ${strong} | yếu ${weak} | mâu thuẫn → cần xem ${conflict} | nhận thêm vùng chưa có ${newly} | đổi nhãn so với hiện nay ${changed}`,
    );
    console.table([...changedBy].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => ({ n, k })));

    // ---------- 4. open lines → rings ----------
    // Open polylines inside the boundary on layers that go to an area class (what buildFeatures chains, with SNAP = 1 cm).
    const rowsByKey = new Map(a.rows.map((r) => [r.key, r]));
    const tols = [0.01, 0.05, 0.2, 0.5, 1];
    const tally = new Map<number, { rings: number; used: number }>(tols.map((t) => [t, { rings: 0, used: 0 }]));
    let open = 0;
    const perLayer = new Map<string, { open: number; r: Record<number, number> }>();
    for (const p of folder.drawings.filter((x) => included.has(x.id))) {
      const inside = a.inside.get(p.id)!;
      const byLayer = new Map<string, Vec2[][]>();
      p.doc.entities.forEach((e: CadEntity, i) => {
        if (e.kind !== 'polyline' || !inside[i] || isClosedLine(e.points, e.closed)) return;
        const m = mapping.get(entityRowKey(p.id, e, ctx.get(p.id))!);
        const geom = targetOption(m?.target)?.geom;
        if (geom !== 'A') return;
        const list = byLayer.get(e.layer) ?? [];
        list.push(e.points);
        byLayer.set(e.layer, list);
      });
      for (const [layer, lines] of byLayer) {
        open += lines.length;
        const r: Record<number, number> = {};
        for (const t of tols) {
          const c = chainRings(lines, t);
          tally.get(t)!.rings += c.rings.length;
          tally.get(t)!.used += c.used;
          r[t] = c.rings.length;
        }
        const k = `${p.name} · ${layer}`;
        perLayer.set(k, { open: lines.length, r });
      }
    }
    void rowsByKey;
    void pointInRing;
    void area;
    console.log(`4. Đường hở trên layer ghép vào lớp vùng: ${open} đường`);
    console.table(tols.map((t) => ({ 'ngưỡng nối (m)': t, 'vùng dựng được': tally.get(t)!.rings, 'đường dùng hết': tally.get(t)!.used, 'đường còn bỏ': open - tally.get(t)!.used })));
    console.table([...perLayer].sort((x, y) => y[1].open - x[1].open).slice(0, 8).map(([k, v]) => ({ k, open: v.open, '1cm': v.r[0.01], '5cm': v.r[0.05], '20cm': v.r[0.2], '50cm': v.r[0.5], '1m': v.r[1] })));

    // ---------- 5. what is the biggest unclassified group ("layer hatch")? ----------
    const unk = hs.length ? hs.filter((h) => !h.base && h.layer === 'layer hatch') : [];
    const areas: number[] = [];
    let inLand = 0;
    for (const p of sdd) {
      const inside = a.inside.get(p.id)!;
      const landRings: { bb: [number, number, number, number]; ring: Vec2[]; use: string }[] = [];
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || !inside[i] || e.layer === 'layer hatch') return;
        const m = mapping.get(entityRowKey(p.id, e, ctx.get(p.id))!);
        if (!m?.target || !/ChucNangSuDungDat_A$/.test(m.target) || !e.rings[0]) return;
        landRings.push({ bb: bboxOf(e.rings[0]), ring: e.rings[0], use: m.phanLoai });
      });
      const inLandUse = new Map<string, number>();
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || !inside[i] || e.layer !== 'layer hatch' || !e.rings[0]) return;
        const ar = area(e.rings[0]);
        areas.push(ar);
        const [x0, y0, x1, y1] = bboxOf(e.rings[0]);
        const c: Vec2 = [(x0 + x1) / 2, (y0 + y1) / 2];
        const host = landRings.find((l) => c[0] >= l.bb[0] && c[0] <= l.bb[2] && c[1] >= l.bb[1] && c[1] <= l.bb[3] && pointInRing(c, l.ring));
        if (host) {
          inLand++;
          inLandUse.set(host.use, (inLandUse.get(host.use) ?? 0) + 1);
        }
      });
      if (inLandUse.size) console.log(`   "layer hatch" của ${p.name} nằm trong:`, [...inLandUse].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([u, n]) => `${u} ×${n}`).join('; '));
    }
    areas.sort((x, y) => x - y);
    const pct = (q: number) => (areas.length ? areas[Math.floor(q * (areas.length - 1))].toFixed(1) : '-');
    console.log(`5. "layer hatch" (${unk.length} vùng chưa phân loại): diện tích m² — p10 ${pct(0.1)} | trung vị ${pct(0.5)} | p90 ${pct(0.9)} | lớn nhất ${pct(1)}; tâm nằm trong một vùng đất đã phân loại: ${inLand}/${areas.length}`);

    // ---------- 6. open lines: dangling ends vs T-junctions ----------
    const segDist = (p: Vec2, u: Vec2, v: Vec2) => {
      const dx = v[0] - u[0];
      const dy = v[1] - u[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2)) : 0;
      return Math.hypot(p[0] - (u[0] + t * dx), p[1] - (u[1] + t * dy));
    };
    const buckets = { 'chạm đầu một đường khác ≤ 5 cm': 0, 'chạm giữa một đường khác (chữ T) ≤ 5 cm': 0, 'lệch 5–50 cm tới một đường': 0, 'lệch 0,5–2 m': 0, 'hở > 2 m (đầu tự do)': 0 };
    const seenDrawing = new Set<string>();
    for (const p of folder.drawings.filter((x) => included.has(x.id))) {
      const inside = a.inside.get(p.id)!;
      const lines: Vec2[][] = [];
      const open: Vec2[][] = [];
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polyline' || !inside[i]) return;
        const m = mapping.get(entityRowKey(p.id, e, ctx.get(p.id))!);
        if (targetOption(m?.target)?.geom !== 'A') return;
        lines.push(e.points);
        if (!isClosedLine(e.points, e.closed)) open.push(e.points);
      });
      if (!open.length || seenDrawing.has(p.name.replace(/\W/g, ''))) continue;
      seenDrawing.add(p.name.replace(/\W/g, ''));
      for (const l of open) {
        for (const end of [l[0], l[l.length - 1]]) {
          let dEnd = Infinity;
          let dSeg = Infinity;
          for (const o of lines) {
            if (o === l && o.length < 3) continue;
            for (const q of [o[0], o[o.length - 1]]) if (o !== l || q !== end) dEnd = Math.min(dEnd, Math.hypot(q[0] - end[0], q[1] - end[1]));
            if (Math.abs(o[0][0] - end[0]) > 3000) continue;
            for (let k = 1; k < o.length; k++) if (o !== l || (o[k] !== end && o[k - 1] !== end)) dSeg = Math.min(dSeg, segDist(end, o[k - 1], o[k]));
          }
          if (dEnd <= 0.05) buckets['chạm đầu một đường khác ≤ 5 cm']++;
          else if (dSeg <= 0.05) buckets['chạm giữa một đường khác (chữ T) ≤ 5 cm']++;
          else if (Math.min(dEnd, dSeg) <= 0.5) buckets['lệch 5–50 cm tới một đường']++;
          else if (Math.min(dEnd, dSeg) <= 2) buckets['lệch 0,5–2 m']++;
          else buckets['hở > 2 m (đầu tự do)']++;
        }
      }
    }
    console.log('6. Đầu mút của đường hở (mỗi bản vẽ một lần, bỏ bản sao trùng tên):');
    console.table(Object.entries(buckets).map(([k, n]) => ({ k, n })));

    // ---------- 7. are the "layer hatch" polygons houses already counted elsewhere? ----------
    const houseRows = a.rows.filter((r) => mapping.get(r.key)?.target?.endsWith('/CongTrinh_A'));
    console.log('7. Hàng đã ghép vào CongTrinh_A (nhà):', houseRows.map((r) => `${r.drawing}:${r.layer}/${r.kind} count ${r.count} (đóng ${r.closed}, nối ${r.chained})`).join(' | ') || 'không có');
    {
      const p = sdd.find((x) => x.name.startsWith('QH02')) ?? sdd[0];
      const inside = a.inside.get(p.id)!;
      const houses: { bb: [number, number, number, number]; ring: Vec2[] }[] = [];
      p.doc.entities.forEach((e, i) => {
        if (!inside[i]) return;
        const m = mapping.get(entityRowKey(p.id, e, ctx.get(p.id))!);
        if (!m?.target?.endsWith('/CongTrinh_A')) return;
        const ring = e.kind === 'polygon' ? e.rings[0] : e.kind === 'polyline' && isClosedLine(e.points, e.closed) ? e.points : null;
        if (ring) houses.push({ bb: bboxOf(ring), ring });
      });
      let overlap = 0;
      let total = 0;
      p.doc.entities.forEach((e, i) => {
        if (e.kind !== 'polygon' || !inside[i] || e.layer !== 'layer hatch' || !e.rings[0]) return;
        total++;
        const [x0, y0, x1, y1] = bboxOf(e.rings[0]);
        const c: Vec2 = [(x0 + x1) / 2, (y0 + y1) / 2];
        if (houses.some((h) => c[0] >= h.bb[0] && c[0] <= h.bb[2] && c[1] >= h.bb[1] && c[1] <= h.bb[3] && pointInRing(c, h.ring))) overlap++;
      });
      console.log(`   QH02: ${houses.length} nhà (vòng khép kín) đã có; "layer hatch" ${total} vùng, trong đó tâm nằm trong một nhà đã có: ${overlap}`);

      // ---------- 8. faces recoverable by noding T-junctions (planar graph: faces = E − V + C after pruning dangles) ----------
      const tol = 0.05;
      for (const layer of ['NHA_BKC', 'NHA_T', 'NHA_KC']) {
        const open: Vec2[][] = [];
        p.doc.entities.forEach((e, i) => {
          if (e.kind === 'polyline' && inside[i] && e.layer === layer && !isClosedLine(e.points, e.closed)) open.push(e.points);
        });
        if (!open.length) continue;
        const key = (q: Vec2) => `${Math.round(q[0] / tol)},${Math.round(q[1] / tol)}`;
        // Insert the ends that lie on the middle of another line as vertices of that line.
        const ins: Map<number, { seg: number; t: number; pt: Vec2 }[]> = new Map();
        open.forEach((l, li) => {
          for (const end of [l[0], l[l.length - 1]]) {
            let best: { oi: number; seg: number; t: number; d: number } | null = null;
            open.forEach((o, oi) => {
              for (let k = 1; k < o.length; k++) {
                if (oi === li && (o[k] === end || o[k - 1] === end)) continue;
                const dx = o[k][0] - o[k - 1][0];
                const dy = o[k][1] - o[k - 1][1];
                const l2 = dx * dx + dy * dy;
                if (!l2) continue;
                const t = Math.max(0, Math.min(1, ((end[0] - o[k - 1][0]) * dx + (end[1] - o[k - 1][1]) * dy) / l2));
                const d = Math.hypot(end[0] - (o[k - 1][0] + t * dx), end[1] - (o[k - 1][1] + t * dy));
                if (d <= tol && t > 0 && t < 1 && (!best || d < best.d)) best = { oi, seg: k, t, d };
              }
            });
            if (best) {
              const b = best as { oi: number; seg: number; t: number; d: number };
              const list = ins.get(b.oi) ?? [];
              list.push({ seg: b.seg, t: b.t, pt: end });
              ins.set(b.oi, list);
            }
          }
        });
        const edges = new Set<string>();
        const deg = new Map<string, Set<string>>();
        const addEdge = (u: Vec2, v: Vec2) => {
          const a1 = key(u);
          const b1 = key(v);
          if (a1 === b1) return;
          const ek = a1 < b1 ? `${a1}|${b1}` : `${b1}|${a1}`;
          if (edges.has(ek)) return;
          edges.add(ek);
          (deg.get(a1) ?? deg.set(a1, new Set()).get(a1)!).add(b1);
          (deg.get(b1) ?? deg.set(b1, new Set()).get(b1)!).add(a1);
        };
        open.forEach((l, li) => {
          const extra = (ins.get(li) ?? []).sort((x, y) => x.seg - y.seg || x.t - y.t);
          const pts: Vec2[] = [l[0]];
          for (let k = 1; k < l.length; k++) {
            for (const x of extra) if (x.seg === k) pts.push(x.pt);
            pts.push(l[k]);
          }
          for (let k = 1; k < pts.length; k++) addEdge(pts[k - 1], pts[k]);
        });
        // Prune dangling vertices.
        const queue = [...deg].filter(([, n]) => n.size <= 1).map(([v]) => v);
        while (queue.length) {
          const v = queue.pop()!;
          const nb = deg.get(v);
          if (!nb) continue;
          for (const w of nb) {
            deg.get(w)?.delete(v);
            if ((deg.get(w)?.size ?? 0) <= 1) queue.push(w);
          }
          deg.delete(v);
        }
        const E = [...deg.values()].reduce((t, n) => t + n.size, 0) / 2;
        const V = deg.size;
        // Connected components.
        const seenV = new Set<string>();
        let C = 0;
        for (const v of deg.keys()) {
          if (seenV.has(v)) continue;
          C++;
          const st = [v];
          while (st.length) {
            const x = st.pop()!;
            if (seenV.has(x)) continue;
            seenV.add(x);
            for (const w of deg.get(x) ?? []) st.push(w);
          }
        }
        const chained = chainRings(open, tol).rings.length;
        console.log(`8. QH02 · ${layer}: ${open.length} đường hở → nối đầu–đầu ≤ 5 cm dựng ${chained} vùng | nối cả chữ T (đồ thị phẳng) dựng ${E - V + C} vùng`);
      }
    }
    expect(N).toBeGreaterThan(0);
  });
});
