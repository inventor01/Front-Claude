import { createHash } from 'node:crypto';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  intervalMinutes: 15,
  scanXExplore: true,
  scanTikTokTrends: true,
  maxTrendQueries: 3,
  resultsPerQuery: 6,
  xAccounts: [],
  keywords: [],
});

const asList = (value) => (Array.isArray(value) ? value : []);
const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalizeConfig(input = {}) {
  const xAccounts = [...new Set(asList(input.xAccounts)
    .map((value) => cleanText(value, 32).replace(/^@/, ''))
    .filter((value) => /^[A-Za-z0-9_]{1,15}$/.test(value)))]
    .slice(0, 100);
  const keywords = [...new Set(asList(input.keywords)
    .map((value) => cleanText(value, 100))
    .filter((value) => value.length >= 2))]
    .slice(0, 50);
  const intervalMinutes = Math.max(10, Math.min(240, Number(input.intervalMinutes) || DEFAULT_CONFIG.intervalMinutes));
  const maxTrendQueries = Math.max(0, Math.min(10, Number(input.maxTrendQueries) || DEFAULT_CONFIG.maxTrendQueries));
  const resultsPerQuery = Math.max(2, Math.min(20, Number(input.resultsPerQuery) || DEFAULT_CONFIG.resultsPerQuery));
  return {
    enabled: input.enabled !== false,
    intervalMinutes,
    scanXExplore: input.scanXExplore !== false,
    scanTikTokTrends: input.scanTikTokTrends !== false,
    maxTrendQueries,
    resultsPerQuery,
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

function allowedUrl(platform, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
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
        const author = typeof node.author === 'object' && node.author
          ? (node.author.uniqueId || node.author.nickname || '')
          : (node.authorName || node.author || '');
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
