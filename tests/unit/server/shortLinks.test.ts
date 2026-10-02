import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShortLink, saveShortLink, shortLinksEnabled, underRateLimit } from '@/lib/server/shortLinks';

/** In-memory stand-in for the Upstash REST endpoint. */
function fakeUpstash() {
  const db = new Map<string, string>();
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const [cmd, key, ...args] = JSON.parse(String(init.body)) as string[];
    let result: unknown = null;
    if (cmd === 'SET') {
      if (args.includes('NX') && db.has(key)) result = null;
      else {
        db.set(key, args[0]);
        result = 'OK';
      }
    } else if (cmd === 'GET') result = db.get(key) ?? null;
    else if (cmd === 'INCR') {
      db.set(key, String(Number(db.get(key) ?? 0) + 1));
      result = Number(db.get(key));
    } else if (cmd === 'EXPIRE') result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
  return { db, fetchMock };
}

describe('short share links', () => {
  let fake: ReturnType<typeof fakeUpstash>;
  beforeEach(() => {
    vi.stubEnv('KV_REST_API_URL', 'https://example.upstash.io/');
    vi.stubEnv('KV_REST_API_TOKEN', 'token');
    fake = fakeUpstash();
    vi.stubGlobal('fetch', fake.fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is off without credentials', () => {
    vi.stubEnv('KV_REST_API_URL', '');
    expect(shortLinksEnabled()).toBe(false);
  });

  it('stores a map under an 8-character id and reads it back', async () => {
    const id = await saveShortLink({ p: 'abc', t: 'Tuyến ống' });
    expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(await loadShortLink(id)).toEqual({ p: 'abc', t: 'Tuyến ống' });
    expect(fake.fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('gives the same map the same id (no duplicates), updating the title', async () => {
    const a = await saveShortLink({ p: 'same', t: 'Cũ' });
    const b = await saveShortLink({ p: 'same', t: 'Mới' });
    expect(b).toBe(a);
    expect(fake.db.size).toBe(1);
    expect((await loadShortLink(a))?.t).toBe('Mới');
  });

  it('takes a longer id when the short one is held by another map', async () => {
    const id = await saveShortLink({ p: 'one', t: '' });
    fake.db.set(`share:${id}`, JSON.stringify({ p: 'other', t: '' })); // simulate a hash collision
    const again = await saveShortLink({ p: 'one', t: '' });
    expect(again).toHaveLength(10);
  });

  it('rejects malformed ids without asking the store', async () => {
    expect(await loadShortLink('../../etc')).toBeNull();
    expect(fake.fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits per client per minute', async () => {
    for (let i = 0; i < 3; i++) expect(await underRateLimit('1.2.3.4', 3)).toBe(true);
    expect(await underRateLimit('1.2.3.4', 3)).toBe(false);
    expect(await underRateLimit('5.6.7.8', 3)).toBe(true);
  });
});
