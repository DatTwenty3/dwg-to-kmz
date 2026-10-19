// Which Mục of Phụ lục I (kind of planning drawing) a folder follows — it decides which colour table applies.
// From the title block ("QUY HOẠCH CHUNG XÃ …" → Mục 7), else by vote: the Mục whose colours the hatches match best.
import { foldVietnamese } from '@/lib/geo/provinces';
import { matchColor } from './color';
import { LAND_USE_SECTIONS, SECTION_TITLES, symbolsOfSection } from './tt16Symbols';

export interface SectionChoice {
  section: number | null;
  /** Short Vietnamese reason shown next to the choice. */
  why: string;
  source: 'title' | 'vote' | 'none';
}

const NONE: SectionChoice = { section: null, why: 'Chưa nhận ra loại đồ án', source: 'none' };

/** "1/10.000", "1:10000" → 10000 (only the scales that tell Mục 2 from Mục 3). */
function scalesIn(texts: string[]): number[] {
  const out: number[] = [];
  for (const t of texts) {
    if (t.length > 300) continue;
    for (const m of t.matchAll(/1\s*[/:]\s*(\d{1,2})[.,]?(\d{3})\b/g)) out.push(Number(m[1] + m[2]));
  }
  return out;
}

/** Mục from the title(s) of the drawings: "QUY HOẠCH CHUNG XÃ …" → 7, "QUY HOẠCH PHÂN KHU …" → 4, … */
export function sectionFromTitles(texts: string[]): SectionChoice {
  const titles = texts.filter((t) => t.length <= 300).map((t) => foldVietnamese(t).replace(/\s+/g, ' ').trim());
  const hit = (re: RegExp) => titles.find((t) => re.test(t));
  const as = (section: number, why: string): SectionChoice => ({ section, why, source: 'title' });

  if (hit(/quy hoach phan khu/)) return as(4, 'Tiêu đề: quy hoạch phân khu');
  if (hit(/quy hoach chi tiet/)) return as(5, 'Tiêu đề: quy hoạch chi tiết');
  if (hit(/quy hoach chung (?:xay dung )?(?:khu (?:kinh te|chuc nang|cong nghiep|du lich|che xuat)|khu cn\b)/)) return as(6, 'Tiêu đề: quy hoạch chung khu chức năng');
  if (hit(/quy hoach chung (?:xay dung )?(?:xa|dac khu|nong thon)\b/)) return as(7, 'Tiêu đề: quy hoạch chung xã');
  if (hit(/quy hoach chung (?:xay dung )?(?:do thi|thanh pho|thi xa|thi tran|phuong|huyen)\b/)) {
    const scales = scalesIn(texts);
    const big = scales.filter((s) => s >= 10000).length;
    const small = scales.filter((s) => s >= 5000 && s < 10000).length;
    return small > big ? as(3, 'Tiêu đề: quy hoạch chung đô thị 1/5.000') : as(2, 'Tiêu đề: quy hoạch chung đô thị 1/10.000');
  }
  return NONE;
}

/** Mục (2..7) whose colour table matches most hatches: `hexCounts` = hatch colour → number of hatches. */
export function sectionByVote(hexCounts: ReadonlyMap<string, number>): SectionChoice {
  let best: { section: number; score: number; specific: number } | null = null;
  let total = 0;
  for (const n of hexCounts.values()) total += n;
  for (const section of LAND_USE_SECTIONS) {
    const symbols = symbolsOfSection(section);
    let score = 0;
    for (const [hex, n] of hexCounts) if (matchColor(hex, symbols, 'A').level === 'exact') score += n;
    // Several sections share colours: on a tie the one with fewer symbols is the more specific.
    const specific = symbols.filter((s) => s.kind === 'A').length;
    if (score > 0 && (!best || score > best.score || (score === best.score && specific < best.specific))) best = { section, score, specific };
  }
  if (!best) return NONE;
  return { section: best.section, why: `Bầu chọn: ${best.score.toLocaleString('vi-VN')}/${total.toLocaleString('vi-VN')} vùng khớp màu ${SECTION_TITLES[best.section]}`, source: 'vote' };
}

/** Title first, then the vote; null when neither gives anything. */
export function pickSection(texts: string[], hexCounts?: ReadonlyMap<string, number>): SectionChoice {
  const t = sectionFromTitles(texts);
  if (t.section !== null) return t;
  return hexCounts ? sectionByVote(hexCounts) : NONE;
}
