import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { dedupeEvidence, extractHashtags, extractTikTokItemsFromJson, metricFromAria, normalizeConfig, sanitizeTopic, stableId, xTrendLabel } from './core.mjs';
import { findSystemChrome, frontCdpUrl, frontLoginProfileDir, openRegularChromeForLogin, stopExistingFrontChrome, waitForCdp } from './system-browser.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const profileDir = frontLoginProfileDir(dataDir);
const configPath = path.join(dataDir, 'config.json');
const systemChrome = findSystemChrome();
const cdpPort = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const cdpUrl = frontCdpUrl(cdpPort);
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set(
  (process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
fs.mkdirSync(profileDir, { recursive: true });

let browserConnection;
let context;
let config = normalizeConfig(readJson(configPath, {}));
let running = false;
let lastRun = null;
let lastError = null;
let lastCount = 0;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
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
function originAllowed(req) {
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}
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

async function ensureBrowser() {
  if (context && browserConnection?.isConnected?.()) return context;
  if (!systemChrome) throw new Error('Google Chrome is required for authenticated X/TikTok scans. Install Chrome, then restart the Front browser bridge.');
  try {
    browserConnection = await chromium.connectOverCDP(cdpUrl);
    context = browserConnection.contexts()[0];
    if (!context) throw new Error('Front Chrome did not expose its browser context.');
    browserConnection.on('disconnected', () => {
      browserConnection = undefined;
      context = undefined;
    });
    return context;
  } catch (error) {
    browserConnection = undefined;
    context = undefined;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Front login Chrome is not available for scanning. Click Open X + TikTok login, finish signing in, and LEAVE that Front Chrome window open while scanning. (${detail})`);
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

async function collectXQuery(query, limit) {
  const q = query.trim();
  if (!q) return [];
  const page = await newPage(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`);
  try {
    await page.waitForTimeout(2600);
    const articles = page.locator('article[data-testid="tweet"]');
    const count = Math.min(await articles.count(), limit);
    const out = [];
    for (let i = 0; i < count; i++) {
      const article = articles.nth(i);
      const text = (await article.innerText().catch(() => '')).trim();
      if (!text) continue;
      const link = article.locator('a[href*="/status/"]').first();
      const href = await link.getAttribute('href').catch(() => null);
      if (!href) continue;
      const url = href.startsWith('http') ? href : `https://x.com${href}`;
      const time = article.locator('time').first();
      const dt = await time.getAttribute('datetime').catch(() => null);
      const published = dt && Number.isFinite(Date.parse(dt)) ? Date.parse(dt) : null;
      const aria = await article.getAttribute('aria-label').catch(() => '') || text;
      const views = metricFromAria(aria, 'views');
      const likes = metricFromAria(aria, 'likes');
      const authorHref = await article.locator('a[href^="/"][role="link"]').first().getAttribute('href').catch(() => null);
      const author = authorHref ? authorHref.split('/').filter(Boolean)[0] : 'X';
      out.push({
        id: stableId('X', url, text), platform: 'X', author, url, content: text,
        published, views, likes,
        provenance: `Local Chrome browser · X Latest search · query: ${q}`,
      });
    }
    if (!out.length) throw new Error(`X returned no posts for “${q}”. Confirm the Front Chrome session is signed in and the search page is accessible.`);
    return out;
  } finally { await page.close(); }
}

async function collectXExplore(limit) {
  const page = await newPage('https://x.com/explore/tabs/trending');
  try {
    await page.waitForTimeout(3000);
    const candidates = page.locator('a[href*="/search?q="], [data-testid="trend"]');
    const count = Math.min(await candidates.count(), Math.max(limit * 3, limit));
    const out = [];
    for (let i = 0; i < count && out.length < limit; i++) {
      const item = candidates.nth(i);
      const raw = (await item.innerText().catch(() => '')).trim();
      const text = xTrendLabel(raw);
      if (!text) continue;
      const href = await item.getAttribute('href').catch(() => null);
      const url = href
        ? (href.startsWith('http') ? href : `https://x.com${href}`)
        : `https://x.com/search?q=${encodeURIComponent(text)}&src=trend_click&f=live`;
      out.push({ id: stableId('X', url, text), platform: 'X', author: 'X Explore', url, content: text, published: null, views: null, likes: null, provenance: 'Local Chrome browser · X Explore trending' });
    }
    if (!out.length) {
      const body = await page.locator('body').innerText().catch(() => '');
      for (const tag of extractHashtags(body, limit)) {
        const url = `https://x.com/search?q=${encodeURIComponent('#' + tag)}&src=trend_click&f=live`;
        out.push({ id: stableId('X', url, tag), platform: 'X', author: 'X Explore', url, content: `#${tag}`, published: null, views: null, likes: null, provenance: 'Local Chrome browser · X Explore hashtag fallback' });
      }
    }
    if (!out.length) throw new Error('X Explore loaded but no trend evidence was extractable. Confirm the Front Chrome session is signed in and Explore is available.');
    return out;
  } finally { await page.close(); }
}

async function collectTikTokSearch(topic, limit) {
  const q = sanitizeTopic(topic);
  if (!q) return [];
  const page = await newPage(`https://www.tiktok.com/search?q=${encodeURIComponent(q)}`);
  try {
    await page.waitForTimeout(3200);
    const extracted = await page.evaluate(() => {
      const scripts = Array.from(document.scripts).map((s) => s.textContent || '').filter(Boolean);
      const json = [];
      for (const text of scripts) {
        const value = text.trim();
        if (!value.startsWith('{') && !value.startsWith('[')) continue;
        try { json.push(JSON.parse(value)); } catch {}
      }
      return json;
    });
    const items = [];
    for (const value of extracted) items.push(...extractTikTokItemsFromJson(value));
    const unique = new Map(items.map((item) => [item.id, item]));
    const out = [...unique.values()].slice(0, limit).map((item) => {
      const author = item.author || 'TikTok';
      const url = author !== 'TikTok' ? `https://www.tiktok.com/@${author}/video/${item.id}` : `https://www.tiktok.com/video/${item.id}`;
      return { id: `tiktok:browser:${item.id}`, platform: 'TikTok', author, url, content: item.content, published: item.published, views: item.views, likes: item.likes, provenance: `Local Chrome browser · TikTok search · query: ${q}` };
    });
    if (!out.length) throw new Error(`TikTok returned no extractable videos for “${q}”. The page may require verification or TikTok may have changed its page data.`);
    return out;
  } finally { await page.close(); }
}

async function collectTikTokExplore(limit) {
  const page = await newPage('https://www.tiktok.com/explore');
  try {
    await page.waitForTimeout(3500);
    const extracted = await page.evaluate(() => {
      const json = [];
      for (const script of Array.from(document.scripts)) {
        const value = (script.textContent || '').trim();
        if (!value.startsWith('{') && !value.startsWith('[')) continue;
        try { json.push(JSON.parse(value)); } catch {}
      }
      return json;
    });
    const items = [];
    for (const value of extracted) items.push(...extractTikTokItemsFromJson(value));
    const unique = new Map(items.map((item) => [item.id, item]));
    const out = [...unique.values()].slice(0, limit).map((item) => {
      const author = item.author || 'TikTok';
      const url = author !== 'TikTok' ? `https://www.tiktok.com/@${author}/video/${item.id}` : `https://www.tiktok.com/video/${item.id}`;
      return { id: `tiktok:browser:${item.id}`, platform: 'TikTok', author, url, content: item.content, published: item.published, views: item.views, likes: item.likes, provenance: 'Local Chrome browser · TikTok Explore fallback' };
    });
    if (!out.length) throw new Error('TikTok Explore loaded but no extractable videos were found.');
    return out;
  } finally { await page.close(); }
}

async function collectTikTokTrends(limit) {
  let creativeError = null;
  try {
    const page = await newPage('https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en');
    try {
      await page.waitForTimeout(3500);
      const rows = page.locator('a[href*="/hashtag/"], a[href*="/trends/"]');
      const count = Math.min(await rows.count(), Math.max(limit * 3, limit));
      const out = [];
      for (let i = 0; i < count && out.length < limit; i++) {
        const row = rows.nth(i);
        const text = (await row.innerText().catch(() => '')).replace(/\n+/g, ' · ').trim();
        const href = await row.getAttribute('href').catch(() => null);
        if (!text || !href) continue;
        const url = href.startsWith('http') ? href : `https://ads.tiktok.com${href}`;
        out.push({ id: stableId('TikTok', url, text), platform: 'TikTok', author: 'TikTok Creative Center', url, content: text, published: null, views: null, likes: null, provenance: 'Local Chrome browser · TikTok Creative Center trends' });
      }
      if (!out.length) {
        const body = await page.locator('body').innerText().catch(() => '');
        for (const tag of extractHashtags(body, limit)) {
          const url = `https://www.tiktok.com/search?q=${encodeURIComponent(tag)}`;
          out.push({ id: stableId('TikTok', url, tag), platform: 'TikTok', author: 'TikTok Creative Center', url, content: `#${tag}`, published: null, views: null, likes: null, provenance: 'Local Chrome browser · TikTok Creative Center hashtag fallback' });
        }
      }
      if (out.length) return out;
      creativeError = new Error('Creative Center loaded but no trend evidence was extractable.');
    } finally { await page.close(); }
  } catch (error) {
    creativeError = error;
  }

  try {
    return await collectTikTokExplore(limit);
  } catch (fallbackError) {
    const primary = creativeError instanceof Error ? creativeError.message : String(creativeError || 'unknown Creative Center failure');
    const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`Creative Center unavailable (${primary}); TikTok Explore fallback also failed (${fallback}).`);
  }
}

async function collectAll(input = {}) {
  if (running) throw new Error('A browser scan is already running.');
  running = true;
  lastError = null;
  try {
    const active = normalizeConfig({ ...config, ...input });
    const evidence = [];
    const errors = [];
    if (active.scanXExplore) {
      try { evidence.push(...await collectXExplore(active.resultsPerQuery)); } catch (e) { errors.push(`X Explore: ${e.message}`); }
    }
    for (const account of active.xAccounts.slice(0, 25)) {
      try { evidence.push(...await collectXQuery(`from:${account} -filter:replies`, active.resultsPerQuery)); } catch (e) { errors.push(`X @${account}: ${e.message}`); }
    }
    for (const keyword of active.keywords.slice(0, 20)) {
      try { evidence.push(...await collectXQuery(`"${keyword}" -filter:replies`, active.resultsPerQuery)); } catch (e) { errors.push(`X ${keyword}: ${e.message}`); }
    }
    if (active.scanTikTokTrends) {
      try {
        const trends = await collectTikTokTrends(active.resultsPerQuery * 2);
        evidence.push(...trends);
        const trendTopics = trends.map((x) => sanitizeTopic(x.content.split('·')[0])).filter(Boolean).slice(0, active.maxTrendQueries);
        for (const topic of trendTopics) {
          try { evidence.push(...await collectTikTokSearch(topic, active.resultsPerQuery)); } catch (e) { errors.push(`TikTok ${topic}: ${e.message}`); }
        }
      } catch (e) { errors.push(`TikTok trends: ${e.message}`); }
    }
    for (const keyword of active.keywords.slice(0, active.maxTrendQueries)) {
      try { evidence.push(...await collectTikTokSearch(keyword, active.resultsPerQuery)); } catch (e) { errors.push(`TikTok ${keyword}: ${e.message}`); }
    }
    const result = dedupeEvidence(evidence);
    lastRun = Date.now();
    lastCount = result.length;
    lastError = errors.length ? errors.join(' | ') : null;
    return { evidence: result, errors, at: lastRun, config: active };
  } finally { running = false; }
}

function status() {
  return {
    ok: true,
    service: 'front-browser-bridge',
    version: 5,
    running,
    lastRun,
    lastCount,
    lastError,
    config,
    loginBrowser: systemChrome ? 'system-chrome' : 'unavailable',
    scanConnection: browserConnection?.isConnected?.() ? 'attached' : 'waiting-for-front-chrome',
    cdpUrl,
  };
}

const server = http.createServer(async (req, res) => {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') return json(req, res, 204, {});
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(req, res, 200, status());
    if (req.method === 'GET' && url.pathname === '/config') return json(req, res, 200, config);
    if (req.method === 'POST' && url.pathname === '/config') {
      let body = '';
      for await (const chunk of req) body += chunk;
      config = normalizeConfig(JSON.parse(body || '{}'));
      writeJson(configPath, config);
      return json(req, res, 200, { ok: true, config });
    }
    if (req.method === 'POST' && url.pathname === '/scan') {
      let body = '';
      for await (const chunk of req) body += chunk;
      return json(req, res, 200, await collectAll(JSON.parse(body || '{}')));
    }
    if (req.method === 'POST' && url.pathname === '/open-login') {
      if (!systemChrome) throw new Error('Google Chrome is required for authenticated X/TikTok scans. Install Chrome, then restart the Front browser bridge.');
      if (browserConnection?.isConnected?.()) await browserConnection.close().catch(() => {});
      browserConnection = undefined;
      context = undefined;
      stopExistingFrontChrome({ dataDir });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const opened = openRegularChromeForLogin({ dataDir, chromeExecutable: systemChrome, debuggingPort: cdpPort });
      try {
        await waitForCdp(opened.cdpUrl, { timeoutMs: 12000 });
      } catch (error) {
        throw new Error(`Front Chrome opened, but its local scan connection did not start. Close the Front Chrome window and click Open X + TikTok login once more. ${(error instanceof Error ? error.message : String(error))}`);
      }
      return json(req, res, 200, {
        ok: true,
        message: 'Front Chrome is ready for scanning. Sign in to X and TikTok, LEAVE this Front Chrome window open (it can be minimized), then click Run browser scan.',
        profileDir: opened.profileDir,
        cdpUrl: opened.cdpUrl,
      });
    }
    return json(req, res, 404, { error: 'Not found' });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return json(req, res, 500, { error: lastError });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[front-bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[front-bridge] browser profile: ${profileDir}`);
  console.log(`[front-bridge] login browser: ${systemChrome || 'Google Chrome not found'}`);
  console.log(`[front-bridge] scan connection: ${cdpUrl}`);
  console.log(`[front-bridge] allowed origins: ${[...allowedOrigins].join(', ')}`);
});
