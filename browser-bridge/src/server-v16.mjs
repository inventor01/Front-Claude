import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import {
  cleanEvidenceContent,
  extractHashtags,
  extractTikTokItemsFromJson,
  metricFromAria,
  normalizeConfig,
  parseCompactNumber,
  sanitizeTopic,
  stableId,
  xTrendLabel,
} from './core.mjs';
import { detectTopics, enrichMomentum, topicSnapshot } from './topic-engine.mjs';
import {
  attachFeedPenetration,
  attachSoundSignals,
  chooseSentinelAccounts,
  consolidateTopicAliases,
  mergeRichEvidence,
  normalizeAdaptiveConfig,
  scanNovelty,
  updateSourceReputation,
} from './adaptive-intelligence.mjs';
import {
  attachOriginResearch,
  attachVisualSignals,
  semanticConsolidateTopics,
  shouldAutoDeep,
} from './advanced-intelligence.mjs';
import {
  SCOUT_SKILL_VERSION,
  attachObservedMetricVelocity,
  evaluateDiscoveryPass,
  rankInvestigationCandidates,
  scoutBroadeningPlan,
} from './scout-skill.mjs';
import {
  findSystemChrome,
  frontCdpUrl,
  frontLoginProfileDir,
  openRegularChromeForLogin,
  stopExistingFrontChrome,
  waitForCdp,
} from './system-browser.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const profileDir = frontLoginProfileDir(dataDir);
const configPath = path.join(dataDir, 'config.json');
const pendingPath = path.join(dataDir, 'pending-evidence.json');
const historyPath = path.join(dataDir, 'topic-history.json');
const seenPath = path.join(dataDir, 'feed-seen-v10.json');
const penetrationPath = path.join(dataDir, 'feed-penetration-v10.json');
const reputationPath = path.join(dataDir, 'source-reputation-v10.json');
const rotationPath = path.join(dataDir, 'sentinel-rotation-v10.json');
const visualCachePath = path.join(dataDir, 'visual-hash-v11.json');
const creatorCachePath = path.join(dataDir, 'creator-stats-v11.json');
const escalationPath = path.join(dataDir, 'auto-deep-v11.json');
const metricSnapshotPath = path.join(dataDir, 'metric-snapshots-v16.json');
const systemChrome = findSystemChrome();
const cdpPort = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const cdpUrl = frontCdpUrl(cdpPort);
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set((process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',').map((value) => value.trim()).filter(Boolean));
const ORIGIN_SCROLLS = 7;
const ORIGIN_RESULTS = 48;
const AUTO_DEEP_COOLDOWN_MS = 45 * 60_000;
fs.mkdirSync(profileDir, { recursive: true });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function activeConfig(input = {}) { return normalizeAdaptiveConfig(normalizeConfig({ ...config, ...input }), { ...config, ...input }); }
function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin, Access-Control-Request-Private-Network',
  };
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
function originAllowed(req) { const origin = req.headers.origin; return !origin || allowedOrigins.has(origin); }
function json(req, res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...corsHeaders(req),
  });
  res.end(payload);
}
function hasMeaningfulText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 3) return false;
  if (/^[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T|%|x)?$/i.test(text)) return false;
  if (/^(?:hashtag|caption|video|photo|sound|profile|user|creator|account|show|more|view|like|likes|quote|reply|share|follow|following|for you|explore|home|trending)$/i.test(text)) return false;
  return /[\p{L}]/u.test(text);
}
function trendSlug(rawHref) {
  if (!rawHref) return '';
  try {
    const url = new URL(rawHref, 'https://ads.tiktok.com');
    const parts = url.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => ['hashtag', 'trend', 'trends'].includes(part.toLowerCase()));
    if (index >= 0 && parts[index + 1]) return decodeURIComponent(parts[index + 1]).replace(/[-_]+/g, ' ').trim();
  } catch {}
  return '';
}
function numeric(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null; }
function queueEvidence(rows) { pendingEvidence = mergeRichEvidence([...pendingEvidence, ...rows]).slice(-500); writeJson(pendingPath, pendingEvidence); }
function ackEvidence(ids) {
  const set = new Set(Array.isArray(ids) ? ids.map(String) : []);
  if (!set.size) return 0;
  const before = pendingEvidence.length;
  pendingEvidence = pendingEvidence.filter((row) => !set.has(row.id));
  writeJson(pendingPath, pendingEvidence);
  return before - pendingEvidence.length;
}
function normalizeUrl(value, base = 'https://x.com') {
  try { const url = new URL(value, base); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
function isXHost(value) {
  try { return /(^|\.)(x\.com|twitter\.com)$/i.test(new URL(value).hostname); } catch { return false; }
}
function topicIdentity(topic) { return sanitizeTopic(topic?.key || topic?.topic || '').toLowerCase(); }

let browserConnection;
let context;
let config = normalizeAdaptiveConfig(normalizeConfig(readJson(configPath, {})), readJson(configPath, {}));
let pendingEvidence = mergeRichEvidence(readJson(pendingPath, [])).slice(-500);
let topicHistory = Array.isArray(readJson(historyPath, [])) ? readJson(historyPath, []).slice(-96) : [];
let seenState = readJson(seenPath, { X: [], TikTok: [] });
let penetrationState = readJson(penetrationPath, {});
let sourceReputation = readJson(reputationPath, {});
let sentinelRotation = readJson(rotationPath, { cursor: 0 });
let visualCache = readJson(visualCachePath, {});
let creatorCache = readJson(creatorCachePath, {});
let autoDeepState = readJson(escalationPath, {});
let metricSnapshotState = readJson(metricSnapshotPath, {});
let running = false;
let lastRun = null;
let lastError = null;
let lastCount = 0;
let lastTopics = [];
let nextScheduledRun = null;
let scheduleTimer;
let lastAudit = null;

async function ensureBrowser() {
  if (context && browserConnection?.isConnected?.()) return context;
  if (!systemChrome) throw new Error('Google Chrome is required for authenticated X/TikTok scans.');
  try {
    browserConnection = await chromium.connectOverCDP(cdpUrl);
    context = browserConnection.contexts()[0];
    if (!context) throw new Error('Front Chrome did not expose its browser context.');
    browserConnection.on('disconnected', () => { browserConnection = undefined; context = undefined; });
    return context;
  } catch (error) {
    browserConnection = undefined;
    context = undefined;
    throw new Error(`Front login Chrome is not available for scanning. Click Open X + TikTok login, finish signing in, and leave that Front Chrome window open. (${error instanceof Error ? error.message : String(error)})`);
  }
}
async function newPage(url) {
  const browser = await ensureBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    return page;
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}
async function scrollViewport(page, pauseMs = 900) {
  await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.95, 760))).catch(() => {});
  await page.waitForTimeout(pauseMs);
}

async function adaptiveCollect(page, extractor, { platform, target, maxScrolls, stalePassLimit, maxSeconds, pauseMs = 900 }) {
  const started = Date.now();
  let rows = [];
  let passes = 0;
  let stale = 0;
  let previousCount = 0;
  let novelCount = 0;
  let focusSignal = null;
  const priorSeen = Array.isArray(seenState[platform]) ? seenState[platform] : [];
  while (true) {
    rows = mergeRichEvidence([...rows, ...(await extractor())]);
    const novelty = scanNovelty(rows, priorSeen);
    novelCount = novelty.newRows.length;
    const added = rows.length - previousCount;
    stale = added <= 1 ? stale + 1 : 0;
    previousCount = rows.length;
    focusSignal = evaluateDiscoveryPass(novelty.unique, {
      pass: passes,
      platform,
      now: Date.now(),
      minSample: Math.min(18, Math.max(8, Math.round(target * .15))),
    });
    const timeExpired = Date.now() - started >= maxSeconds * 1000;
    if (focusSignal.focus || novelCount >= target || passes >= maxScrolls || stale >= stalePassLimit || timeExpired) {
      seenState[platform] = novelty.seenIds;
      writeJson(seenPath, seenState);
      return {
        rows: novelty.newRows.length ? novelty.newRows.slice(0, target) : novelty.unique.slice(0, target),
        audit: {
          passes,
          uniqueObserved: novelty.unique.length,
          newToHistory: novelty.newRows.length,
          noveltyPct: Number((novelty.newRatio * 100).toFixed(1)),
          elapsedMs: Date.now() - started,
          stopReason: focusSignal.focus ? 'signal-found' : novelCount >= target ? 'target' : stale >= stalePassLimit ? 'stale' : passes >= maxScrolls ? 'scroll-cap' : 'time-cap',
          focusSignal,
        },
      };
    }
    passes += 1;
    await scrollViewport(page, pauseMs);
  }
}

async function visualHashForUrl(page, url) {
  const cleanUrl = normalizeUrl(url, 'https://www.tiktok.com');
  if (!cleanUrl) return null;
  const cached = visualCache[cleanUrl];
  if (cached?.hash && Date.now() - Number(cached.at || 0) < 7 * 86400000) return cached.hash;
  try {
    const response = await page.context().request.get(cleanUrl, { timeout: 6000, failOnStatusCode: false });
    if (!response.ok()) return null;
    const headers = response.headers();
    const type = String(headers['content-type'] || 'image/jpeg').split(';')[0];
    if (!type.startsWith('image/')) return null;
    const buffer = await response.body();
    if (!buffer.length || buffer.length > 4_000_000) return null;
    const dataUrl = `data:${type};base64,${buffer.toString('base64')}`;
    const hash = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      const canvas = document.createElement('canvas');
      canvas.width = 9; canvas.height = 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, 9, 8);
      const pixels = ctx.getImageData(0, 0, 9, 8).data;
      let bits = '';
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const i = (y * 9 + x) * 4;
          const j = (y * 9 + x + 1) * 4;
          const left = pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114;
          const right = pixels[j] * .299 + pixels[j + 1] * .587 + pixels[j + 2] * .114;
          bits += left > right ? '1' : '0';
        }
      }
      let hex = '';
      for (let i = 0; i < bits.length; i += 4) hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
      return hex;
    }, dataUrl).catch(() => null);
    if (hash) {
      visualCache[cleanUrl] = { hash, at: Date.now() };
      const entries = Object.entries(visualCache).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 1500);
      visualCache = Object.fromEntries(entries);
      writeJson(visualCachePath, visualCache);
    }
    return hash;
  } catch { return null; }
}

async function enrichVisualRows(page, rows, max = 24) {
  const candidates = rows.filter((row) => row.coverUrl && !row.visualHash).slice(0, max);
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(candidates.slice(i, i + 4).map(async (row) => { row.visualHash = await visualHashForUrl(page, row.coverUrl); }));
  }
  return rows;
}

async function extractXArticles(page, limit, provenance) {
  const articles = page.locator('article[data-testid="tweet"]');
  const count = Math.min(await articles.count(), Math.max(limit * 3, limit));
  const out = [];
  for (let i = 0; i < count && out.length < limit; i++) {
    const article = articles.nth(i);
    const statusLinks = await article.locator('a[href*="/status/"]').evaluateAll((els) => els.map((el) => el.getAttribute('href')).filter(Boolean)).catch(() => []);
    const href = statusLinks[0];
    if (!href) continue;
    const url = href.startsWith('http') ? href : `https://x.com${href}`;
    const dt = await article.locator('time').first().getAttribute('datetime').catch(() => null);
    const published = dt && Number.isFinite(Date.parse(dt)) ? Date.parse(dt) : null;
    const aria = await article.getAttribute('aria-label').catch(() => '') || '';
    const views = metricFromAria(aria, 'views');
    const likes = metricFromAria(aria, 'likes');
    const replies = metricFromAria(aria, 'replies');
    const reposts = metricFromAria(aria, 'reposts') ?? metricFromAria(aria, 'retweets');
    const bookmarks = metricFromAria(aria, 'bookmarks');
    const quotes = metricFromAria(aria, 'quotes');
    const statusPath = new URL(url).pathname.split('/').filter(Boolean);
    const author = statusPath[0] || 'X';
    const tweetTextParts = await article.locator('[data-testid="tweetText"]').allInnerTexts().catch(() => []);
    const directText = tweetTextParts.map((value) => value.trim()).filter(hasMeaningfulText).join(' ');
    if (!directText) continue;
    const text = cleanEvidenceContent('X', directText, author);
    if (!hasMeaningfulText(text)) continue;
    const quotedHref = statusLinks.find((candidate) => candidate !== href && !candidate.includes(href)) || null;
    const mediaType = await article.locator('[data-testid="videoPlayer"], video').count().then((n) => n ? 'video' : null).catch(() => null)
      || await article.locator('[data-testid="tweetPhoto"] img').count().then((n) => n ? 'image' : null).catch(() => null)
      || 'text';
    const coverUrl = await article.locator('[data-testid="tweetPhoto"] img').first().getAttribute('src').catch(() => null)
      || await article.locator('video').first().getAttribute('poster').catch(() => null);
    const outboundUrls = await article.locator('a[href]').evaluateAll((els) => els.map((el) => el.href).filter(Boolean)).catch(() => []);
    const external = [...new Set(outboundUrls.map((value) => normalizeUrl(value)).filter((value) => value && !isXHost(value) && !/\/hashtag\//i.test(value)))].slice(0, 12);
    out.push({
      id: stableId('X', url, text), platform: 'X', author, url, content: text, published, views, likes,
      replies, reposts, bookmarks, quotes,
      quotedUrl: quotedHref ? (quotedHref.startsWith('http') ? quotedHref : `https://x.com${quotedHref}`) : null,
      outboundUrls: external,
      hashtags: extractHashtags(text, 30), mediaType, coverUrl, provenance,
    });
  }
  return mergeRichEvidence(out);
}

async function collectXForYou(active) {
  const page = await newPage('https://x.com/home');
  try {
    await page.waitForTimeout(2300);
    const tab = page.getByRole('tab', { name: /^For you$/i }).first();
    if (await tab.count().catch(() => 0)) await tab.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(700);
    const result = await adaptiveCollect(page, () => extractXArticles(page, active.targetUniqueFeedItems, 'Local Chrome browser · X For You feed'), {
      platform: 'X', target: active.targetUniqueFeedItems, maxScrolls: active.maxAdaptiveScrolls,
      stalePassLimit: active.stalePassLimit, maxSeconds: active.maxFeedScanSeconds, pauseMs: 850,
    });
    result.rows = await enrichVisualRows(page, result.rows, 24);
    return result;
  } finally { await page.close(); }
}

async function collectXQuery(query, limit, active, provenancePrefix = 'X Latest search', scrollOverride = null) {
  const q = query.trim();
  if (!q) return [];
  const page = await newPage(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`);
  try {
    await page.waitForTimeout(2200);
    let out = [];
    const scrollPasses = Number.isFinite(scrollOverride) ? scrollOverride : active.searchScrollPasses;
    for (let i = 0; i <= scrollPasses; i++) {
      out = mergeRichEvidence([...out, ...(await extractXArticles(page, limit, `Local Chrome browser · ${provenancePrefix} · query: ${q}`))]);
      if (out.length >= limit || i === scrollPasses) break;
      await scrollViewport(page, 700);
    }
    if (!out.length) throw new Error(`X returned no posts with real tweet text for “${q}”.`);
    return await enrichVisualRows(page, out.slice(0, limit), provenancePrefix.includes('origin research') ? 36 : 16);
  } finally { await page.close(); }
}

async function collectXUrl(url, active, provenance = 'X origin research · quoted ancestry') {
  if (!url || !isXHost(url)) return [];
  const page = await newPage(url);
  try {
    await page.waitForTimeout(1800);
    const rows = await extractXArticles(page, 6, `Local Chrome browser · ${provenance}`);
    return await enrichVisualRows(page, rows, 6);
  } finally { await page.close(); }
}

async function collectXExplore(limit) {
  const page = await newPage('https://x.com/explore/tabs/trending');
  try {
    await page.waitForTimeout(2500);
    const candidates = page.locator('a[href*="/search?q="], [data-testid="trend"]');
    const count = Math.min(await candidates.count(), Math.max(limit * 3, limit));
    const out = [];
    for (let i = 0; i < count && out.length < limit; i++) {
      const item = candidates.nth(i);
      const raw = (await item.innerText().catch(() => '')).trim();
      const text = xTrendLabel(raw);
      if (!hasMeaningfulText(text)) continue;
      const href = await item.getAttribute('href').catch(() => null);
      const url = href ? (href.startsWith('http') ? href : `https://x.com${href}`) : `https://x.com/search?q=${encodeURIComponent(text)}&src=trend_click&f=live`;
      out.push({ id: stableId('X', url, text), platform: 'X', author: 'X Explore', url, content: text, published: null, views: null, likes: null, provenance: 'Local Chrome browser · X Explore trend seed' });
    }
    if (!out.length) throw new Error('X Explore loaded but no trend evidence was extractable.');
    return out;
  } finally { await page.close(); }
}

function richTikTokItems(value) {
  const out = new Map();
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const id = String(node.id ?? node.itemId ?? node.item_id ?? '');
    const desc = node.desc ?? node.description ?? node.text;
    const authorObj = node.author && typeof node.author === 'object' ? node.author : {};
    const author = authorObj.uniqueId ?? authorObj.unique_id ?? node.authorName ?? node.author_name;
    const stats = node.stats && typeof node.stats === 'object' ? node.stats : (node.statistics && typeof node.statistics === 'object' ? node.statistics : {});
    const authorStats = node.authorStats && typeof node.authorStats === 'object' ? node.authorStats
      : (authorObj.stats && typeof authorObj.stats === 'object' ? authorObj.stats : {});
    const music = node.music && typeof node.music === 'object' ? node.music : (node.sound && typeof node.sound === 'object' ? node.sound : {});
    const duetInfo = node.duetInfo && typeof node.duetInfo === 'object' ? node.duetInfo : {};
    const stitchInfo = node.stitchInfo && typeof node.stitchInfo === 'object' ? node.stitchInfo : {};
    const duetFromId = String(node.duetFromId ?? node.duet_from_id ?? duetInfo.duetFromId ?? duetInfo.duet_from_id ?? '');
    const stitchFromId = String(node.stitchFromId ?? node.stitch_from_id ?? stitchInfo.stitchFromId ?? stitchInfo.stitch_from_id ?? '');
    const originalItemId = String(node.originalItemId ?? node.original_item_id ?? '');
    const relatedVideoId = /^\d{10,25}$/.test(duetFromId) ? duetFromId : /^\d{10,25}$/.test(stitchFromId) ? stitchFromId : /^\d{10,25}$/.test(originalItemId) ? originalItemId : null;
    const relationType = relatedVideoId ? (/^\d{10,25}$/.test(duetFromId) ? 'duet' : /^\d{10,25}$/.test(stitchFromId) ? 'stitch' : 'derived') : null;
    if (/^\d{10,25}$/.test(id) && typeof desc === 'string') {
      out.set(id, {
        id,
        content: desc,
        author: typeof author === 'string' ? author : 'TikTok',
        published: numeric(node.createTime ?? node.create_time) ? numeric(node.createTime ?? node.create_time) * 1000 : null,
        views: numeric(stats.playCount ?? stats.play_count ?? stats.viewCount ?? stats.view_count),
        likes: numeric(stats.diggCount ?? stats.digg_count ?? stats.likeCount ?? stats.like_count),
        comments: numeric(stats.commentCount ?? stats.comment_count),
        shares: numeric(stats.shareCount ?? stats.share_count),
        saves: numeric(stats.collectCount ?? stats.collect_count ?? stats.favoriteCount ?? stats.favorite_count),
        creatorFollowers: numeric(authorStats.followerCount ?? authorStats.follower_count ?? authorObj.followerCount ?? authorObj.follower_count),
        soundId: String(music.id ?? music.musicId ?? music.music_id ?? '').slice(0, 80) || null,
        soundTitle: String(music.title ?? music.musicName ?? music.music_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
        soundAuthor: String(music.authorName ?? music.author_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null,
        coverUrl: String(node.video?.cover ?? node.video?.originCover ?? node.video?.dynamicCover ?? '').slice(0, 2048) || null,
        relationType,
        relatedVideoId,
      });
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) visit(child);
  };
  visit(value);
  return out;
}

async function extractTikTokPage(page, provenance, limit) {
  const extracted = await page.evaluate(() => {
    const json = [];
    for (const script of Array.from(document.scripts)) {
      const value = (script.textContent || '').trim();
      if (!value.startsWith('{') && !value.startsWith('[')) continue;
      try { json.push(JSON.parse(value)); } catch {}
    }
    return json;
  });
  const baseItems = [];
  const rich = new Map();
  for (const value of extracted) {
    baseItems.push(...extractTikTokItemsFromJson(value));
    for (const [id, item] of richTikTokItems(value)) rich.set(id, { ...(rich.get(id) || {}), ...item });
  }
  const byId = new Map();
  for (const item of baseItems) {
    if (!hasMeaningfulText(item.content)) continue;
    byId.set(item.id, { ...item, ...(rich.get(item.id) || {}) });
  }
  const anchors = page.locator('a[href*="/video/"]');
  const anchorCount = Math.min(await anchors.count(), limit * 4);
  for (let i = 0; i < anchorCount; i++) {
    const anchor = anchors.nth(i);
    const href = await anchor.getAttribute('href').catch(() => null);
    if (!href) continue;
    const match = href.match(/\/@([^/]+)\/video\/(\d{10,25})/);
    if (!match) continue;
    if (!byId.has(match[2])) {
      const aria = (await anchor.getAttribute('aria-label').catch(() => null) || '').trim();
      const title = (await anchor.getAttribute('title').catch(() => null) || '').trim();
      const imageAlt = (await anchor.locator('img').first().getAttribute('alt').catch(() => null) || '').trim();
      const coverUrl = await anchor.locator('img').first().getAttribute('src').catch(() => null);
      const text = [aria, title, imageAlt].map((value) => cleanEvidenceContent('TikTok', value, match[1])).find(hasMeaningfulText) || '';
      if (text) byId.set(match[2], { id: match[2], content: text, author: match[1], published: null, views: null, likes: null, coverUrl, ...(rich.get(match[2]) || {}) });
    }
  }
  return [...byId.values()].slice(0, limit).flatMap((item) => {
    const author = item.author || 'TikTok';
    const url = author !== 'TikTok' ? `https://www.tiktok.com/@${author}/video/${item.id}` : `https://www.tiktok.com/video/${item.id}`;
    const content = cleanEvidenceContent('TikTok', item.content, author);
    if (!hasMeaningfulText(content)) return [];
    return [{
      id: `tiktok:browser:${item.id}`, platform: 'TikTok', author, url, content,
      published: item.published ?? null, views: item.views ?? null, likes: item.likes ?? null,
      comments: item.comments ?? null, shares: item.shares ?? null, saves: item.saves ?? null,
      creatorFollowers: item.creatorFollowers ?? null,
      soundId: item.soundId ?? null, soundTitle: item.soundTitle ?? null, soundAuthor: item.soundAuthor ?? null,
      coverUrl: item.coverUrl ?? null, relationType: item.relationType ?? null, relatedVideoId: item.relatedVideoId ?? null,
      hashtags: extractHashtags(content, 30), mediaType: 'video', provenance,
    }];
  });
}

async function collectTikTokForYou(active) {
  let page;
  try { page = await newPage('https://www.tiktok.com/foryou'); }
  catch { page = await newPage('https://www.tiktok.com/explore'); }
  try {
    await page.waitForTimeout(2800);
    const result = await adaptiveCollect(page, () => extractTikTokPage(page, 'Local Chrome browser · TikTok For You feed', active.targetUniqueFeedItems), {
      platform: 'TikTok', target: active.targetUniqueFeedItems, maxScrolls: active.maxAdaptiveScrolls,
      stalePassLimit: active.stalePassLimit, maxSeconds: active.maxFeedScanSeconds, pauseMs: 900,
    });
    result.rows = await enrichVisualRows(page, result.rows, 28);
    return result;
  } finally { await page.close(); }
}

async function collectTikTokSearch(topic, limit, active, provenancePrefix = 'TikTok search', scrollOverride = null) {
  const q = sanitizeTopic(topic);
  if (!q) return [];
  const page = await newPage(`https://www.tiktok.com/search?q=${encodeURIComponent(q)}`);
  try {
    await page.waitForTimeout(2600);
    let out = [];
    const scrollPasses = Number.isFinite(scrollOverride) ? scrollOverride : active.searchScrollPasses;
    for (let i = 0; i <= scrollPasses; i++) {
      out = mergeRichEvidence([...out, ...(await extractTikTokPage(page, `Local Chrome browser · ${provenancePrefix} · query: ${q}`, limit))]);
      if (out.length >= limit || i === scrollPasses) break;
      await scrollViewport(page, 800);
    }
    if (!out.length) throw new Error(`TikTok returned no videos with real caption metadata for “${q}”.`);
    return await enrichVisualRows(page, out.slice(0, limit), provenancePrefix.includes('origin research') ? 36 : 18);
  } finally { await page.close(); }
}

async function collectTikTokTrends(limit) {
  let creativeError = null;
  try {
    const page = await newPage('https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en');
    try {
      await page.waitForTimeout(2800);
      const rows = page.locator('a[href*="/hashtag/"], a[href*="/trends/"], a[href*="/trend/"]');
      const count = Math.min(await rows.count(), Math.max(limit * 3, limit));
      const out = [];
      for (let i = 0; i < count && out.length < limit; i++) {
        const row = rows.nth(i);
        const href = await row.getAttribute('href').catch(() => null);
        if (!href) continue;
        const raw = (await row.innerText().catch(() => '')).replace(/\n+/g, ' · ').trim();
        const slug = trendSlug(href);
        const label = hasMeaningfulText(slug) ? slug : (extractHashtags(raw, 1)[0] || '');
        if (!hasMeaningfulText(label)) continue;
        const url = href.startsWith('http') ? href : `https://ads.tiktok.com${href}`;
        out.push({ id: stableId('TikTok', url, label), platform: 'TikTok', author: 'TikTok Creative Center', url, content: `#${label.replace(/\s+/g, '')}`, published: null, views: null, likes: null, provenance: 'Local Chrome browser · TikTok Creative Center trend seed' });
      }
      if (out.length) return out;
      creativeError = new Error('Creative Center loaded but no real trend labels were extractable.');
    } finally { await page.close(); }
  } catch (error) { creativeError = error; }
  try {
    const fallback = await collectTikTokForYou({ ...activeConfig(), targetUniqueFeedItems: Math.max(limit, 20), maxFeedScanSeconds: 25, maxAdaptiveScrolls: 4 });
    return fallback.rows.slice(0, limit);
  } catch (fallbackError) {
    throw new Error(`Creative Center unavailable (${creativeError instanceof Error ? creativeError.message : String(creativeError)}); TikTok For You fallback also failed (${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}).`);
  }
}

function topicInvestigationQueries(topic, deep) {
  const queries = [topic.topic, ...(topic.aliases || [])].map((value) => sanitizeTopic(value)).filter(hasMeaningfulText);
  return [...new Set(queries)].slice(0, deep ? 3 : 1);
}

function followerFromText(text) {
  const match = String(text || '').match(/([\d,.]+(?:\.\d+)?\s*[KMB]?)\s+(?:Followers|follower)/i);
  return match ? parseCompactNumber(match[1]) : null;
}

async function fetchCreatorFollowers(platform, author) {
  const cleanAuthor = String(author || '').replace(/^@/, '').trim();
  if (!cleanAuthor || /^(?:X Explore|TikTok Creative Center)$/i.test(cleanAuthor)) return null;
  const key = `${platform}:${cleanAuthor.toLowerCase()}`;
  const cached = creatorCache[key];
  if (Number.isFinite(cached?.followers) && Date.now() - Number(cached.at || 0) < 6 * 3600000) return cached.followers;
  let page;
  try {
    page = await newPage(platform === 'X' ? `https://x.com/${encodeURIComponent(cleanAuthor)}` : `https://www.tiktok.com/@${encodeURIComponent(cleanAuthor)}`);
    await page.waitForTimeout(platform === 'X' ? 1700 : 2100);
    let followers = null;
    if (platform === 'X') {
      const text = await page.locator(`a[href$="/${cleanAuthor}/followers"], a[href$="/${cleanAuthor}/verified_followers"]`).first().innerText().catch(() => '');
      followers = followerFromText(`${text} Followers`) ?? parseCompactNumber(text);
    } else {
      const scripts = await page.evaluate(() => Array.from(document.scripts).map((script) => script.textContent || '').filter((value) => value.includes('followerCount')).slice(0, 12)).catch(() => []);
      for (const text of scripts) {
        const match = text.match(/"followerCount"\s*:\s*(\d+)/);
        if (match) { followers = Number(match[1]); break; }
      }
      if (!Number.isFinite(followers)) followers = followerFromText(await page.locator('body').innerText().catch(() => ''));
    }
    if (Number.isFinite(followers)) {
      creatorCache[key] = { followers, at: Date.now() };
      creatorCache = Object.fromEntries(Object.entries(creatorCache).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 800));
      writeJson(creatorCachePath, creatorCache);
      return followers;
    }
  } catch {} finally { await page?.close().catch(() => {}); }
  return null;
}

async function enrichCreatorFollowers(rows, maxCreators = 14) {
  const byCreator = new Map();
  for (const row of rows) {
    if (Number.isFinite(row.creatorFollowers) || !row.author) continue;
    const key = `${row.platform}:${String(row.author).toLowerCase()}`;
    if (!byCreator.has(key)) byCreator.set(key, { platform: row.platform, author: row.author });
    if (byCreator.size >= maxCreators) break;
  }
  const entries = [...byCreator.entries()];
  for (let i = 0; i < entries.length; i += 3) {
    const resolved = await Promise.all(entries.slice(i, i + 3).map(async ([key, creator]) => [key, await fetchCreatorFollowers(creator.platform, creator.author)]));
    for (const [key, followers] of resolved) if (Number.isFinite(followers)) {
      for (const row of rows) if (`${row.platform}:${String(row.author).toLowerCase()}` === key) row.creatorFollowers = followers;
    }
  }
  return rows;
}

async function runOriginResearch(topics, active, add, errors) {
  let searches = 0;
  for (const topic of topics.slice(0, 3)) {
    const queries = topicInvestigationQueries(topic, true).slice(0, 2);
    for (const query of queries) {
      try {
        const rows = await collectXQuery(`"${query}" -filter:replies`, active.originResultsPerQuery || ORIGIN_RESULTS, active, 'X origin research', active.originSearchScrollPasses || ORIGIN_SCROLLS);
        add('X Origin Research', rows); searches += 1;
        const ancestors = [...new Set(rows.map((row) => row.quotedUrl).filter(Boolean))].slice(0, 4);
        for (const ancestor of ancestors) {
          try { add('X Origin Ancestry', await collectXUrl(ancestor, active)); } catch (error) { errors.push(`X origin ancestry ${query}: ${error.message}`); }
        }
      } catch (error) { errors.push(`X origin ${query}: ${error.message}`); }
      try {
        add('TikTok Origin Research', await collectTikTokSearch(query, active.originResultsPerQuery || ORIGIN_RESULTS, active, 'TikTok origin research', active.originSearchScrollPasses || ORIGIN_SCROLLS));
        searches += 1;
      } catch (error) { errors.push(`TikTok origin ${query}: ${error.message}`); }
    }
  }
  return searches;
}

async function investigateTopics(topics, active, scanMode, add, errors, investigated, sourcePrefix = 'Candidate Investigation') {
  const deepLimit = scanMode === 'deep' ? active.deepResultsPerQuery : Math.max(8, active.resultsPerQuery);
  for (const topic of topics) {
    const identity = topicIdentity(topic);
    if (!identity || investigated.has(identity)) continue;
    investigated.add(identity);
    for (const query of topicInvestigationQueries(topic, scanMode === 'deep')) {
      try { add(`X ${sourcePrefix}`, await collectXQuery(`"${query}" -filter:replies`, deepLimit, active, `X ${sourcePrefix.toLowerCase()}`)); }
      catch (error) { errors.push(`X investigate ${query}: ${error.message}`); }
      try { add(`TikTok ${sourcePrefix}`, await collectTikTokSearch(query, deepLimit, active, `TikTok ${sourcePrefix.toLowerCase()}`)); }
      catch (error) { errors.push(`TikTok investigate ${query}: ${error.message}`); }
    }
  }
}

async function collectAll(input = {}) {
  if (running) throw new Error('A browser scan is already running.');
  running = true;
  lastError = null;
  const scanMode = input.mode === 'scout' ? 'scout' : 'deep';
  try {
    const active = activeConfig(input);
    const evidence = [];
    const errors = [];
    const sourceCounts = {};
    const feedAudits = {};
    const investigated = new Set();
    let earlyPlan = { focusFirst: false, reduceBroadSeeds: false, reason: 'not-evaluated' };
    let earlyCandidates = [];
    const add = (source, rows) => {
      evidence.push(...rows.map((row) => ({ firstObserved: row.firstObserved || Date.now(), ...row })));
      sourceCounts[source] = (sourceCounts[source] || 0) + rows.length;
    };

    if (active.scanXForYou !== false) {
      try { const result = await collectXForYou(active); add('X For You', result.rows); feedAudits.x = result.audit; }
      catch (error) { errors.push(`X For You: ${error.message}`); }
    }
    if (active.scanTikTokForYou !== false) {
      try { const result = await collectTikTokForYou(active); add('TikTok For You', result.rows); feedAudits.tiktok = result.audit; }
      catch (error) { errors.push(`TikTok For You: ${error.message}`); }
    }

    // Skill-driven focus gate: once the recommendation feeds show a real event,
    // investigate it immediately instead of spending the rest of the run blindly scrolling.
    const feedAt = Date.now();
    const feedPreview = attachObservedMetricVelocity(mergeRichEvidence(evidence), metricSnapshotState, feedAt).rows;
    if (feedPreview.length) {
      let feedTopics = detectTopics(feedPreview, feedAt, Math.max(active.inferredTopicSearches, 8));
      feedTopics = attachSoundSignals(feedTopics, feedPreview);
      feedTopics = attachVisualSignals(feedTopics, feedPreview, feedAt);
      feedTopics = semanticConsolidateTopics(feedTopics, feedPreview, feedAt);
      feedTopics = consolidateTopicAliases(feedTopics);
      earlyCandidates = rankInvestigationCandidates(feedTopics, feedPreview, { limit: scanMode === 'deep' ? 3 : 2, now: feedAt });
      earlyPlan = scoutBroadeningPlan(earlyCandidates, scanMode);
      if (earlyPlan.focusFirst) await investigateTopics(earlyCandidates.slice(0, scanMode === 'deep' ? 2 : 1), active, scanMode, add, errors, investigated, 'Focus Investigation');
    }

    if (active.scanXExplore && !earlyPlan.reduceBroadSeeds) {
      try { add('X Trending seeds', await collectXExplore(active.resultsPerQuery)); }
      catch (error) { errors.push(`X Explore: ${error.message}`); }
    }
    if (active.scanTikTokTrends && !earlyPlan.reduceBroadSeeds) {
      try { add('TikTok Trending seeds', await collectTikTokTrends(active.resultsPerQuery * 2)); }
      catch (error) { errors.push(`TikTok trends: ${error.message}`); }
    }

    const requestedSentinels = scanMode === 'deep' ? active.sentinelAccountsPerDeep : active.sentinelAccountsPerScout;
    const sentinelCount = earlyPlan.reduceBroadSeeds && scanMode === 'scout' ? Math.min(2, requestedSentinels) : requestedSentinels;
    const selection = chooseSentinelAccounts(active.xAccounts, sourceReputation, sentinelRotation.cursor || 0, sentinelCount);
    sentinelRotation = { cursor: selection.nextCursor, at: Date.now(), last: selection.accounts };
    writeJson(rotationPath, sentinelRotation);
    for (const account of selection.accounts) {
      try { add('X Sentinel', await collectXQuery(`from:${account} -filter:replies`, Math.max(8, active.resultsPerQuery), active, `X sentinel @${account}`)); }
      catch (error) { errors.push(`X sentinel @${account}: ${error.message}`); }
    }

    // Explicit user hunt phrases are never skipped by automatic focus mode.
    for (const keyword of active.keywords.slice(0, scanMode === 'deep' ? 12 : 5)) {
      try { add('X Keyword Search', await collectXQuery(`"${keyword}" -filter:replies`, Math.max(8, active.resultsPerQuery), active)); }
      catch (error) { errors.push(`X ${keyword}: ${error.message}`); }
      if (scanMode === 'deep') {
        try { add('TikTok Keyword Search', await collectTikTokSearch(keyword, Math.max(8, active.resultsPerQuery), active)); }
        catch (error) { errors.push(`TikTok ${keyword}: ${error.message}`); }
      }
    }

    const firstAt = Date.now();
    const initialPreview = attachObservedMetricVelocity(mergeRichEvidence(evidence), metricSnapshotState, firstAt).rows;
    let firstPass = detectTopics(initialPreview, firstAt, Math.max(active.inferredTopicSearches, 8));
    firstPass = attachSoundSignals(firstPass, initialPreview);
    firstPass = attachVisualSignals(firstPass, initialPreview, firstAt);
    firstPass = semanticConsolidateTopics(firstPass, initialPreview, firstAt);
    firstPass = consolidateTopicAliases(firstPass);
    const investigateCount = scanMode === 'deep' ? Math.max(4, active.inferredTopicSearches) : Math.min(2, Math.max(1, active.inferredTopicSearches));
    const rankedFirstPass = rankInvestigationCandidates(firstPass, initialPreview, { limit: Math.max(investigateCount * 2, 6), now: firstAt });
    await investigateTopics(rankedFirstPass.slice(0, investigateCount), active, scanMode, add, errors, investigated);

    let originSearches = 0;
    if (scanMode === 'deep' && rankedFirstPass.length) originSearches = await runOriginResearch(rankedFirstPass, active, add, errors);

    let result = mergeRichEvidence(evidence);
    if (scanMode === 'deep') result = await enrichCreatorFollowers(result, 16);
    const at = Date.now();
    const measured = attachObservedMetricVelocity(result, metricSnapshotState, at);
    result = measured.rows;
    metricSnapshotState = measured.state;
    writeJson(metricSnapshotPath, metricSnapshotState);
    let topics = detectTopics(result, at, 24);
    topics = attachSoundSignals(topics, result);
    topics = attachVisualSignals(topics, result, at);
    topics = semanticConsolidateTopics(topics, result, at);
    topics = consolidateTopicAliases(topics);
    topics = enrichMomentum(topics, topicHistory, at);
    const penetration = attachFeedPenetration(topics, result, penetrationState, at);
    topics = penetration.topics;
    topics = attachOriginResearch(topics, result, at);
    topics = rankInvestigationCandidates(topics, result, { limit: Math.max(24, topics.length), now: at });
    penetrationState = { ...penetrationState, ...penetration.state };
    writeJson(penetrationPath, penetrationState);
    topicHistory = [...topicHistory, topicSnapshot(topics, at)].filter((snapshot) => snapshot.at > at - 7 * 86400000).slice(-96);
    writeJson(historyPath, topicHistory);
    sourceReputation = updateSourceReputation(sourceReputation, result, topics, at);
    writeJson(reputationPath, sourceReputation);

    lastRun = at;
    lastCount = result.length;
    lastTopics = topics;
    lastError = errors.length ? errors.join(' | ') : null;
    const uniqueCreators = new Set(result.map((item) => `${item.platform}:${String(item.author).toLowerCase()}`)).size;
    const sounds = new Map();
    for (const item of result) if (item.platform === 'TikTok' && item.soundId) {
      const set = sounds.get(item.soundId) || new Set(); set.add(String(item.author).toLowerCase()); sounds.set(item.soundId, set);
    }
    lastAudit = {
      mode: scanMode,
      scoutSkillVersion: SCOUT_SKILL_VERSION,
      scoutPlan: earlyPlan,
      focusCandidates: earlyCandidates.slice(0, 3).map((topic) => ({ topic: topic.topic, key: topic.key, score: topic.scoutFocusScore, reasons: topic.scoutFocusReasons })),
      autoEscalation: input.autoEscalation || null,
      sourceCounts,
      feedAudits,
      collected: evidence.length,
      uniqueEvidence: result.length,
      uniqueCreators,
      forYouSampleSize: penetration.feedSampleSize,
      inferredTopics: topics.length,
      acceleratingTopics: topics.filter((topic) => topic.momentum?.label === 'Accelerating').length,
      risingFeedTopics: topics.filter((topic) => (topic.feedPenetrationVelocity || 0) > 0).length,
      newTopics: topics.filter((topic) => topic.momentum?.newTopic).length,
      measuredVelocityPosts: result.filter((row) => Number.isFinite(row.viewsPerMinute) || Number.isFinite(row.likesPerMinute)).length,
      repeatedTikTokSounds: [...sounds.values()].filter((creators) => creators.size >= 3).length,
      repeatedVisualTemplates: topics.reduce((sum, topic) => sum + (topic.visualSignals || []).filter((signal) => signal.creators >= 2).length, 0),
      semanticMergedTopics: topics.filter((topic) => topic.semanticMerged).length,
      visualHashes: result.filter((row) => row.visualHash).length,
      creatorFollowerCoverage: result.filter((row) => Number.isFinite(row.creatorFollowers)).length,
      originResearchRows: result.filter((row) => /origin research/i.test(row.provenance || '')).length,
      originSearches,
      sentinelsScanned: selection.accounts,
      sourceReputation: Object.fromEntries(selection.accounts.map((account) => [account, sourceReputation[account.toLowerCase()]?.score || 0])),
      errors: errors.length,
    };
    return { evidence: result, errors, inferredTopics: topics, audit: lastAudit, at: lastRun, config: active };
  } finally { running = false; }
}

function escalationOnCooldown(decision, now = Date.now()) {
  if (!decision?.trigger) return false;
  const key = decision.key || decision.topic || 'global';
  return now - Number(autoDeepState[key] || 0) < AUTO_DEEP_COOLDOWN_MS;
}
function recordEscalation(decision, now = Date.now()) {
  const key = decision.key || decision.topic || 'global';
  autoDeepState[key] = now;
  autoDeepState = Object.fromEntries(Object.entries(autoDeepState).filter(([, at]) => now - Number(at || 0) < 24 * 3600000));
  writeJson(escalationPath, autoDeepState);
}

function scheduleNext() {
  clearTimeout(scheduleTimer);
  nextScheduledRun = null;
  if (!config.enabled) return;
  const delay = config.intervalMinutes * 60000;
  nextScheduledRun = Date.now() + delay;
  scheduleTimer = setTimeout(async () => {
    nextScheduledRun = null;
    try {
      const scout = await collectAll({ ...config, mode: 'scout' });
      let queued = scout.evidence;
      const decision = shouldAutoDeep(scout.inferredTopics, scout.audit);
      if (decision.trigger && !escalationOnCooldown(decision)) {
        recordEscalation(decision);
        const deep = await collectAll({ ...config, mode: 'deep', autoEscalation: decision });
        queued = mergeRichEvidence([...scout.evidence, ...deep.evidence]);
      } else if (decision.trigger) {
        lastAudit = { ...(lastAudit || scout.audit), autoEscalation: { ...decision, skipped: 'cooldown' } };
      }
      queueEvidence(queued);
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    finally { scheduleNext(); }
  }, delay);
  scheduleTimer.unref?.();
}

function status() {
  return {
    ok: true,
    service: 'front-browser-bridge',
    version: 16,
    scanner: 'viral-narrative-scout-v16',
    running,
    lastRun,
    lastCount,
    lastError,
    lastTopics,
    lastAudit,
    topicHistoryCount: topicHistory.length,
    config,
    pendingCount: pendingEvidence.length,
    nextScheduledRun,
    loginBrowser: systemChrome ? 'system-chrome' : 'unavailable',
    scanConnection: browserConnection?.isConnected?.() ? 'attached' : 'waiting-for-front-chrome',
    cdpUrl,
    capabilities: [
      'x-for-you','tiktok-for-you','adaptive-scroll','signal-stop-scroll','viral-scout-skill','focus-first-investigation',
      'measured-snapshot-velocity','sentinel-rotation','candidate-investigation','feed-penetration','sound-signals',
      'source-reputation','alias-consolidation','semantic-context-clustering','visual-perceptual-hash',
      'creator-follower-enrichment','outbound-link-evidence','tiktok-duet-stitch-relations','origin-research','auto-deep-escalation',
    ],
  };
}

const server = http.createServer(async (req, res) => {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') return json(req, res, 204, {});
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(req, res, 200, status());
    if (req.method === 'GET' && url.pathname === '/config') return json(req, res, 200, config);
    if (req.method === 'GET' && url.pathname === '/pending') return json(req, res, 200, { evidence: pendingEvidence.slice(-250), count: pendingEvidence.length, lastRun, lastTopics, lastAudit });
    if (req.method === 'POST' && url.pathname === '/ack') {
      let body = ''; for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      return json(req, res, 200, { ok: true, removed: ackEvidence(parsed.ids), remaining: pendingEvidence.length });
    }
    if (req.method === 'POST' && url.pathname === '/config') {
      let body = ''; for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      config = activeConfig(parsed);
      writeJson(configPath, config);
      scheduleNext();
      return json(req, res, 200, { ok: true, config });
    }
    if (req.method === 'POST' && url.pathname === '/scan') {
      let body = ''; for await (const chunk of req) body += chunk;
      return json(req, res, 200, await collectAll(JSON.parse(body || '{}')));
    }
    if (req.method === 'POST' && url.pathname === '/open-login') {
      if (!systemChrome) throw new Error('Google Chrome is required for authenticated X/TikTok scans.');
      if (browserConnection?.isConnected?.()) await browserConnection.close().catch(() => {});
      browserConnection = undefined; context = undefined;
      stopExistingFrontChrome({ dataDir });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const opened = openRegularChromeForLogin({ dataDir, chromeExecutable: systemChrome, debuggingPort: cdpPort });
      try { await waitForCdp(opened.cdpUrl, { timeoutMs: 12000 }); }
      catch (error) { throw new Error(`Front Chrome opened, but its local scan connection did not start. ${error instanceof Error ? error.message : String(error)}`); }
      return json(req, res, 200, { ok: true, message: 'Front Chrome is ready. Sign in to X and TikTok. For best discovery quality, keep this dedicated profile broad rather than training it only on crypto.', profileDir: opened.profileDir, cdpUrl: opened.cdpUrl });
    }
    return json(req, res, 404, { error: 'Not found' });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return json(req, res, 500, { error: lastError });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Front browser bridge v${SCOUT_SKILL_VERSION} listening on http://${HOST}:${PORT}`);
  console.log('Discovery: Viral Scout → signal-aware scrolling → focus investigation → origin research → measured momentum + launch watch.');
  scheduleNext();
});
