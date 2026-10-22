// Road network attributes read from the drawing: the name written along a road ("ĐƯỜNG HUYỆN 36", "ĐƯỜNG 915C",
// "TUYẾN SỐ 5"), its kind and rank (quốc lộ / tỉnh / huyện), its surface (the layer "DUONG_NHUA", the note "(ĐƯỜNG NHỰA)")
// and the bridges' names. Pure: texts and lines in, TT16 field values out (domain codes looked up in the template).
import type { Vec2 } from '@/lib/cad/types';
import { foldVietnamese } from '@/lib/geo/provinces';
import { domainCode } from '@/lib/gdb/tt16Schema';

export interface RoadText {
  text: string;
  at: Vec2;
  height: number;
  rotation: number;
}

export interface RoadName {
  /** Proper name as written, in title case ("Đường huyện 36", "Đường 915C"); null for a note of surface only. */
  name: string | null;
  /** Rank of the road (kind and class are the same for these), null when the name does not tell. */
  rank: RoadRank | null;
  /** LoaiChatLieuTraiMat label. */
  surface: string | null;
}

/** Rank keys; the labels differ between the geodatabases ("Quốc lộ" in HienTrang, "Đường quốc lộ" in QuyHoach). */
export type RoadRank = 'quocLo' | 'tinh' | 'huyen' | 'khuVuc';
const LOAI_LABELS: Record<RoadRank, string[]> = {
  quocLo: ['Đường quốc lộ', 'Quốc lộ'],
  tinh: ['Đường tỉnh'],
  huyen: ['Đường huyện', 'Đường huyện\nĐường huyện'],
  khuVuc: ['Đường khu vực'],
};
const CAP_LABELS: Record<RoadRank, string[]> = {
  quocLo: ['Đường quốc lộ'],
  tinh: ['Đường tỉnh'],
  huyen: ['Đường huyện'],
  khuVuc: ['Đường cấp khu vực'],
};
export const SURFACE = { dat: 'Đất', nhua: 'Nhựa', beTong: 'Bê tông', da: 'Đá, sỏi' } as const;

const NOT_A_ROAD = /\b(dien|day|ong|nuoc|thoat|kinh|di bo|dong muc|thai|rac|tru|mat cat)\b/;
const GENERIC_BRIDGE = /^cau( (be tong|sat|thep|go|khi|xi mang|bt|btct|tam|dan sinh|cong|nho|treo))*$/;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|\.|-)/)
    .map((w) => (/\d/.test(w) ? w.toUpperCase() : /^(qh|ql|dt|dh|hl|tl)$/.test(foldVietnamese(w)) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

const surfaceOf = (f: string): string | null =>
  /nhua/.test(f) ? SURFACE.nhua : /be tong|btxm|\bbt\b/.test(f) ? SURFACE.beTong : /cap phoi|\bda\b|soi/.test(f) ? SURFACE.da : /\bdat\b|\bmon\b/.test(f) ? SURFACE.dat : null;

/**
 * What a text written along a road says. null = not about a road. A note such as "ĐƯỜNG NHỰA" gives the surface only;
 * "ĐƯỜNG HL12 (ĐƯỜNG NHỰA)" gives both.
 */
export function parseRoadText(raw: string): RoadName | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 60) return null;
  // The note in brackets is the surface; the rest is the name.
  const bracket = /\(([^)]*)\)/.exec(text);
  const main = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const noteSurface = bracket ? surfaceOf(foldVietnamese(bracket[1])) : null;
  const f = foldVietnamese(main);
  if (!f || NOT_A_ROAD.test(f) || /\d\s?m$|l\s?=/.test(f)) return null;
  const out = (name: string | null, rank: RoadRank | null): RoadName => ({ name, rank, surface: noteSurface });

  let m = /^(duong )?(quoc lo|ql)\s?(\d+[a-z]?)$/.exec(f);
  if (m) return out(`Quốc lộ ${m[3].toUpperCase()}`, 'quocLo');
  m = /^(duong )?(tinh lo|duong tinh|dt|tl)\s?(\d+[a-z]?)$/.exec(f) ?? /^(duong tinh)\s?(\d+[a-z]?)$/.exec(f);
  if (m) return out(`Đường tỉnh ${m[m.length - 1].toUpperCase()}`, 'tinh');
  m = /^(duong )?(huyen|dh|duong huyen)\s?(\d+[a-z]?)$/.exec(f);
  if (m) return out(`Đường huyện ${m[3].toUpperCase()}`, 'huyen');
  // "ĐƯỜNG 915C": a three-digit number is a provincial road.
  m = /^duong (\d{3}[a-z]?)$/.exec(f);
  if (m) return out(`Đường ${m[1].toUpperCase()}`, 'tinh');
  m = /^tuyen so (\d+)$/.exec(f);
  if (m) return out(`Tuyến số ${m[1]}`, null);
  // A note of the surface only.
  m = /^duong (nhua|be tong|dat|da|cap phoi|mon|btxm|dan)$/.exec(f);
  if (m) return { name: null, rank: null, surface: surfaceOf(f) };
  // "ĐƯỜNG BÊ TÔNG BA TRẠCH": the surface, then the name.
  m = /^duong (nhua|be tong|dat|da|cap phoi) (.{2,})$/.exec(f);
  if (m) {
    const words = main.split(' ');
    const skip = /^(nhua|be tong|cap phoi)$/.test(m[1]) ? (m[1] === 'be tong' ? 3 : 2) : 2;
    return { name: titleCase(`Đường ${words.slice(skip).join(' ')}`), rank: null, surface: noteSurface ?? surfaceOf(m[1]) };
  }
  m = /^duong (.+)$/.exec(f);
  if (m && m[1].length >= 2) return out(titleCase(main), null);
  return null;
}

/** Name of a bridge written next to it ("Cầu Kênh Xáng"); the type notes ("CẦU BÊ TÔNG") name nothing. */
export function parseBridgeText(raw: string): { name: string | null; note: string } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  const f = foldVietnamese(text);
  if (!text || text.length > 60 || !/^cau\b/.test(f)) return null;
  return { name: GENERIC_BRIDGE.test(f) ? null : titleCase(text), note: titleCase(text) };
}

/** Surface of the road a layer is named after ("DUONG_NHUA", "DUONG_BETONG", "DUONG_MON"). */
export function layerSurface(compact: string): string | null {
  if (/nhua/.test(compact)) return SURFACE.nhua;
  if (/betong|btxm/.test(compact)) return SURFACE.beTong;
  if (/duongda|dasoi|capphoi/.test(compact)) return SURFACE.da;
  if (/duongmon|duongdat/.test(compact)) return SURFACE.dat;
  return null;
}

/** Kind and rank a layer is named after ("D-QuocLo", "D-TINH", "HTKT_GT_Duongkhuvuc"). */
export function layerRank(compact: string): RoadRank | null {
  if (/quoclo|^ql\d*$/.test(compact)) return 'quocLo';
  if (/duongtinh|^dtinh$|tinhlo/.test(compact)) return 'tinh';
  if (/duonghuyen|huyenlo/.test(compact)) return 'huyen';
  if (/duongkhuvuc/.test(compact)) return 'khuVuc';
  return null;
}

/** Readable phanLoai of the road layers the drawings name by habit. */
export function roadPhanLoai(compact: string): string | null {
  const table: [RegExp, string][] = [
    [/timduong/, 'Tim đường'],
    [/htktgtquyhoach/, 'Đường quy hoạch'],
    [/htktgtnongthon/, 'Giao thông nông thôn'],
    [/duongkhuvuc/, 'Đường khu vực'],
    [/heduong/, 'Hệ thống đường'],
    [/duonghientrangmorong/, 'Đường hiện trạng mở rộng'],
    [/longduong/, 'Lòng đường'],
    [/quoclo/, 'Quốc lộ'],
    [/duongtinh|^dtinh$/, 'Đường tỉnh'],
    [/duongnhua/, 'Đường nhựa'],
    [/duongbetong/, 'Đường bê tông'],
    [/duongmon/, 'Đường mòn'],
    [/duongda$/, 'Đường đá'],
    [/nenbetong/, 'Nền bê tông'],
    [/kebetong/, 'Kè bê tông'],
    [/caubetong/, 'Cầu bê tông'],
    [/giaothongdinhhuong|giaothongqh/, 'Giao thông quy hoạch'],
    [/cau$/, 'Cầu'],
  ];
  return table.find(([re]) => re.test(compact))?.[1] ?? null;
}

// ------------------------------------------------------------------------------------------ matching texts to lines

function segmentDistance(p: Vec2, a: number[], b: number[]): { d: number; angle: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

const angleGap = (a: number, b: number) => {
  const g = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(g, 180 - g);
};

/**
 * Index of the text written along a line: the nearest one lying within a few text heights of it and turned the way the
 * line runs there (names are written along the road). -1 when there is none.
 */
export function textAlong(lines: number[][][], texts: readonly RoadText[], maxTurn = 30): number {
  let best = -1;
  let bestD = Infinity;
  texts.forEach((t, i) => {
    const reach = Math.max(2.5 * t.height, 20);
    let near = Infinity;
    let angle = 0;
    for (const line of lines)
      for (let k = 1; k < line.length; k++) {
        const s = segmentDistance(t.at, line[k - 1], line[k]);
        if (s.d < near) {
          near = s.d;
          angle = s.angle;
        }
      }
    if (near > reach || angleGap(angle, t.rotation) > maxTurn) return;
    if (near < bestD) {
      bestD = near;
      best = i;
    }
  });
  return best;
}

/** Field values (domain labels resolved to codes of one geodatabase) for a road. */
export function roadFields(db: string, r: Partial<RoadName>): Record<string, string> {
  const out: Record<string, string> = {};
  if (r.name) out.tenDuong = r.name.slice(0, 100);
  const set = (field: string, domain: string, labels: readonly string[]) => {
    for (const label of labels) {
      const code = domainCode(db, domain, label);
      if (code !== null) {
        out[field] = code;
        return;
      }
    }
  };
  if (r.rank) {
    set('loaiDuong', 'LoaiDuongBo', LOAI_LABELS[r.rank]);
    set('capDuong', 'CapDuongBo', CAP_LABELS[r.rank]);
  }
  if (r.surface) set('loaiChatLieuTraiMat', 'LoaiChatLieuTraiMat', [r.surface]);
  return out;
}

/**
 * Chains of lines that continue one another: two ends meeting alone at a point (a junction of three or more roads
 * does not link them). Returns, per line, the id of its chain.
 */
export function chainIds(ends: { a: Vec2; b: Vec2 }[], tolerance = 1): number[] {
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const key = (p: Vec2) => `${Math.round(p[0] / tolerance)}|${Math.round(p[1] / tolerance)}`;
  const at = new Map<string, number[]>();
  ends.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const k = key(p);
      const arr = at.get(k);
      if (arr) arr.push(i);
      else at.set(k, [i]);
    }
  });
  for (const arr of at.values()) if (arr.length === 2 && arr[0] !== arr[1]) parent[find(arr[0])] = find(arr[1]);
  return ends.map((_, i) => find(i));
}
