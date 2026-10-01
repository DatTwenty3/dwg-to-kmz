// Main-thread API over cad.worker. One worker per client; requests are matched by id.
import type { CadDocument, CrsOptions, WorkerRequest, WorkerResponse } from '@/lib/cad/types';

// Distributive Omit so each union member keeps its own fields.
type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

type Pending = {
  resolve: (doc: CadDocument) => void;
  reject: (err: Error) => void;
  onProgress?: (stage: string, percent: number) => void;
};

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
      else p.resolve(msg.doc);
    };
  }

  private request(
    req: RequestBody,
    onProgress?: Pending['onProgress'],
    transfer: Transferable[] = [],
  ): Promise<CadDocument> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  /** Parse a DWG/DXF file; result is in drawing coordinates (crs = null). */
  async parse(file: File, onProgress?: Pending['onProgress']): Promise<CadDocument> {
    const data = await file.arrayBuffer();
    return this.request({ type: 'parse', fileName: file.name, data }, onProgress, [data]);
  }

  /** Re-project the last parsed document to WGS84. */
  transform(crs: CrsOptions): Promise<CadDocument> {
    return this.request({ type: 'transform', crs });
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Pipeline disposed'));
    this.pending.clear();
  }
}
