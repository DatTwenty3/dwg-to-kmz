// Password gate of the work tools: signed per-device cookie, password check, redirect target.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REMEMBER_SECONDS, SESSION_SECONDS, gateEnabled, makeToken, passwordOk, safeNext, tokenOk } from '@/lib/server/accessGate';

const env = process.env as Record<string, string | undefined>;
const saved = { p: env.ACCESS_PASSWORD, s: env.ACCESS_SECRET };
beforeEach(() => {
  env.ACCESS_PASSWORD = 'mat-khau-thu';
  delete env.ACCESS_SECRET;
});
afterEach(() => {
  env.ACCESS_PASSWORD = saved.p;
  env.ACCESS_SECRET = saved.s;
  if (saved.p === undefined) delete env.ACCESS_PASSWORD;
  if (saved.s === undefined) delete env.ACCESS_SECRET;
});

describe('gate', () => {
  it('is off without ACCESS_PASSWORD', () => {
    expect(gateEnabled()).toBe(true);
    delete env.ACCESS_PASSWORD;
    expect(gateEnabled()).toBe(false);
  });

  it('accepts only the right password', async () => {
    expect(await passwordOk('mat-khau-thu')).toBe(true);
    expect(await passwordOk('mat-khau-sai')).toBe(false);
    expect(await passwordOk('')).toBe(false);
    expect(await passwordOk('x'.repeat(300))).toBe(false);
  });

  it('a device that entered the password carries a cookie that stays valid; a remembered one lasts months', async () => {
    const now = 1_800_000_000_000;
    const kept = await makeToken(true, now);
    expect(kept.maxAge).toBe(REMEMBER_SECONDS);
    expect(await tokenOk(kept.value, now + 1000)).toBe(true);
    expect(await tokenOk(kept.value, now + (REMEMBER_SECONDS - 60) * 1000)).toBe(true);
    expect(await tokenOk(kept.value, now + (REMEMBER_SECONDS + 60) * 1000)).toBe(false);
    // not remembered: a session cookie, good for a day
    const session = await makeToken(false, now);
    expect(session.maxAge).toBeUndefined();
    expect(await tokenOk(session.value, now + (SESSION_SECONDS - 60) * 1000)).toBe(true);
    expect(await tokenOk(session.value, now + (SESSION_SECONDS + 60) * 1000)).toBe(false);
  });

  it('refuses a missing, malformed or tampered cookie', async () => {
    const now = Date.now();
    const { value } = await makeToken(true, now);
    const [exp, sig] = value.split('.');
    expect(await tokenOk(undefined)).toBe(false);
    expect(await tokenOk('')).toBe(false);
    expect(await tokenOk('abc')).toBe(false);
    expect(await tokenOk(`${Number(exp) + 86_400_000}.${sig}`)).toBe(false); // longer life, same signature
    expect(await tokenOk(`${exp}.${sig.slice(0, -2)}xx`)).toBe(false);
    expect(await tokenOk(`${exp}.`)).toBe(false);
  });

  it('changing the password (or the secret) signs every device out', async () => {
    const { value } = await makeToken(true);
    expect(await tokenOk(value)).toBe(true);
    env.ACCESS_PASSWORD = 'mat-khau-moi';
    expect(await tokenOk(value)).toBe(false);
    env.ACCESS_PASSWORD = 'mat-khau-thu';
    expect(await tokenOk(value)).toBe(true);
    env.ACCESS_SECRET = 'doi-khoa';
    expect(await tokenOk(value)).toBe(false);
  });
});

describe('safeNext', () => {
  it('keeps paths of this site and drops everything else', () => {
    expect(safeNext('/boc-tach')).toBe('/boc-tach');
    expect(safeNext('/kiem-tra?x=1')).toBe('/kiem-tra?x=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'boc-tach', '', undefined, null, 42, '/a\r\nSet-Cookie: x=1']) expect(safeNext(bad)).toBe('/');
    expect(safeNext('/khoa?next=/khoa')).toBe('/');
  });
});
