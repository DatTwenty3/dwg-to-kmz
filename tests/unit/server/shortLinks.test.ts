import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShortLink, saveShortLink, SHORT_LINK_IDLE_TTL_S, shortLinksEnabled, underRateLimit } from '@/lib/server/shortLinks';

/** In-memory stand-in for the Upstash REST endpoint. */
function fakeUpstash() {
  const db = new Map<string, string>();
  const ttl = new Map<string, number>();
  const exOf = (args: (string | number)[]) => {
    const i = args.indexOf('EX');
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const [cmd, key, ...args] = JSON.parse(String(init.body)) as [string, string, ...(string | number)[]];
    let result: unknown = null;
    if (cmd === 'SET') {
      if (args.includes('NX') && db.has(key)) result = null;
      else {
        db.set(key, String(args[0]));
        const ex = exOf(args);
        if (ex) ttl.set(key, ex);
        else ttl.delete(key);
        result = 'OK';
      }
    } else if (cmd === 'GETEX') {
      result = db.get(key) ?? null;
      const ex = exOf(args);
      if (result !== null && ex) ttl.set(key, ex);
    } else if (cmd === 'GET') result = db.get(key) ?? null;
    else if (cmd === 'INCR') {
      db.set(key, String(Number(db.get(key) ?? 0) + 1));
      result = Number(db.get(key));
    } else if (cmd === 'EXPIRE') result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
  return { db, ttl, fetchMock };
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

  it('accepts a custom prefix chosen when connecting the store', () => {
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('STORAGE_REST_API_URL', 'https://x.upstash.io');
    vi.stubEnv('STORAGE_REST_API_TOKEN', 't');
    expect(shortLinksEnabled()).toBe(true);
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

  it('expires links after a week without opens; each open restarts the countdown', async () => {
    expect(SHORT_LINK_IDLE_TTL_S).toBe(7 * 24 * 3600);
    const id = await saveShortLink({ p: 'ttl', t: '' });
    expect(fake.ttl.get(`share:${id}`)).toBe(SHORT_LINK_IDLE_TTL_S);
    fake.ttl.set(`share:${id}`, 10); // almost expired
    await loadShortLink(id);
    expect(fake.ttl.get(`share:${id}`)).toBe(SHORT_LINK_IDLE_TTL_S);
    // A title change keeps the expiry too.
    await saveShortLink({ p: 'ttl', t: 'Tên mới' });
    expect(fake.ttl.get(`share:${id}`)).toBe(SHORT_LINK_IDLE_TTL_S);
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
