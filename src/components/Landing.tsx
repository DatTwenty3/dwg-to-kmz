'use client';
// Start screen of the map tool (/ban-do): drop a drawing, start a new map, or go back to the open one; the
// coordinate-system step is shown in the same frame.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { filesFromDrop } from './dropFiles';
import { IconAlert, IconArrowRight, IconPen } from './icons';
import ToolStart from './ToolStart';
import { useFileAccept } from './useFileAccept';

/** Formats cycled in the headline, in the order the app reads them. */
const FORMATS = ['.dwg', '.dxf', '.kmz', '.kml', '.gdb'];


const TYPE_MS = 110;
const DELETE_MS = 60;
const HOLD_MS = 1300;
const GAP_MS = 350;

/**
 * Typewriter: types a format, holds, deletes it character by character, then types the next one.
 * Runs even with prefers-reduced-motion: it only changes text in place (no movement), and the
 * owner wants it visible on machines where Windows "Animation effects" is off.
 */
function FormatTyper() {
  const [i, setI] = useState(0);
  const [len, setLen] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const word = FORMATS[i];

  useEffect(() => {
    let delay: number;
    let next: () => void;
    if (!deleting && len < word.length) {
      delay = TYPE_MS;
      next = () => setLen(len + 1);
    } else if (!deleting) {
      delay = HOLD_MS;
      next = () => setDeleting(true);
    } else if (len > 0) {
      delay = DELETE_MS;
      next = () => setLen(len - 1);
    } else {
      delay = GAP_MS;
      next = () => {
        setDeleting(false);
        setI((v) => (v + 1) % FORMATS.length);
      };
    }
    const t = setTimeout(next, delay);
    return () => clearTimeout(t);
  }, [i, len, deleting, word]);

  return (
    <span className="inline-flex h-[1.45em] min-w-[3.6em] items-center rounded-lg bg-blue-50 px-2 font-mono font-semibold leading-none text-blue-600 ring-1 ring-blue-100">
      <span className="sr-only">{FORMATS.join(', ')}</span>
      <span aria-hidden>{word.slice(0, len)}</span>
      <span aria-hidden className="ui-caret ml-px inline-block h-[1em] w-[2px] rounded-full bg-blue-600" />
    </span>
  );
}

export default function Landing({
  onFile,
  busy,
  error,
  resumeName,
  onResume,
  panel,
  onBlankMap,
}: {
  onFile: (file: File) => void;
  /** A file is being read (the brand loader covers the page): the drop zone is disabled. */
  busy: boolean;
  error: string | null;
  /** A drawing is already loaded: offer to go back to it. */
  resumeName?: string;
  onResume?: () => void;
  /** Open an empty map to draw on (no file needed). */
  onBlankMap?: () => void;
  /** Shown in place of the drop zone (e.g. the coordinate-system step). */
  panel?: ReactNode;
}) {
  const fileAccept = useFileAccept();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => !busy && inputRef.current?.click();

  return (
    <div className="relative flex min-h-dvh flex-col bg-white">
      <ToolStart
        art="map"
        title={
          <>
            Bản đồ <span className="ui-shimmer">CAD</span>
          </>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            Đưa <FormatTyper /> của bạn lên nền ảnh vệ tinh.
          </span>
        }
        prompt="Thả file hoặc bấm để chọn"
        hint="DWG · DXF · KMZ · KML · GDB"
        label="Chọn hoặc kéo thả file DWG, DXF, KMZ, KML, thư mục geodatabase (.gdb) hoặc phiên làm việc LDG"
        over={over}
        onActivate={open}
        panel={panel}
        zoneProps={{
          onClick: open,
          style: { cursor: busy ? 'progress' : 'pointer' },
          onDragOver: (e) => {
            e.preventDefault();
            setOver(true);
          },
          onDragLeave: () => setOver(false),
          onDrop: async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            if (busy) return;
            // A dropped .gdb / HoSoGIS folder arrives as one zip.
            const [f] = await filesFromDrop(e.dataTransfer);
            if (f) onFile(f);
          },
        }}
        after={
          <>
            {error && (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-left text-xs leading-relaxed text-red-700">
                <IconAlert className="mt-px shrink-0" width={14} height={14} />
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2.5">
              {onBlankMap && (
                <button className="ui-cta group" onClick={onBlankMap} disabled={busy}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
                    <IconPen width={15} height={15} className="transition-transform duration-300 group-hover:-rotate-12" />
                  </span>
                  <span>Tạo bản đồ mới</span>
                  <IconArrowRight width={16} height={16} className="transition-transform duration-300 group-hover:translate-x-1" />
                </button>
              )}
              {resumeName && onResume && (
                <button className="ui-btn" onClick={onResume} disabled={busy}>
                  Tiếp tục <b className="max-w-[14rem] truncate font-semibold">{resumeName}</b>
                  <IconArrowRight width={14} height={14} />
                </button>
              )}
            </div>
          </>
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={fileAccept}
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </ToolStart>
    </div>
  );
}
