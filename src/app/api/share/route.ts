// POST /api/share { payload, title } → { id, url }: stores a shared map and returns its short link.
import { cleanShareTitle, decodeSharedMap } from '@/lib/cad/share';
import { saveShortLink, shortLinksEnabled, underRateLimit } from '@/lib/server/shortLinks';

/** Largest stored map (base64url chars). Long links are rarely above ~50 k; this leaves room for big drawings. */
const MAX_PAYLOAD = 400_000;

export async function POST(req: Request) {
  if (!shortLinksEnabled()) return Response.json({ error: 'not-configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { payload?: unknown; title?: unknown } | null;
  const payload = body?.payload;
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > MAX_PAYLOAD) {
    return Response.json({ error: 'bad-payload' }, { status: 400 });
  }
  // Only real shared maps are stored (the decoder validates and sanitises everything).
  const map = await decodeSharedMap(payload);
  if (!map) return Response.json({ error: 'bad-payload' }, { status: 400 });

  const client = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  try {
    if (!(await underRateLimit(client))) return Response.json({ error: 'rate-limited' }, { status: 429 });
    const id = await saveShortLink({ p: payload, t: cleanShareTitle(map.title) ?? '' });
    return Response.json({ id, url: new URL(`/s/${id}`, req.url).toString() });
  } catch {
    return Response.json({ error: 'storage' }, { status: 502 });
  }
}
