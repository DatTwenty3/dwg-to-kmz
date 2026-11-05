// POST /api/unlock { password, remember } → sets the access cookie when the password is right (see lib/server/accessGate.ts).
import { ACCESS_COOKIE, gateEnabled, makeToken, passwordOk } from '@/lib/server/accessGate';
import { underAttemptLimit } from '@/lib/server/shortLinks';

export async function POST(req: Request) {
  if (!gateEnabled()) return Response.json({ ok: true });

  const body = (await req.json().catch(() => null)) as { password?: unknown; remember?: unknown } | null;
  const client = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await underAttemptLimit(client))) return Response.json({ error: 'rate-limited' }, { status: 429 });

  if (typeof body?.password !== 'string' || !(await passwordOk(body.password))) {
    await new Promise((r) => setTimeout(r, 600)); // slows down guessing
    return Response.json({ error: 'wrong-password' }, { status: 401 });
  }

  const { value, maxAge } = await makeToken(body.remember !== false);
  const cookie = [
    `${ACCESS_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
    ...(maxAge ? [`Max-Age=${maxAge}`] : []),
  ].join('; ');
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
}

// DELETE /api/unlock → forgets this device (the next use asks for the password again).
export async function DELETE() {
  const cookie = [`${ACCESS_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(process.env.NODE_ENV === 'production' ? ['Secure'] : [])].join('; ');
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
}
