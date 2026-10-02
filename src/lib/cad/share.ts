// Share a custom map through the URL fragment only (no server): title, description, basemap and sketches
// are packed into a compact JSON, deflated (CompressionStream, built into browsers and Node ≥ 18) and
// base64url-encoded into `#m=…`. The fragment never reaches a server.
import type { Vec2 } from './types';
import { isValidFeature, type SketchFeature, type SketchKind } from './sketch';

export interface SharedMap {
  title: string;
  description?: string;
  basemap?: string;
  features: SketchFeature[];
}

export const SHARE_HASH_PREFIX = '#m=';
/** Above this many characters some chat apps cut or refuse links. */
export const SHARE_LINK_SOFT_LIMIT = 8000;

/** 1e-7° ≈ 1 cm — far below what anyone draws by hand on the map. */
const SCALE = 1e7;
const KINDS: SketchKind[] = ['line', 'polygon', 'point'];
const DASHES = ['solid', 'dashed', 'dotted', 'dashdot'] as const;

/** Wire format v1 (short keys; coordinates as delta-encoded integers). */
interface WireFeature {
  k: number; // index in KINDS
  n: string; // name
  c: string; // colour without '#'
  p: number[]; // flattened [dx, dy, dx, dy, …] in 1e-7 degrees (first pair absolute)
  w?: number;
  d?: number; // index in DASHES
  o?: number; // fill opacity × 100
  l?: string; // label
  s?: number; // label size (m)
  h?: 1; // hidden
}
interface WireMap {
  v: 1;
  t: string;
  e?: string;
  b?: string;
  f: WireFeature[];
}

function packPoints(points: readonly Vec2[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const [lng, lat] of points) {
    const x = Math.round(lng * SCALE);
    const y = Math.round(lat * SCALE);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

function unpackPoints(flat: readonly number[]): Vec2[] {
  const out: Vec2[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([x / SCALE, y / SCALE]);
  }
  return out;
}

export function toWire(map: SharedMap): WireMap {
  return {
    v: 1,
    t: map.title,
    ...(map.description ? { e: map.description } : {}),
    ...(map.basemap ? { b: map.basemap } : {}),
    f: map.features.filter(isValidFeature).map((f) => {
      const w: WireFeature = { k: KINDS.indexOf(f.kind), n: f.name, c: f.style.color.replace('#', ''), p: packPoints(f.points) };
      if (f.style.width !== undefined) w.w = f.style.width;
      if (f.style.dash && f.style.dash !== 'solid') w.d = DASHES.indexOf(f.style.dash);
      if (f.style.fillOpacity !== undefined) w.o = Math.round(f.style.fillOpacity * 100);
      if (f.label) w.l = f.label;
      if (f.labelSize !== undefined) w.s = f.labelSize;
      if (f.hidden) w.h = 1;
      return w;
    }),
  };
}

const HEX6 = /^[0-9a-f]{6}$/i;
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.normalize('NFC').slice(0, max) : undefined);
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;

/** Validates untrusted wire data (it comes from a link anyone can craft); drops anything malformed. */
export function fromWire(raw: unknown): SharedMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<WireMap>;
  if (m.v !== 1 || !Array.isArray(m.f)) return null;
  const features: SketchFeature[] = [];
  m.f.forEach((w, i) => {
    if (!w || typeof w !== 'object') return;
    const kind = KINDS[w.k as number];
    const color = typeof w.c === 'string' && HEX6.test(w.c) ? `#${w.c.toLowerCase()}` : null;
    if (!kind || !color || !Array.isArray(w.p) || !w.p.every((n) => typeof n === 'number' && Number.isFinite(n))) return;
    const points = unpackPoints(w.p).filter(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
    const dash = typeof w.d === 'number' ? DASHES[w.d] : undefined;
    const width = num(w.w, 0.5, 20);
    const opacity = num(w.o, 0, 100);
    const f: SketchFeature = {
      id: `s${i + 1}`,
      kind,
      name: str(w.n, 120) || `Nét ${i + 1}`,
      points,
      style: {
        color,
        ...(width !== undefined ? { width } : {}),
        ...(dash ? { dash } : {}),
        ...(opacity !== undefined ? { fillOpacity: opacity / 100 } : {}),
      },
      ...(str(w.l, 200) ? { label: str(w.l, 200) } : {}),
      ...(num(w.s, 0.5, 500) !== undefined ? { labelSize: num(w.s, 0.5, 500) } : {}),
      ...(w.h === 1 ? { hidden: true } : {}),
    };
    if (isValidFeature(f)) features.push(f);
  });
  // Names are layer names: keep them unique.
  const seen = new Set<string>();
  for (const f of features) {
    let name = f.name;
    for (let n = 2; seen.has(name); n++) name = `${f.name} (${n})`;
    f.name = name;
    seen.add(name);
  }
  return {
    title: str(m.t, 160) || 'Bản đồ chưa đặt tên',
    ...(str(m.e, 500) ? { description: str(m.e, 500) } : {}),
    ...(typeof m.b === 'string' && /^[a-z0-9-]{1,40}$/.test(m.b) ? { basemap: m.b } : {}),
    features,
  };
}

// ---- base64url + deflate ---------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** `SharedMap` → URL fragment payload (without the `#m=` prefix). */
export async function encodeSharedMap(map: SharedMap): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toWire(map)));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Fragment payload → `SharedMap`, or null if the link is damaged / not ours. Never throws. */
export async function decodeSharedMap(payload: string): Promise<SharedMap | null> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length > 2_000_000) return null;
    const bytes = await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw'));
    if (bytes.length > 20_000_000) return null;
    return fromWire(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** Full share URL for the current page origin + path. */
/**
 * Query parameter carrying the map title in plain text. The map itself lives in the fragment, which chat apps
 * never send to the server — the title in the query is what lets the server put it in the link preview
 * (page metadata + /og image). The app ignores it; the fragment stays the source of truth.
 */
export const SHARE_TITLE_PARAM = 't';
const TITLE_IN_URL_MAX = 80;

/** Title from the query string, made safe for metadata (untrusted: anyone can edit the link). */
export function cleanShareTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_IN_URL_MAX)
    .trim();
  return t || null;
}

export async function buildShareUrl(base: string, map: SharedMap): Promise<string> {
  const u = new URL(base);
  u.hash = '';
  u.search = '';
  const title = cleanShareTitle(map.title);
  if (title) u.searchParams.set(SHARE_TITLE_PARAM, title);
  return `${u.toString()}${SHARE_HASH_PREFIX}${await encodeSharedMap(map)}`;
}

/** Payload from a location hash, or null when the hash is not a shared map. */
export function sharePayloadOf(hash: string): string | null {
  return hash.startsWith(SHARE_HASH_PREFIX) ? hash.slice(SHARE_HASH_PREFIX.length) : null;
}
