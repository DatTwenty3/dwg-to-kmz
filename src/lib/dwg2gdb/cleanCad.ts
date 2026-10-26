// "Làm sạch, chuẩn hóa bản vẽ theo Thông tư 16": one clean CAD drawing out of a map and its xrefs. What stays is the
// planning content inside the planning area (land-use hatches, roads, bridges, boundaries, names, route signs), each on
// a layer named as Phụ lục I names it where it names one (DAT_NNK_Songsuoi, BV_Rg_lapquyhoach, BV_Ten_Diadanh…) with
// the colour (ACI) of its symbol; everything else is dropped with a reason (the cadastral base, survey signs, frames,
// annotation layers) or kept on a layer of the same family and listed for a look. Pure: documents in, document + report
// out — the geometry of what stays is not touched.
import type { CadDocument, CadEntity, CadLayer, DashStyle, LineTypeDef, Vec2 } from '@/lib/cad/types';
import { normalizeHex } from '@/lib/export/color';
import { foldVietnamese } from '@/lib/geo/provinces';
import { aciHex } from './color';
import type { DrawingInput } from './features';
import { entityRowKey } from './inventory';
import { parseRouteSign } from './roads';
import { CANONICAL_TITLE, findTitle, guessRole, roleById, type DbName, type RoleId } from './roles';
import { compactName, LAND_USE_M1, parseTarget, prettyLayer, tt16LandUse } from './suggest';
import { objectKey } from './summary';
import type { MappingEntry } from './template';
import { symbolsOfSection, type Tt16Symbol } from './tt16Symbols';

export interface CleanDrawing extends DrawingInput {
  role: RoleId;
  db?: DbName | null;
}

/**
 * A decision of the person (or the assistant) who looked at the drawings, applied before every built-in rule:
 * "this layer is a survey remain: drop", "this layer is the 22 kV line: keep as HTKT_CD_Duongday22kV".
 */
export interface CleanOverride {
  /** Name of the drawing (part of the file name, case-insensitive); omitted = every drawing. */
  drawing?: string;
  /** Layer: its exact name (case-insensitive) or a regular expression written "/…/i". */
  layer: string;
  kind?: CadEntity['kind'];
  action: 'drop' | 'keep';
  /** keep: the layer it goes to. */
  to?: string;
  /** keep: hex colour (default: the entity's own). */
  color?: string;
  why?: string;
  /** Flagged ⚠ in the report. */
  look?: boolean;
}

function matchesLayer(spec: string, layer: string): boolean {
  const re = /^\/(.+)\/([a-z]*)$/.exec(spec);
  if (re) return new RegExp(re[1], re[2] || 'i').test(layer);
  return spec.toLowerCase() === layer.toLowerCase() || compactName(spec) === compactName(layer);
}

export interface CleanOptions {
  /**
   * Keep the base the plan is drawn on — the cadastral parcels and the topographic survey inside the area — on layers
   * of their own (NEN_Giaithua, NEN_Diahinh_*), visible and drawn first (under the plan): the base is an important part
   * of a planning drawing. The web app ignores them. Off: they are dropped.
   */
  keepBase?: boolean;
  /** Most base objects kept per map (the survey of a commune can run to millions). Default 250 000. */
  baseLimit?: number;
}

export interface CleanLine {
  /** Source: "<drawing> · <layer>". */
  from: string;
  /** Layer it goes to (null: dropped). */
  to: string | null;
  kept: number;
  dropped: number;
  /** Why (rule applied). */
  why: string;
  /** Worth a look: kept on a guess, or dropped although it might be content. */
  look?: boolean;
}

export interface CleanResult {
  doc: CadDocument;
  lines: CleanLine[];
  /** Entities read (all drawings), kept, left outside the planning area. */
  totals: { read: number; kept: number; outside: number };
}

type Decision = { layer: string; color?: string; dash?: DashStyle; why: string; look?: boolean; hidden?: boolean } | { drop: string; look?: boolean };

const DATASET_PREFIX: [RegExp, string][] = [
  [/CapDien/, 'HTKT_CD'],
  [/CapNuoc/, 'HTKT_CN'],
  [/ThoatNuoc|ChuanBiKyThuat/, 'HTKT_TN'],
  [/ThongTinLienLac/, 'HTKT_TTLL'],
  [/CGDD_CGXD/, 'HTKT_CG'],
  [/KienTrucCanhQuan|ThietkeDoThi/, 'KTCQ'],
  [/GiaoThong/, 'HTKT_GT'],
];
/** Prefix of the infrastructure layers of a thematic map (cấp điện, cấp nước, thoát nước, thông tin liên lạc). */
const ROLE_PREFIX: Partial<Record<RoleId, string>> = { 'qh-dien': 'HTKT_CD', 'qh-nuoc': 'HTKT_CN', 'qh-tn': 'HTKT_TN', 'qh-ttll': 'HTKT_TTLL' };

/** "Đường tỉnh" → "Duongtinh": the way Phụ lục I writes a layer's last word(s). */
export function pascalAscii(s: string): string {
  const w = foldVietnamese(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return w.map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join('');
}

const norm = (s: string) => foldVietnamese(s).replace(/\s+/g, ' ').trim();

/**
 * The symbol of Phụ lục I a land use is drawn with: its colour from the Mục of the drawing, its layer name from the
 * Mục that names one (Mục 7 names none — the nearest Mục with the same land use **and colour** lends it, so "Đất ở" of
 * a commune plan is DAT_KXD_Dancunongthon (57), not the urban one (30)).
 */
export function landUseSymbol(landUse: string, section: number | null): { layer: string; aci: number | null; label: string } {
  const want = norm(landUse);
  const same = (s: Tt16Symbol) => s.kind === 'A' && !!s.landUse && norm(s.landUse) === want;
  let own = section !== null ? symbolsOfSection(section).find(same) : undefined;
  // A land use the Mục does not list (giáo dục in a commune plan) is drawn with its parent's colour (công cộng).
  if (!own && section !== null && LAND_USE_M1[landUse]) {
    const parent = norm(LAND_USE_M1[landUse]);
    own = symbolsOfSection(section).find((s) => s.kind === 'A' && !!s.landUse && norm(s.landUse) === parent);
  }
  let named: Tt16Symbol | undefined = own && same(own) && own.layer ? own : undefined;
  for (const n of [6, 5, 4, 3, 2]) {
    if (named) break;
    const list = symbolsOfSection(n).filter((s) => same(s) && !!s.layer);
    named = own ? list.find((s) => s.aci === own!.aci) ?? (same(own) ? undefined : list[0]) : list[0];
  }
  // No Mục names it: a layer of our own, written the way Phụ lục I writes them (DAT_<NNK|KXD>_<Name>).
  const f = norm(landUse).replace(/^dat /, '');
  const group = /nong nghiep|trong|rung|thuy san|nuoi|muoi|chua su dung|mat nuoc|song|ho |ao /.test(f) ? 'NNK' : 'KXD';
  const word = pascalAscii(f);
  return { layer: named?.layer ?? `DAT_${group}_${word.charAt(0).toUpperCase()}${word.slice(1, 27)}`, aci: own?.aci ?? named?.aci ?? null, label: own?.name ?? named?.name ?? landUse };
}

function entityBox(e: CadEntity): [number, number, number, number] | null {
  const pts: Vec2[] = e.kind === 'polyline' ? e.points : e.kind === 'polygon' ? e.rings.flat() : e.kind === 'table' ? [e.origin] : [e.position];
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Layers that are not the plan: the cadastral base, survey remains, plotting leftovers.
const JUNK_LAYER = /giaithua|ghepmanh|^audit|^ks|spm_?map|defpoints|viewport|^layer\d*$|^(0|1|2|3)$|^kyhieu$|^plin|^pline/;
// Facility pictograms the planning office drew on purpose (schools, markets…): content, kept apart.
/** Survey layer of the bridges and culverts ("KS_CAU-CONG"): the only trace of them, so no junk. */
const SURVEY_BRIDGE = /^kscau/;
const PICTOGRAM_LAYER = /kyhieucaccongtrinhchucnang|^02kyhieu|^00gtkihieu|^kyhieucongtrinh/;
const ROADISH_LAYER = /htktgt|giaothong|duongtinh|quoclo|timduong|duongkhuvuc|heduong/;
/** A route number ("914B") written big enough to be a sign on the map, not a parcel or a survey number. */
const SIGN_MIN_HEIGHT = 20;
/**
 * The number of a route (911, 914C, 915) standing at the end of a road: on a road layer, on a layer called "TEXT", or on any
 * layer (Lưu Nghiệp Anh draws its signs on layer "0", which is otherwise junk) when the text is as big as a sign.
 */
const isRouteSign = (e: CadEntity, c: string): boolean =>
  e.kind === 'text' && !!parseRouteSign(e.text, null) && !/giaithua/.test(c) && (ROADISH_LAYER.test(c) || /text/.test(c) || e.height >= SIGN_MIN_HEIGHT);
const ADMIN_NAME = /^(xa|x\.|phuong|p\.|thi tran|ap|khom|thon|ban|to dan pho|khu pho)\s/;
const ROAD_NAME = /^(duong|tuyen so|dt\.|ql\.)\s?/;

/** "22 kV", "EE-22", "Dien cao the 110KV" → "22" / "110" ('' when the name says no voltage). */
function voltage(raw: string): string {
  const f = foldVietnamese(raw).toLowerCase().replace(/[_\-\s]+/g, ' ');
  return /(\d{1,3}(?:[.,]\d)?) ?kv/.exec(f)?.[1]?.replace(',', '.') ?? /^e{1,2} ?(\d{2,3})(?!\d)/.exec(f)?.[1] ?? '';
}

/**
 * Layer of an infrastructure object, one convention for all themes: <HTKT_CD|CN|TN|TTLL>_<Duongday22kV | Ongcapnuoc |
 * Tuyen_Nuocmua | Hoga_Nuocthai | Tuyencap | Trambienap | Congtrinh>. Phụ lục I gives no layer names to infrastructure.
 */
function infraLayer(prefix: string, cls: string, phanLoai: string, raw: string): string {
  const point = /_[PA]$/.test(cls);
  const f = norm(`${phanLoai} ${raw}`);
  switch (prefix) {
    case 'HTKT_CD': {
      if (point) return /tram|bien ap/.test(f) ? 'HTKT_CD_Trambienap' : 'HTKT_CD_Congtrinh';
      const kv = voltage(raw) || voltage(phanLoai);
      return `HTKT_CD_Duongday${kv ? `${kv}kV` : ''}`;
    }
    case 'HTKT_CN':
      return point ? 'HTKT_CN_Congtrinh' : 'HTKT_CN_Ongcapnuoc';
    case 'HTKT_TN': {
      const water = /thai|TNT|VSMT/.test(cls) || /nuoc thai|(?:^| )thai(?: |$)/.test(f) ? 'Nuocthai' : 'Nuocmua';
      return point ? (/(?:^| )ga(?: |$)|hoga|ho ga/.test(f) ? `HTKT_TN_Hoga_${water}` : `HTKT_TN_Congtrinh_${water}`) : `HTKT_TN_Tuyen_${water}`;
    }
    case 'HTKT_TTLL':
      return point ? 'HTKT_TTLL_Congtrinh' : 'HTKT_TTLL_Tuyencap';
    default:
      return `${prefix}_${pascalAscii(phanLoai || prettyLayer(raw)) || 'Khac'}`;
  }
}

// Remains of a topographic survey (earth banks, spot points, vegetation, symbol blocks) and plotting leftovers.
const SURVEY_LAYER = /^(bodat|diem|thucvat|blockkihieu|khddc|bonhoa|moc|line\d*|\d*lssannodims?)$|anno|dims?$/;
/** Footprints of buildings: a layer of many small hatched polygons (median area ≤ 400 m²). */
const BUILDING_MEDIAN_M2 = 400;

const fmtLimit = (n: number) => n.toLocaleString('vi-VN');
const ringArea = (r: Vec2[]) => Math.abs(r.reduce((t, q, k) => t + (q[0] * r[(k + 1) % r.length][1] - r[(k + 1) % r.length][0] * q[1]), 0)) / 2;

function roadLayer(cls: string, phanLoai: string, layer: string): string {
  if (cls === 'ChiGioiDuongDo_L') return 'HTKT_GT_Heduong';
  if (cls === 'CongTrinhGiaoThong_L' || cls === 'CongTrinhGiaoThong_A' || cls === 'CongTrinhGiaoThong_P') {
    // The material of the bridge ("Cầu bê tông") stays in the layer name, so the phanLoai can be read back.
    const rest = norm(phanLoai).replace(/^(ks\s*)?cau\s*/, '').trim();
    return rest && rest.length <= 20 ? `HTKT_GT_Cau_${pascalAscii(rest)}` : 'HTKT_GT_Cau';
  }
  const f = norm(phanLoai || prettyLayer(layer));
  if (/tinh/.test(f)) return 'HTKT_GT_Duongtinh';
  if (/quoc lo/.test(f)) return 'HTKT_GT_Quoclo';
  if (/khu vuc/.test(f)) return 'HTKT_GT_Duongkhuvuc';
  if (/tim duong/.test(f)) return 'HTKT_GT_Timduong';
  if (/quy hoach/.test(f)) return 'HTKT_GT_Quyhoach';
  return `HTKT_GT_${pascalAscii(phanLoai || prettyLayer(layer)) || 'Duong'}`;
}

export function cleanDocument(drawings: CleanDrawing[], mapping: Map<string, MappingEntry & { reason?: string; unknown?: boolean; review?: boolean }>, boundary: Vec2[] | null, overrides: readonly CleanOverride[] = [], options: CleanOptions = {}): CleanResult {
  let around: [number, number, number, number] | null = null;
  if (boundary?.length) {
    const b = entityBox({ kind: 'polyline', layer: '', color: '', points: boundary, closed: true })!;
    const m = 0.1 * Math.max(b[2] - b[0], b[3] - b[1]);
    around = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  }
  const layers = new Map<string, CadLayer>();
  const entities: CadEntity[] = [];
  const seen = new Set<string>();
  const lineTypes: Record<string, LineTypeDef> = {};
  const lines = new Map<string, CleanLine>();
  const totals = { read: 0, kept: 0, outside: 0 };
  const baseLimit = options.baseLimit ?? 250_000;
  let baseKept = 0;

  const note = (d: CleanDrawing, e: CadEntity, to: string | null, why: string, kept: boolean, look?: boolean) => {
    const k = `${d.name}\u0001${e.layer}\u0001${to ?? ''}\u0001${why}`;
    let l = lines.get(k);
    if (!l) lines.set(k, (l = { from: `${d.name.replace(/\.dwg$/i, '')} · ${e.layer}`, to, kept: 0, dropped: 0, why, look }));
    if (kept) l.kept++;
    else l.dropped++;
  };

  for (const d of drawings) {
    const db = roleById(d.role).db && (d.db ?? roleById(d.role).db);
    if (!db) continue;
    for (const [name, def] of Object.entries(d.doc.lineTypes ?? {})) lineTypes[name] ??= def;
    const section = d.color?.section ?? null;
    const rolePrefix = ROLE_PREFIX[d.role];
    // Layers of building footprints: ≥ 30 small polygons inside the area, median area ≤ 400 m².
    const areas = new Map<string, number[]>();
    d.doc.entities.forEach((e, i) => {
      if (e.kind === 'polygon' && d.inside[i] && e.rings[0]?.length > 2) (areas.get(e.layer) ?? areas.set(e.layer, []).get(e.layer)!).push(ringArea(e.rings[0]));
    });
    const buildings = new Set<string>();
    for (const [layer, list] of areas) {
      list.sort((x, y) => x - y);
      if (list.length >= 30 && list[Math.floor(list.length / 2)] <= BUILDING_MEDIAN_M2) buildings.add(layer);
    }

    const decide = (e: CadEntity, i: number, inside: boolean): Decision => {
      const c = compactName(e.layer);
      if (e.kind === 'table') return { drop: 'bảng — không có trong Phụ lục I' };
      if (e.kind === 'polyline' && (e.points.length < 2 || new Set(e.points.map((q) => `${q[0].toFixed(3)},${q[1].toFixed(3)}`)).size < 2)) return { drop: 'nét suy biến (một điểm)' };
      if (e.kind === 'polygon' && !(e.rings[0] && e.rings[0].length > 2 && ringArea(e.rings[0]) > 0.05)) return { drop: 'vùng suy biến (diện tích ≈ 0)' };
      const ov = overrides.find((o) => (!o.drawing || d.name.toLowerCase().includes(o.drawing.toLowerCase())) && (!o.kind || o.kind === e.kind) && matchesLayer(o.layer, e.layer));
      if (ov) {
        if (ov.action === 'drop') return { drop: ov.why ?? 'bỏ theo quyết định', look: ov.look };
        if (ov.to) return { layer: ov.to, color: ov.color, why: ov.why ?? 'theo quyết định', look: ov.look };
      }
      if (options.keepBase && /giaithua/.test(c)) return { layer: e.kind === 'text' ? 'NEN_Giaithua_Chu' : 'NEN_Giaithua', color: aciHex(8), why: 'nền giải thửa (địa chính) — giữ làm nền (hiện sẵn, nằm dưới cùng)' };
      if (isRouteSign(e, c)) return { layer: 'HTKT_GT_Kyhieutuyen', why: 'biển số tuyến' };
      if (JUNK_LAYER.test(c) && !PICTOGRAM_LAYER.test(c) && !SURVEY_BRIDGE.test(c)) return { drop: /giaithua/.test(c) ? 'nền giải thửa (địa chính), không thuộc đồ án' : 'layer rác (ký hiệu khảo sát, layer 0/Defpoints, nét thừa)' };
      const key = entityRowKey(d.id, e, d.color);
      const m = key ? mapping.get(key) : undefined;
      const t = m?.target ? parseTarget(m.target) : null;

      if (e.kind === 'text') {
        const f = norm(e.text);
        if (/^\d{1,4}([.,]\d+)?$/.test(f) && /giaithua/.test(c)) return { drop: 'số thửa' };
        if (/ten ?kenh|kenh_?rach|rach_?song/.test(foldVietnamese(e.layer))) return { layer: 'BV_Chu_Tenkenh', why: 'tên kênh, rạch' };
        if (ADMIN_NAME.test(f) || /^bv_?ten_?diadanh/i.test(e.layer)) return { layer: 'BV_Ten_Diadanh', why: 'tên đơn vị hành chính / địa danh (Phụ lục I)' };
        if (ROAD_NAME.test(f) || /tenduong/.test(c)) return { layer: 'HTKT_GT_Tenduong', why: 'tên đường' };
        if (rolePrefix) return { layer: `${rolePrefix}_Ghichu`, why: 'ghi chú hạ tầng (đường kính, chiều dài, tên công trình…)' };
        return { layer: 'BV_Chu_Chucnang', why: 'chữ ghi chú chức năng / diện tích' };
      }
      if (!inside) return { drop: 'ngoài ranh' };
      // The line type names what the line is: a line drawn with "Ranh giới lập quy hoạch" is the planning boundary, whatever
      // its layer is called (Đôn Châu: layer "Ranh giới huyện") — it must not become a second, administrative boundary.
      if (e.kind === 'polyline' && e.closed && /lapquyhoach/.test(compactName(e.lineType ?? ''))) return { layer: 'BV_Rg_lapquyhoach', color: aciHex(1), dash: 'dotted', why: 'ranh lập quy hoạch (theo kiểu nét "Ranh giới lập quy hoạch")' };

      if (t) {
        const cls = t.cls;
        if (cls === 'ChucNangSuDungDat_A') {
          if (e.kind === 'polygon') {
            // Colour and layer name disagree (flagged "cần xem"): a layer that is itself a Phụ lục I name keeps its meaning.
            const named = m!.review ? tt16LandUse(c) : null;
            if (named) {
              const sym = landUseSymbol(named, section);
              return { layer: sym.layer, color: sym.aci !== null ? aciHex(sym.aci) : undefined, why: `vùng ${sym.label} theo tên layer (màu ${m!.phanLoai} không khớp)`, look: true };
            }
            const sym = landUseSymbol(m!.phanLoai, section);
            return { layer: sym.layer, color: sym.aci !== null ? aciHex(sym.aci) : undefined, why: `vùng ${sym.label}${sym.aci !== null ? ` — màu ${sym.aci}` : ''}` };
          }
          // A wide line on a land-use layer is a road (Đôn Châu: 20 m); a thin one (3 m) is only the outline of the parcel.
          // A wide dotted "Hidden" line (Long Hiệp: 15 m, QHDD_DAT_XD_Chucnangkhac) is the outline of a land-use area drawn heavy: not a road either.
          if (e.kind === 'polyline' && (e.width ?? 0) >= 8 && !/hidden/i.test(e.lineType ?? '')) return { layer: roadLayer('', '', e.layer), why: 'nét rộng ≥ 8 m — là đường, không phải thửa' };
          return { layer: 'BV_Vienthua', why: 'viền thửa/lô (vùng đã có hatch)' };
        }
        if (/^RanhGioiQuyHoach/.test(cls)) return { layer: 'BV_Rg_lapquyhoach', color: aciHex(1), dash: 'dotted', why: 'ranh lập quy hoạch (Phụ lục I)' };
        if (/^RanhGioiHanhChinh/.test(cls)) return { layer: 'BV_Rg_capcoso', color: aciHex(14), why: 'ranh hành chính → ranh cấp cơ sở (Phụ lục I)', look: true };
        if (cls === 'TenDonViHanhChinh_P') return { layer: 'BV_Ten_Diadanh', why: 'tên đơn vị hành chính (Phụ lục I)' };
        if (cls === 'ChiGioiDuongDo_L') return { layer: 'HTKT_GT_Heduong', why: 'hè đường / chỉ giới đường đỏ' };
        const prefix = DATASET_PREFIX.find(([re]) => re.test(t.dataset))?.[1];
        if (prefix === 'HTKT_GT') {
          // The line type of the object (dashes, dots, "110kV" in the gaps) goes with it: the entity keeps lineType / lineScale.
          return { layer: roadLayer(cls, m!.phanLoai, e.layer), why: 'đường giao thông' };
        }
        return { layer: infraLayer(prefix ?? pascalAscii(t.dataset), cls, m!.phanLoai, e.layer), why: `hạ tầng: ${t.cls}` };
      }

      const kv = e.kind === 'polyline' && /dien|^ee?-?\d/.test(c) ? voltage(e.layer) : '';
      if (kv) return { layer: `HTKT_CD_Duongday${kv}kV`, why: `đường dây điện ${kv} kV` };
      if (SURVEY_LAYER.test(c) && (m?.unknown || !t) && options.keepBase && !/anno|dims?$|^audit/.test(c))
        return { layer: `NEN_Diahinh_${pascalAscii(e.layer).slice(0, 30) || 'Khac'}`, why: 'nền đo đạc địa hình (bờ đất, điểm, thực vật…) — giữ làm nền (hiện sẵn, nằm dưới cùng)' };
      if (SURVEY_LAYER.test(c) && (m?.unknown || !t)) return { drop: 'chi tiết đo đạc / khảo sát địa hình (bờ đất, điểm, thực vật…) hoặc nét thừa — không thuộc nội dung quy hoạch' };
      if (/trucchay/.test(c) && rolePrefix === 'HTKT_CN') return { layer: 'HTKT_CN_Trucuuhoa', why: 'trụ cứu hỏa (ký hiệu nhỏ màu đỏ dọc tuyến ống)' };
      if (e.kind === 'polyline' && /quoclo/.test(c)) return { layer: 'HTKT_GT_Quoclo', why: 'quốc lộ' };
      if (e.kind === 'polyline' && /logioi|chigioi/.test(c)) return { layer: 'HTKT_GT_Logioi', why: 'lộ giới / chỉ giới đường' };
      if (/^bvrgcapxa|^bvrgcap/.test(c) && e.kind === 'polyline') return { layer: 'BV_Rg_capcoso', color: aciHex(14), why: 'ranh xã (Phụ lục I)' };
      if (e.kind === 'polyline' && /^tenkenh/.test(c)) return { layer: 'BV_Kenh_Rach', why: 'tuyến kênh, rạch', look: true };
      if (e.kind === 'polyline' && /Đường viền thửa/.test(m?.reason ?? '')) return { layer: 'BV_Vienthua', why: 'viền thửa/lô (vùng đã có hatch)' };
      if (PICTOGRAM_LAYER.test(c)) return { layer: 'KYHIEU_Congtrinh', why: 'ký hiệu công trình chức năng', look: true };
      if (m?.unknown) {
        if (ROADISH_LAYER.test(c)) return { layer: roadLayer('', '', e.layer), why: 'ký hiệu / nét trên layer đường', look: true };
        if (e.kind === 'polygon' && buildings.has(e.layer)) return { layer: 'KTCQ_Nha_Congtrinh', why: `mặt bằng nhà, công trình (nhiều vùng nhỏ, diện tích trung vị ≤ ${BUILDING_MEDIAN_M2} m²)`, look: true };
        if (rolePrefix) return { layer: infraLayer(rolePrefix, e.kind === 'polyline' ? 'X_L' : 'X_P', '', e.layer), why: `hạ tầng theo loại bản đồ (${roleById(d.role).label})`, look: true };
        return { layer: `XEM_${pascalAscii(e.layer).slice(0, 40)}`, why: 'chưa nhận ra — giữ để xem', look: true };
      }
      return { drop: (m?.reason ?? 'không thuộc dữ liệu quy hoạch').slice(0, 90) };
    };

    d.doc.entities.forEach((e, i) => {
      totals.read++;
      let inside = !!d.inside[i];
      if (!inside && e.kind !== 'text') {
        // Signs at the ends of the roads stand just outside the boundary: kept when they sit on a road layer.
        const box = around ? entityBox(e) : null;
        const c = compactName(e.layer);
        const near = !!box && !!around && box[0] >= around[0] && box[1] >= around[1] && box[2] <= around[2] && box[3] <= around[3];
        if (near && (ROADISH_LAYER.test(c) || (/^text$/.test(c) && e.kind === 'polyline' && (e.width ?? 0) >= 5))) inside = true;
        else {
          totals.outside++;
          return;
        }
      }
      if (!inside && e.kind === 'text') {
        const sign = isRouteSign(e, compactName(e.layer));
        const b = entityBox(e);
        if (!(sign && b && around && b[0] >= around[0] && b[1] >= around[1] && b[2] <= around[2] && b[3] <= around[3])) {
          totals.outside++;
          return;
        }
        inside = true;
      }
      const dec = decide(e, i, inside);
      if ('drop' in dec) {
        note(d, e, null, dec.drop, false, dec.look);
        return;
      }
      if (dec.layer.startsWith('NEN_') && ++baseKept > baseLimit) {
        note(d, e, null, `nền vượt giới hạn ${fmtLimit(baseLimit)} đối tượng — để ở bản gốc`, false, true);
        return;
      }
      const out: CadEntity = { ...e, layer: dec.layer, ...(dec.color ? { color: dec.color } : {}) };
      const k = objectKey(dec.layer, out);
      if (seen.has(k)) {
        note(d, e, dec.layer, 'trùng với đối tượng đã có', false);
        return;
      }
      seen.add(k);
      if (!layers.has(dec.layer)) layers.set(dec.layer, { name: dec.layer, color: normalizeHex(dec.color ?? e.color), visible: !dec.hidden, ...(dec.dash ? { style: { dash: dec.dash } } : {}) });
      entities.push(out);
      totals.kept++;
      note(d, e, dec.layer, dec.why, true, dec.look);
    });
  }
  // A boundary drawn as an open line whose ends nearly meet (gap < 2 % of its length — a drafting slip) is closed, so it
  // reads as the planning area (Phụ lục I: RanhGioiQuyHoach_A). Width and line type stay exactly as drawn.
  entities.forEach((e, i) => {
    if (e.layer !== 'BV_Rg_lapquyhoach' || e.kind !== 'polyline' || e.closed || e.points.length < 10) return;
    let len = 0;
    for (let k = 1; k < e.points.length; k++) len += Math.hypot(e.points[k][0] - e.points[k - 1][0], e.points[k][1] - e.points[k - 1][1]);
    const f = e.points[0];
    const l = e.points[e.points.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.02 * len) entities[i] = { ...e, closed: true };
  });
  if (boundary && ![...layers.keys()].includes('BV_Rg_lapquyhoach')) {
    layers.set('BV_Rg_lapquyhoach', { name: 'BV_Rg_lapquyhoach', color: aciHex(1), visible: true, style: { dash: 'dotted' } });
    const ranh = 'QH_Ranh giới lập quy hoạch';
    // Same look as the office's own boundary line (width, pattern scale): taken from the longest line of that type in the
    // drawings — maps without a boundary of their own only carry the legend sample (2 points, other scale), so those fall back to 50.
    let sample: { width?: number; lineScale?: number; n: number } | undefined;
    for (const d of drawings)
      for (const e of d.doc.entities)
        if (e.kind === 'polyline' && e.lineType === ranh && (!sample || e.points.length > sample.n)) sample = { width: e.width, lineScale: e.lineScale, n: e.points.length };
    const ranhScale = sample && sample.n >= 10 && sample.lineScale ? sample.lineScale : 50;
    entities.push({ kind: 'polyline', layer: 'BV_Rg_lapquyhoach', color: aciHex(1), points: boundary, closed: true, ...(sample?.width ? { width: sample.width } : {}), ...(lineTypes[ranh] ? { lineType: ranh, lineScale: ranhScale } : {}) });
  }
  // The base is drawn first: AutoCAD draws the entities in file order, so the plan lies on top of it.
  entities.sort((x, y) => Number(y.layer.startsWith('NEN_')) - Number(x.layer.startsWith('NEN_')));
  const box = entities.map(entityBox).filter((b): b is [number, number, number, number] => !!b);
  const bbox: [Vec2, Vec2] = box.length ? [[Math.min(...box.map((b) => b[0])), Math.min(...box.map((b) => b[1]))], [Math.max(...box.map((b) => b[2])), Math.max(...box.map((b) => b[3]))]] : [[0, 0], [0, 0]];
  return {
    doc: { units: 'm', crs: null, layers: [...layers.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')), entities, bbox, warnings: [], lineTypes },
    lines: [...lines.values()],
    totals,
  };
}

/**
 * The title block of a cleaned drawing, so the web app recognises it again: the kind of map ("BẢN ĐỒ QUY HOẠCH CẤP
 * ĐIỆN" — the original wording when it reads back as `role`, else the standard one) and the title of the plan
 * ("QUY HOẠCH CHUNG XÃ …": it tells the Mục of Phụ lục I and the commune), written above the area on layer
 * BV_Ten_Banve (kept in the clean drawing, not dropped as "frame text").
 */
export function addTitleBlock(doc: CadDocument, role: RoleId, originalTexts: readonly string[]): string[] {
  const lines: string[] = [];
  const own = findTitle([...originalTexts]);
  lines.push(own && guessRole('', [own]).role === role ? own.replace(/\s+/g, ' ').trim() : (CANONICAL_TITLE[role] ?? own ?? ''));
  const plan = originalTexts
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length <= 200 && /^(quy hoach|do an) (chung|phan khu|chi tiet|xay dung)/.test(foldVietnamese(t)));
  for (const t of plan.sort((x, y) => y.length - x.length).slice(0, 1)) lines.push(t);
  const text = lines.filter(Boolean);
  if (!text.length) return [];
  const [[x0, y0], [x1, y1]] = doc.bbox;
  const width = Math.max(1, x1 - x0);
  const height = width / 160;
  if (!doc.layers.some((l) => l.name === 'BV_Ten_Banve')) doc.layers.push({ name: 'BV_Ten_Banve', color: aciHex(7), visible: true });
  text.forEach((t, k) => {
    doc.entities.push({ kind: 'text', layer: 'BV_Ten_Banve', color: aciHex(7), text: t, position: [x0, y1 + height * 2.2 * (text.length - k)], height, rotation: 0, hAlign: 'left', vAlign: 'baseline' });
  });
  doc.bbox = [[x0, y0], [x1, y1 + height * 2.2 * (text.length + 1)]];
  return text;
}
