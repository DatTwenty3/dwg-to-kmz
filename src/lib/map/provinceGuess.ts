// Guess the province of a drawing from its own text (title blocks usually name it, e.g.
// "TP. CẦN THƠ", "QUẬN NINH KIỀU"). Without a province every VN-2000 central meridian lands
// inside *some* province and auto-detection cannot choose; with it, suggestCrs ranks correctly.
import type { CadDocument } from '@/lib/cad/types';
import { foldVietnamese, PROVINCES } from '@/lib/geo';

export interface ProvinceGuess {
  id: string;
  name: string;
  /** Number of text entities mentioning it. */
  hits: number;
}

/** Province names/aliases (folded, ≥ 4 chars) → province id. Exported for tests. */
export function provinceKeywords(): { id: string; name: string; words: string[] }[] {
  return PROVINCES.map((p) => {
    const words = [p.name, ...p.aliases]
      .map(foldVietnamese)
      .filter((w) => w.length >= 4);
    return { id: p.id, name: p.name, words: [...new Set(words)] };
  });
}

export function guessProvinceFromText(doc: CadDocument): ProvinceGuess | null {
  const keys = provinceKeywords();
  const hits = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of doc.entities) {
    const texts = e.kind === 'text' ? [e.text] : e.kind === 'table' ? e.cells.map((c) => c.text) : [];
    for (const t of texts) {
      if (t.length < 4 || seen.has(t)) continue;
      seen.add(t);
      const folded = ` ${foldVietnamese(t)} `;
      for (const k of keys) {
        if (k.words.some((w) => folded.includes(` ${w} `))) hits.set(k.id, (hits.get(k.id) ?? 0) + 1);
      }
    }
  }
  let best: ProvinceGuess | null = null;
  for (const k of keys) {
    const n = hits.get(k.id) ?? 0;
    if (n > 0 && (!best || n > best.hits)) best = { id: k.id, name: k.name, hits: n };
  }
  return best;
}
