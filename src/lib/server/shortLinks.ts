// Short share links (/s/<id>) stored in Upstash Redis through its REST API (no SDK). Server-only.
// Vercel's Upstash integration exposes KV_REST_API_URL / KV_REST_API_TOKEN (older) or
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN; either pair works.
import { createHash } from 'node:crypto';

export interface ShortLinkRecord {
  /** `encodeSharedMap` payload (what a long link carries after `#m=`). */
  p: string;
  /** Map title, for the link preview. */
  t: string;
}

export const SHORT_ID_RE = /^[A-Za-z0-9]{8,16}$/;
const KEY = (id: string) => `share:${id}`;

function config(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

export const shortLinksEnabled = () => config() !== null;

/** One Redis command over REST; returns its `result`. */
async function redis(command: (string | number)[]): Promise<unknown> {
  const c = config();
  if (!c) throw new Error('Short links are not configured');
  const res = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!res.ok || !body || body.error) throw new Error(body?.error ?? `Redis HTTP ${res.status}`);
  return body.result;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Id derived from the content: the same map always gets the same link, and storage does not grow on re-shares. */
function contentId(payload: string, length: number): string {
  const bytes = createHash('sha256').update(payload).digest();
  let id = '';
  for (let i = 0; i < length; i++) id += BASE62[bytes[i] % 62];
  return id;
}

/** Stores the map and returns its id (8 characters, longer only on a hash collision). */
export async function saveShortLink(rec: ShortLinkRecord): Promise<string> {
  const value = JSON.stringify(rec);
  for (const length of [8, 10, 12, 16]) {
    const id = contentId(rec.p, length);
    if ((await redis(['SET', KEY(id), value, 'NX'])) === 'OK') return id;
    const existing = await loadShortLink(id);
    if (existing?.p === rec.p) {
      // Same map shared again: keep the id, refresh the title if it changed.
      if (existing.t !== rec.t) await redis(['SET', KEY(id), value]);
      return id;
    }
  }
  throw new Error('Could not allocate a short link id');
}

export async function loadShortLink(id: string): Promise<ShortLinkRecord | null> {
  if (!SHORT_ID_RE.test(id) || !shortLinksEnabled()) return null;
  try {
    const raw = await redis(['GET', KEY(id)]);
    if (typeof raw !== 'string') return null;
    const rec = JSON.parse(raw) as Partial<ShortLinkRecord>;
    return typeof rec.p === 'string' && typeof rec.t === 'string' ? { p: rec.p, t: rec.t } : null;
  } catch {
    return null;
  }
}

/** Fixed-window limit per client: at most `max` new links per minute. */
export async function underRateLimit(client: string, max = 20): Promise<boolean> {
  const key = `rl:share:${client}:${Math.floor(Date.now() / 60_000)}`;
  const n = Number(await redis(['INCR', key]));
  if (n === 1) await redis(['EXPIRE', key, 120]);
  return n <= max;
}
