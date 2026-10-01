// Main-thread API over cad.worker. One worker per client; requests are matched by id.
// Several documents can be open at once: each is addressed by a caller-chosen `docId`.
import type { CadDocument, CrsOptions, WorkerRequest, WorkerResponse } from '@/lib/cad/types';

// Distributive Omit so each union member keeps its own fields.
type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

type Pending = {
  resolve: (doc: CadDocument | null) => void;
  reject: (err: Error) => void;
  onProgress?: (stage: string, percent: number) => void;
};

/** Default document id, for single-file callers. */
export const MAIN_DOC = 'main';

export class CadPipeline {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('../workers/cad.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.stage, msg.percent);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else if (msg.type === 'released') p.resolve(null);
      else p.resolve(msg.doc);
    };
  }

  private request(req: RequestBody, onProgress?: Pending['onProgress'], transfer: Transferable[] = []): Promise<CadDocument | null> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  /** Parse a DWG/DXF/KMZ/KML file into `docId` (replacing any previous one); drawing coordinates (crs = null) for CAD. */
  async parse(file: File, onProgress?: Pending['onProgress'], docId: string = MAIN_DOC): Promise<CadDocument> {
    const data = await file.arrayBuffer();
    return (await this.request({ type: 'parse', docId, fileName: file.name, data }, onProgress, [data]))!;
  }

  /** Re-project document `docId` to WGS84. */
  async transform(crs: CrsOptions, docId: string = MAIN_DOC): Promise<CadDocument> {
    return (await this.request({ type: 'transform', docId, crs }))!;
  }

  /** Free the worker's copy of a closed document. */
  async release(docId: string): Promise<void> {
    await this.request({ type: 'release', docId });
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Pipeline disposed'));
    this.pending.clear();
  }
}
