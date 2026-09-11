import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { publicSignals } from '@/lib/providers';

const db = () => { if (!env.DB) throw new Error('Database unavailable'); return env.DB; };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const UI_NOISE = /^(show|show more|more|see more|view|view more|read more|explore|home|for you|trending|trend|news|sports|entertainment|posts?|replies?|likes?|views?|share|bookmark|follow|following)$/i;
const SOURCE_ORDER = ['x-trending','tiktok-trending','tiktok-explore','x-feed','x-search','tiktok-search','google-trends','market-theme','x-browser','tiktok-browser'];

type BrowserRow = {
  id:string; platform:string; author:string; url:string; content:string; published:number|null;
  first_seen:number; last_seen:number; provenance:string; views:number|null; likes:number|null;
};
type LinkRow = { evidence:string; narrative:string; title:string };
type PublicItem = {
  id:string; source:string; sourceKey:string; title:string; query:string; url:string; observed:number;
  published:number|null; views:number|null; likes:number|null; status:'Raw signal'|'Promoted';
  narrative?:{id:string;title:string}|null; detail:string;
};

function sourceFor(row: BrowserRow) {
  const p = row.provenance;
  if (/X Explore/i.test(p)) return { source: 'X Trending', key: 'x-trending' };
  if (/X Home/i.test(p)) return { source: 'X Feed', key: 'x-feed' };
  if (/X Latest search/i.test(p)) return { source: 'X Search', key: 'x-search' };
  if (/TikTok Creative Center/i.test(p)) return { source: 'TikTok Trending', key: 'tiktok-trending' };
  if (/TikTok Explore/i.test(p)) return { source: 'TikTok Explore', key: 'tiktok-explore' };
  if (/TikTok search/i.test(p)) return { source: 'TikTok Search', key: 'tiktok-search' };
  return row.platform === 'X' ? { source: 'X Browser', key: 'x-browser' } : { source: 'TikTok Browser', key: 'tiktok-browser' };
}

function cleanCandidate(value: string) {
  return value.replace(/^#/, '').replace(/^[-·•\s]+|[-·•\s]+$/g, '').replace(/\s+/g, ' ').trim();
}

function titleFor(row: BrowserRow) {
  const content = row.content.trim();
  const chunks = content.split(/\s+·\s+|\n+/).map(cleanCandidate).filter(Boolean);
  const meaningful = chunks.find((part) => !UI_NOISE.test(part) && !/^trending in\b/i.test(part) && !/^[\d,.]+\s*(?:posts?|views?|likes?)$/i.test(part));
  const candidate = meaningful || cleanCandidate(content);
  if (UI_NOISE.test(candidate) || candidate.length < 2) return '';
  return candidate.slice(0, 180);
}

function signalQuality(item: PublicItem) {
  const title = item.title.trim();
  if (!title || UI_NOISE.test(title)) return false;
  const normalized = normalize(title);
  if (!normalized || normalized.length < 2) return false;
  if (/^(show|more|view|explore|home|trending)$/.test(normalized)) return false;
  return true;
}

function dedupe(items: PublicItem[]) {
  const out = new Map<string, PublicItem>();
  for (const item of items) {
    if (!signalQuality(item)) continue;
    const key = `${item.sourceKey}:${normalize(item.title) || item.id}`;
    const old = out.get(key);
    if (!old || item.observed > old.observed || item.status === 'Promoted') out.set(key, item);
  }
  return [...out.values()];
}

function balanced(items: PublicItem[]) {
  const buckets = new Map<string, PublicItem[]>();
  for (const item of items) {
    const list = buckets.get(item.sourceKey) ?? [];
    list.push(item);
    buckets.set(item.sourceKey, list);
  }
  for (const list of buckets.values()) list.sort((a,b) => (b.status === 'Promoted' ? 1 : 0) - (a.status === 'Promoted' ? 1 : 0) || b.observed - a.observed);
  const orderedKeys = [...SOURCE_ORDER.filter((key) => buckets.has(key)), ...[...buckets.keys()].filter((key) => !SOURCE_ORDER.includes(key))];
  const result: PublicItem[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const key of orderedKeys) {
      const item = buckets.get(key)?.shift();
      if (!item) continue;
      result.push(item);
      added = true;
    }
  }
  return result;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: 'Please sign in to view public signals.' }, 401);
  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.max(10, Math.min(100, Math.trunc(Number(params.get('limit')) || 50)));
    const offset = Math.max(0, Math.min(10000, Math.trunc(Number(params.get('offset')) || 0)));
    const source = (params.get('source') || 'all').trim().toLowerCase();
    const q = normalize(params.get('q') || '');
    const now = Date.now();

    const browser = await db().prepare(`SELECT e.id,e.platform,e.author,e.url,e.content,e.published,e.first_seen,e.last_seen,e.provenance,
      (SELECT o.views FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS views,
      (SELECT o.likes FROM observations o WHERE o.owner=e.owner AND o.id=e.id ORDER BY o.observed DESC LIMIT 1) AS likes
      FROM evidence e WHERE e.owner=? AND e.last_seen>? ORDER BY e.last_seen DESC LIMIT 4000`).bind(user.userId, now - 14 * 86400000).all<BrowserRow>();
    const links = await db().prepare(`SELECT l.evidence,l.narrative,n.title FROM evidence_links l JOIN narratives n ON n.owner=l.owner AND n.id=l.narrative WHERE l.owner=? ORDER BY n.created DESC LIMIT 8000`).bind(user.userId).all<LinkRow>();
    const linkByEvidence = new Map<string, LinkRow>();
    for (const row of links.results) if (!linkByEvidence.has(row.evidence)) linkByEvidence.set(row.evidence, row);

    const browserItems: PublicItem[] = browser.results.flatMap((row) => {
      const meta = sourceFor(row); const linked = linkByEvidence.get(row.id); const title = titleFor(row);
      if (!title) return [];
      return [{
        id: `browser:${row.id}`, source: meta.source, sourceKey: meta.key, title, query: title, url: row.url,
        observed: row.last_seen, published: row.published, views: row.views, likes: row.likes,
        status: linked ? 'Promoted' : 'Raw signal', narrative: linked ? { id: linked.narrative, title: linked.title } : null,
        detail: linked ? `Promoted to ${linked.title}` : `${row.author} · observed from ${meta.source}`,
      }];
    });

    let external: Awaited<ReturnType<typeof publicSignals>> = { signals: [], coverage: [], at: now };
    try { external = await publicSignals(); } catch { /* browser signals still work when public providers fail */ }
    const externalItems: PublicItem[] = external.signals.map((signal) => ({
      id: `external:${signal.id}`, source: signal.source, sourceKey: signal.source === 'Google Trends' ? 'google-trends' : 'market-theme',
      title: signal.title, query: signal.query, url: signal.url, observed: external.at, published: null, views: null, likes: null,
      status: 'Raw signal', narrative: null, detail: signal.detail,
    }));

    const allItems = dedupe([...browserItems, ...externalItems]);
    const counts: Record<string, number> = { all: allItems.length };
    for (const item of allItems) counts[item.sourceKey] = (counts[item.sourceKey] || 0) + 1;

    let items = source === 'all' ? balanced(allItems) : allItems.filter((item) => item.sourceKey === source).sort((a,b) => b.observed - a.observed);
    if (q) items = items.filter((item) => normalize(`${item.title} ${item.detail} ${item.narrative?.title || ''}`).includes(q));
    const total = items.length;
    return json({
      items: items.slice(offset, offset + limit),
      page: { limit, offset, total, hasMore: offset + limit < total, nextOffset: offset + limit < total ? offset + limit : null },
      counts,
      coverage: external.coverage,
      at: now,
      note: 'Public Signals balances X/TikTok trend, feed, search and public-provider sources instead of letting one source crowd out the others. Low-value UI labels are discarded.',
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}
