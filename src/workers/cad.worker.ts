/// <reference lib="webworker" />
// Heavy work off the main thread: parse DWG/DXF once, keep the drawing-coordinate
// document, and re-project it whenever the user changes the CRS.
import { detectFormat, parseDwg, parseDxf } from '@/lib/cad';
import type { CadDocument, WorkerRequest, WorkerResponse } from '@/lib/cad/types';
import { transformDocument } from '@/lib/geo';

declare const self: DedicatedWorkerGlobalScope;

let rawDoc: CadDocument | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'parse') {
      const onProgress = (stage: string, percent: number) => post({ id: req.id, type: 'progress', stage, percent });
      const opts = { wasmBaseUrl: `${self.location.origin}/wasm`, onProgress };
      const format = detectFormat(req.fileName, req.data);
      let doc: CadDocument;
      if (format === 'kmz' || format === 'kml') {
        // KML/KMZ is already WGS84 (crs set); the UI applies an identity transform for display.
        const { parseKmlFile } = await import('@/lib/kml');
        onProgress('Đọc KML/KMZ', 10);
        doc = await parseKmlFile(req.data, req.fileName);
      } else {
        doc = format === 'dwg' ? await parseDwg(req.data, opts) : await parseDxf(req.data, opts);
      }
      rawDoc = doc;
      post({ id: req.id, type: 'parsed', doc });
    } else if (req.type === 'transform') {
      if (!rawDoc) throw new Error('Chưa có bản vẽ nào được đọc.');
      post({ id: req.id, type: 'transformed', doc: transformDocument(rawDoc, req.crs) });
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
