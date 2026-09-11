import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { dedupeEvidence, extractTikTokItemsFromJson, metricFromAria, normalizeConfig, sanitizeTopic, stableId } from './core.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const profileDir = path.join(dataDir, 'profile');
const configPath = path.join(dataDir, 'config.json');
fs.mkdirSync(profileDir, { recursive: true });

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
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}
async function ensureBrowser() {
  if (context) return context;
  context = await chromium.launchPersistentContext(profileDir, {
    headless: process.env.FRONT_BRIDGE_HEADLESS === '1',
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  });
  context.on('close', () => { context = undefined; });
  return context;
}
async function newPage(url) {
  const browser = await ensureBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page;
}

async function collectXQuery(query, limit) {
  const q = query.trim();
  if (!q) return [];
  const page = await newPage(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`);
  try {
    await page.waitForTimeout(2200);
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
        provenance: `Local Playwright browser · X Latest search · query: ${q}`,
      });
    }
    return out;
  } finally { await page.close(); }
}

async function collectXExplore(limit) {
  const page = await newPage('https://x.com/explore/tabs/trending');
  try {
    await page.waitForTimeout(2200);
    const links = page.locator('a[href*="/search?q="]');
    const count = Math.min(await links.count(), limit);
    const out = [];
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const text = (await link.innerText().catch(() => '')).replace(/\n+/g, ' · ').trim();
      const href = await link.getAttribute('href').catch(() => null);
      if (!text || !href) continue;
      const url = href.startsWith('http') ? href : `https://x.com${href}`;
      out.push({ id: stableId('X', url, text), platform: 'X', author: 'X Explore', url, content: text, published: null, views: null, likes: null, provenance: 'Local Playwright browser · X Explore trending' });
    }
    return out;
  } finally { await page.close(); }
}

async function collectTikTokSearch(topic, limit) {
  const q = sanitizeTopic(topic);
  if (!q) return [];
  const page = await newPage(`https://www.tiktok.com/search?q=${encodeURIComponent(q)}`);
  try {
    await page.waitForTimeout(2600);
    const extracted = await page.evaluate(() => {
      const scripts = Array.from(document.scripts).map((s) => s.textContent || '').filter(Boolean);
      const json = [];
      for (const text of scripts) {
        if (!text.trim().startsWith('{')) continue;
        try { json.push(JSON.parse(text)); } catch {}
      }
      return json;
    });
    const items = [];
    for (const value of extracted) items.push(...extractTikTokItemsFromJson(value));
    const unique = new Map(items.map((item) => [item.id, item]));
    return [...unique.values()].slice(0, limit).map((item) => {
      const author = item.author || 'TikTok';
      const url = author !== 'TikTok' ? `https://www.tiktok.com/@${author}/video/${item.id}` : `https://www.tiktok.com/video/${item.id}`;
      return { id: `tiktok:browser:${item.id}`, platform: 'TikTok', author, url, content: item.content, published: item.published, views: item.views, likes: item.likes, provenance: `Local Playwright browser · TikTok search · query: ${q}` };
    });
  } finally { await page.close(); }
}

async function collectTikTokTrends(limit) {
  const page = await newPage('https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en');
  try {
    await page.waitForTimeout(2500);
    const rows = page.locator('a[href*="/hashtag/"]');
    const count = Math.min(await rows.count(), limit);
    const out = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const text = (await row.innerText().catch(() => '')).replace(/\n+/g, ' · ').trim();
      const href = await row.getAttribute('href').catch(() => null);
      if (!text || !href) continue;
      const url = href.startsWith('http') ? href : `https://ads.tiktok.com${href}`;
      out.push({ id: stableId('TikTok', url, text), platform: 'TikTok', author: 'TikTok Creative Center', url, content: text, published: null, views: null, likes: null, provenance: 'Local Playwright browser · TikTok Creative Center trends' });
    }
    return out;
  } finally { await page.close(); }
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
  return { ok: true, service: 'front-browser-bridge', version: 1, running, lastRun, lastCount, lastError, config, profileDir };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, status());
    if (req.method === 'GET' && url.pathname === '/config') return json(res, 200, config);
    if (req.method === 'POST' && url.pathname === '/config') {
      let body = '';
      for await (const chunk of req) body += chunk;
      config = normalizeConfig(JSON.parse(body || '{}'));
      writeJson(configPath, config);
      return json(res, 200, { ok: true, config });
    }
    if (req.method === 'POST' && url.pathname === '/scan') {
      let body = '';
      for await (const chunk of req) body += chunk;
      return json(res, 200, await collectAll(JSON.parse(body || '{}')));
    }
    if (req.method === 'POST' && url.pathname === '/open-login') {
      const browser = await ensureBrowser();
      const x = await browser.newPage();
      await x.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45000 });
      const tiktok = await browser.newPage();
      await tiktok.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      return json(res, 200, { ok: true, message: 'X and TikTok opened in the local persistent browser profile. Sign in there once, then run a scan.' });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return json(res, 500, { error: lastError });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[front-bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[front-bridge] browser profile: ${profileDir}`);
});
