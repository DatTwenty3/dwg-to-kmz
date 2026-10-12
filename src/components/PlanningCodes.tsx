'use client';
// The two codes every Thông tư 16 feature carries (maHoSoQH, maThongTinQH), entered once — or "số mẫu" valid for
// the province, to try things out. Shared by "Chuẩn hóa TT16" and "Bóc tách DWG → TT16".
import { useState } from 'react';
import { describeMaThongTin, parseMaHoSo, parseMaThongTin, PROVINCE_CODES, sampleCodes } from '@/lib/gdb/tt16';
import { IconAlert } from './icons';

/**
 * Starts a download of an object URL. The anchor is attached to the page (Firefox ignores detached ones) and the
 * URL is NOT revoked here: a large zip is read by the browser after the click, and revoking early makes the
 * download fail ("Lỗi mạng"). The caller revokes it when its dialog closes.
 */
export function startDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface PlanningCodes {
  maHoSo: string;
  maTT: string;
  useSample: boolean;
  setMaHoSo: (v: string) => void;
  setMaTT: (v: string) => void;
  chooseSample: (on: boolean) => void;
  /** Both codes valid. */
  valid: boolean;
  sampleProvince: string;
}

/** `own` = valid codes already known (from the data), `sampleProvince` = 2-digit province code for samples. */
export function usePlanningCodes(own: { maHoSoQH: string; maThongTinQH: string }, sampleProvince: string): PlanningCodes {
  const [useSample, setUseSample] = useState(false);
  const [maHoSo, setMaHoSo] = useState(own.maHoSoQH);
  const [maTT, setMaTT] = useState(own.maThongTinQH);
  const chooseSample = (on: boolean) => {
    setUseSample(on);
    const v = on ? sampleCodes(sampleProvince) : own;
    setMaHoSo(v.maHoSoQH);
    setMaTT(v.maThongTinQH);
  };
  return { maHoSo, maTT, useSample, setMaHoSo, setMaTT, chooseSample, valid: !!parseMaHoSo(maHoSo) && !!parseMaThongTin(maTT), sampleProvince };
}

export default function PlanningCodeFields({ codes, provinceCode, disabled }: { codes: PlanningCodes; provinceCode: string | null; disabled: boolean }) {
  const { maHoSo, maTT, useSample, setMaHoSo, setMaTT, chooseSample, sampleProvince } = codes;
  const pHoSo = parseMaHoSo(maHoSo);
  const pTT = parseMaThongTin(maTT);
  const mismatch = pHoSo && pTT && pHoSo.province !== pTT.province;
  const otherProvince = pHoSo && provinceCode && pHoSo.province !== provinceCode;
  return (
    <>
      <div>
        <span className="ui-label">Mã hồ sơ và mã thông tin quy hoạch</span>
        <div className="ui-segment mt-1" role="group" aria-label="Nguồn mã">
          <button aria-pressed={!useSample} onClick={() => chooseSample(false)} disabled={disabled}>
            Nhập mã của đồ án
          </button>
          <button aria-pressed={useSample} onClick={() => chooseSample(true)} disabled={disabled}>
            Dùng số mẫu
          </button>
        </div>
        {useSample && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <IconAlert width={14} height={14} className="mt-0.5 shrink-0" />
            Số mẫu đúng định dạng theo tỉnh {PROVINCE_CODES[sampleProvince] ?? sampleProvince} — dùng để thử. Khi nộp chính thức hãy làm lại với mã do Sở
            Xây dựng cấp và mã trên quyết định phê duyệt.
          </p>
        )}
      </div>
      <label className="block">
        <span className="ui-label">Mã hồ sơ quy hoạch (maHoSoQH)</span>
        <input
          className="ui-input mt-1 w-full font-mono"
          value={maHoSo}
          onChange={(e) => setMaHoSo(e.target.value.toUpperCase())}
          placeholder="vd. 86QHC1000001"
          disabled={disabled || useSample}
          maxLength={15}
        />
        <span className={`mt-1 block text-[12px] ${maHoSo && !pHoSo ? 'text-red-600' : 'text-zinc-400'}`}>
          {pHoSo
            ? `${pHoSo.provinceName ?? `mã tỉnh ${pHoSo.province} (không thuộc 34 tỉnh/thành)`} · ${pHoSo.kind} · STT ${pHoSo.seq}`
            : '<Mã tỉnh 2 số><QHC|QPK|QCT><x><xx><xxxx> — do Sở Xây dựng cấp khi phê duyệt nhiệm vụ quy hoạch'}
        </span>
      </label>
      <label className="block">
        <span className="ui-label">Mã thông tin quy hoạch (maThongTinQH)</span>
        <input
          className="ui-input mt-1 w-full font-mono"
          value={maTT}
          onChange={(e) => setMaTT(e.target.value.replace(/\D/g, ''))}
          placeholder="vd. 862511000001"
          disabled={disabled || useSample}
          maxLength={12}
          inputMode="numeric"
        />
        <span className={`mt-1 block text-[12px] ${maTT && !pTT ? 'text-red-600' : 'text-zinc-400'}`}>
          {pTT ? describeMaThongTin(pTT) : '12 chữ số, ghi trên quyết định phê duyệt quy hoạch (NĐ 111/2024, TT 24/2025/TT-BXD)'}
        </span>
      </label>
      {(mismatch || otherProvince) && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <IconAlert width={14} height={14} className="mt-0.5 shrink-0" />
          {mismatch
            ? `Mã tỉnh trong hai mã khác nhau (${pHoSo!.province} và ${pTT!.province}).`
            : `Mã hồ sơ thuộc ${PROVINCE_CODES[pHoSo!.province] ?? pHoSo!.province}, khác tỉnh đã chọn (${PROVINCE_CODES[provinceCode!] ?? provinceCode}).`}
        </p>
      )}
    </>
  );
}
