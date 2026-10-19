// Colour table of Phụ lục I, Thông tư 16/2025/TT-BXD ("Tên phân lớp – Định dạng – Màu", số = mã ACI of AutoCAD),
// extracted with scripts/extract-tt16-cad.py and checked by hand against the rendered pages (Mục 7 is read from the
// page images: it has symbol names but no layer names). Mục 8 (hạ tầng kỹ thuật) has no colours and is not here.
import raw from './tt16-cad-symbols.json';
import type { GeomKind } from './suggest';

export interface Tt16Symbol {
  /** Mục of Phụ lục I = kind of planning drawing (SECTION_TITLES). */
  section: number;
  page: number;
  /** TT16 layer name ("DAT_DD_Truonghoc"); null in Mục 7, which only names the symbols. */
  layer: string | null;
  /** "Tên ký hiệu" / "Loại chức năng". */
  name: string;
  kind: GeomKind;
  /** AutoCAD colour index. */
  aci: number;
  /** A land use label (suggest.ts LAND_USE_LABELS) — becomes phanLoai. */
  landUse: string | null;
  /** Feature class name ("ChucNangSuDungDat_A") or null for frames / texts. */
  target: string | null;
}

export const TT16_SYMBOLS = raw as Tt16Symbol[];

export const SECTION_TITLES: Record<number, string> = {
  1: 'Ký hiệu chung',
  2: 'QH chung đô thị 1/10.000',
  3: 'QH chung đô thị 1/5.000',
  4: 'QH phân khu',
  5: 'QH chi tiết 1/500',
  6: 'QH khu chức năng',
  7: 'QH nông thôn (xã)',
};

/** Sections whose land-use colours can classify a hatch. */
export const LAND_USE_SECTIONS = [2, 3, 4, 5, 6, 7];

export const symbolsOfSection = (n: number): Tt16Symbol[] => TT16_SYMBOLS.filter((s) => s.section === n);
