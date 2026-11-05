// Password gate of the two work tools (/kiem-tra, /boc-tach): one shared password, remembered per device.
// Entering it once sets a signed, HttpOnly cookie; a device without a valid cookie is asked every time.
// Server-only (used by proxy.ts and /api/unlock). Pure Web Crypto, so it runs in Node and Edge alike.
//
//   ACCESS_PASSWORD  the shared password. Not set → the gate is OFF (local dev, deployments not configured yet).
//   ACCESS_SECRET    optional extra key material. The cookie is signed with password + secret, so changing either one
//                    signs every device out at once.

export const ACCESS_COOKIE = 'ledat_acc';
/** "Ghi nhớ máy này": the cookie (and the token inside) lives this long. */
export const REMEMBER_SECONDS = 180 * 24 * 3600;
/** Not remembered: a session cookie, and the token itself is only good for a day. */
export const SESSION_SECONDS = 24 * 3600;

export const gateEnabled = (): boolean => !!process.env.ACCESS_PASSWORD;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(message: string, secret = signingKey()): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function signingKey(): string {
  return `${process.env.ACCESS_PASSWORD ?? ''}\u0000${process.env.ACCESS_SECRET ?? ''}`;
}

/** Equal strings without leaking where they differ (both are hashed to the same length first). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sign(a, 'cmp'), sign(b, 'cmp')]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function passwordOk(candidate: string): Promise<boolean> {
  const real = process.env.ACCESS_PASSWORD;
  return !!real && candidate.length > 0 && candidate.length <= 256 && (await safeEqual(candidate, real));
}

/** `<expires at, ms>.<signature>` — the cookie value. */
export async function makeToken(remember: boolean, now = Date.now()): Promise<{ value: string; maxAge: number | undefined }> {
  const seconds = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
  const exp = now + seconds * 1000;
  return { value: `${exp}.${await sign(String(exp))}`, maxAge: remember ? seconds : undefined };
}

export async function tokenOk(value: string | undefined, now = Date.now()): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(value.slice(0, dot));
  if (!Number.isFinite(exp) || exp < now) return false;
  return safeEqual(value.slice(dot + 1), await sign(String(exp)));
}

/** Where to go after unlocking: a path of this site only (no `//host`, no scheme), never the unlock page itself. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\r\n]/.test(raw)) return '/';
  return raw.startsWith('/khoa') ? '/' : raw;
}
