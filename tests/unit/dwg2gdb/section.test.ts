import { describe, expect, it } from 'vitest';
import { aciHex } from '@/lib/dwg2gdb/color';
import { pickSection, sectionByVote, sectionFromTitles } from '@/lib/dwg2gdb/section';

describe('sectionFromTitles', () => {
  it('quy hoạch chung xã → Mục 7', () => {
    expect(sectionFromTitles(['BẢN ĐỒ HIỆN TRẠNG SỬ DỤNG ĐẤT', 'QUY HOẠCH CHUNG XÃ LONG HIỆP, TỈNH VĨNH LONG ĐẾN NĂM 2050']).section).toBe(7);
    expect(sectionFromTitles(['QUY HOẠCH CHUNG XÂY DỰNG XÃ MỸ LỘC']).section).toBe(7);
  });
  it('quy hoạch phân khu → Mục 4, quy hoạch chi tiết → Mục 5', () => {
    expect(sectionFromTitles(['QUY HOẠCH PHÂN KHU NINH KIỀU', 'TỶ LỆ 1/2.000']).section).toBe(4);
    expect(sectionFromTitles(['QUY HOẠCH CHI TIẾT KHU DÂN CƯ ABC TỶ LỆ 1/500']).section).toBe(5);
  });
  it('khu chức năng → Mục 6', () => {
    expect(sectionFromTitles(['QUY HOẠCH CHUNG KHU KINH TẾ ĐỊNH AN']).section).toBe(6);
    expect(sectionFromTitles(['QUY HOẠCH CHUNG XÂY DỰNG KHU DU LỊCH QUỐC GIA']).section).toBe(6);
  });
  it('quy hoạch chung đô thị → Mục 2 or 3 by scale', () => {
    expect(sectionFromTitles(['QUY HOẠCH CHUNG THÀNH PHỐ CẦN THƠ', 'TỶ LỆ 1/10.000']).section).toBe(2);
    expect(sectionFromTitles(['QUY HOẠCH CHUNG THỊ XÃ ABC', 'TỶ LỆ 1/5.000', 'TỶ LỆ 1/5.000']).section).toBe(3);
  });
  it('unknown titles give null', () => {
    expect(sectionFromTitles(['SƠ ĐỒ VỊ TRÍ', 'GHI CHÚ']).section).toBeNull();
  });
});

describe('sectionByVote', () => {
  it('picks the section whose colours match the hatches', () => {
    // 15 (trường) + 22 hỗn hợp + 24 THPT exist in Mục 3/4/5 but 24 and 15 not in Mục 2.
    const counts = new Map([[aciHex(24), 10], [aciHex(15), 10], [aciHex(22), 5]]);
    const v = sectionByVote(counts);
    expect([3, 4, 5]).toContain(v.section);
    expect(v.source).toBe('vote');
  });
  it('the more specific section wins a tie', () => {
    // 57 / 3 / 148 exist in Mục 7 and others; Mục 7 has fewer symbols.
    expect(sectionByVote(new Map([[aciHex(3), 4]])).section).toBe(7);
  });
  it('nothing matching gives null', () => {
    expect(sectionByVote(new Map([['#7f007f', 9]])).section).toBeNull();
  });
});

describe('pickSection', () => {
  it('title before vote', () => {
    expect(pickSection(['QUY HOẠCH CHUNG XÃ A'], new Map([[aciHex(24), 10]])).source).toBe('title');
    expect(pickSection(['KHUNG TÊN'], new Map([[aciHex(24), 10]])).source).toBe('vote');
    expect(pickSection(['KHUNG TÊN']).section).toBeNull();
  });
});
