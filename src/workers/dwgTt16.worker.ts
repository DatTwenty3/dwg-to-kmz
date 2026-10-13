/// <reference lib="webworker" />
// "Bóc tách DWG → CSDL TT16" off the main thread: reads the drawings of a planning folder (DWG via libredwg-web,
// DXF) with their xrefs, analyses them (src/lib/dwg2gdb), previews one drawing on the map, and exports HoSoGIS.zip:
// features → GeoJSON → GDAL stage 1 → "Chuẩn hóa TT16" → check. Nothing leaves the browser.
import { parseDwg, parseDxf } from '@/lib/cad';
import type { CadDocument, CadEntity, CrsOptions, Vec2 } from '@/lib/cad/types';
import {
  analyzeDrawings,
  BOUNDARY_LAYER,
  buildFeatures,
  drawingTexts,
  guessesInProvince,
  loadFolder,
  buildQgs,
  cleanProjectName,
  planStage1,
  planUnitFromTitle,
  projectNameFromTexts,
  provinceFromTexts,
  summaryDocument,
  vn2000EsriWkt,
  type DrawingInfo,
  type FolderFile,
  type LayerRow,
  type MappingEntry,
  type ParsedDrawing,
  type RoleId,
} from '@/lib/dwg2gdb';
import { toDxf } from '@/lib/export/dxf';
import JSZip from 'jszip';
import { collectGdbs, readCatalog, runCheck, type SubmissionReport } from '@/lib/gdb';
import { executePlan, planNormalization, type NormalizeSource } from '@/lib/gdb/normalize';
import { locateVn2000, type Vn2000Guess } from '@/lib/geo/search';
import { transformDocument } from '@/lib/geo/transform';
import { gdal, gdalFailure, gdbZipFile, nextPrefix, openAll, outputEntries, zipEntries } from './gdalRuntime';

declare const self: DedicatedWorkerGlobalScope;

export type DwgTt16Request =
  | { type: 'load'; files: { path: string; file: File }[] }
  | { type: 'preview'; drawingId: string; crs: CrsOptions; layers: string[] | null }
  | {
      type: 'export';
      drawings: string[];
      mapping: [string, MappingEntry][];
      lon0: number;
      zone: 3 | 6;
      place: string | null;
      maHoSoQH: string;
      maThongTinQH: string;
      createMissing: boolean;
      sourceInGhiChu: boolean;
      provinceCode: string | null;
      /** Planning title for the QGIS project. */
      projectTitle: string | null;
      /** Also write the summary drawing (DXF): the mapped CAD objects + texts, by TT16 class / phanLoai. */
      dxf: boolean;
      /** Map kind of each drawing as set by the user (prefix HT / QH of the texts' layers). */
      roles: Record<string, RoleId>;
      /** Add the QGIS project <projectName>.qgz (tệp tổng hợp) to HoSoGIS. */
      qgz: boolean;
      projectName: string;
    };

export type DwgTt16Response =
  | { type: 'progress'; stage: string; done: number; total: number }
  | {
      type: 'loaded';
      drawings: DrawingInfo[];
      rows: LayerRow[];
      boundary: Vec2[] | null;
      boundaryArea: number;
      unused: FolderFile[];
      missingXrefs: string[];
      /** VN-2000 KTTs that place the planning area inside the province using them (named province first). */
      guesses: Vn2000Guess[];
      /** Current province named in the title blocks ("TỈNH VĨNH LONG"), if any. */
      provinceId: string | null;
      /** Project name from the title blocks ("QHC_XaLongHiep"), if found. */
      projectName: string | null;
      /** Planning title ("QUY HOẠCH CHUNG XÃ LONG HIỆP…"), if found. */
      projectTitle: string | null;
      ms: number;
    }
  | { type: 'preview'; drawingId: string; doc: CadDocument; truncated: boolean }
  | {
      type: 'done';
      zip: Blob;
      fileName: string;
      /** Summary drawing (DXF, UTF-8), when asked. */
      dxf: { blob: Blob; fileName: string; layers: number; entities: number } | null;
      notes: string[];
      report: SubmissionReport;
      classes: { target: string; count: number }[];
      ms: number;
    }
  | { type: 'error'; during: 'load' | 'preview' | 'export'; message: string };

const post = (m: DwgTt16Response) => self.postMessage(m);

let parsed: ParsedDrawing[] = [];
let analysis: ReturnType<typeof analyzeDrawings> | null = null;

async function load(files: { path: string; file: File }[]) {
  const t0 = performance.now();
  const wasmBaseUrl = `${self.location.origin}/wasm`;
  const input = files.map(({ path, file }, i) => ({
    id: `f${i}`,
    name: path.replace(/^.*\//, ''),
    path,
    size: file.size,
    read: () => file.arrayBuffer(),
  }));
  parsed = [];
  analysis = null;
  const folder = await loadFolder(
    input,
    (f, data) => (/\.dxf$/i.test(f.name) ? parseDxf(data, { wasmBaseUrl }) : parseDwg(data, { wasmBaseUrl })),
    (done, total, name) => post({ type: 'progress', stage: name ? `Đọc ${name}` : 'Đã đọc xong', done, total }),
  );
  if (!folder.drawings.length) throw new Error('Không có bản vẽ DWG/DXF nào trong thư mục.');
  post({ type: 'progress', stage: 'Phân tích layer và ranh quy hoạch', done: 0, total: 1 });
  parsed = folder.drawings;
  analysis = analyzeDrawings(parsed);
  const b = analysis.boundary;
  let guesses: Vn2000Guess[] = [];
  const at: Vec2 | null = b
    ? [(Math.min(...b.ring.map((p) => p[0])) + Math.max(...b.ring.map((p) => p[0]))) / 2, (Math.min(...b.ring.map((p) => p[1])) + Math.max(...b.ring.map((p) => p[1]))) / 2]
    : (() => {
        const d = analysis!.drawings.find((x) => x.included) ?? analysis!.drawings[0];
        return d ? [(d.bbox[0][0] + d.bbox[1][0]) / 2, (d.bbox[0][1] + d.bbox[1][1]) / 2] : null;
      })();
  // The province named in the main drawings' title blocks settles which KTT fits.
  const mainTexts = parsed.filter((p) => !p.owner).flatMap((p) => drawingTexts(p.doc));
  const province = provinceFromTexts(mainTexts);
  const projectTitle =
    mainTexts
      .flatMap((t) => t.split('\n'))
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .find((t) => /^QUY HOẠCH (CHUNG|PHÂN KHU|CHI TIẾT)/i.test(t) && t.length < 160) ?? null;
  if (at) guesses = guessesInProvince(locateVn2000(at[1], at[0]), province);
  post({
    type: 'loaded',
    drawings: analysis.drawings,
    rows: analysis.rows,
    boundary: b?.ring ?? null,
    boundaryArea: b?.area ?? 0,
    unused: folder.unused,
    missingXrefs: folder.missingXrefs,
    guesses,
    provinceId: province?.id ?? null,
    projectName: projectNameFromTexts(mainTexts),
    projectTitle,
    ms: performance.now() - t0,
  });
}

/** Drawings this big are previewed with the requested layers only. */
const PREVIEW_LIMIT = 200_000;

function preview(drawingId: string, crs: CrsOptions, layers: string[] | null) {
  const p = parsed.find((d) => d.id === drawingId);
  const flags = analysis?.inside.get(drawingId);
  if (!p || !flags) throw new Error('Bản vẽ không còn trong bộ nhớ — hãy mở lại thư mục.');
  let inside = 0;
  for (const f of flags) inside += f;
  const keep = layers && inside > PREVIEW_LIMIT ? new Set(layers) : null;
  const entities: CadEntity[] = p.doc.entities.filter((e, i) => flags[i] && (!keep || keep.has(e.layer)));
  const ring = analysis!.boundary?.ring;
  if (ring) entities.push({ kind: 'polyline', layer: BOUNDARY_LAYER, color: '#ef4444', points: ring, closed: true, width: 0 });
  const used = new Set(entities.map((e) => e.layer));
  const doc: CadDocument = {
    ...p.doc,
    entities,
    layers: [...p.doc.layers.filter((l) => used.has(l.name)), ...(ring ? [{ name: BOUNDARY_LAYER, color: '#ef4444', visible: true, style: { width: 2.5 } }] : [])],
    xrefs: undefined,
  };
  post({ type: 'preview', drawingId, doc: transformDocument(doc, crs), truncated: !!keep });
}

async function exportHoSoGis(req: Extract<DwgTt16Request, { type: 'export' }>) {
  const t0 = performance.now();
  if (!analysis) throw new Error('Chưa đọc thư mục bản vẽ.');
  post({ type: 'progress', stage: 'Bóc tách đối tượng', done: 0, total: 1 });
  const ids = new Set(req.drawings);
  const built = buildFeatures(
    parsed.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: analysis!.inside.get(p.id)! })),
    new Map(req.mapping),
    { boundary: analysis.boundary?.ring ?? null, sourceInGhiChu: req.sourceInGhiChu, planUnit: planUnitFromTitle(req.projectTitle) },
  );
  if (!built.classes.length) throw new Error('Chưa có layer nào được ghép vào lớp dữ liệu.');

  // Summary drawing: the same objects as drawn in CAD (hatch patterns, colours, widths) + the texts.
  let dxf: Extract<DwgTt16Response, { type: 'done' }>['dxf'] = null;
  if (req.dxf) {
    post({ type: 'progress', stage: 'Ghi bản vẽ tổng hợp (.dxf)', done: 0, total: 1 });
    const doc = summaryDocument(
      parsed
        .filter((p) => ids.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, doc: p.doc, inside: analysis!.inside.get(p.id)!, role: req.roles[p.id] ?? 'other' })),
      new Map(req.mapping),
      { boundary: analysis.boundary?.ring ?? null, texts: true },
    );
    const text = toDxf(doc, { units: 'm', layers: doc.layers.map((l) => l.name) });
    dxf = { blob: new Blob([text], { type: 'application/dxf' }), fileName: 'BanVeTongHop.dxf', layers: doc.layers.length, entities: doc.entities.length };
  }

  post({ type: 'progress', stage: 'Tải thư viện GDAL (lần đầu khoảng 40 MB)', done: 0, total: 1 });
  const Gdal = await gdal();

  // Stage 1: GeoJSON → <CSDL>.gdb with the classes that have data.
  const s1 = planStage1(built.classes, vn2000EsriWkt(req.lon0, req.zone, req.place));
  const o1 = await openAll(
    Gdal,
    s1.inputs.map((i) => new File([i.json], i.fileName, { type: 'application/geo+json' })),
  );
  const p1 = nextPrefix('a');
  try {
    await executePlan(Gdal, new Map(o1.datasets.map((d) => [d.path.replace(/^.*\//, '').replace(/\.geojson$/i, ''), d])), s1, p1, (done, total, label) =>
      post({ type: 'progress', stage: label ? `Ghi ${label}` : 'Hoàn tất ghi', done, total }),
    );
  } catch (e) {
    throw gdalFailure(e);
  } finally {
    for (const d of o1.datasets) await Gdal.close(d).catch(() => {});
  }

  // Stage 2: "Chuẩn hóa TT16" — every required group / class, the 6 fields, codes, maDoiTuong, missing databases.
  post({ type: 'progress', stage: 'Chuẩn hóa theo Thông tư 16', done: 0, total: 1 });
  const stage1 = await outputEntries(Gdal, p1, (rel) => rel);
  const { gdbs } = collectGdbs(stage1);
  const zips: File[] = [];
  const sources: NormalizeSource[] = [];
  for (let i = 0; i < gdbs.length; i++) {
    zips.push(await gdbZipFile(`s${i}`, gdbs[i].name, gdbs[i].files));
    sources.push({ key: `s${i}`, name: gdbs[i].name, database: gdbs[i].name.replace(/\.gdb$/i, ''), catalog: await readCatalog(gdbs[i]) });
  }
  const plan = planNormalization(sources, { maHoSoQH: req.maHoSoQH, maThongTinQH: req.maThongTinQH, createMissingDatabases: req.createMissing });
  const o2 = await openAll(Gdal, zips, ['vsizip']);
  const p2 = nextPrefix('b');
  try {
    await executePlan(Gdal, new Map(o2.datasets.map((d) => [d.path.replace(/\.gdb\.zip$/i, ''), d])), plan, p2, (done, total, label) =>
      post({ type: 'progress', stage: label ? `Chuẩn hóa ${label}` : 'Hoàn tất', done, total }),
    );
  } catch (e) {
    throw gdalFailure(e);
  } finally {
    for (const d of o2.datasets) await Gdal.close(d).catch(() => {});
  }

  post({ type: 'progress', stage: 'Đóng gói và kiểm tra HoSoGIS', done: 0, total: 1 });
  const out: { path: string; bytes: Uint8Array; read: () => Promise<Uint8Array> }[] = await outputEntries(Gdal, p2, (rel) => `HoSoGIS/${rel}`);
  // Tệp tổng hợp: QGIS project next to the geodatabases.
  let qgzName: string | null = null;
  if (req.qgz) {
    const name = cleanProjectName(req.projectName);
    const ring = analysis.boundary?.ring;
    const pts = ring ?? built.classes.flatMap((c) => c.features.slice(0, 200).flatMap((f) => (f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.flat() : f.geometry.coordinates.flat(2))));
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const pad = 200;
    const qgs = buildQgs({
      name,
      title: req.projectTitle || name,
      classes: built.classes,
      lon0: req.lon0,
      zone: req.zone,
      extent: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad],
    });
    const z = new JSZip();
    z.file(`${name}.qgs`, qgs);
    const bytes = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    qgzName = `${name}.qgz`;
    out.push({ path: `HoSoGIS/${qgzName}`, bytes, read: async () => bytes });
  }
  const zip = await zipEntries(out);
  const report = await runCheck(out, undefined, { provinceCode: req.provinceCode });
  post({
    type: 'done',
    zip,
    fileName: 'HoSoGIS.zip',
    dxf,
    notes: [...built.notes, ...plan.notes, ...(qgzName ? [`Tạo tệp tổng hợp ${qgzName} (QGIS): các lớp tô màu theo phân loại như bản vẽ, nhãn theo tên đối tượng`] : [])],
    report,
    classes: built.classes.map((c) => ({ target: c.target, count: c.features.length })),
    ms: performance.now() - t0,
  });
}

self.onmessage = (ev: MessageEvent<DwgTt16Request>) => {
  const m = ev.data;
  const fail = (during: 'load' | 'preview' | 'export') => (e: unknown) =>
    post({ type: 'error', during, message: e instanceof Error ? e.message : String(e) });
  if (m.type === 'load') load(m.files).catch(fail('load'));
  else if (m.type === 'preview') {
    try {
      preview(m.drawingId, m.crs, m.layers);
    } catch (e) {
      fail('preview')(e);
    }
  } else exportHoSoGis(m).catch(fail('export'));
};
