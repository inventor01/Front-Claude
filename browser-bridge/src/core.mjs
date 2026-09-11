import { createHash } from 'node:crypto';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  intervalMinutes: 15,
  scanXExplore: true,
  scanXHome: true,
  scanTikTokTrends: true,
  scanTikTokExplore: true,
  scrollPasses: 4,
  maxFeedItems: 40,
  inferredTopicSearches: 4,
  maxTrendQueries: 3,
  resultsPerQuery: 6,
  xAccounts: [],
  keywords: [],
});

const asList = (value) => (Array.isArray(value) ? value : []);
const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampInt = (value, fallback, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(value) || fallback)));

export function normalizeConfig(input = {}) {
  const xAccounts = [...new Set(asList(input.xAccounts)
    .map((value) => cleanText(value, 32).replace(/^@/, ''))
    .filter((value) => /^[A-Za-z0-9_]{1,15}$/.test(value)))]
    .slice(0, 100);
  const keywords = [...new Set(asList(input.keywords)
    .map((value) => cleanText(value, 100))
    .filter((value) => value.length >= 2))]
    .slice(0, 50);
  return {
    enabled: input.enabled !== false,
    intervalMinutes: clampInt(input.intervalMinutes, DEFAULT_CONFIG.intervalMinutes, 10, 240),
    scanXExplore: input.scanXExplore !== false,
    scanXHome: input.scanXHome !== false,
    scanTikTokTrends: input.scanTikTokTrends !== false,
    scanTikTokExplore: input.scanTikTokExplore !== false,
    scrollPasses: clampInt(input.scrollPasses, DEFAULT_CONFIG.scrollPasses, 1, 10),
    maxFeedItems: clampInt(input.maxFeedItems, DEFAULT_CONFIG.maxFeedItems, 10, 120),
    inferredTopicSearches: clampInt(input.inferredTopicSearches, DEFAULT_CONFIG.inferredTopicSearches, 0, 10),
    maxTrendQueries: clampInt(input.maxTrendQueries, DEFAULT_CONFIG.maxTrendQueries, 0, 10),
    resultsPerQuery: clampInt(input.resultsPerQuery, DEFAULT_CONFIG.resultsPerQuery, 2, 20),
    xAccounts,
    keywords,
  };
}

export function stableId(platform, url, content = '') {
  const digest = createHash('sha256').update(`${platform}\n${url}\n${content}`).digest('hex').slice(0, 28);
  return `${String(platform).toLowerCase()}:browser:${digest}`;
}

export function parseCompactNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim().replace(/,/g, '');
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || '').toUpperCase()] || 1;
  const out = Math.round(base * multiplier);
  return out >= 0 ? out : null;
}

export function metricFromAria(label, metricName) {
  if (!label) return null;
  const escaped = String(metricName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = String(label).match(new RegExp(`([\\d,.]+(?:\\s*[KMB])?)\\s+${escaped}`, 'i'));
  if (direct) return parseCompactNumber(direct[1]);
  const reverse = String(label).match(new RegExp(`${escaped}[^\\d]*([\\d,.]+(?:\\s*[KMB])?)`, 'i'));
  return reverse ? parseCompactNumber(reverse[1]) : null;
}

export function extractHashtags(value, limit = 30) {
  const out = [];
  const seen = new Set();
  for (const match of String(value ?? '').matchAll(/#([\p{L}\p{N}_]{2,80})/gu)) {
    const tag = match[1];
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}

export function xTrendLabel(value) {
  const lines = String(value ?? '').split(/\n+/).map((line) => cleanText(line, 160)).filter(Boolean);
  const noise = /^(trending|show more|what(?:'|’)s happening|for you|news|sports|entertainment|[\d,.]+\s*(?:posts?|post))$/i;
  const candidates = lines.filter((line) => !noise.test(line) && !/^trending in\b/i.test(line));
  return candidates.find((line) => line.startsWith('#')) || candidates.find((line) => !/\bposts?\b/i.test(line)) || '';
}

const STOP = new Set(('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really new now today tonight yesterday tomorrow have has had do does did can could would should will may might about into over under after before more most some any all one two via amp rt https http com www video watch post posts people thing things time day get got like know think make made going go went see saw says said say look looks looking why how what when where who which there here').split(' '));
const GENERIC_TOPIC = new Set(('meme memes viral virality reaction reactions reacts reacted clip clips trend trends trending story stories update updates breaking news funny wild crazy internet tiktok twitter tweet tweets x social media creator creators account accounts').split(' '));
const BROAD_TOPIC = new Set(('crypto cryptocurrency bitcoin btc ethereum eth solana market markets stocks stock politics political election elections sports football basketball baseball soccer music entertainment technology tech ai artificial intelligence gaming games celebrity celebrities world national local economy economic finance financial').split(' '));
const NICHE_CUE = /\b(meme|reaction|clip|sound|audio|dance|challenge|edit|template|joke|nickname|quote|face|caught|moment|remix|duet|stitch|trend|viral|brainrot|copypasta|slang|mascot|character)\b/i;

function splitCamel(value) {
  return String(value ?? '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
}

const normalizeTopic = (value) => cleanText(splitCamel(value), 100)
  .replace(/^#/, '')
  .replace(/[’']/g, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

function topicTokens(value) {
  return normalizeTopic(value)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC_TOPIC.has(word) && !/^\d+$/.test(word));
}

function broadOnly(tokens) {
  return Boolean(tokens.length) && tokens.every((token) => BROAD_TOPIC.has(token) || GENERIC_TOPIC.has(token));
}

function candidatePhrases(content) {
  const out = new Map();
  const add = (label, weight, kind = 'phrase') => {
    const clean = cleanText(splitCamel(label), 100).replace(/^#/, '').trim();
    const key = normalizeTopic(clean);
    if (key.length < 3 || key.length > 80 || STOP.has(key)) return;
    const tokens = topicTokens(clean);
    if (!tokens.length || broadOnly(tokens)) return;
    const aliases = new Set([key]);
    // Named entities and hashtags may be described differently across posts.
    // A distinctive leading token lets “Dejon Love”, “Dejon reaction” and
    // “#DejonLove” corroborate without needing a paid semantic-model call.
    if (kind === 'name' || kind === 'hashtag') {
      const distinctive = tokens.filter((token) => !BROAD_TOPIC.has(token));
      if (distinctive[0]?.length >= 4) aliases.add(distinctive[0]);
      if (tokens.length >= 2) aliases.add(tokens.join(' '));
    }
    const old = out.get(key);
    if (!old || weight > old.weight) out.set(key, { key, label: clean, weight, kind, aliases: [...aliases], tokenCount: tokens.length });
  };
  for (const tag of extractHashtags(content, 12)) add(tag, 3.2, 'hashtag');
  for (const match of String(content).matchAll(/\b[A-Z][\p{L}\p{N}'’_-]{2,30}(?:\s+[A-Z][\p{L}\p{N}'’_-]{2,30}){0,2}\b/gu)) add(match[0], 2.6, 'name');
  const words = normalizeTopic(content).split(' ').filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word)).slice(0, 80);
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i <= words.length - size; i++) add(words.slice(i, i + size).join(' '), size === 3 ? 1.25 : 1, 'phrase');
  }
  return [...out.values()];
}

function addObservation(row, event, phrase, recency, engagement) {
  if (!row.evidence.has(event.id)) row.evidence.set(event.id, event);
  row.authors.add(`${event.platform}:${event.author.toLocaleLowerCase()}`);
  row.platforms.add(event.platform);
  row.kinds.add(phrase.kind);
  if (NICHE_CUE.test(event.content)) row.nicheEvidence.add(event.id);
  const previous = row.eventWeight.get(event.id) || 0;
  if (phrase.weight > previous) row.eventWeight.set(event.id, phrase.weight);
  row.recencyByEvent.set(event.id, Math.max(row.recencyByEvent.get(event.id) || 0, recency));
  row.engagementByEvent.set(event.id, Math.max(row.engagementByEvent.get(event.id) || 0, engagement));
  const specificity = phrase.weight + Math.min(2, phrase.tokenCount * 0.45) + (phrase.kind === 'hashtag' ? 0.3 : 0);
  const oldLabel = row.labels.get(phrase.label) || 0;
  row.labels.set(phrase.label, oldLabel + specificity);
}

function evidenceAnchor(event) {
  return {
    id: event.id,
    platform: event.platform,
    author: event.author,
    url: event.url,
    content: cleanText(event.content, 260),
    published: event.published,
    views: event.views,
    likes: event.likes,
  };
}

export function inferTopics(events, now = Date.now(), limit = 10) {
  const normalized = dedupeEvidence(events);
  const buckets = new Map();
  for (const event of normalized) {
    const ageHours = event.published ? Math.max(0, (now - event.published) / 3600000) : 6;
    const recency = Math.max(0.15, 1 / (1 + ageHours / 3));
    const engagement = Math.log10(1 + (event.views || 0)) + 0.35 * Math.log10(1 + (event.likes || 0));
    for (const phrase of candidatePhrases(event.content)) {
      for (const alias of phrase.aliases) {
        if (!alias || GENERIC_TOPIC.has(alias) || STOP.has(alias) || BROAD_TOPIC.has(alias)) continue;
        const row = buckets.get(alias) || {
          key: alias,
          evidence: new Map(),
          authors: new Set(),
          platforms: new Set(),
          eventWeight: new Map(),
          recencyByEvent: new Map(),
          engagementByEvent: new Map(),
          labels: new Map(),
          kinds: new Set(),
          nicheEvidence: new Set(),
        };
        addObservation(row, event, phrase, recency, engagement);
        buckets.set(alias, row);
      }
    }
  }

  const ranked = [...buckets.values()]
    .map((row) => {
      const evidence = [...row.evidence.values()];
      const evidenceCount = evidence.length;
      const authorCount = row.authors.size;
      const platformCount = row.platforms.size;
      const corroborated = evidenceCount >= 2 && authorCount >= 2;
      const phraseWeight = [...row.eventWeight.values()].reduce((sum, value) => sum + value, 0);
      const recency = [...row.recencyByEvent.values()].reduce((sum, value) => sum + value, 0);
      const engagement = [...row.engagementByEvent.values()].reduce((sum, value) => sum + value, 0);
      const label = [...row.labels.entries()].sort((a, b) => b[1] - a[1] || topicTokens(b[0]).length - topicTokens(a[0]).length || b[0].length - a[0].length)[0]?.[0] || row.key;
      const tokens = topicTokens(label);
      const hasStructuredSignal = row.kinds.has('hashtag') || row.kinds.has('name');
      const nicheEvidenceCount = row.nicheEvidence.size;
      const nicheEnough = !broadOnly(tokens) && (hasStructuredSignal || nicheEvidenceCount > 0 || tokens.length >= 3);
      const specificityScore = Math.min(10, tokens.length * 1.4 + (row.kinds.has('hashtag') ? 1.4 : 0) + (row.kinds.has('name') ? 0.8 : 0) + Math.min(2.4, nicheEvidenceCount * 0.8) + (platformCount > 1 ? 0.6 : 0));
      const score = phraseWeight + authorCount * 2.8 + platformCount * 2.2 + recency * 1.5 + Math.min(8, engagement * 0.45) + specificityScore * 1.2;
      const dated = evidence.map((event) => event.published).filter((value) => Number.isFinite(value));
      const anchors = [...evidence]
        .sort((a, b) => ((b.views || 0) + (b.likes || 0) * 4) - ((a.views || 0) + (a.likes || 0) * 4) || (b.published || 0) - (a.published || 0))
        .slice(0, 3)
        .map(evidenceAnchor);
      return {
        topic: label,
        key: row.key,
        evidenceCount,
        authorCount,
        platforms: [...row.platforms],
        oldestPublished: dated.length ? Math.min(...dated) : null,
        newestPublished: dated.length ? Math.max(...dated) : null,
        engagementEvidence: evidence.reduce((sum, event) => sum + (event.views || 0) + (event.likes || 0), 0),
        score: Number(score.toFixed(2)),
        specificityScore: Number(specificityScore.toFixed(2)),
        niche: nicheEnough,
        nicheEvidenceCount,
        corroborated,
        evidenceIds: evidence.slice(0, 8).map((event) => event.id),
        anchors,
      };
    })
    .filter((row) => row.corroborated && row.niche)
    .sort((a, b) => b.score - a.score || b.specificityScore - a.specificityScore || b.authorCount - a.authorCount || b.evidenceCount - a.evidenceCount);

  // Alias buckets can point at the same evidence set. Prefer the more specific
  // candidate when two rows explain essentially the same posts/videos.
  const selected = [];
  for (const row of ranked) {
    const evidenceSet = new Set(row.evidenceIds);
    const dupeIndex = selected.findIndex((existing) => {
      const overlap = existing.evidenceIds.filter((id) => evidenceSet.has(id)).length;
      return overlap >= 2 && overlap / Math.min(existing.evidenceIds.length, row.evidenceIds.length) >= 0.66;
    });
    if (dupeIndex >= 0) {
      const existing = selected[dupeIndex];
      const rowTokens = topicTokens(row.topic).length;
      const existingTokens = topicTokens(existing.topic).length;
      if (rowTokens > existingTokens && row.specificityScore >= existing.specificityScore - 0.5) selected[dupeIndex] = row;
      continue;
    }
    selected.push(row);
    if (selected.length >= Math.max(0, limit)) break;
  }
  return selected.sort((a, b) => b.score - a.score || b.specificityScore - a.specificityScore).slice(0, Math.max(0, limit));
}

function allowedUrl(platform, rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (platform === 'X' && !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host)) return null;
  if (platform === 'TikTok' && !['tiktok.com', 'www.tiktok.com', 'ads.tiktok.com'].includes(host)) return null;
  url.hash = '';
  return url.toString();
}

export function normalizeEvidence(raw) {
  const platform = raw?.platform === 'X' || raw?.platform === 'TikTok' ? raw.platform : null;
  if (!platform) return null;
  const url = allowedUrl(platform, raw.url);
  if (!url) return null;
  const content = cleanText(raw.content, 8000);
  if (!content) return null;
  const author = cleanText(raw.author || (platform === 'X' ? 'X' : 'TikTok'), 120) || platform;
  const publishedNumber = Number(raw.published);
  const published = Number.isFinite(publishedNumber) && publishedNumber > 0 ? Math.trunc(publishedNumber) : null;
  const views = Number.isFinite(Number(raw.views)) && Number(raw.views) >= 0 ? Math.trunc(Number(raw.views)) : null;
  const likes = Number.isFinite(Number(raw.likes)) && Number(raw.likes) >= 0 ? Math.trunc(Number(raw.likes)) : null;
  const provenance = cleanText(raw.provenance || `${platform} browser session`, 300);
  const id = cleanText(raw.id, 180) || stableId(platform, url, content);
  return { id, platform, author, url, content, published, views, likes, provenance };
}

export function dedupeEvidence(events) {
  const map = new Map();
  for (const event of events || []) {
    const normalized = normalizeEvidence(event);
    if (!normalized) continue;
    const key = `${normalized.platform}|${normalized.url}`;
    const previous = map.get(key);
    if (!previous || (normalized.views ?? -1) > (previous.views ?? -1)) map.set(key, normalized);
  }
  return [...map.values()];
}

export function extractTikTokItemsFromJson(value) {
  const out = new Map();
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node)) {
      const id = typeof node.id === 'string' && /^\d{10,25}$/.test(node.id) ? node.id : null;
      const desc = typeof node.desc === 'string' ? node.desc : typeof node.title === 'string' ? node.title : '';
      if (id && desc) {
        const author = typeof node.author === 'object' && node.author ? (node.author.uniqueId || node.author.nickname || '') : (node.authorName || node.author || '');
        const stats = typeof node.stats === 'object' && node.stats ? node.stats : {};
        const createTime = Number(node.createTime || node.create_time || 0);
        out.set(id, {
          id,
          content: cleanText(desc, 8000),
          author: cleanText(author, 120),
          published: Number.isFinite(createTime) && createTime > 1e8 ? Math.trunc(createTime * 1000) : null,
          views: Number.isFinite(Number(stats.playCount ?? stats.play_count)) ? Math.trunc(Number(stats.playCount ?? stats.play_count)) : null,
          likes: Number.isFinite(Number(stats.diggCount ?? stats.digg_count)) ? Math.trunc(Number(stats.diggCount ?? stats.digg_count)) : null,
        });
      }
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) visit(child);
  };
  visit(value);
  return [...out.values()];
}

export function sanitizeTopic(value) {
  return cleanText(value, 100).replace(/^#/, '').trim();
}
