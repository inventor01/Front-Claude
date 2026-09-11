import { getChatGPTUser } from '@/app/chatgpt-auth';
import { saveEvidence, type Evidence } from '@/lib/narratives';
import { env } from 'cloudflare:workers';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const db = () => {
  if (!env.DB) throw new Error('Database unavailable');
  return env.DB;
};

function asMetric(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function asTimestamp(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function safeUrl(platform: 'X' | 'TikTok', raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const allowed = platform === 'X'
    ? new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'])
    : new Set(['tiktok.com', 'www.tiktok.com', 'ads.tiktok.com']);
  if (!allowed.has(host)) return null;
  url.hash = '';
  return url.toString();
}

function evidenceFrom(value: unknown): Evidence | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const platform = row.platform === 'X' || row.platform === 'TikTok' ? row.platform : null;
  if (!platform) return null;
  const url = safeUrl(platform, row.url);
  const content = typeof row.content === 'string' ? row.content.replace(/\s+/g, ' ').trim().slice(0, 8000) : '';
  const author = typeof row.author === 'string' ? row.author.trim().slice(0, 120) : '';
  const id = typeof row.id === 'string' ? row.id.trim().slice(0, 180) : '';
  if (!url || !content || !author || !id) return null;
  const provenanceRaw = typeof row.provenance === 'string' ? row.provenance.trim() : '';
  return {
    id,
    platform,
    author,
    url,
    content,
    published: asTimestamp(row.published),
    views: asMetric(row.views),
    likes: asMetric(row.likes),
    provenance: (provenanceRaw || `${platform} local browser bridge`).slice(0, 300),
  };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Please sign in to save browser evidence.' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);
  try {
    const body = await request.json() as { evidence?: unknown[] };
    if (!Array.isArray(body.evidence)) return json({ error: 'Evidence must be an array.' }, 400);
    if (body.evidence.length > 250) return json({ error: 'A browser batch is limited to 250 evidence records.' }, 400);
    const accepted = body.evidence.map(evidenceFrom).filter((row): row is Evidence => Boolean(row));
    if (!accepted.length && body.evidence.length) return json({ error: 'No valid X or TikTok evidence records were supplied.' }, 400);
    const at = Date.now();
    for (const row of accepted) await saveEvidence(db(), user.userId, row, at);
    return json({ ok: true, accepted: accepted.length, rejected: body.evidence.length - accepted.length, at });
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'Invalid request.' : (error as Error).message }, 500);
  }
}
