'use client';
// "Chuẩn hóa TT16": asks for the two planning codes, runs src/workers/gdbNormalize.worker.ts (GDAL in the browser)
// and hands back HoSoGIS_chuanhoa_TT16_<ngày>.zip — the geodatabases rebuilt to Thông tư 16, geometries untouched —
// together with the check of the result.
import { useEffect, useRef, useState } from 'react';
import BrandLoader from './BrandLoader';
import type { SubmissionReport } from '@/lib/gdb/check';
import { parseMaHoSo, parseMaThongTin } from '@/lib/gdb/tt16';
import type { NormalizeRequest, NormalizeResponse } from '@/workers/gdbNormalize.worker';
import { IconAlert, IconCheckCircle, IconDownload, IconSpinner, IconX, IconXCircle } from './icons';
import PlanningCodeFields, { startDownload, usePlanningCodes } from './PlanningCodes';

type Picked = { path: string; file: File };

const firstValid = (values: [string, number][], parse: (v: string) => unknown) => values.map(([v]) => v).find((v) => parse(v)) ?? '';

/** Main databases "Chuẩn hóa" creates (empty) when they were not uploaded; NenDiaHinh follows the Bộ Xây dựng template. */
const CREATABLE = new Set(['HienTrang', 'QuyHoach', 'MocGioi', 'NenDiaHinh']);

export default function GdbNormalizeDialog({
  rep,
  files,
  provinceCode,
  onClose,
  onOpenResult,
}: {
  rep: SubmissionReport;
  /** The files picked for the check (folders / zips) — normalised again from the original bytes. */
  files: Picked[];
  provinceCode: string | null;
  onClose: () => void;
  /** Load the normalised zip into the checker (re-check + map). */
  onOpenResult: (file: File) => void;
}) {
  const own = { maHoSoQH: firstValid(rep.maHoSo, parseMaHoSo), maThongTinQH: firstValid(rep.maThongTin, parseMaThongTin) };
  // Province of the samples: the chosen one, else the one of a valid code in the data, else Vĩnh Long (86).
  const sampleProvince = provinceCode ?? (parseMaHoSo(own.maHoSoQH)?.province || parseMaThongTin(own.maThongTinQH)?.province || '86');
  const codes = usePlanningCodes(own, sampleProvince);
  const { maHoSo, maTT } = codes;
  // Only offered when a main database is really missing from the upload.
  const missing = rep.missingDatabases.filter((m) => CREATABLE.has(m.name));
  const [createMissing, setCreateMissing] = useState(true);
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [result, setResult] = useState<Extract<NormalizeResponse, { type: 'done' }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);
  /** Object URL of the result zip, kept until the dialog closes (see startDownload). */
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (zipUrl) URL.revokeObjectURL(zipUrl);
  }, [zipUrl]);

  const pHoSo = parseMaHoSo(maHoSo);
  const running = !!progress && !result && !error;

  const start = () => {
    if (!pHoSo || !codes.valid) return;
    setError(null);
    setResult(null);
    setProgress({ stage: 'Bắt đầu', done: 0, total: 1 });
    // One worker per dialog: GDAL stays loaded for another run from the same dialog.
    const w = (workerRef.current ??= new Worker(new URL('../workers/gdbNormalize.worker.ts', import.meta.url), { type: 'module' }));
    w.onmessage = (ev: MessageEvent<NormalizeResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') setProgress(m);
      else if (m.type === 'error') setError(m.message);
      else {
        setResult(m);
        const url = URL.createObjectURL(m.zip);
        setZipUrl(url);
        // Automatic download; if the browser blocks it (no user gesture), the "Tải HoSoGIS.zip" link below works.
        startDownload(url, m.fileName);
      }
    };
    w.onerror = () => setError('Trình duyệt dừng việc chuẩn hóa (thiếu bộ nhớ?). Hãy thử lại với ít geodatabase hơn.');
    w.postMessage({
      files,
      options: { maHoSoQH: maHoSo.trim(), maThongTinQH: maTT.trim(), createMissingDatabases: missing.length > 0 && createMissing },
      databases: Object.fromEntries(rep.gdbs.map((g) => [g.dir, g.database])),
      provinceCode: provinceCode ?? pHoSo.province,
    } satisfies NormalizeRequest);
  };

  const after = result?.report;
  const afterErrors = after ? after.gdbs.reduce((t, g) => t + g.counts.errors, after.issues.filter((i) => i.level === 'error').length) : 0;
  const afterWarns = after ? after.gdbs.reduce((t, g) => t + g.counts.warnings, 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4 backdrop-blur-[2px]" role="dialog" aria-modal aria-label="Chuẩn hóa TT16">
      <div className="ui-floating ui-pop-in flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden">
        <div className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="flex-1">
            <h2 className="text-[16px] font-semibold text-zinc-900">Chuẩn hóa theo Thông tư 16</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">
              Sửa {rep.gdbs.map((g) => g.fileName).join(', ')} cho đúng Thông tư 16/2025/TT-BXD và tải về <b className="font-medium text-zinc-700">HoSoGIS.zip</b>. Các nét,
              vùng, điểm giữ nguyên; file gốc không bị thay đổi.
            </p>
          </div>
          {!running && (
            <button aria-label="Đóng" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900" onClick={onClose}>
              <IconX width={16} height={16} />
            </button>
          )}
        </div>

        <div className="ui-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px]">
          {!result && (
            <div className="space-y-4">
              <PlanningCodeFields codes={codes} provinceCode={provinceCode} disabled={running} />
              {missing.length > 0 && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="ui-check mt-0.5" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} disabled={running} />
                  <span className="text-zinc-700">
                    Tạo thêm {missing.map((m) => `${m.name}.gdb`).join(', ')} còn thiếu{' '}
                    <span className="text-zinc-400">
                      (chỉ có cấu trúc, chưa có dữ liệu{missing.some((m) => m.name === 'NenDiaHinh') ? '; NenDiaHinh theo mẫu của Bộ Xây dựng' : ''})
                    </span>
                  </span>
                </label>
              )}
              <ul className="space-y-1 rounded-lg bg-zinc-50 px-3 py-2.5 text-[12.5px] text-zinc-600">
                <li>• Dựng theo mẫu cấu trúc dữ liệu của Bộ Xây dựng: đủ nhóm, lớp (lớp chưa có dữ liệu để rỗng), tên hiển thị và danh mục giá trị.</li>
                <li>• Mỗi lớp đúng các trường của mẫu (6 trường quy định + trường riêng của lớp), giữ giá trị trùng tên; xóa các trường dư.</li>
                <li>• Gán hai mã trên cho mọi đối tượng, tính lại maDoiTuong = mã hồ sơ-tên lớp-OBJECTID; điền trạng thái, loại / cấp độ quy hoạch, loại điều chỉnh theo mã thông tin.</li>
                <li>• Sửa tên lớp sai chữ hoa, chuyển lớp về đúng nhóm, đặt tên file chuẩn trong thư mục HoSoGIS.</li>
              </ul>
              {error && (
                <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                  <IconXCircle width={14} height={14} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          )}

          {result && after && (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 font-medium ${afterErrors ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
                {afterErrors ? <IconAlert width={16} height={16} /> : <IconCheckCircle width={16} height={16} />}
                {afterErrors
                  ? `Đã chuẩn hóa — còn ${afterErrors} lỗi cần xử lý thủ công`
                  : `Đã chuẩn hóa — đạt Thông tư 16${afterWarns ? ` (${afterWarns} mục cần xem lại)` : ''}`}
              </div>
              {afterErrors > 0 && (
                <ul className="space-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-700">
                  {[...after.issues, ...after.gdbs.flatMap((g) => g.issues)]
                    .filter((i) => i.level === 'error')
                    .slice(0, 6)
                    .map((i, k) => (
                      <li key={k} className="flex gap-2">
                        <IconXCircle width={13} height={13} className="mt-0.5 shrink-0 text-red-600" />
                        {i.text}
                      </li>
                    ))}
                  {after.gdbs.some((g) => g.counts.errors > g.issues.filter((i) => i.level === 'error').length) && (
                    <li className="text-zinc-500">Bấm “Xem bản chuẩn hóa trên trang” để xem chi tiết từng lớp.</li>
                  )}
                </ul>
              )}
              <p className="text-[12.5px] text-zinc-500">
                {result.outputs.map((o) => `${o}.gdb`).join(', ')} · {(result.zip.size / 1048576).toFixed(1)} MB · {(result.ms / 1000).toFixed(1)} s
              </p>
              <ul className="space-y-1 text-[12.5px] text-zinc-700">
                {result.notes.map((n, k) => (
                  <li key={k} className="flex gap-2">
                    <IconCheckCircle width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                    {n}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-zinc-400">
                File .aprx / .ppkx không đi kèm: hãy mở lại trong ArcGIS Pro và trỏ nguồn dữ liệu tới các .gdb mới trong thư mục HoSoGIS.
              </p>
            </div>
          )}

          {running && (
            <div className="mt-4" aria-live="polite">
              <div className="flex items-center gap-2 text-[12.5px] text-zinc-600">
                <IconSpinner width={14} height={14} className="text-blue-600" />
                <span className="truncate">{progress?.stage}</span>
                {progress && progress.total > 1 && (
                  <span className="ml-auto tabular-nums text-zinc-400">
                    {progress.done}/{progress.total}
                  </span>
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-[width]"
                  style={{ width: `${progress && progress.total > 1 ? Math.max(4, (progress.done / progress.total) * 100) : 4}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          {result ? (
            <>
              {zipUrl && (
                // A real link: a click on it is a user gesture, so it downloads even when the automatic one was blocked.
                <a className="ui-btn" href={zipUrl} download={result.fileName}>
                  <IconDownload width={15} height={15} /> Tải {result.fileName} ({(result.zip.size / 1048576).toFixed(1)} MB)
                </a>
              )}
              <button className="ui-btn-primary" onClick={() => onOpenResult(new File([result.zip], result.fileName, { type: 'application/zip' }))}>
                Xem bản chuẩn hóa trên trang
              </button>
            </>
          ) : (
            <>
              <button className="ui-btn-ghost" onClick={onClose} disabled={running}>
                Hủy
              </button>
              <button className="ui-btn-primary" onClick={start} disabled={running || !codes.valid}>
                {running ? 'Đang chuẩn hóa…' : 'Chuẩn hóa và tải về'}
              </button>
            </>
          )}
        </div>
      </div>
      <BrandLoader
        show={running}
        stage={progress?.stage ? `Chuẩn hóa TT16 · ${progress.stage}` : 'Đang chuẩn hóa theo Thông tư 16…'}
        percent={progress && progress.total > 1 ? (progress.done / progress.total) * 100 : null}
      />
    </div>
  );
}
