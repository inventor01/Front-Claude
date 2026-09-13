import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { cleanEvidenceContent, extractHashtags, normalizeConfig, sanitizeTopic, stableId } from './core.mjs';
import { detectTopics } from './topic-engine.mjs';
import { attachSoundSignals, consolidateTopicAliases, mergeRichEvidence, normalizeAdaptiveConfig } from './adaptive-intelligence.mjs';
import { attachVisualSignals, semanticConsolidateTopics } from './advanced-intelligence.mjs';
import { rankInvestigationCandidates } from './scout-skill.mjs';
import { ContentUnderstandingEngine } from './content-understanding.mjs';
import { BroadTikTokObserver } from './tiktok-observer-v21.mjs';
import {
  findSystemChrome,
  frontCdpUrl,
  frontLoginProfileDir,
  openRegularChromeForLogin,
  stopExistingFrontChrome,
  waitForCdp,
} from './system-browser.mjs';

export const V25_VERSION = 25;
const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const CDP_PORT = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const CDP_URL = frontCdpUrl(CDP_PORT);
const DATA_DIR = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const LEDGER_PATH = path.join(DATA_DIR, 'scan-ledger-v25.json');
const PENDING_PATH = path.join(DATA_DIR, 'pending-evidence-v25.json');
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set((process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',').map((value) => value.trim()).filter(Boolean));
const systemChrome = findSystemChrome();
fs.mkdirSync(DATA_DIR, { recursive: true });

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function scanId() { return `v25-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function hasText(value) {
  const text = clean(value, 2000);
  if (text.length < 3 || !/[\p{L}]/u.test(text)) return false;
  if (/^(?:home|explore|for you|following|search|profile|video|photo|sound|show more|more|views?|likes?|shares?|comments?)$/i.test(text)) return false;
  return true;
}
function canonicalXUrl(raw) {
  try {
    const url = new URL(raw, 'https://x.com');
    if (!/(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname)) return null;
    url.search = ''; url.hash = '';
    return url.toString();
  } catch { return null; }
}
function canonicalTikTokUrl(raw) {
  try {
    const url = new URL(raw, 'https://www.tiktok.com');
    const match = url.pathname.match(/\/@([^/]+)\/video\/(\d{10,25})/);
    if (!match) return null;
    return `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
  } catch { return null; }
}
function deriveTopics(rows = [], limit = 24) {
  if (!rows.length) return [];
  const at = Date.now();
  let topics = detectTopics(rows, at, limit);
  topics = attachSoundSignals(topics, rows);
  topics = attachVisualSignals(topics, rows, at);
  topics = semanticConsolidateTopics(topics, rows, at);
  topics = consolidateTopicAliases(topics);
  return rankInvestigationCandidates(topics, rows, { limit, now: at });
}
function summarizeRows(rows = []) {
  const platformCounts = {};
  for (const row of rows) platformCounts[row.platform] = (platformCounts[row.platform] || 0) + 1;
  return { observed: rows.length, platformCounts };
}
function requestSummary(body = {}) {
  return {
    mode: body.mode === 'scout' ? 'scout' : 'deep',
    targetUniqueFeedItems: Math.max(30, Math.min(180, Number(body.targetUniqueFeedItems || 90))),
    scanXForYou: body.scanXForYou !== false,
    scanTikTokForYou: body.scanTikTokForYou !== false,
    keywords: Array.isArray(body.keywords) ? body.keywords.map((x) => clean(x, 120)).filter(Boolean).slice(0, 12) : [],
  };
}

let config = normalizeAdaptiveConfig(normalizeConfig(readJson(CONFIG_PATH, {})), readJson(CONFIG_PATH, {}));
let scans = readJson(LEDGER_PATH, []);
if (!Array.isArray(scans)) scans = [];
scans = scans.slice(-100);
let pendingEvidence = readJson(PENDING_PATH, []);
if (!Array.isArray(pendingEvidence)) pendingEvidence = [];
pendingEvidence = pendingEvidence.slice(-500);
let browserConnection = null;
let browserContext = null;
let current = null;
let latestLive = {
  ok: true, version: V25_VERSION, active: false, status: 'idle', phase: 'idle', scanId: null,
  observed: 0, candidateTopics: 0, platformCounts: {}, sourcePages: [], errors: [], evidence: [], inferredTopics: [], stages: {},
};
const understanding = new ContentUnderstandingEngine({ dataDir: DATA_DIR });
const tiktok = new BroadTikTokObserver({ cdpUrl: CDP_URL, intervalMs: Number(process.env.FRONT_TIKTOK_OBSERVER_MS || 850) });

function saveLedger() { writeJson(LEDGER_PATH, scans.slice(-100)); }
function savePending() { writeJson(PENDING_PATH, pendingEvidence.slice(-500)); }
function stage(name, patch = {}) {
  latestLive = {
    ...latestLive,
    stages: {
      ...latestLive.stages,
      [name]: { ...(latestLive.stages[name] || {}), ...patch, updatedAt: Date.now() },
    },
  };
}
function livePayload() {
  return {
    ...latestLive,
    tiktokDiscovery: latestLive.stages?.tiktokDiscovery || {
      observed: 0, grounded: 0, target: latestLive.request?.targetUniqueFeedItems || 90,
      active: false, status: 'idle', sourcePages: [], errors: [],
    },
  };
}
function setPhase(phase) {
  if (!current) return;
  current.phase = phase;
  current.heartbeatAt = Date.now();
  latestLive = { ...latestLive, phase, updatedAt: Date.now() };
}
function shouldStop() { return Boolean(current?.stopRequested); }
async function ensureContext() {
  if (browserContext && browserConnection?.isConnected?.()) return browserContext;
  browserConnection = await chromium.connectOverCDP(CDP_URL, { noDefaults: true });
  browserContext = browserConnection.contexts()[0];
  if (!browserContext) throw new Error('Front Chrome did not expose a browser context.');
  browserConnection.on('disconnected', () => { browserConnection = null; browserContext = null; });
  return browserContext;
}
async function openOwnedPage(url) {
  const context = await ensureContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    return page;
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

async function extractX(page, provenance, limit = 120) {
  const raw = await page.evaluate((max) => {
    return [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0, max).map((article) => {
      const status = [...article.querySelectorAll('a[href*="/status/"]')].map((a) => a.href || a.getAttribute('href')).find(Boolean) || '';
      const text = [...article.querySelectorAll('[data-testid="tweetText"]')].map((n) => n.textContent || '').join(' ').trim();
      const published = article.querySelector('time')?.getAttribute('datetime') || null;
      const poster = article.querySelector('video')?.getAttribute('poster') || article.querySelector('[data-testid="tweetPhoto"] img')?.getAttribute('src') || null;
      const video = Boolean(article.querySelector('video,[data-testid="videoPlayer"]'));
      return { status, text, published, poster, video };
    });
  }, Math.max(limit * 2, limit)).catch(() => []);
  const out = [];
  for (const row of raw) {
    const url = canonicalXUrl(row.status);
    if (!url || !hasText(row.text)) continue;
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const author = parts[0] || 'X';
    const content = cleanEvidenceContent('X', row.text, author);
    if (!hasText(content)) continue;
    out.push({
      id: stableId('X', url, content), platform: 'X', author, url, content,
      published: row.published && Number.isFinite(Date.parse(row.published)) ? Date.parse(row.published) : null,
      views: null, likes: null, coverUrl: row.poster, mediaType: row.video ? 'video' : (row.poster ? 'image' : 'text'),
      hashtags: extractHashtags(content, 30), provenance, firstObserved: Date.now(),
    });
  }
  return mergeRichEvidence(out).slice(0, limit);
}

async function collectXFeed(target, maxSeconds = 70) {
  const page = await openOwnedPage('https://x.com/home');
  const started = Date.now();
  const rows = new Map();
  let scrolls = 0;
  let stale = 0;
  let lastSize = 0;
  try {
    await page.waitForTimeout(2200);
    const tab = page.getByRole('tab', { name: /^For you$/i }).first();
    if (await tab.count().catch(() => 0)) await tab.click({ timeout: 2000 }).catch(() => {});
    while (!shouldStop() && Date.now() - started < maxSeconds * 1000 && rows.size < target && scrolls < 24 && stale < 4) {
      for (const row of await extractX(page, 'Front v25 · X dedicated For You collector', target)) rows.set(row.id, row);
      stale = rows.size <= lastSize + 1 ? stale + 1 : 0;
      lastSize = rows.size;
      stage('xDiscovery', { status: 'running', observed: rows.size, target, scrolls, sourcePage: page.url(), stalePasses: stale });
      latestLive = { ...latestLive, sourcePages: [...new Set([...latestLive.sourcePages.filter((x) => !/x\.com/i.test(x)), page.url()])], updatedAt: Date.now() };
      if (rows.size >= target) break;
      await page.mouse.wheel(0, Math.max(900, await page.evaluate(() => innerHeight * 0.95).catch(() => 900))).catch(() => {});
      await page.waitForTimeout(800);
      scrolls += 1;
    }
    stage('xDiscovery', { status: shouldStop() ? 'stopped' : 'complete', observed: rows.size, target, scrolls, elapsedMs: Date.now() - started });
    return [...rows.values()];
  } finally { await page.close().catch(() => {}); }
}

async function extractTikTokSearch(page, provenance, limit = 40) {
  const raw = await page.evaluate((max) => [...document.querySelectorAll('a[href*="/video/"]')].slice(0, max * 4).map((link) => {
    const container = link.closest('[data-e2e*="search-card"], [data-e2e*="recommend-list-item-container"], article') || link.parentElement?.parentElement?.parentElement || link.parentElement;
    const image = link.querySelector('img') || container?.querySelector?.('img');
    return { href: link.href || link.getAttribute('href') || '', text: (container?.innerText || link.getAttribute('aria-label') || image?.getAttribute('alt') || '').slice(0, 5000), coverUrl: image?.getAttribute('src') || null };
  }), limit).catch(() => []);
  const rows = [];
  const seen = new Set();
  for (const item of raw) {
    const url = canonicalTikTokUrl(item.href);
    if (!url || seen.has(url) || !hasText(item.text)) continue;
    seen.add(url);
    const match = new URL(url).pathname.match(/\/@([^/]+)\/video\/(\d{10,25})/);
    if (!match) continue;
    const author = match[1];
    const content = cleanEvidenceContent('TikTok', item.text, author);
    if (!hasText(content)) continue;
    rows.push({ id: `tiktok:browser:${match[2]}`, platform: 'TikTok', author, url, content, published: null, views: null, likes: null, coverUrl: item.coverUrl, mediaType: 'video', hashtags: extractHashtags(content, 30), provenance, firstObserved: Date.now() });
    if (rows.length >= limit) break;
  }
  return rows;
}

async function collectSearch(platform, query, limit = 24) {
  const q = sanitizeTopic(query);
  if (!q || shouldStop()) return [];
  const url = platform === 'X'
    ? `https://x.com/search?q=${encodeURIComponent(`\"${q}\" -filter:replies`)}&src=typed_query&f=live`
    : `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`;
  const page = await openOwnedPage(url);
  try {
    await page.waitForTimeout(platform === 'X' ? 1800 : 2300);
    let out = [];
    for (let pass = 0; pass < 4 && out.length < limit && !shouldStop(); pass++) {
      const rows = platform === 'X'
        ? await extractX(page, `Front v25 · X origin/investigation · ${q}`, limit)
        : await extractTikTokSearch(page, `Front v25 · TikTok origin/investigation · ${q}`, limit);
      out = mergeRichEvidence([...out, ...rows]);
      if (out.length >= limit) break;
      await page.mouse.wheel(0, 950).catch(() => {});
      await page.waitForTimeout(650);
    }
    return out.slice(0, limit);
  } finally { await page.close().catch(() => {}); }
}

async function collectTikTokFeed(target, maxSeconds = 70) {
  const started = Date.now();
  tiktok.start({ targetUniqueFeedItems: target });
  try {
    while (!shouldStop() && Date.now() - started < maxSeconds * 1000) {
      const snap = tiktok.snapshot();
      stage('tiktokDiscovery', {
        status: snap.status, active: snap.active, observed: snap.observed, grounded: snap.grounded, target: snap.target,
        sourcePages: snap.sourcePages, errors: snap.errors, elapsedMs: Date.now() - started,
      });
      latestLive = { ...latestLive, sourcePages: [...new Set([...latestLive.sourcePages.filter((x) => !/tiktok\.com/i.test(x)), ...snap.sourcePages])], updatedAt: Date.now() };
      if (snap.observed >= target) break;
      await sleep(700);
    }
    const snap = tiktok.snapshot();
    stage('tiktokDiscovery', {
      status: shouldStop() ? 'stopped' : 'complete', active: false, observed: snap.observed, grounded: snap.grounded,
      target: snap.target, sourcePages: snap.sourcePages, errors: snap.errors, elapsedMs: Date.now() - started,
    });
    return { evidence: tiktok.groundedEvidence(), snapshot: snap };
  } finally {
    tiktok.stop(shouldStop() ? 'stopped' : 'complete');
  }
}

async function addOriginResearch(rows, topics, mode) {
  if (mode !== 'deep' || shouldStop()) return rows;
  const merged = [...rows];
  const candidates = topics.slice(0, 3);
  let searched = 0;
  for (const topic of candidates) {
    const q = sanitizeTopic(topic.topic || topic.key || '');
    if (!q || shouldStop()) continue;
    stage('originResearch', { status: 'running', searched, total: candidates.length * 2, current: q });
    try { merged.push(...await collectSearch('X', q, 24)); } catch (error) { latestLive.errors.push(`X origin ${q}: ${clean(error?.message || error, 240)}`); }
    searched += 1;
    try { merged.push(...await collectSearch('TikTok', q, 24)); } catch (error) { latestLive.errors.push(`TikTok origin ${q}: ${clean(error?.message || error, 240)}`); }
    searched += 1;
  }
  stage('originResearch', { status: shouldStop() ? 'stopped' : 'complete', searched, total: candidates.length * 2 });
  return mergeRichEvidence(merged);
}

async function runScan(body = {}) {
  if (current) throw new Error('A scan is already running. Use Stop scan before starting another one.');
  const request = requestSummary({ ...config, ...body });
  const id = scanId();
  current = { id, status: 'running', phase: 'starting', startedAt: Date.now(), heartbeatAt: Date.now(), request, stopRequested: false };
  latestLive = {
    ok: true, version: V25_VERSION, active: true, status: 'running', phase: 'starting', scanId: id,
    startedAt: current.startedAt, updatedAt: Date.now(), completedAt: null, observed: 0, candidateTopics: 0,
    platformCounts: {}, sourcePages: [], errors: [], request, evidence: [], inferredTopics: [], stages: {
      chrome: { status: 'starting', updatedAt: Date.now() },
      xDiscovery: { status: request.scanXForYou ? 'pending' : 'disabled', observed: 0, target: request.targetUniqueFeedItems, updatedAt: Date.now() },
      tiktokDiscovery: { status: request.scanTikTokForYou ? 'pending' : 'disabled', active: request.scanTikTokForYou, observed: 0, grounded: 0, target: request.targetUniqueFeedItems, sourcePages: [], errors: [], updatedAt: Date.now() },
      visualUnderstanding: { status: 'pending', updatedAt: Date.now() },
      narrativeEngine: { status: 'pending', updatedAt: Date.now() },
      originResearch: { status: request.mode === 'deep' ? 'pending' : 'disabled', updatedAt: Date.now() },
    },
  };

  let resultRows = [];
  let topics = [];
  let finalStatus = 'failed';
  try {
    setPhase('browser-preflight');
    await ensureContext();
    stage('chrome', { status: 'connected', cdpUrl: CDP_URL });

    setPhase('discovery');
    const jobs = [];
    const feedSeconds = Number(body.maxFeedScanSeconds || config.maxFeedScanSeconds || 70);
    if (request.scanXForYou) jobs.push(collectXFeed(request.targetUniqueFeedItems, feedSeconds).then((rows) => ({ platform: 'X', rows })));
    if (request.scanTikTokForYou) jobs.push(collectTikTokFeed(request.targetUniqueFeedItems, feedSeconds).then((value) => ({ platform: 'TikTok', rows: value.evidence, tiktok: value.snapshot })));
    const settled = await Promise.allSettled(jobs);
    for (const item of settled) {
      if (item.status === 'fulfilled') resultRows.push(...item.value.rows);
      else latestLive.errors.push(clean(item.reason?.message || item.reason, 500));
    }
    resultRows = mergeRichEvidence(resultRows);
    let summary = summarizeRows(resultRows);
    latestLive = { ...latestLive, ...summary, evidence: resultRows.slice(-300), updatedAt: Date.now() };

    if (request.keywords.length && !shouldStop()) {
      setPhase('keyword-investigation');
      for (const q of request.keywords) {
        try { resultRows.push(...await collectSearch('X', q, 18)); } catch (error) { latestLive.errors.push(`X keyword ${q}: ${clean(error?.message || error, 220)}`); }
        try { resultRows.push(...await collectSearch('TikTok', q, 18)); } catch (error) { latestLive.errors.push(`TikTok keyword ${q}: ${clean(error?.message || error, 220)}`); }
      }
      resultRows = mergeRichEvidence(resultRows);
    }

    setPhase('visual-understanding');
    const context = await ensureContext();
    if (!shouldStop() && understanding.status().enabled && resultRows.length) {
      const requestedVideos = request.mode === 'deep' ? Number(process.env.FRONT_CONTENT_DEEP_VIDEOS || 8) : Number(process.env.FRONT_CONTENT_SCOUT_VIDEOS || 4);
      stage('visualUnderstanding', { status: 'running', requested: requestedVideos });
      const enriched = await understanding.enrich(context, resultRows, { mode: request.mode, maxVideos: requestedVideos });
      resultRows = enriched.rows;
      stage('visualUnderstanding', { status: enriched.stats.failed ? 'degraded' : 'complete', ...enriched.stats, engine: understanding.status() });
    } else {
      stage('visualUnderstanding', { status: understanding.status().enabled ? (shouldStop() ? 'stopped' : 'skipped-no-video') : 'inactive', engine: understanding.status() });
    }

    setPhase('narrative-ranking');
    topics = deriveTopics(resultRows, 24);
    stage('narrativeEngine', { status: 'complete', candidates: topics.length });
    resultRows = await addOriginResearch(resultRows, topics, request.mode);
    if (!shouldStop() && request.mode === 'deep') {
      topics = deriveTopics(resultRows, 24);
      stage('narrativeEngine', { status: 'complete', candidates: topics.length, rerankedAfterOrigin: true });
    }

    summary = summarizeRows(resultRows);
    latestLive = {
      ...latestLive, ...summary, active: false, status: shouldStop() ? 'stopped' : (resultRows.length ? 'complete' : 'zero'),
      phase: shouldStop() ? 'stopped' : 'complete', completedAt: Date.now(), updatedAt: Date.now(),
      candidateTopics: topics.length, evidence: resultRows.slice(-300), inferredTopics: topics.slice(0, 50), errors: latestLive.errors.slice(-30),
    };
    finalStatus = latestLive.status;
    pendingEvidence = mergeRichEvidence([...pendingEvidence, ...resultRows]).slice(-500);
    savePending();
    return {
      ok: true, version: V25_VERSION, scanId: id, evidence: resultRows, inferredTopics: topics, errors: latestLive.errors,
      audit: { singleProcess: true, stages: latestLive.stages, sourcePages: latestLive.sourcePages, ...summary },
      contentUnderstanding: { ...understanding.status(), visuallyUnderstood: resultRows.filter((row) => row.contentSummary).length }, at: Date.now(),
    };
  } catch (error) {
    latestLive = {
      ...latestLive, active: false, status: shouldStop() ? 'stopped' : 'failed', phase: shouldStop() ? 'stopped' : 'failed',
      completedAt: Date.now(), updatedAt: Date.now(), errors: [...latestLive.errors, clean(error?.message || error, 500)].slice(-30),
    };
    finalStatus = latestLive.status;
    throw error;
  } finally {
    const startedAt = Number(current?.startedAt || latestLive.startedAt || Date.now());
    const finished = {
      id, status: finalStatus, startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, request,
      observed: latestLive.observed, candidateTopics: latestLive.candidateTopics, platformCounts: latestLive.platformCounts,
      stages: latestLive.stages, errors: latestLive.errors, sourcePages: latestLive.sourcePages,
      samples: latestLive.evidence.slice(0, 30).map((row) => ({ platform: row.platform, author: row.author, url: row.url, content: clean(row.contentSummary || row.content, 260), provenance: row.provenance })),
    };
    scans.push(finished); scans = scans.slice(-100); saveLedger();
    current = null;
  }
}

function health() {
  return {
    ok: true, service: 'front-browser-bridge', version: V25_VERSION, scanner: 'front-single-process-v25', architecture: 'single-process',
    running: Boolean(current), scanId: current?.id || null, scanPhase: current?.phase || 'idle', scanLedger: { current, retained: scans.length },
    scanConnection: browserConnection?.isConnected?.() ? 'attached' : 'waiting-for-front-chrome', cdpUrl: CDP_URL,
    contentUnderstanding: understanding.status(), contentTargets: { deepVideos: Number(process.env.FRONT_CONTENT_DEEP_VIDEOS || 8), scoutVideos: Number(process.env.FRONT_CONTENT_SCOUT_VIDEOS || 4) },
    capabilities: ['single-process-orchestrator','owned-x-page','owned-tiktok-page','broad-tiktok-observation','caption-light-tiktok-discovery','visual-understanding','narrative-ranking','origin-research','single-scan-ledger','explicit-stage-diagnostics'],
    activePorts: { bridge: PORT, chromeCdp: CDP_PORT },
  };
}
function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = { 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin, Access-Control-Request-Private-Network' };
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
function originAllowed(req) { const origin = req.headers.origin; return !origin || allowedOrigins.has(origin); }
function json(req, res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store', ...corsHeaders(req) });
  res.end(payload);
}
async function readBody(req, max = 2_000_000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('Request body too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...corsHeaders(req), 'Cache-Control': 'no-store' }); return res.end(); }
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(req, res, 200, health());
    if (req.method === 'GET' && url.pathname === '/live') return json(req, res, 200, livePayload());
    if (req.method === 'GET' && url.pathname === '/ledger') return json(req, res, 200, { ok: true, version: V25_VERSION, current, scans: [...scans].reverse().slice(0, 50), retained: scans.length });
    if (req.method === 'POST' && url.pathname === '/ledger/clear') { scans = []; saveLedger(); return json(req, res, 200, { ok: true, cleared: true, current }); }
    if (req.method === 'GET' && url.pathname === '/config') return json(req, res, 200, config);
    if (req.method === 'POST' && url.pathname === '/config') {
      const parsed = JSON.parse(await readBody(req) || '{}');
      const merged = { ...config, ...parsed };
      config = normalizeAdaptiveConfig(normalizeConfig(merged), merged);
      writeJson(CONFIG_PATH, config);
      return json(req, res, 200, { ok: true, config });
    }
    if (req.method === 'GET' && url.pathname === '/pending') return json(req, res, 200, { evidence: pendingEvidence.slice(-250), count: pendingEvidence.length });
    if (req.method === 'POST' && url.pathname === '/ack') {
      const body = JSON.parse(await readBody(req) || '{}');
      const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
      const before = pendingEvidence.length;
      pendingEvidence = pendingEvidence.filter((row) => !ids.has(String(row.id)));
      savePending();
      return json(req, res, 200, { ok: true, removed: before - pendingEvidence.length, remaining: pendingEvidence.length });
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      if (current) current.stopRequested = true;
      tiktok.stop('stopped');
      return json(req, res, 200, { ok: true, stopped: Boolean(current), scanId: current?.id || null });
    }
    if (req.method === 'POST' && url.pathname === '/open-login') {
      if (!systemChrome) throw new Error('Google Chrome is required for authenticated X/TikTok scans.');
      if (browserConnection?.isConnected?.()) await browserConnection.close().catch(() => {});
      browserConnection = null; browserContext = null;
      stopExistingFrontChrome({ dataDir: DATA_DIR });
      await sleep(700);
      const opened = openRegularChromeForLogin({ dataDir: DATA_DIR, chromeExecutable: systemChrome, debuggingPort: CDP_PORT });
      await waitForCdp(opened.cdpUrl, { timeoutMs: 12000 });
      return json(req, res, 200, { ok: true, message: 'Front Chrome is ready. Sign in to X and TikTok and leave this dedicated profile open.', profileDir: frontLoginProfileDir(DATA_DIR), cdpUrl: opened.cdpUrl });
    }
    if (req.method === 'POST' && url.pathname === '/scan') {
      if (current) return json(req, res, 409, { error: 'A scan is already running. Use Stop scan before starting another one.', scanId: current.id });
      const body = JSON.parse(await readBody(req) || '{}');
      try { return json(req, res, 200, await runScan(body)); }
      catch (error) { return json(req, res, 500, { error: clean(error?.message || error, 500), scanId: latestLive.scanId, live: livePayload() }); }
    }
    return json(req, res, 404, { error: 'Not found' });
  } catch (error) { return json(req, res, 500, { error: clean(error?.message || error, 500) }); }
});

server.listen(PORT, HOST, () => {
  console.log(`Front browser bridge v25 listening on http://${HOST}:${PORT}`);
  console.log(`Single-process scanner active. Chrome CDP remains on ${CDP_URL}.`);
  console.log('Pipeline: browser preflight → X/TikTok discovery → visual understanding → narrative ranking → origin research.');
});
