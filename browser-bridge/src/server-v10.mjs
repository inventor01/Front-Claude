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
  .split(',').map((v) => v.trim()).filter(Boolean));
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
    const u = new URL(rawHref, 'https://ads.tiktok.com');
    const parts = u.pathname.split('/').filter(Boolean);
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

let browserConnection;
let context;
let config = normalizeAdaptiveConfig(normalizeConfig(readJson(configPath, {})), readJson(configPath, {}));
let pendingEvidence = mergeRichEvidence(readJson(pendingPath, [])).slice(-500);
let topicHistory = Array.isArray(readJson(historyPath, [])) ? readJson(historyPath, []).slice(-96) : [];
let seenState = readJson(seenPath, { X: [], TikTok: [] });
let penetrationState = readJson(penetrationPath, {});
let sourceReputation = readJson(reputationPath, {});
let sentinelRotation = readJson(rotationPath, { cursor: 0 });
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

async function adaptiveCollect(page, extractor, {
  platform,
  target,
  maxScrolls,
  stalePassLimit,
  maxSeconds,
  pauseMs = 900,
}) {
  const started = Date.now();
  let rows = [];
  let passes = 0;
  let stale = 0;
  let previousCount = 0;
  let novelCount = 0;
  const priorSeen = Array.isArray(seenState[platform]) ? seenState[platform] : [];
  while (true) {
    rows = mergeRichEvidence([...rows, ...(await extractor())]);
    const novelty = scanNovelty(rows, priorSeen);
    novelCount = novelty.newRows.length;
    const added = rows.length - previousCount;
    stale = added <= 1 ? stale + 1 : 0;
    previousCount = rows.length;
    if (novelCount >= target || passes >= maxScrolls || stale >= stalePassLimit || Date.now() - started >= maxSeconds * 1000) {
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
          stopReason: novelCount >= target ? 'target' : stale >= stalePassLimit ? 'stale' : passes >= maxScrolls ? 'scroll-cap' : 'time-cap',
        },
      };
    }
    passes += 1;
    await scrollViewport(page, pauseMs);
  }
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
    const directText = tweetTextParts.map((v) => v.trim()).filter(hasMeaningfulText).join(' ');
    if (!directText) continue;
    const text = cleanEvidenceContent('X', directText, author);
    if (!hasMeaningfulText(text)) continue;
    const quotedHref = statusLinks.find((candidate) => candidate !== href && !candidate.includes(href)) || null;
    const mediaType = await article.locator('[data-testid="videoPlayer"]').count().then((n) => n ? 'video' : null).catch(() => null)
      || await article.locator('[data-testid="tweetPhoto"]').count().then((n) => n ? 'image' : null).catch(() => null)
      || 'text';
    out.push({
      id: stableId('X', url, text),
      platform: 'X',
      author,
      url,
      content: text,
      published,
      views,
      likes,
      replies,
      reposts,
      bookmarks,
      quotes,
      quotedUrl: quotedHref ? (quotedHref.startsWith('http') ? quotedHref : `https://x.com${quotedHref}`) : null,
      hashtags: extractHashtags(text, 30),
      mediaType,
      provenance,
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
    return await adaptiveCollect(page, () => extractXArticles(page, active.targetUniqueFeedItems, 'Local Chrome browser · X For You feed'), {
      platform: 'X',
      target: active.targetUniqueFeedItems,
      maxScrolls: active.maxAdaptiveScrolls,
      stalePassLimit: active.stalePassLimit,
      maxSeconds: active.maxFeedScanSeconds,
      pauseMs: 850,
    });
  } finally { await page.close(); }
}

async function collectXQuery(query, limit, active, provenancePrefix = 'X Latest search') {
  const q = query.trim();
  if (!q) return [];
  const page = await newPage(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`);
  try {
    await page.waitForTimeout(2200);
    let out = [];
    for (let i = 0; i <= active.searchScrollPasses; i++) {
      out = mergeRichEvidence([...out, ...(await extractXArticles(page, limit, `Local Chrome browser · ${provenancePrefix} · query: ${q}`))]);
      if (out.length >= limit || i === active.searchScrollPasses) break;
      await scrollViewport(page, 700);
    }
    if (!out.length) throw new Error(`X returned no posts with real tweet text for “${q}”.`);
    return out.slice(0, limit);
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
    const music = node.music && typeof node.music === 'object' ? node.music : (node.sound && typeof node.sound === 'object' ? node.sound : {});
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
        soundId: String(music.id ?? music.musicId ?? music.music_id ?? '').slice(0, 80) || null,
        soundTitle: String(music.title ?? music.musicName ?? music.music_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
        soundAuthor: String(music.authorName ?? music.author_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null,
        coverUrl: String(node.video?.cover ?? node.video?.originCover ?? node.video?.dynamicCover ?? '').slice(0, 2048) || null,
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
    const a = anchors.nth(i);
    const href = await a.getAttribute('href').catch(() => null);
    if (!href) continue;
    const match = href.match(/\/@([^/]+)\/video\/(\d{10,25})/);
    if (!match) continue;
    if (!byId.has(match[2])) {
      const aria = (await a.getAttribute('aria-label').catch(() => null) || '').trim();
      const title = (await a.getAttribute('title').catch(() => null) || '').trim();
      const imageAlt = (await a.locator('img').first().getAttribute('alt').catch(() => null) || '').trim();
      const text = [aria, title, imageAlt].map((v) => cleanEvidenceContent('TikTok', v, match[1])).find(hasMeaningfulText) || '';
      if (text) byId.set(match[2], { id: match[2], content: text, author: match[1], published: null, views: null, likes: null, ...(rich.get(match[2]) || {}) });
    }
  }
  return [...byId.values()].slice(0, limit).flatMap((item) => {
    const author = item.author || 'TikTok';
    const url = author !== 'TikTok' ? `https://www.tiktok.com/@${author}/video/${item.id}` : `https://www.tiktok.com/video/${item.id}`;
    const content = cleanEvidenceContent('TikTok', item.content, author);
    if (!hasMeaningfulText(content)) return [];
    return [{
      id: `tiktok:browser:${item.id}`,
      platform: 'TikTok',
      author,
      url,
      content,
      published: item.published ?? null,
      views: item.views ?? null,
      likes: item.likes ?? null,
      comments: item.comments ?? null,
      shares: item.shares ?? null,
      saves: item.saves ?? null,
      soundId: item.soundId ?? null,
      soundTitle: item.soundTitle ?? null,
      soundAuthor: item.soundAuthor ?? null,
      coverUrl: item.coverUrl ?? null,
      hashtags: extractHashtags(content, 30),
      mediaType: 'video',
      provenance,
    }];
  });
}

async function collectTikTokForYou(active) {
  let page;
  try { page = await newPage('https://www.tiktok.com/foryou'); }
  catch { page = await newPage('https://www.tiktok.com/explore'); }
  try {
    await page.waitForTimeout(2800);
    return await adaptiveCollect(page, () => extractTikTokPage(page, 'Local Chrome browser · TikTok For You feed', active.targetUniqueFeedItems), {
      platform: 'TikTok',
      target: active.targetUniqueFeedItems,
      maxScrolls: active.maxAdaptiveScrolls,
      stalePassLimit: active.stalePassLimit,
      maxSeconds: active.maxFeedScanSeconds,
      pauseMs: 900,
    });
  } finally { await page.close(); }
}

async function collectTikTokSearch(topic, limit, active, provenancePrefix = 'TikTok search') {
  const q = sanitizeTopic(topic);
  if (!q) return [];
  const page = await newPage(`https://www.tiktok.com/search?q=${encodeURIComponent(q)}`);
  try {
    await page.waitForTimeout(2600);
    let out = [];
    for (let i = 0; i <= active.searchScrollPasses; i++) {
      out = mergeRichEvidence([...out, ...(await extractTikTokPage(page, `Local Chrome browser · ${provenancePrefix} · query: ${q}`, limit))]);
      if (out.length >= limit || i === active.searchScrollPasses) break;
      await scrollViewport(page, 800);
    }
    if (!out.length) throw new Error(`TikTok returned no videos with real caption metadata for “${q}”.`);
    return out.slice(0, limit);
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
  const queries = [topic.topic, ...(topic.aliases || [])]
    .map((x) => sanitizeTopic(x))
    .filter(hasMeaningfulText);
  return [...new Set(queries)].slice(0, deep ? 2 : 1);
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
    const add = (source, rows) => {
      evidence.push(...rows);
      sourceCounts[source] = (sourceCounts[source] || 0) + rows.length;
    };

    // For You feeds are the primary discovery surfaces. Trend pages are only seeds.
    if (active.scanXForYou !== false) {
      try { const result = await collectXForYou(active); add('X For You', result.rows); feedAudits.x = result.audit; }
      catch (error) { errors.push(`X For You: ${error.message}`); }
    }
    if (active.scanTikTokForYou !== false) {
      try { const result = await collectTikTokForYou(active); add('TikTok For You', result.rows); feedAudits.tiktok = result.audit; }
      catch (error) { errors.push(`TikTok For You: ${error.message}`); }
    }
    if (active.scanXExplore) {
      try { add('X Trending seeds', await collectXExplore(active.resultsPerQuery)); }
      catch (error) { errors.push(`X Explore: ${error.message}`); }
    }
    if (active.scanTikTokTrends) {
      try { add('TikTok Trending seeds', await collectTikTokTrends(active.resultsPerQuery * 2)); }
      catch (error) { errors.push(`TikTok trends: ${error.message}`); }
    }

    // A small rotating sentinel set replaces the old broad static-account sweep.
    const sentinelCount = scanMode === 'deep' ? active.sentinelAccountsPerDeep : active.sentinelAccountsPerScout;
    const selection = chooseSentinelAccounts(active.xAccounts, sourceReputation, sentinelRotation.cursor || 0, sentinelCount);
    sentinelRotation = { cursor: selection.nextCursor, at: Date.now(), last: selection.accounts };
    writeJson(rotationPath, sentinelRotation);
    for (const account of selection.accounts) {
      try { add('X Sentinel', await collectXQuery(`from:${account} -filter:replies`, Math.max(8, active.resultsPerQuery), active, `X sentinel @${account}`)); }
      catch (error) { errors.push(`X sentinel @${account}: ${error.message}`); }
    }

    for (const keyword of active.keywords.slice(0, scanMode === 'deep' ? 12 : 5)) {
      try { add('X Keyword Search', await collectXQuery(`"${keyword}" -filter:replies`, Math.max(8, active.resultsPerQuery), active)); }
      catch (error) { errors.push(`X ${keyword}: ${error.message}`); }
      if (scanMode === 'deep') {
        try { add('TikTok Keyword Search', await collectTikTokSearch(keyword, Math.max(8, active.resultsPerQuery), active)); }
        catch (error) { errors.push(`TikTok ${keyword}: ${error.message}`); }
      }
    }

    const firstAt = Date.now();
    let firstPass = detectTopics(mergeRichEvidence(evidence), firstAt, Math.max(active.inferredTopicSearches, 8));
    firstPass = attachSoundSignals(firstPass, mergeRichEvidence(evidence));
    firstPass = consolidateTopicAliases(firstPass);
    const investigateCount = scanMode === 'deep' ? Math.max(4, active.inferredTopicSearches) : Math.min(2, Math.max(1, active.inferredTopicSearches));
    const deepLimit = scanMode === 'deep' ? active.deepResultsPerQuery : Math.max(8, active.resultsPerQuery);
    for (const topic of firstPass.slice(0, investigateCount)) {
      for (const query of topicInvestigationQueries(topic, scanMode === 'deep')) {
        try { add('X Candidate Investigation', await collectXQuery(`"${query}" -filter:replies`, deepLimit, active, 'X candidate investigation')); }
        catch (error) { errors.push(`X investigate ${query}: ${error.message}`); }
        try { add('TikTok Candidate Investigation', await collectTikTokSearch(query, deepLimit, active, 'TikTok candidate investigation')); }
        catch (error) { errors.push(`TikTok investigate ${query}: ${error.message}`); }
      }
    }

    const result = mergeRichEvidence(evidence);
    const at = Date.now();
    let topics = detectTopics(result, at, 24);
    topics = attachSoundSignals(topics, result);
    topics = consolidateTopicAliases(topics);
    topics = enrichMomentum(topics, topicHistory, at);
    const penetration = attachFeedPenetration(topics, result, penetrationState, at);
    topics = penetration.topics;
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
      repeatedTikTokSounds: [...sounds.values()].filter((creators) => creators.size >= 3).length,
      sentinelsScanned: selection.accounts,
      sourceReputation: Object.fromEntries(selection.accounts.map((account) => [account, sourceReputation[account.toLowerCase()]?.score || 0])),
      errors: errors.length,
    };
    return { evidence: result, errors, inferredTopics: topics, audit: lastAudit, at: lastRun, config: active };
  } finally { running = false; }
}

function scheduleNext() {
  clearTimeout(scheduleTimer);
  nextScheduledRun = null;
  if (!config.enabled) return;
  const delay = config.intervalMinutes * 60000;
  nextScheduledRun = Date.now() + delay;
  scheduleTimer = setTimeout(async () => {
    nextScheduledRun = null;
    try { const result = await collectAll({ ...config, mode: 'scout' }); queueEvidence(result.evidence); }
    catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    finally { scheduleNext(); }
  }, delay);
  scheduleTimer.unref?.();
}

function status() {
  return {
    ok: true,
    service: 'front-browser-bridge',
    version: 10,
    scanner: 'for-you-adaptive',
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
    capabilities: ['x-for-you','tiktok-for-you','adaptive-scroll','sentinel-rotation','candidate-investigation','feed-penetration','sound-signals','source-reputation','alias-consolidation'],
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
  console.log(`Front browser bridge v10 listening on http://${HOST}:${PORT}`);
  console.log('Discovery: X For You + TikTok For You → infer → cross-platform investigate → measure penetration/momentum.');
  scheduleNext();
});
