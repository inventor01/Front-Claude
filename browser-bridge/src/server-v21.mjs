import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BroadTikTokObserver } from './tiktok-observer-v21.mjs';
import { mergeScanEvidence } from './tiktok-observation-v21.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const V20_PORT = Number(process.env.FRONT_BRIDGE_V20_PORT || 43986);
const CDP_PORT = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const breadthLedgerPath = path.join(dataDir, 'tiktok-breadth-v21.json');
const innerServer = path.join(here, 'launcher-v20.mjs');
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set((process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',').map((value) => value.trim()).filter(Boolean));

let inner;
let restartTimer;
let shuttingDown = false;
let lastBroadScan = (() => { try { return JSON.parse(fs.readFileSync(breadthLedgerPath, 'utf8')); } catch { return null; } })();
const broadTikTok = new BroadTikTokObserver({ cdpUrl: `http://${HOST}:${CDP_PORT}`, intervalMs: Number(process.env.FRONT_TIKTOK_OBSERVER_MS || 850) });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store', ...corsHeaders(req) });
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
  for (const name of ['content-type', 'origin', 'user-agent', 'access-control-request-private-network']) if (req.headers[name]) headers[name] = req.headers[name];
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
      FRONT_BRIDGE_PORT: String(V20_PORT),
      FRONT_BRIDGE_CDP_PORT: String(CDP_PORT),
      FRONT_CONTENT_DEEP_VIDEOS: process.env.FRONT_CONTENT_DEEP_VIDEOS || '8',
      FRONT_CONTENT_SCOUT_VIDEOS: process.env.FRONT_CONTENT_SCOUT_VIDEOS || '4',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  inner = proc;
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[gateway-v20] ${chunk}`));
  proc.stderr?.on('data', (chunk) => process.stderr.write(`[gateway-v20] ${chunk}`));
  proc.on('exit', (code, signal) => {
    if (inner === proc) inner = undefined;
    if (broadTikTok.snapshot().active) broadTikTok.stop('failed');
    if (!shuttingDown) {
      console.error(`Front v21: v20 gateway exited (${signal || code || 'unknown'}); restarting.`);
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
async function innerFetch(urlPath, init = {}, retries = 0, timeoutMs = 0) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const options = { ...init };
      if (timeoutMs > 0) options.signal = AbortSignal.timeout(timeoutMs);
      return await fetch(`http://${HOST}:${V20_PORT}${urlPath}`, options);
    } catch (error) {
      last = error;
      if (attempt < retries) await sleep(140);
    }
  }
  throw last || new Error('v20 gateway unavailable');
}
async function waitForInner(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await innerFetch('/health', {}, 0, 1200)).ok) return true; } catch {}
    await sleep(160);
  }
  return false;
}
async function parseJsonResponse(response) {
  try { return await response.json(); }
  catch { throw new Error('Local scanner returned invalid JSON.'); }
}

function persistBroadScan(value) {
  lastBroadScan = value;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(breadthLedgerPath, JSON.stringify(value, null, 2));
  } catch (error) {
    console.error(`Could not persist v21 TikTok breadth ledger: ${clean(error?.message || error)}`);
  }
}
function broadAudit() {
  const snapshot = broadTikTok.snapshot();
  return {
    observedVideos: snapshot.observed,
    groundedVideos: snapshot.grounded,
    target: snapshot.target,
    sourcePages: snapshot.sourcePages,
    errors: snapshot.errors,
  };
}

function augmentWithBroadTikTok(data = {}) {
  const snapshot = broadTikTok.snapshot();
  const grounded = broadTikTok.groundedEvidence();
  const baseEvidence = Array.isArray(data.evidence) ? data.evidence : [];
  const evidence = mergeScanEvidence(baseEvidence, grounded);
  return {
    ...data,
    evidence,
    audit: {
      ...(data.audit || {}),
      broadTikTok: {
        ...broadAudit(),
        mergedGroundedVideos: evidence.filter((row) => row.platform === 'TikTok').length,
      },
    },
  };
}
async function proxy(req, res, urlPath, body, { retries = 1, timeoutMs = 0, transform } = {}) {
  let response;
  try {
    response = await innerFetch(urlPath, { method: req.method, headers: proxyHeaders(req), body: body?.length ? body : undefined }, retries, timeoutMs);
  } catch (error) {
    return json(req, res, 503, { error: 'The local scanner is starting or unavailable.', detail: clean(error?.message || error) });
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/application\/json/i.test(contentType)) {
    const bytes = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', ...corsHeaders(req) });
    return res.end(bytes);
  }
  let data;
  try { data = await response.json(); }
  catch { return json(req, res, 502, { error: 'Local scanner returned invalid JSON.' }); }
  return json(req, res, response.status, transform ? await transform(data, response) : data);
}

async function handle(req, res) {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...corsHeaders(req), 'Cache-Control': 'no-store' }); return res.end(); }
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  let body = Buffer.alloc(0);
  try { if (!['GET', 'HEAD'].includes(req.method || 'GET')) body = await readBody(req); }
  catch (error) { return json(req, res, 413, { error: clean(error?.message || error) }); }

  if (req.method === 'POST' && url.pathname === '/scan') {
    if (broadTikTok.snapshot().active) return json(req, res, 409, { error: 'A scan is already running. Use Stop scan before starting another one.' });
    let parsed = {};
    try { parsed = JSON.parse(body.toString('utf8') || '{}'); }
    catch { return json(req, res, 400, { error: 'Invalid scan request.' }); }
    try {
      const preflight = await innerFetch('/health', {}, 1, 1800);
      if (!preflight.ok) return json(req, res, 503, { error: 'Could not verify scanner state before starting.' });
      const health = await preflight.json();
      if (health.running || health.scanLedger?.current) return json(req, res, 409, { error: 'A scan is already running. Use Stop scan before starting another one.' });
    } catch (error) {
      return json(req, res, 503, { error: 'Could not verify scanner state before starting.', detail: clean(error?.message || error) });
    }
    broadTikTok.start(parsed);
    let response;
    try { response = await innerFetch('/scan', { method: 'POST', headers: proxyHeaders(req), body }, 0, 0); }
    catch (error) {
      broadTikTok.stop('failed');
      return json(req, res, 503, { error: 'Local scanner unavailable.', detail: clean(error?.message || error) });
    }
    let data;
    try { data = await parseJsonResponse(response); }
    catch (error) { broadTikTok.stop('failed'); return json(req, res, 502, { error: clean(error.message) }); }
    data = augmentWithBroadTikTok(data);
    const breadth = data.audit?.broadTikTok || broadAudit();
    persistBroadScan({ at: Date.now(), status: response.status === 499 || data.stopped ? 'stopped' : !response.ok ? 'failed' : 'complete', ...breadth });
    if (response.status === 499 || data.stopped) broadTikTok.stop('stopped');
    else if (!response.ok) broadTikTok.stop('failed');
    else broadTikTok.stop(data.evidence?.length ? 'complete' : 'zero');
    return json(req, res, response.status, data);
  }

  if (req.method === 'GET' && url.pathname === '/live') {
    return proxy(req, res, '/live', body, { retries: 1, timeoutMs: 1800, transform: async (data) => {
      const broad = broadTikTok.snapshot();
      const mergedEvidence = mergeScanEvidence(Array.isArray(data.evidence) ? data.evidence : [], broadTikTok.groundedEvidence()).slice(-300);
      return {
        ...data,
        observed: Math.max(Number(data.observed || 0), mergedEvidence.length, broad.observed),
        evidence: mergedEvidence,
        tiktokDiscovery: {
          observed: broad.observed,
          grounded: broad.grounded,
          target: broad.target,
          active: broad.active,
          status: broad.status,
          sourcePages: broad.sourcePages,
          errors: broad.errors,
        },
      };
    }});
  }

  if (req.method === 'GET' && url.pathname === '/ledger') {
    return proxy(req, res, `${url.pathname}${url.search}`, body, { retries: 1, timeoutMs: 2500, transform: async (data) => {
      const currentBroad = broadTikTok.snapshot();
      const current = data.current ? {
        ...data.current,
        broadTikTok: currentBroad.active ? { observedVideos: currentBroad.observed, groundedVideos: currentBroad.grounded, target: currentBroad.target, sourcePages: currentBroad.sourcePages, errors: currentBroad.errors } : data.current.broadTikTok,
      } : data.current;
      const scans = Array.isArray(data.scans) ? data.scans.map((scan, index) => index === 0 && lastBroadScan ? { ...scan, broadTikTok: scan.broadTikTok || lastBroadScan } : scan) : data.scans;
      return { ...data, version: 21, current, scans, broadTikTok: currentBroad };
    }});
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return proxy(req, res, '/health', body, { retries: 6, timeoutMs: 1500, transform: async (data) => ({
      ...data,
      version: 21,
      scanner: 'viral-narrative-content-scout-v21',
      capabilities: [...new Set([...(Array.isArray(data.capabilities) ? data.capabilities : []), 'broad-tiktok-observation', 'caption-light-tiktok-discovery', 'ranked-8-video-understanding'])],
      broadTikTok: broadTikTok.snapshot(),
      contentTargets: { deepVideos: Number(process.env.FRONT_CONTENT_DEEP_VIDEOS || 8), scoutVideos: Number(process.env.FRONT_CONTENT_SCOUT_VIDEOS || 4) },
      gateway: { ...(data.gateway || {}), outerVersion: 21, innerVersion: 20, innerPort: V20_PORT },
    }) });
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    const result = await proxy(req, res, '/stop', body, { retries: 1, timeoutMs: 15000, transform: async (data) => { broadTikTok.stop('stopped'); return data; } });
    return result;
  }

  return proxy(req, res, `${url.pathname}${url.search}`, body, { retries: url.pathname === '/open-login' ? 1 : 0, timeoutMs: url.pathname === '/open-login' ? 20000 : 0 });
}

const server = http.createServer((req, res) => void handle(req, res).catch((error) => json(req, res, 500, { error: clean(error?.message || error) })));
server.listen(PORT, HOST, () => {
  console.log(`Front v21 TikTok breadth supervisor listening on http://${HOST}:${PORT}`);
  console.log(`v20 scanner runs internally on http://${HOST}:${V20_PORT}`);
  console.log('v21 counts caption-light TikTok videos as observed, keeps grounded evidence separate, and raises deep visual analysis to the top 8 candidates.');
});
startInner();
void waitForInner().then((ready) => { if (!ready) console.error('Front v21: inner scanner is still warming up.'); });

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  broadTikTok.stop('stopped');
  killProcessGroup(inner);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
