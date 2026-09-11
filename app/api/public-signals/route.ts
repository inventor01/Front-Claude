import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { publicSignals } from '@/lib/providers';

const db = () => { if (!env.DB) throw new Error('Database unavailable'); return env.DB; };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const UI_NOISE = /^(show|show more|more|see more|view|view more|read more|explore|home|for you|trending|trend|news|sports|entertainment|posts?|replies?|likes?|views?|share|bookmark|follow|following)$/i;
const GENERIC = new Set('meme memes viral virality reaction reactions clip clips trend trends trending story stories update updates breaking news funny internet tiktok twitter tweet tweets social media creator creators fyp foryou foryoupage'.split(' '));
const BROAD = new Set('crypto cryptocurrency bitcoin btc ethereum eth solana market markets stocks stock politics political election elections sports football basketball baseball soccer music entertainment technology tech ai artificial intelligence gaming games celebrity celebrities world national local economy economic finance financial'.split(' '));
const STOP = new Set('the a an and or but this that these those to of in on at for from with is are was were be been it its i you your we our they their he she his her not no just very really new now today tonight yesterday tomorrow have has had do does did can could would should will may might about into over under after before more most some any all one two via amp rt https http com www video watch post posts people thing things time day get got like know think make made going go went see saw says said say look looks looking why how what when where who which there here'.split(' '));
const SOURCE_ORDER = ['early-candidate','x-trending','tiktok-trending','tiktok-explore','x-feed','x-search','tiktok-search','google-trends','market-theme','x-browser','tiktok-browser'];

type BrowserRow = {
  id:string; platform:string; author:string; url:string; content:string; published:number|null;
  first_seen:number; last_seen:number; provenance:string; views:number|null; likes:number|null;
};
type LinkRow = { evidence:string; narrative:string; title:string };
type PublicStatus = 'Raw signal'|'Early candidate'|'Promoted';
type PublicItem = {
  id:string; source:string; sourceKey:string; title:string; query:string; url:string; observed:number;
  published:number|null; views:number|null; likes:number|null; status:PublicStatus;
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
  const rank:Record<PublicStatus,number> = {'Raw signal':0,'Early candidate':1,'Promoted':2};
  for (const item of items) {
    if (!signalQuality(item)) continue;
    const key = `${item.sourceKey}:${normalize(item.title) || item.id}`;
    const old = out.get(key);
    if (!old || rank[item.status] > rank[old.status] || item.observed > old.observed) out.set(key, item);
  }
  return [...out.values()];
}

function balanced(items: PublicItem[]) {
  const buckets = new Map<string, PublicItem[]>();
  const statusRank:Record<PublicStatus,number> = {'Promoted':3,'Early candidate':2,'Raw signal':1};
  for (const item of items) {
    const list = buckets.get(item.sourceKey) ?? [];
    list.push(item);
    buckets.set(item.sourceKey, list);
  }
  for (const list of buckets.values()) list.sort((a,b) => statusRank[b.status] - statusRank[a.status] || b.observed - a.observed);
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

function candidateTokens(value:string) {
  return normalize(value).split(' ').filter((token) => token.length >= 3 && !STOP.has(token) && !GENERIC.has(token) && !/^\d+$/.test(token));
}

function candidateLabels(row:BrowserRow) {
  const out = new Map<string,string>();
  const add = (raw:string) => {
    const label = cleanCandidate(raw).slice(0,80); const key = normalize(label); const tokens = candidateTokens(label);
    if (!key || key.length < 3 || UI_NOISE.test(label) || !tokens.length) return;
    if (tokens.every((token) => BROAD.has(token) || GENERIC.has(token))) return;
    if (!out.has(key)) out.set(key,label);
  };
  for (const match of row.content.matchAll(/#([\p{L}\p{N}_]{3,80})/gu)) add(match[1].replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/_/g,' '));
  for (const match of row.content.matchAll(/\b[A-Z][\p{L}\p{N}'’_-]{2,30}(?:\s+[A-Z][\p{L}\p{N}'’_-]{2,30}){0,2}\b/gu)) add(match[0]);
  const title = titleFor(row); if (title && title.split(/\s+/).length <= 5) add(title);
  return [...out.entries()].map(([key,label])=>({key,label}));
}

function buildEarlyCandidates(rows:BrowserRow[], linked:Set<string>, now:number):PublicItem[] {
  const groups = new Map<string,{labels:Map<string,number>;rows:BrowserRow[];authors:Set<string>;platforms:Set<string>}>();
  for (const row of rows) {
    if (linked.has(row.id) || row.last_seen < now - 36*3600000) continue;
    for (const {key,label} of candidateLabels(row)) {
      const group = groups.get(key) ?? {labels:new Map(),rows:[],authors:new Set(),platforms:new Set()};
      if (!group.rows.some((item)=>item.id===row.id)) group.rows.push(row);
      group.authors.add(`${row.platform}:${row.author.toLowerCase()}`); group.platforms.add(row.platform);
      group.labels.set(label,(group.labels.get(label)||0)+1); groups.set(key,group);
    }
  }
  return [...groups.entries()].flatMap(([key,group]) => {
    const top = [...group.rows].sort((a,b)=>((b.views||0)+(b.likes||0)*4)-((a.views||0)+(a.likes||0)*4)||b.last_seen-a.last_seen)[0];
    const hotSingle = group.rows.length===1 && ((top.views||0)>=100000 || (top.likes||0)>=5000);
    if (group.authors.size < 2 && !hotSingle) return [];
    const title = [...group.labels.entries()].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length)[0]?.[0] || key;
    const latest = Math.max(...group.rows.map((row)=>row.last_seen));
    const published = group.rows.map((row)=>row.published).filter((value):value is number=>typeof value==='number'&&value>0);
    return [{
      id:`candidate:${key}`, source:'Early Candidate', sourceKey:'early-candidate', title, query:title, url:top.url, observed:latest,
      published:published.length?Math.min(...published):null, views:top.views, likes:top.likes, status:'Early candidate' as const, narrative:null,
      detail:`${group.authors.size} creator${group.authors.size===1?'':'s'} · ${[...group.platforms].join(' + ')} · ${group.rows.length} supporting item${group.rows.length===1?'':'s'} · unconfirmed`,
    }];
  }).sort((a,b)=>b.observed-a.observed).slice(0,40);
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
    const earlyCandidates = buildEarlyCandidates(browser.results,new Set(linkByEvidence.keys()),now);

    let external: Awaited<ReturnType<typeof publicSignals>> = { signals: [], coverage: [], at: now };
    try { external = await publicSignals(); } catch { /* browser signals still work when public providers fail */ }
    const externalItems: PublicItem[] = external.signals.map((signal) => ({
      id: `external:${signal.id}`, source: signal.source, sourceKey: signal.source === 'Google Trends' ? 'google-trends' : 'market-theme',
      title: signal.title, query: signal.query, url: signal.url, observed: external.at, published: null, views: null, likes: null,
      status: 'Raw signal', narrative: null, detail: signal.detail,
    }));

    const allItems = dedupe([...earlyCandidates,...browserItems, ...externalItems]);
    const counts: Record<string, number> = { all: allItems.length };
    for (const item of allItems) counts[item.sourceKey] = (counts[item.sourceKey] || 0) + 1;
    const sourceCounts:Record<string,number>={};
    for(const row of browser.results){const key=sourceFor(row).key;sourceCounts[key]=(sourceCounts[key]||0)+1;}

    let items = source === 'all' ? balanced(allItems) : allItems.filter((item) => item.sourceKey === source).sort((a,b) => b.observed - a.observed);
    if (q) items = items.filter((item) => normalize(`${item.title} ${item.detail} ${item.narrative?.title || ''}`).includes(q));
    const total = items.length;
    const uniqueAuthors = new Set(browser.results.map((row)=>`${row.platform}:${row.author.toLowerCase()}`)).size;
    const latestBrowserSeen = browser.results[0]?.last_seen ?? null;
    const diagnosis = browser.results.length===0
      ? 'No synced browser evidence is stored yet. Run a fresh Browser Sources scan, or use Sync background finds if the local bridge has pending evidence.'
      : allItems.length===0
        ? 'Browser evidence exists, but none survived signal-quality parsing. This should be investigated as an extractor regression.'
        : null;
    return json({
      items: items.slice(offset, offset + limit),
      page: { limit, offset, total, hasMore: offset + limit < total, nextOffset: offset + limit < total ? offset + limit : null },
      counts,
      coverage: external.coverage,
      diagnostics:{browserEvidence:browser.results.length,uniqueAuthors,earlyCandidates:earlyCandidates.length,sourceCounts,latestBrowserSeen,externalSignals:externalItems.length,diagnosis},
      at: now,
      note: 'Public Signals is the high-recall layer. Early Candidate means repeated or unusually high-engagement evidence that is worth watching but has not passed Narrative Radar corroboration yet.',
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}
