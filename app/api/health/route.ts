import { env } from 'cloudflare:workers';

export async function GET() {
  try {
    if (!env.DB) return Response.json({ ok: false, database: false }, { status: 503 });
    await env.DB.prepare('SELECT 1 AS ok').first();
    return Response.json({ ok: true, database: true, service: 'front' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, database: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
