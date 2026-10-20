'use client';
// The one drop zone of the home page: whatever the user drops (a drawing, a geodatabase folder, a planning dossier)
// is handed to the tool that reads it — "Bản đồ", "Kiểm tra CSDL GIS" or "Bóc tách DWG" — and that page opens.
// The tools stay reachable as quiet links below, for starting empty (a new map).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { classifyDrop, GDB_MARKER, MAP_EXT, type LaunchTool } from '@/lib/launch/classify';
import { pickedFromDrop, pickedFromInput, zipFiles } from './dropFiles';
import { handOffToChecker, handOffToExtractor, handOffToMap } from './handoff';
import { IconFolderOpen, IconSpinner, IconUpload } from './icons';
import { useFileAccept } from './useFileAccept';
import { useIsPhone } from './useIsPhone';

type Picked = { path: string; file: File };

const TOOL_NAME: Record<LaunchTool, string> = { map: 'Bản đồ', check: 'Kiểm tra CSDL GIS', extract: 'Bóc tách DWG' };
const TOOL_PATH: Record<LaunchTool, string> = { map: '/ban-do', check: '/kiem-tra', extract: '/boc-tach' };

const UNKNOWN =
  'Chưa nhận ra định dạng — thả file .dwg, .dxf, .kmz, .kml, thư mục .gdb / HoSoGIS, hoặc thư mục bản vẽ quy hoạch.';

/** Geodatabase folders of a drop become one .zip each (as the checker expects); loose .zip files go as they are. */
async function geodatabaseFiles(picked: Picked[]): Promise<File[]> {
  const out: File[] = [];
  const roots = new Map<string, Picked[]>();
  for (const p of picked) {
    const path = p.path.replaceAll('\\', '/');
    const slash = path.indexOf('/');
    if (slash < 0) {
      if (/\.zip$/i.test(path)) out.push(p.file);
      continue;
    }
    const root = path.slice(0, slash);
    roots.set(root, [...(roots.get(root) ?? []), { path, file: p.file }]);
  }
  for (const [root, files] of roots) {
    if (files.some((f) => f.path.toLowerCase().endsWith('/' + GDB_MARKER))) out.push(await zipFiles(`${root}.zip`, files));
  }
  return out;
}

export default function HomeDrop() {
  const router = useRouter();
  const accept = useFileAccept();
  const phone = useIsPhone();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<LaunchTool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  useEffect(() => {
    // React has no typed prop for these non-standard attributes.
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  });

  // A drop anywhere on the page counts, not only on the card.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setOver(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const dragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      void launch(pickedFromDrop(e.dataTransfer));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', dragOver);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', dragOver);
      window.removeEventListener('drop', drop);
    };
    // `launch` only uses stable things (router, setters).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function launch(pending: Promise<Picked[]> | Picked[]) {
    if (busy) return;
    setError(null);
    try {
      const picked = await pending;
      const tool = classifyDrop(picked.map((p) => p.path));
      if (!tool) {
        setError(UNKNOWN);
        return;
      }
      setBusy(tool);
      if (tool === 'map') handOffToMap(picked.filter((p) => MAP_EXT.test(p.path)).map((p) => p.file));
      else if (tool === 'extract') handOffToExtractor(picked);
      else handOffToChecker(await geodatabaseFiles(picked));
      router.push(TOOL_PATH[tool]);
    } catch (err) {
      setBusy(null);
      setError(`Không đọc được: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list?.length) void launch(pickedFromInput(list));
    e.target.value = '';
  };

  return (
    <div className="mt-10 w-full max-w-2xl sm:mt-16">
      <div
        className={`ui-intro-card rounded-[2rem] border-2 border-dashed p-6 text-center backdrop-blur-md transition sm:p-9 ${
          over ? 'border-blue-500 bg-blue-50/80' : 'border-zinc-300 bg-white/80'
        } shadow-[0_1px_2px_rgba(11,53,88,0.05),0_12px_32px_rgba(11,53,88,0.06)]`}
        style={{ animationDelay: '2.15s' }}
      >
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-white shadow-md transition ${
            over ? 'scale-105 bg-blue-600' : 'bg-gradient-to-br from-zinc-900 to-blue-700'
          }`}
        >
          {busy ? <IconSpinner width={24} height={24} /> : <IconUpload width={24} height={24} />}
        </span>
        <p className="mt-4 text-lg font-bold tracking-[-0.01em] text-zinc-900 sm:text-xl">
          {busy ? `Đang mở ${TOOL_NAME[busy]}…` : 'Thả file hoặc thư mục vào đây'}
        </p>
        <p className="mt-1 text-[13px] text-zinc-500">DWG · DXF · KMZ · KML · GDB · thư mục bản vẽ</p>
        <div className="ui-pills mt-5 flex flex-wrap items-center justify-center gap-2">
          <button className="ui-btn-primary" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <IconUpload width={15} height={15} />
            Chọn file
          </button>
          {!phone && (
            <button className="ui-btn" disabled={!!busy} onClick={() => folderRef.current?.click()}>
              <IconFolderOpen width={15} height={15} />
              Chọn thư mục
            </button>
          )}
        </div>
        {error && (
          <p className="mx-auto mt-4 max-w-md text-[13px] text-red-600" role="alert">
            {error}
          </p>
        )}
        <input ref={fileRef} type="file" multiple accept={accept} className="hidden" onChange={onInput} />
        <input ref={folderRef} type="file" className="hidden" onChange={onInput} />
      </div>

      <nav className="ui-intro-card mt-5 flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-[13px] text-zinc-500" aria-label="Công cụ" style={{ animationDelay: '2.35s' }}>
        <span className="mr-1">hoặc mở:</span>
        {[
          { href: '/ban-do', label: 'Bản đồ' },
          { href: '/ban-do#moi', label: 'Vẽ bản đồ mới' },
          { href: '/kiem-tra', label: 'Kiểm tra CSDL GIS' },
          { href: '/boc-tach', label: 'Bóc tách DWG' },
        ].map((x, k) => (
          <span key={x.label} className="flex items-center gap-1">
            {k > 0 && <span aria-hidden className="text-zinc-300">·</span>}
            <Link href={x.href} className="rounded-full px-2 py-1 font-semibold text-zinc-700 transition hover:bg-blue-50 hover:text-blue-700">
              {x.label}
            </Link>
          </span>
        ))}
      </nav>
    </div>
  );
}
