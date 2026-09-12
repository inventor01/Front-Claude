import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const V18_PORT = Number(process.env.FRONT_BRIDGE_V18_PORT || (PORT + 7));
const V17_PORT = Number(process.env.FRONT_BRIDGE_V17_PORT || (PORT + 10));
const V16_PORT = Number(process.env.FRONT_BRIDGE_INTERNAL_PORT || (PORT + 13));
const CDP_PORT = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const ledgerPath = path.join(dataDir, 'scan-ledger-v19.json');
const here = path.dirname(fileURLToPath(import.meta.url));
const innerServer = path.join(here, 'server-v18.mjs');
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set((process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',').map((value) => value.trim()).filter(Boolean));

fs.mkdirSync(dataDir, { recursive: true });

let inner;
let restartTimer;
let shuttingDown = false;
let currentScan = null;
let scans = readJson(ledgerPath, []);
if (!Array.isArray(scans)) scans = [];
scans = scans.slice(-100);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const scanId = () => `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeLedger() {
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify(scans.slice(-100), null, 2));
  } catch (error) {
    console.error(`Could not persist scan ledger: ${clean(error?.message || error)}`);
  }
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
async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Local bridge request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function proxyHeaders(req) {
  const headers = {};
  for (const name of ['content-type', 'origin', 'user-agent', 'access-control-request-private-network']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  return headers;
}
function scheduleInner(delay = 700) {
  clearTimeout(restartTimer);
  if (shuttingDown) return;
  restartTimer = setTimeout(startInner, delay);
  restartTimer.unref?.();
}
function startInner() {
  if (shuttingDown || inner) return;
  const proc = spawn(process.execPath, [innerServer], {
    env: {
      ...process.env,
      FRONT_BRIDGE_PORT: String(V18_PORT),
      FRONT_BRIDGE_V17_PORT: String(V17_PORT),
      FRONT_BRIDGE_INTERNAL_PORT: String(V16_PORT),
      FRONT_BRIDGE_CDP_PORT: String(CDP_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  inner = proc;
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[gateway-v18] ${chunk}`));
  proc.stderr?.on('data', (chunk) => process.stderr.write(`[gateway-v18] ${chunk}`));
  proc.on('exit', (code, signal) => {
    if (inner === proc) inner = undefined;
    if (!shuttingDown) {
      if (currentScan?.status === 'running') finishCurrent('failed', { errors: [`v18 gateway exited during scan (${signal || code || 'unknown'}).`] });
      scheduleInner();
    }
  });
}
function killProcessGroup(proc) {
  const pid = proc?.pid;
  if (!pid) return;
  try { process.kill(-pid, 'SIGTERM'); }
  catch { try { proc.kill('SIGTERM'); } catch {} }
}
async function innerFetch(urlPath, init = {}, retries = 0) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fetch(`http://${HOST}:${V18_PORT}${urlPath}`, init); }
    catch (error) {
      last = error;
      if (attempt < retries) await sleep(150);
    }
  }
  throw last || new Error('v18 gateway unavailable');
}
async function waitForInner(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await innerFetch('/health')).ok) return true; } catch {}
    await sleep(150);
  }
  return false;
}

function requestSummary(body = {}) {
  return {
    mode: body.mode === 'scout' ? 'scout' : 'deep',
    xForYou: body.scanXForYou !== false,
    tiktokForYou: body.scanTikTokForYou !== false,
    xExplore: body.scanXExplore !== false,
    tiktokTrends: body.scanTikTokTrends !== false,
    keywordCount: Array.isArray(body.keywords) ? body.keywords.length : 0,
    sentinelCount: Array.isArray(body.xAccounts) ? body.xAccounts.length : 0,
    targetUniqueFeedItems: Number(body.targetUniqueFeedItems || 0) || null,
  };
}
function sourceCountsFrom(payload = {}) {
  const out = { ...(payload.audit?.sourceCounts || {}) };
  const fallback = payload.audit?.fallbackDiscovery;
  if (fallback?.diagnostics?.x) out['v18 X visual fallback'] = Number(fallback.diagnostics.x.collected || 0);
  if (fallback?.diagnostics?.tiktok) out['v18 TikTok visual fallback'] = Number(fallback.diagnostics.tiktok.collected || 0);
  return out;
}
function evidenceSamples(rows = []) {
  return rows.slice(0, 30).map((row) => ({
    platform: row.platform || null,
    author: clean(row.author, 100),
    url: clean(row.url, 500),
    mediaType: row.mediaType || null,
    provenance: clean(row.provenance, 220),
    content: clean(row.contentSummary || row.content, 260),
    contentConfidence: Number.isFinite(Number(row.contentConfidence)) ? Number(row.contentConfidence) : null,
    views: Number.isFinite(Number(row.views)) ? Number(row.views) : null,
    likes: Number.isFinite(Number(row.likes)) ? Number(row.likes) : null,
  }));
}
function payloadSummary(payload = {}) {
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const topics = Array.isArray(payload.inferredTopics) ? payload.inferredTopics : [];
  const errors = Array.isArray(payload.errors) ? payload.errors.map((value) => clean(value, 900)).filter(Boolean).slice(-20) : [];
  const fallback = payload.audit?.fallbackDiscovery || null;
  const vision = payload.contentUnderstanding || null;
  const platformCounts = evidence.reduce((acc, row) => {
    const key = row.platform || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const observed = Math.max(
    Number(payload.audit?.collected || 0),
    Number(payload.audit?.uniqueEvidence || 0),
    Number(fallback?.rawEvidence || 0),
    evidence.length,
  );
  return {
    usableEvidence: evidence.length,
    observed,
    inferredTopics: topics.length,
    uniqueCreators: Number(payload.audit?.uniqueCreators || 0) || null,
    sourceCounts: sourceCountsFrom(payload),
    platformCounts,
    errors,
    fallback: fallback ? {
      triggered: Boolean(fallback.triggered),
      failed: Boolean(fallback.failed),
      rawEvidence: Number(fallback.rawEvidence || 0),
      groundedEvidence: Number(fallback.groundedEvidence || 0),
      diagnostics: fallback.diagnostics || null,
    } : null,
    vision: vision ? {
      enabled: Boolean(vision.enabled),
      provider: vision.provider || null,
      model: vision.model || null,
      visuallyUnderstood: Number(vision.visuallyUnderstood || 0),
      scan: vision.scan || null,
      lastError: vision.lastError || null,
    } : null,
    samples: evidenceSamples(evidence),
  };
}
function finishCurrent(status, payload = {}) {
  if (!currentScan) return null;
  const finished = {
    ...currentScan,
    status,
    completedAt: Date.now(),
    durationMs: Date.now() - currentScan.startedAt,
    ...payloadSummary(payload),
    ...(payload.errors && !payload.evidence ? { errors: payload.errors.map((value) => clean(value, 900)).slice(-20) } : {}),
  };
  scans.push(finished);
  scans = scans.slice(-100);
  writeLedger();
  currentScan = null;
  return finished;
}
async function refreshCurrent() {
  if (!currentScan) return null;
  try {
    const response = await innerFetch('/health', {}, 2);
    if (!response.ok) return currentScan;
    const health = await response.json();
    currentScan = {
      ...currentScan,
      phase: health.scanPhase || (health.running ? 'scanning' : currentScan.phase),
      scanConnection: health.scanConnection || null,
      innerRunning: Boolean(health.running),
      heartbeatAt: Date.now(),
      contentUnderstanding: health.contentUnderstanding ? {
        enabled: Boolean(health.contentUnderstanding.enabled),
        provider: health.contentUnderstanding.provider || null,
        model: health.contentUnderstanding.model || null,
        cachedVideos: Number(health.contentUnderstanding.cachedVideos || 0),
        lastRun: health.contentUnderstanding.lastRun || null,
        lastError: health.contentUnderstanding.lastError || null,
      } : null,
    };
  } catch {}
  return currentScan;
}

async function handle(req, res) {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(req), 'Cache-Control': 'no-store' });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/ledger') {
    await refreshCurrent();
    return json(req, res, 200, { ok: true, version: 19, current: currentScan, scans: [...scans].reverse().slice(0, 50), retained: scans.length });
  }
  if (req.method === 'POST' && url.pathname === '/ledger/clear') {
    scans = [];
    writeLedger();
    return json(req, res, 200, { ok: true, cleared: true, current: currentScan });
  }

  let body = Buffer.alloc(0);
  try { if (!['GET', 'HEAD'].includes(req.method || 'GET')) body = await readBody(req); }
  catch (error) { return json(req, res, 413, { error: clean(error?.message || error) }); }

  if (req.method === 'POST' && url.pathname === '/scan') {
    if (currentScan?.status === 'running') return json(req, res, 409, { error: 'A scan is already running. Use Stop scan before starting another one.' });
    let parsed = {};
    try { parsed = JSON.parse(body.toString('utf8') || '{}'); }
    catch { return json(req, res, 400, { error: 'Invalid scan request.' }); }
    currentScan = {
      id: scanId(),
      startedAt: Date.now(),
      status: 'running',
      phase: 'starting',
      request: requestSummary(parsed),
      scanConnection: null,
      innerRunning: true,
      heartbeatAt: Date.now(),
    };
    const id = currentScan.id;
    let response;
    try {
      response = await innerFetch('/scan', { method: 'POST', headers: proxyHeaders(req), body }, 1);
    } catch (error) {
      if (currentScan?.id === id) finishCurrent('failed', { errors: [clean(error?.message || error)] });
      return json(req, res, 503, { error: 'Local scanner unavailable.', detail: clean(error?.message || error) });
    }
    let data;
    try { data = await response.json(); }
    catch {
      if (currentScan?.id === id) finishCurrent('failed', { errors: ['Local scanner returned invalid JSON.'] });
      return json(req, res, 502, { error: 'Local scanner returned invalid JSON.' });
    }
    if (currentScan?.id === id) {
      if (response.status === 499 || data.stopped) finishCurrent('stopped', data);
      else if (!response.ok) finishCurrent('failed', { ...data, errors: [data.error || `HTTP ${response.status}`] });
      else finishCurrent(Array.isArray(data.evidence) && data.evidence.length ? 'complete' : 'zero', data);
    }
    return json(req, res, response.status, data);
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    let response;
    try { response = await innerFetch('/stop', { method: 'POST', headers: proxyHeaders(req), body }, 1); }
    catch (error) { return json(req, res, 503, { error: 'Could not reach the active scanner.', detail: clean(error?.message || error) }); }
    let data;
    try { data = await response.json(); } catch { data = { ok: response.ok, stopped: response.ok }; }
    if (currentScan?.status === 'running') finishCurrent('stopped', { errors: [], stopMessage: data.message });
    return json(req, res, response.status, data);
  }

  let response;
  try {
    response = await innerFetch(`${url.pathname}${url.search}`, {
      method: req.method,
      headers: proxyHeaders(req),
      body: body.length ? body : undefined,
    }, url.pathname === '/health' ? 8 : 1);
  } catch (error) {
    return json(req, res, 503, { error: 'The local scanner is starting or unavailable.', detail: clean(error?.message || error) });
  }

  const contentType = response.headers.get('content-type') || '';
  if (!/application\/json/i.test(contentType)) {
    const bytes = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
      ...corsHeaders(req),
    });
    return res.end(bytes);
  }
  let data;
  try { data = await response.json(); }
  catch { return json(req, res, 502, { error: 'Local scanner returned invalid JSON.' }); }

  if (req.method === 'GET' && url.pathname === '/health' && response.ok) {
    await refreshCurrent();
    return json(req, res, 200, {
      ...data,
      version: 19,
      scanner: 'viral-narrative-content-scout-v19',
      capabilities: [...new Set([...(Array.isArray(data.capabilities) ? data.capabilities : []), 'scan-ledger', 'live-scan-ledger', 'cdp-no-defaults-compat'])],
      scanLedger: { current: currentScan, retained: scans.length, endpoint: '/ledger' },
      gateway: { ...(data.gateway || {}), outerVersion: 19, innerSupervisorVersion: 18, innerSupervisorPort: V18_PORT },
    });
  }
  if (req.method === 'GET' && url.pathname === '/content-health' && response.ok) {
    return json(req, res, 200, { ...data, outerGatewayVersion: 19 });
  }
  return json(req, res, response.status, data);
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch((error) => json(req, res, 500, { error: clean(error?.message || error) }));
});
server.listen(PORT, HOST, () => {
  console.log(`Front v19 supervisor listening on http://${HOST}:${PORT}`);
  console.log(`v18 scanner supervisor runs internally on http://${HOST}:${V18_PORT}`);
  console.log('v19 adds a persistent scan ledger and Playwright CDP compatibility for the dedicated Front Chrome session.');
});
startInner();
void waitForInner().then((ready) => { if (!ready) console.error('Front v19: inner scanner is still warming up.'); });

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  killProcessGroup(inner);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
