'use client';
// Share dialog: the whole custom map is packed into the link (URL fragment), so nothing is uploaded.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildShareUrl, SHARE_LINK_SOFT_LIMIT, SHARE_TITLE_PARAM, type SharedMap } from '@/lib/cad/share';
import { BRAND_NAVY } from './brand';
import { brandedQr } from './qr';
import { IconAlert, IconCheck, IconCopy, IconDownload, IconSpinner, IconX } from './icons';

/** Byte capacity of the largest QR code (version 40, low error correction). */
const QR_MAX = 2900;

/**
 * Ask the server for the link-preview image (/og?t=…) now, so it is rendered and cached at the CDN
 * before a chat app's crawler asks for them — a cold render (~2 s) can exceed the crawler's patience and the
 * preview then shows without image or title. Fire and forget.
 */
function prewarmPreview(shareUrl: string) {
  try {
    const u = new URL(shareUrl);
    if (u.origin !== window.location.origin) return;
    const title = u.searchParams.get(SHARE_TITLE_PARAM);
    if (!title) return;
    const og = new URL('/og', u.origin);
    og.searchParams.set(SHARE_TITLE_PARAM, title);
    void fetch(og, { priority: 'low' }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export default function ShareDialog({ map, onClose }: { map: SharedMap; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    buildShareUrl(window.location.href, map)
      .then((u) => {
        if (alive) setUrl(u);
        prewarmPreview(u);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [map]);

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 150);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const qr = useMemo(() => {
    if (!url || url.length > QR_MAX) return null;
    return brandedQr(url)?.svg ?? null;
  }, [url]);

  const [qrBusy, setQrBusy] = useState(false);
  /** PNG for print / documents: the branded QR with the map title underneath. */
  const downloadQr = async () => {
    if (!qr) return;
    setQrBusy(true);
    try {
      // The wordmark is painted on the canvas below: an SVG drawn through <img> cannot use the web font.
      const branded = url ? brandedQr(url, { withText: false }) : null;
      if (!branded) return;
      const img = new Image();
      const svgUrl = URL.createObjectURL(new Blob([branded.svg], { type: 'image/svg+xml' }));
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Không vẽ được mã QR'));
        img.src = svgUrl;
      });
      URL.revokeObjectURL(svgUrl);

      // Card: QR with the logo in the middle, the map title underneath.
      const W = 1080;
      const pad = 72;
      const size = W - pad * 2;
      const font = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Trình duyệt không hỗ trợ canvas');
      // Wrap the title to the QR width (max 2 lines).
      const titleFont = `600 52px ${font}`;
      ctx.font = titleFont;
      const lines: string[] = [];
      for (const w of map.title.split(/\s+/)) {
        const last = lines[lines.length - 1];
        if (last !== undefined && ctx.measureText(`${last} ${w}`).width <= size - 40) lines[lines.length - 1] = `${last} ${w}`;
        else lines.push(w);
      }
      if (lines.length > 2) lines.splice(2, lines.length - 2, `${lines[1]}…`);
      const lineH = 66;
      canvas.width = W;
      canvas.height = pad + size + 36 + lines.length * lineH + pad - 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, pad, pad, size, size);
      if (branded.label) {
        const l = branded.label;
        const brandFont = getComputedStyle(document.documentElement).getPropertyValue('--font-brand').trim() || font;
        const x0 = pad + l.x * size;
        ctx.fillStyle = BRAND_NAVY;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = `700 ${l.word.size * size}px ${brandFont}`;
        const wordW = Math.min(ctx.measureText(l.word.text).width, l.width * size);
        ctx.fillText(l.word.text, x0, pad + l.word.y * size, wordW);
        // Tagline: letters spread evenly across the wordmark's width (as in the logo).
        ctx.font = `500 ${l.tag.size * size}px ${brandFont}`;
        const chars = [...l.tag.text];
        const widths = chars.map((c) => ctx.measureText(c).width);
        const spacing = (wordW - widths.reduce((a, b) => a + b, 0)) / (chars.length - 1);
        let cx = x0;
        chars.forEach((c, i) => {
          ctx.fillText(c, cx, pad + l.tag.y * size);
          cx += widths[i] + spacing;
        });
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = BRAND_NAVY;
      ctx.font = titleFont;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, pad + size + 36 + lineH / 2 + i * lineH));

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Không tạo được ảnh PNG');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${map.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'ban-do'} - QR.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setQrBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      inputRef.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const shown = map.features.filter((f) => !f.hidden).length;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4 backdrop-blur-[2px] transition-opacity duration-150 ${
        closing ? 'opacity-0' : 'ui-fade-up'
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
    >
      <div className={`ui-floating w-[26rem] max-w-full overflow-hidden ${closing ? '' : 'ui-pop-in'}`}>
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id="share-title" className="text-[15px] font-semibold text-zinc-900">
              Chia sẻ bản đồ
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500" title={map.title}>
              {map.title} · {map.features.length} nét vẽ{shown < map.features.length ? ` (${shown} đang hiện)` : ''}
            </p>
          </div>
          <button className="ui-icon-btn" aria-label="Đóng" onClick={close}>
            <IconX width={16} height={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 pb-5">
          {error ? (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <IconAlert className="mt-px shrink-0" width={14} height={14} />
              Không tạo được link: {error}
            </p>
          ) : !url ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <IconSpinner className="text-blue-600" /> Đang tạo link…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  readOnly
                  value={url}
                  className="ui-input min-w-0 flex-1 !py-2 font-mono text-[11px]"
                  onFocus={(e) => e.target.select()}
                  aria-label="Link chia sẻ"
                />
                <button className="ui-btn-primary shrink-0 !px-3" onClick={copy}>
                  {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
                  {copied ? 'Đã chép' : 'Chép link'}
                </button>
              </div>

              {qr ? (
                <div className="flex items-center gap-4 rounded-xl bg-zinc-50 p-3">
                  <div
                    className="h-40 w-40 shrink-0 overflow-hidden rounded-lg bg-white p-1 ring-1 ring-zinc-200 [&>svg]:h-full [&>svg]:w-full"
                    // uqr returns a self-contained <svg> built from the link text (no user HTML).
                    dangerouslySetInnerHTML={{ __html: qr }}
                    aria-label="Mã QR của link"
                    role="img"
                  />
                  <div className="flex flex-col items-start gap-2.5">
                    <p className="text-xs leading-relaxed text-zinc-500">Quét mã bằng điện thoại để mở bản đồ ngay.</p>
                    <button className="ui-btn !px-3 !py-1.5 !text-xs" onClick={downloadQr} disabled={qrBusy}>
                      {qrBusy ? <IconSpinner width={14} height={14} /> : <IconDownload width={14} height={14} />}
                      Tải mã QR (PNG)
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500">Bản đồ nhiều nét nên link quá dài để tạo mã QR — hãy gửi link.</p>
              )}

              {url.length > SHARE_LINK_SOFT_LIMIT && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  <IconAlert className="mt-px shrink-0" width={14} height={14} />
                  Link dài {url.length.toLocaleString('vi-VN')} ký tự — một số ứng dụng chat có thể cắt mất. Nếu người nhận mở không được, hãy gửi file KMZ (tab Xuất).
                </p>
              )}

              <p className="text-[11px] leading-relaxed text-zinc-400">
                Toàn bộ nét vẽ nằm ngay trong link, không lưu lên máy chủ. Ai có link đều xem được; link là bản chụp tại lúc tạo — sửa xong hãy chia sẻ link mới. Bản vẽ DWG/DXF/KMZ đã mở không được gửi kèm.
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
