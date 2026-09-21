import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { samePublicOrigin } from '@/lib/request-origin';
import {
  dashboardViewCount,
  normalizeViewSessionId,
  registerDashboardView,
} from '@/lib/view-counter';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function database() {
  if (!env.DB) throw new Error('Database unavailable');
  return env.DB;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in required' }, 401);

  try {
    return json({ count: await dashboardViewCount(database()) });
  } catch {
    return json({ error: 'View counter unavailable' }, 503);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!samePublicOrigin(request)) return json({ error: 'Forbidden' }, 403);

  let body: { sessionId?: unknown };
  try {
    body = (await request.json()) as { sessionId?: unknown };
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const sessionId = normalizeViewSessionId(body.sessionId);
  if (!sessionId) return json({ error: 'Invalid view session id' }, 400);

  try {
    const count = await registerDashboardView(database(), sessionId);
    return json({ count });
  } catch {
    return json({ error: 'View counter unavailable' }, 503);
  }
}
