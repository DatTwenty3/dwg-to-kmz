// Province of a planning dossier from its drawings' title blocks ("XÃ LONG HIỆP, TỈNH VĨNH LONG"), and the
// VN-2000 central meridian that goes with it. The location alone is ambiguous: a wrong KTT shifts the data by
// ~55 km per 30' and can land it inside a neighbour that uses that KTT (Long Hiệp: 105°30' Trà Vinh and 105°
// Hậu Giang both "fit"), so the province named in the drawings decides.
import { foldVietnamese, PROVINCES, type Province } from '@/lib/geo/provinces';
import type { Vn2000Guess } from '@/lib/geo/search';

/** The province named most often as "tỉnh X" / "thành phố X" in the texts (current or former names). */
export function provinceFromTexts(texts: string[]): Province | null {
  const names = PROVINCES.flatMap((p) => [p.name, ...(p.formerUnits ?? []).map((u) => u.name)].map((n) => ({ p, n: foldVietnamese(n) })));
  const votes = new Map<Province, number>();
  for (const t of texts) {
    if (t.length > 400) continue;
    // foldVietnamese drops a leading "tỉnh" — keep it with a dummy first word.
    const f = ` ${foldVietnamese(`x ${t}`)} `;
    if (!/ (tinh|thanh pho|tp) /.test(f)) continue;
    for (const { p, n } of names)
      if (f.includes(` tinh ${n} `) || f.includes(` thanh pho ${n} `) || f.includes(` tp ${n} `)) votes.set(p, (votes.get(p) ?? 0) + 1);
  }
  let best: Province | null = null;
  let n = 0;
  for (const [p, v] of votes)
    if (v > n) {
      best = p;
      n = v;
    }
  return best;
}

/** The location guesses that belong to the province (all of them when it is unknown or none matches). */
export function guessesInProvince(guesses: Vn2000Guess[], province: Province | null): Vn2000Guess[] {
  if (!province) return guesses;
  const former = new Set((province.formerUnits ?? []).map((u) => foldVietnamese(u.name)));
  const inside = guesses.filter((g) => g.province.split(', ').some((n) => former.has(foldVietnamese(n))));
  return inside.length ? inside : guesses;
}
