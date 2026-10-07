'use client';
// Files from a drag & drop, with folders: an Esri File Geodatabase is a *folder* (HienTrang.gdb/…), so a dropped
// folder that holds one (or a HoSoGIS folder holding several) is packed into a single .zip File in the browser
// (stored, not compressed — fast) and then goes through the normal one-file pipeline like a dropped .zip.

/** Name of the system catalog table present in every File Geodatabase folder. */
const GDB_MARKER = 'a00000001.gdbtable';

type Picked = { path: string; file: File };

async function walk(entry: FileSystemEntry, prefix: string, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns batches (≤ 100 in Chrome) until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, `${prefix}${entry.name}/`, out);
    }
  }
}

/** Every file of a dropped folder tree, with its relative path ("HoSoGIS/HienTrang.gdb/a00000001.gdbtable"). */
export async function folderFiles(entry: FileSystemEntry): Promise<Picked[]> {
  const out: Picked[] = [];
  await walk(entry, '', out);
  return out;
}

/** Packs picked files (relative paths kept) into one .zip File. */
export async function zipFiles(name: string, files: Picked[]): Promise<File> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.file);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return new File([blob], name, { type: 'application/zip' });
}

/**
 * Files of a drop event. Plain files are returned as is; a folder containing a geodatabase becomes "<folder>.zip".
 * Other folders are ignored. Must be called synchronously from the drop handler (entries are read up front).
 */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  // The DataTransfer is emptied once the event handler returns: read everything before the first await.
  const picked = [...(dt.items ?? [])]
    .filter((i) => i.kind === 'file')
    .map((i) => ({ entry: i.webkitGetAsEntry?.() ?? null, file: i.getAsFile() }));
  const plain = [...(dt.files ?? [])];
  if (!picked.some((p) => p.entry?.isDirectory)) return plain;
  const out: File[] = [];
  for (const { entry, file } of picked) {
    if (entry?.isDirectory) {
      const files = await folderFiles(entry);
      if (files.some((f) => f.path.toLowerCase().endsWith('/' + GDB_MARKER))) out.push(await zipFiles(`${entry.name}.zip`, files));
    } else if (file) out.push(file);
  }
  return out;
}
