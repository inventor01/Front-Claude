import { batches, type Signal } from './domain';
import { fetchJson, searchCoins } from './providers';
import { tiktokOembedSchema, xPageSchema, parseProvider } from './schemas';

/** X public_metrics are numbers; anything else is unknown, never coerced. */
const metric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;

export type Evidence = {
  id: string;
  platform: 'X' | 'TikTok';
  author: string;
  url: string;
  content: string;
  published: number | null;
  views: number | null;
  likes: number | null;
  provenance: string;
};

export type NarrativeFeedOptions = {
  limit?: number;
  offset?: number;
  query?: string;
  includeArchived?: boolean;
  includeDuplicates?: boolean;
};

const GENERIC = new Set('meme memes viral virality reaction reactions clip clips trend trends trending story stories update updates breaking news funny internet tiktok twitter tweet tweets social media creator creators fyp foryou foryoupage'.split(' '));
const BROAD = new Set('crypto cryptocurrency bitcoin btc ethereum eth solana market markets stocks stock politics political election elections sports football basketball baseball soccer music entertainment technology tech ai artificial intelligence gaming games celebrity celebrities world national local economy economic finance financial'.split(' '));

function splitCamel(value: string) {
  return value.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

const normalize = (s: string) => splitCamel(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const terms = (s: string) => normalize(s).split(' ').filter(Boolean);

export function phraseMatch(text: string, phrase: string) {
  return (' ' + normalize(text) + ' ').includes(' ' + normalize(phrase) + ' ');
}

export function isBroadNarrativeTitle(title: string) {
  const tokens = terms(title);
  if (!tokens.length) return true;
  return tokens.every((token) => GENERIC.has(token) || BROAD.has(token) || /^\d+$/.test(token));
}

export function narrativeTitleSimilarity(a: string, b: string) {
  const left = new Set(terms(a).filter((token) => !GENERIC.has(token)));
  const right = new Set(terms(b).filter((token) => !GENERIC.has(token)));
  if (!left.size || !right.size) return 0;
  const an = normalize(a), bn = normalize(b);
  if (an === bn) return 1;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export function lifecycleStage(lastSeen: number, recent15: number, recentHour: number, previous45: number, now = Date.now()) {
  const age = Math.max(0, now - lastSeen);
  if (age > 48 * 3600000) return 'Archived';
  if (age > 6 * 3600000) return 'Cooling';
  if (recent15 >= 2 && recent15 >= Math.max(1, previous45)) return 'Accelerating';
  if (recentHour >= 3) return 'Spreading';
  if (recentHour >= 2) return 'Early watch';
  return 'Observed';
}

export function tiktokUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !['www.tiktok.com', 'tiktok.com'].includes(u.hostname) || u.username || u.password || u.port || !/^\/@[a-zA-Z0-9_.]+\/video\/\d{10,25}$/.test(u.pathname)) {
    throw Error('Use the full https://www.tiktok.com/@creator/video/… link. Short links and other hosts are not accepted.');
  }
  return 'https://www.tiktok.com' + u.pathname;
}

function safeAliases(raw: string) {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 24) : [];
  } catch {
    return [];
  }
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < statements.length; i += size) await db.batch(statements.slice(i, i + size));
}

/**
 * Save raw evidence and link it only to narratives that already exist.
 * Automatic narrative creation intentionally does NOT happen here. The browser
 * inference/corroboration pipeline is the single automatic promotion gate.
 */
export async function saveEvidence(db: D1Database, owner: string, e: Evidence, at = Date.now()) {
  await db.batch([
    db.prepare('INSERT INTO evidence(owner,id,platform,author,url,content,published,first_seen,last_seen,provenance) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET content=excluded.content,last_seen=excluded.last_seen').bind(owner, e.id, e.platform, e.author, e.url, e.content, e.published, at, at, e.provenance),
    db.prepare('INSERT INTO observations(owner,id,observed,views,likes) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(owner, e.id, at, e.views, e.likes),
  ]);
  const ns = await db.prepare('SELECT id,aliases FROM narratives WHERE owner=? ORDER BY created DESC LIMIT 1000').bind(owner).all<{id:string;aliases:string}>();
  const links = ns.results
    .filter((n) => safeAliases(n.aliases).some((alias) => phraseMatch(e.content, alias)))
    .map((n) => db.prepare('INSERT INTO evidence_links(owner,narrative,evidence,reason) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(owner, n.id, e.id, 'Existing narrative alias matched caption/name/hashtag; association unverified'));
  if (links.length) await runBatches(db, links);
}

export async function addNarrative(db: D1Database, owner: string, title: string, aliases: string[]) {
  if (!title.trim() || title.length > 100) throw Error('Enter a narrative title of 1–100 characters.');
  const unique = new Map<string,string>();
  for (const value of [title, ...aliases]) {
    const clean = value.trim();
    if (clean) unique.set(normalize(clean), clean);
  }
  const values = [...unique.values()];
  if (values.length > 12 || values.some((t) => t.length < 3 || t.length > 100)) throw Error('Use up to 12 phrases, each 3–100 characters.');
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO narratives(owner,id,title,aliases,created) VALUES(?,?,?,?,?)').bind(owner, id, title.trim(), JSON.stringify(values), Date.now()).run();
  const es = await db.prepare('SELECT id,content FROM evidence WHERE owner=? ORDER BY last_seen DESC LIMIT 2000').bind(owner).all<{id:string;content:string}>();
  const links = es.results
    .filter((e) => values.some((value) => phraseMatch(e.content, value)))
    .map((e) => db.prepare('INSERT INTO evidence_links(owner,narrative,evidence,reason) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(owner, id, e.id, 'User-defined alias match'));
  if (links.length) await runBatches(db, links);
  return id;
}

export async function inboxTikTok(db: D1Database, owner: string, url: string) {
  const canonical = tiktokUrl(url);
  const parsed = tiktokOembedSchema.safeParse(await fetchJson('https://www.tiktok.com/oembed?url=' + encodeURIComponent(canonical)));
  const data = parsed.success ? parsed.data : undefined;
  if (typeof data?.title !== 'string' || typeof data.author_name !== 'string') throw Error('TikTok did not return valid video metadata. Nothing was saved.');
  const id = 'tiktok:' + canonical.split('/').pop();
  await saveEvidence(db, owner, {
    id,
    platform: 'TikTok',
    author: canonical.split('/')[3],
    url: canonical,
    content: data.title.slice(0, 8000),
    published: null,
    views: null,
    likes: null,
    provenance: 'TikTok oEmbed · submitted URL · no engagement metrics',
  });
  return { id, title: data.title };
}

type RawNarrativeRow = {
  id: string;
  title: string;
  aliases: string;
  created: number;
  evidence_id: string;
  platform: string;
  author: string;
  url: string;
  content: string;
  published: number | null;
  first_seen: number;
  last_seen: number;
  provenance: string;
  reason: string;
};

type RelationshipRow = {
  narrative: string;
  related_key: string;
  related_title: string;
  relation: string;
  score: number;
  evidence_count: number;
  author_count: number;
  platforms: string;
  evidence_ids: string;
  observed: number;
};

function cardLooksDuplicate(a: any, b: any) {
  const similarity = narrativeTitleSimilarity(a.title, b.title);
  if (similarity < 0.75 && normalize(a.title) !== normalize(b.title)) return false;
  const left = new Set(a.evidence.map((e: any) => e.evidence_id));
  const right = new Set(b.evidence.map((e: any) => e.evidence_id));
  const overlap = [...left].filter((id) => right.has(id)).length;
  return normalize(a.title) === normalize(b.title) || (overlap >= 2 && overlap / Math.max(1, Math.min(left.size, right.size)) >= 0.66);
}

function dedupeCards(cards: any[]) {
  const out: any[] = [];
  for (const card of cards) {
    const index = out.findIndex((existing) => cardLooksDuplicate(existing, card));
    if (index < 0) {
      out.push(card);
      continue;
    }
    const existing = out[index];
    const preferCard = card.authors > existing.authors || (card.authors === existing.authors && terms(card.title).length > terms(existing.title).length);
    const primary = preferCard ? card : existing;
    const secondary = preferCard ? existing : card;
    primary.aliases = [...new Set([...(primary.aliases ?? []), ...(secondary.aliases ?? []), secondary.title])].slice(0, 24);
    primary.duplicateIds = [...new Set([...(primary.duplicateIds ?? []), secondary.id, ...(secondary.duplicateIds ?? [])])];
    out[index] = primary;
  }
  return out;
}

export async function narrativeFeed(db: D1Database, owner: string, options: NarrativeFeedOptions = {}) {
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(options.limit) || 50)));
  const offset = Math.max(0, Math.min(10000, Math.trunc(Number(options.offset) || 0)));
  const query = normalize(options.query ?? '');
  const includeArchived = options.includeArchived === true;
  const includeDuplicates = options.includeDuplicates === true;

  const rows = await db.prepare(`SELECT n.id,n.title,n.aliases,n.created,e.id AS evidence_id,e.platform,e.author,e.url,e.content,e.published,e.first_seen,e.last_seen,e.provenance,l.reason FROM narratives n JOIN evidence_links l ON n.owner=l.owner AND n.id=l.narrative JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence WHERE n.owner=? ORDER BY e.last_seen DESC LIMIT 6000`).bind(owner).all<RawNarrativeRow>();
  const grouped = new Map<string, any>();
  for (const row of rows.results) {
    if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, title: row.title, aliases: safeAliases(row.aliases), created: row.created, evidence: [] });
    grouped.get(row.id).evidence.push(row);
  }

  const now = Date.now();
  let cards = [...grouped.values()].map((n) => {
    const recent15 = n.evidence.filter((e: RawNarrativeRow) => e.first_seen > now - 15 * 60000);
    const recentHour = n.evidence.filter((e: RawNarrativeRow) => e.first_seen > now - 3600000);
    const previous45 = n.evidence.filter((e: RawNarrativeRow) => e.first_seen <= now - 15 * 60000 && e.first_seen > now - 3600000);
    const authors15 = new Set(recent15.map((e: RawNarrativeRow) => e.platform + ':' + e.author.toLowerCase())).size;
    const authorsHour = new Set(recentHour.map((e: RawNarrativeRow) => e.platform + ':' + e.author.toLowerCase())).size;
    const authorsPrevious = new Set(previous45.map((e: RawNarrativeRow) => e.platform + ':' + e.author.toLowerCase())).size;
    const firstSeen = Math.min(...n.evidence.map((e: RawNarrativeRow) => e.first_seen));
    const lastSeen = Math.max(...n.evidence.map((e: RawNarrativeRow) => e.last_seen));
    return {
      ...n,
      authors: authorsHour,
      recentAuthors15m: authors15,
      previousAuthors45m: authorsPrevious,
      platforms: [...new Set(n.evidence.map((e: RawNarrativeRow) => e.platform))],
      stage: lifecycleStage(lastSeen, authors15, authorsHour, authorsPrevious, now),
      firstSeen,
      lastSeen,
      duplicateIds: [],
    };
  });

  let relationships: RelationshipRow[] = [];
  try {
    const result = await db.prepare('SELECT narrative,related_key,related_title,relation,score,evidence_count,author_count,platforms,evidence_ids,observed FROM narrative_relationships WHERE owner=? ORDER BY score DESC,observed DESC LIMIT 3000').bind(owner).all<RelationshipRow>();
    relationships = result.results;
  } catch {
    // A pre-migration local database may briefly lack the relationship table.
    relationships = [];
  }
  const relatedByNarrative = new Map<string, RelationshipRow[]>();
  for (const row of relationships) {
    const list = relatedByNarrative.get(row.narrative) ?? [];
    list.push(row);
    relatedByNarrative.set(row.narrative, list);
  }
  cards = cards.map((card) => ({
    ...card,
    relatedContexts: (relatedByNarrative.get(card.id) ?? []).slice(0, 8).map((row) => ({
      key: row.related_key,
      title: row.related_title,
      relation: row.relation,
      score: row.score,
      evidenceCount: row.evidence_count,
      authorCount: row.author_count,
      platforms: safeAliases(row.platforms),
      evidenceIds: safeAliases(row.evidence_ids),
      observed: row.observed,
    })),
  }));

  const snapshots = await db.prepare('SELECT id,observed,views,likes FROM observations WHERE owner=? AND observed>? ORDER BY observed ASC LIMIT 5000').bind(owner, now - 86400000).all<any>();
  for (const card of cards) for (const e of card.evidence) {
    const ss = snapshots.results.filter((s) => s.id === e.evidence_id && s.views != null);
    const first = ss[0], last = ss.at(-1);
    e.views = last?.views ?? null;
    e.viewsPerMinute = first && last && last.observed > first.observed && last.views >= first.views ? (last.views - first.views) / ((last.observed - first.observed) / 60000) : null;
  }

  cards = cards
    .filter((card) => includeArchived || card.stage !== 'Archived')
    .filter((card) => !query || normalize([card.title, ...(card.aliases ?? [])].join(' ')).includes(query))
    .sort((a, b) => {
      const stageRank: Record<string, number> = { Accelerating: 5, Spreading: 4, 'Early watch': 3, Observed: 2, Cooling: 1, Archived: 0 };
      return (stageRank[b.stage] ?? 0) - (stageRank[a.stage] ?? 0) || b.authors - a.authors || b.lastSeen - a.lastSeen;
    });
  if (!includeDuplicates) cards = dedupeCards(cards);

  const total = cards.length;
  const pagedCards = cards.slice(offset, offset + limit);

  const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
  const spend = await db.prepare('SELECT day,reserved FROM usage WHERE owner=? AND day LIKE ?').bind(owner, month + '%').all<{day:string;reserved:number}>();
  const cfg = await db.prepare('SELECT state,lock_until FROM collector WHERE owner=?').bind(owner).first<{state:string;lock_until:number}>();
  const status = cfg ? JSON.parse(cfg.state) : {};
  const coins = await db.prepare('SELECT narrative,mint,data,observed FROM narrative_coins WHERE owner=? ORDER BY observed DESC LIMIT 1000').bind(owner).all<any>();

  return {
    cards: pagedCards,
    coins: coins.results.map((c) => ({ ...c, data: JSON.parse(c.data) })),
    page: { limit, offset, total, hasMore: offset + limit < total, nextOffset: offset + limit < total ? offset + limit : null },
    at: now,
    budget: { dayUsed: spend.results.find((r) => r.day === day)?.reserved ?? 0, monthUsed: spend.results.reduce((s, r) => s + r.reserved, 0), dayLimit: 500000, monthLimit: 15000000 },
    collector: { status: status.status ?? 'Not scanned', lastRun: status.lastRun ?? null, batches: status.groups?.length ?? 0, pendingPages: (status.groups ?? []).filter((g: any) => g.next).length },
    note: 'Automatic radar promotion comes only from corroborated browser inference. Broad/legacy keys are not promoted from raw captions. Archived narratives are hidden by default but remain available in Radar Manager.',
  };
}

export async function deleteNarrative(db: D1Database, owner: string, id: string) {
  const row = await db.prepare('SELECT id,title FROM narratives WHERE owner=? AND id=?').bind(owner, id).first<{id:string;title:string}>();
  if (!row) throw Error('Narrative not found.');
  await db.batch([
    db.prepare('DELETE FROM narrative_coins WHERE owner=? AND narrative=?').bind(owner, id),
    db.prepare('DELETE FROM evidence_links WHERE owner=? AND narrative=?').bind(owner, id),
    db.prepare('DELETE FROM narrative_relationships WHERE owner=? AND narrative=?').bind(owner, id),
    db.prepare('DELETE FROM narratives WHERE owner=? AND id=?').bind(owner, id),
  ]);
  return { id, title: row.title };
}

export async function mergeNarratives(db: D1Database, owner: string, keepId: string, mergeId: string) {
  if (!keepId || !mergeId || keepId === mergeId) throw Error('Choose two different narratives to merge.');
  const [keep, drop] = await Promise.all([
    db.prepare('SELECT id,title,aliases FROM narratives WHERE owner=? AND id=?').bind(owner, keepId).first<{id:string;title:string;aliases:string}>(),
    db.prepare('SELECT id,title,aliases FROM narratives WHERE owner=? AND id=?').bind(owner, mergeId).first<{id:string;title:string;aliases:string}>(),
  ]);
  if (!keep || !drop) throw Error('One of the narratives no longer exists.');

  const aliases = new Map<string,string>();
  for (const alias of [keep.title, ...safeAliases(keep.aliases), drop.title, ...safeAliases(drop.aliases)]) aliases.set(normalize(alias), alias);
  const [links, coins, rels] = await Promise.all([
    db.prepare('SELECT evidence,reason FROM evidence_links WHERE owner=? AND narrative=?').bind(owner, mergeId).all<{evidence:string;reason:string}>(),
    db.prepare('SELECT mint,data,observed FROM narrative_coins WHERE owner=? AND narrative=?').bind(owner, mergeId).all<{mint:string;data:string;observed:number}>(),
    db.prepare('SELECT related_key,related_title,relation,score,evidence_count,author_count,platforms,evidence_ids,observed FROM narrative_relationships WHERE owner=? AND narrative=?').bind(owner, mergeId).all<RelationshipRow>(),
  ]);

  const writes: D1PreparedStatement[] = [
    db.prepare('UPDATE narratives SET aliases=? WHERE owner=? AND id=?').bind(JSON.stringify([...aliases.values()].slice(0, 24)), owner, keepId),
    ...links.results.map((row) => db.prepare('INSERT INTO evidence_links(owner,narrative,evidence,reason) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(owner, keepId, row.evidence, `Merged duplicate · ${row.reason}`.slice(0, 300))),
    ...coins.results.map((row) => db.prepare('INSERT INTO narrative_coins(owner,narrative,mint,data,observed) VALUES(?,?,?,?,?) ON CONFLICT(owner,narrative,mint) DO UPDATE SET data=excluded.data,observed=MAX(narrative_coins.observed,excluded.observed)').bind(owner, keepId, row.mint, row.data, row.observed)),
    ...rels.results.map((row) => db.prepare('INSERT INTO narrative_relationships(owner,narrative,related_key,related_title,relation,score,evidence_count,author_count,platforms,evidence_ids,observed) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,narrative,related_key) DO UPDATE SET score=MAX(narrative_relationships.score,excluded.score),evidence_count=MAX(narrative_relationships.evidence_count,excluded.evidence_count),author_count=MAX(narrative_relationships.author_count,excluded.author_count),platforms=excluded.platforms,evidence_ids=excluded.evidence_ids,observed=MAX(narrative_relationships.observed,excluded.observed)').bind(owner, keepId, row.related_key, row.related_title, row.relation, row.score, row.evidence_count, row.author_count, row.platforms, row.evidence_ids, row.observed)),
  ];
  await runBatches(db, writes);
  await db.batch([
    db.prepare('DELETE FROM narrative_coins WHERE owner=? AND narrative=?').bind(owner, mergeId),
    db.prepare('DELETE FROM evidence_links WHERE owner=? AND narrative=?').bind(owner, mergeId),
    db.prepare('DELETE FROM narrative_relationships WHERE owner=? AND narrative=?').bind(owner, mergeId),
    db.prepare('DELETE FROM narratives WHERE owner=? AND id=?').bind(owner, mergeId),
  ]);
  return { kept: { id: keepId, title: keep.title }, merged: { id: mergeId, title: drop.title } };
}

export async function cleanupLegacyNarratives(db: D1Database, owner: string) {
  const rows = await db.prepare(`SELECT n.id,n.title,n.aliases,n.created,(SELECT COUNT(*) FROM evidence_links l WHERE l.owner=n.owner AND l.narrative=n.id) AS evidence_count,(SELECT MAX(e.last_seen) FROM evidence_links l JOIN evidence e ON e.owner=l.owner AND e.id=l.evidence WHERE l.owner=n.owner AND l.narrative=n.id) AS last_seen FROM narratives n WHERE n.owner=? AND n.id LIKE 'auto:%' ORDER BY n.created ASC LIMIT 1000`).bind(owner).all<{id:string;title:string;aliases:string;created:number;evidence_count:number;last_seen:number|null}>();
  const now = Date.now();
  let deletedBroad = 0, deletedUnsupported = 0, mergedDuplicates = 0;
  const removed = new Set<string>();

  for (const row of rows.results) {
    if (isBroadNarrativeTitle(row.title)) {
      await deleteNarrative(db, owner, row.id);
      removed.add(row.id);
      deletedBroad++;
      continue;
    }
    if (Number(row.evidence_count) === 0 && now - row.created > 10 * 60000) {
      await deleteNarrative(db, owner, row.id);
      removed.add(row.id);
      deletedUnsupported++;
    }
  }

  const candidates = rows.results.filter((row) => !removed.has(row.id));
  const evidenceById = new Map<string, Set<string>>();
  for (const row of candidates) {
    const links = await db.prepare('SELECT evidence FROM evidence_links WHERE owner=? AND narrative=? LIMIT 250').bind(owner, row.id).all<{evidence:string}>();
    evidenceById.set(row.id, new Set(links.results.map((link) => link.evidence)));
  }

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (removed.has(a.id)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (removed.has(b.id)) continue;
      const similarity = narrativeTitleSimilarity(a.title, b.title);
      const exact = normalize(a.title) === normalize(b.title);
      if (!exact && similarity < 0.75) continue;
      const ae = evidenceById.get(a.id) ?? new Set<string>();
      const be = evidenceById.get(b.id) ?? new Set<string>();
      const overlap = [...ae].filter((id) => be.has(id)).length;
      if (!exact && (overlap < 2 || overlap / Math.max(1, Math.min(ae.size, be.size)) < 0.66)) continue;
      const aScore = ae.size * 10 + terms(a.title).length;
      const bScore = be.size * 10 + terms(b.title).length;
      const keep = aScore >= bScore ? a : b;
      const drop = keep.id === a.id ? b : a;
      await mergeNarratives(db, owner, keep.id, drop.id);
      removed.add(drop.id);
      const keepEvidence = evidenceById.get(keep.id) ?? new Set<string>();
      for (const id of evidenceById.get(drop.id) ?? []) keepEvidence.add(id);
      evidenceById.set(keep.id, keepEvidence);
      mergedDuplicates++;
      if (drop.id === a.id) break;
    }
  }

  return { deletedBroad, deletedUnsupported, mergedDuplicates, changed: deletedBroad + deletedUnsupported + mergedDuplicates };
}

// Reserve worst-case read cost before every request. No user expansions: only post reads.
const PAGE = 20, COST = 5000, DAY_LIMIT = 500000, MONTH_LIMIT = 15000000;

export async function scanXBounded(db: D1Database, owner: string, token: string, accounts: string[]) {
  const now = Date.now(), lease = crypto.randomUUID();
  await db.prepare('INSERT INTO collector(owner,state,lock_until,lock_id) VALUES(?,?,0,?) ON CONFLICT DO NOTHING').bind(owner, '{}', '').run();
  const lock = await db.prepare('UPDATE collector SET lock_until=?,lock_id=? WHERE owner=? AND lock_until<? RETURNING state').bind(now + 120000, lease, owner, now).first<{state:string}>();
  if (!lock) throw Error('An X scan is already running.');
  const state: any = JSON.parse(lock.state);
  try {
    if (state.lastRun && now - state.lastRun < 60000) throw Error('Wait one minute between scans.');
    const keys = batches([...new Set(accounts.map((a) => a.toLowerCase()))].sort()).map((b) => b.join(','));
    const old = state.groups ?? [];
    state.groups = keys.map((k) => old.find((g: any) => g.key === k) ?? { key: k, checked: 0, since: null, next: null, start: null, end: null, newest: null });
    const group = [...state.groups].sort((a, b) => a.checked - b.checked)[0];
    if (!group) throw Error('Configure at least one X handle.');
    const day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
    await db.prepare('INSERT INTO usage(owner,day,reserved) VALUES(?,?,0) ON CONFLICT DO NOTHING').bind(owner, day).run();
    const reserved = await db.prepare(`UPDATE usage SET reserved=reserved+? WHERE owner=? AND day=? AND reserved+?<=? AND (SELECT COALESCE(SUM(reserved),0) FROM usage WHERE owner=? AND day LIKE ?)+?<=? RETURNING reserved`).bind(PAGE * COST, owner, day, PAGE * COST, DAY_LIMIT, owner, month + '%', PAGE * COST, MONTH_LIMIT).first();
    if (!reserved) { state.status = 'Paused: daily/monthly read budget reached'; throw Error(state.status); }
    if (!group.next) { group.end = new Date(now - 30000).toISOString(); group.start = group.since ? null : new Date(now - 6 * 3600000).toISOString(); group.newest = group.since; }
    state.lastRun = now; state.status = 'Request reserved';
    await db.prepare('UPDATE collector SET state=? WHERE owner=? AND lock_id=?').bind(JSON.stringify(state), owner, lease).run();
    const params = new URLSearchParams({ query: '(' + group.key.split(',').map((a: string) => 'from:' + a).join(' OR ') + ') -is:retweet', max_results: String(PAGE), 'tweet.fields': 'author_id,created_at,public_metrics,entities', end_time: group.end });
    if (group.since) params.set('since_id', group.since); else params.set('start_time', group.start); if (group.next) params.set('next_token', group.next);
    const data = parseProvider(xPageSchema, await fetchJson('https://api.x.com/2/tweets/search/recent?' + params, token), 'X');
    if (data.errors?.length || (!Array.isArray(data.data) && data.meta?.result_count !== 0)) throw Error('X returned an incomplete response; cursor retained.');
    const posts = data.data ?? [];
    if (posts.length > PAGE || posts.some((p) => !/^\d+$/.test(p.id ?? '') || typeof p.text !== 'string' || !p.author_id)) throw Error('X returned invalid posts; cursor retained.');
    for (const p of posts) {
      const expanded = (p.entities?.urls ?? []).map((u) => u.expanded_url ?? '').join(' ');
      await saveEvidence(db, owner, { id: 'x:' + p.id, platform: 'X', author: String(p.author_id), url: 'https://x.com/i/status/' + p.id, content: (p.text + ' ' + expanded).slice(0, 8000), published: Number.isFinite(Date.parse(p.created_at ?? '')) ? Date.parse(p.created_at ?? '') : null, views: metric(p.public_metrics?.impression_count), likes: metric(p.public_metrics?.like_count), provenance: 'X recent search API' });
      if (p.id && (!group.newest || BigInt(p.id) > BigInt(group.newest))) group.newest = p.id;
    }
    group.checked = now; group.next = data.meta?.next_token ?? null;
    if (!group.next) { group.since = group.newest; group.start = null; group.end = null; }
    state.status = group.next ? 'Page saved; more posts pending' : 'Batch saved';
    await db.prepare('UPDATE usage SET reserved=reserved-? WHERE owner=? AND day=?').bind((PAGE - posts.length) * COST, owner, day).run();
    const feed = await narrativeFeed(db, owner, { limit: 100 });
    const signals: Signal[] = feed.cards.map((n: any) => ({ id: n.id, title: n.title, query: n.aliases[0], source: 'Stored social evidence', detail: n.stage + ' · ' + n.authors + ' recently observed accounts', url: n.evidence[0].url, evidence: n.evidence.slice(0, 8).map((e: any) => ({ url: e.url, text: e.content, author: e.author, views: e.views })) }));
    return { signals, at: now, posts: posts.length, coverage: [{ source: 'X · one incremental batch', ok: true }], note: '20 posts maximum per request. $0.50/day and $15/month estimated post-read limits. Additional pages and batches resume on later scans; API billing is authoritative.' };
  } catch (e) {
    state.status = (e as Error).message;
    throw e;
  } finally {
    await db.prepare('UPDATE collector SET state=?,lock_until=0,lock_id=? WHERE owner=? AND lock_id=?').bind(JSON.stringify(state), '', owner, lease).run();
  }
}

export async function matchNarrative(db: D1Database, owner: string, id: string) {
  const n = await db.prepare('SELECT aliases FROM narratives WHERE owner=? AND id=?').bind(owner, id).first<{aliases:string}>();
  if (!n) throw Error('Narrative not found');
  const queries = safeAliases(n.aliases).slice(0, 3);
  const coverage = [];
  for (const q of queries) {
    const result = await searchCoins(q);
    coverage.push(...result.coverage);
    for (const c of result.coins) {
      await db.prepare('INSERT INTO narrative_coins(owner,narrative,mint,data,observed) VALUES(?,?,?,?,?) ON CONFLICT(owner,narrative,mint) DO UPDATE SET data=excluded.data,observed=excluded.observed').bind(owner, id, c.mint, JSON.stringify({ ...c, matchReason: 'Search candidate for ' + q + '; narrative association unverified' }), Date.now()).run();
    }
  }
  return { coverage, queries };
}
