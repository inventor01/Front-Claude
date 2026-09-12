import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LiveScanObserver } from './live-observer-v20.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const V19_PORT = Number(process.env.FRONT_BRIDGE_V19_PORT || (PORT + 8));
const V18_PORT = Number(process.env.FRONT_BRIDGE_V18_PORT || (V19_PORT + 7));
const V17_PORT = Number(process.env.FRONT_BRIDGE_V17_PORT || (V19_PORT + 10));
const V16_PORT = Number(process.env.FRONT_BRIDGE_INTERNAL_PORT || (V19_PORT + 13));
const CDP_PORT = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const CDP_URL = `http://${HOST}:${CDP_PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const innerServer = path.join(here, 'server-v19.mjs');
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
const live = new LiveScanObserver({ cdpUrl: CDP_URL, intervalMs: Number(process.env.FRONT_LIVE_OBSERVER_MS || 1500) });

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
      FRONT_BRIDGE_PORT: String(V19_PORT),
      FRONT_BRIDGE_V18_PORT: String(V18_PORT),
      FRONT_BRIDGE_V17_PORT: String(V17_PORT),
      FRONT_BRIDGE_INTERNAL_PORT: String(V16_PORT),
      FRONT_BRIDGE_CDP_PORT: String(CDP_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  inner = proc;
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[gateway-v19] ${chunk}`));
  proc.stderr?.on('data', (chunk) => process.stderr.write(`[gateway-v19] ${chunk}`));
  proc.on('exit', (code, signal) => {
    if (inner === proc) inner = undefined;
    if (live.snapshot().active) live.stop('failed');
    if (!shuttingDown) {
      console.error(`Front v20: v19 gateway exited (${signal || code || 'unknown'}); restarting.`);
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
      return await fetch(`http://${HOST}:${V19_PORT}${urlPath}`, options);
    } catch (error) {
      last = error;
      if (attempt < retries) await sleep(120);
    }
  }
  throw last || new Error('v19 gateway unavailable');
}
async function waitForInner(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await innerFetch('/health', {}, 0, 1200)).ok) return true; } catch {}
    await sleep(150);
  }
  return false;
}
async function cdpReady() {
  try {
    const response = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(650), cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}
function liveSummary() {
  const snapshot = live.snapshot();
  return {
    active: snapshot.active,
    status: snapshot.status,
    phase: snapshot.phase,
    startedAt: snapshot.startedAt,
    updatedAt: snapshot.updatedAt,
    completedAt: snapshot.completedAt,
    observed: snapshot.observed,
    candidateTopics: snapshot.candidateTopics,
    platformCounts: snapshot.platformCounts,
    endpoint: '/live',
  };
}
async function proxyJson(req, res, urlPath, body, { retries = 1, timeoutMs = 0, transform } = {}) {
  let response;
  try {
    response = await innerFetch(urlPath, {
      method: req.method,
      headers: proxyHeaders(req),
      body: body?.length ? body : undefined,
    }, retries, timeoutMs);
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
  const output = transform ? await transform(data, response) : data;
  return json(req, res, response.status, output);
}

async function handle(req, res) {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(req), 'Cache-Control': 'no-store' });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/live') {
    if (live.snapshot().active) {
      try {
        const response = await innerFetch('/health', {}, 0, 900);
        if (response.ok) {
          const health = await response.json();
          live.setPhase(health.scanPhase || (health.running ? 'primary' : live.snapshot().phase));
        }
      } catch {}
    }
    return json(req, res, 200, live.snapshot());
  }

  let body = Buffer.alloc(0);
  try { if (!['GET', 'HEAD'].includes(req.method || 'GET')) body = await readBody(req); }
  catch (error) { return json(req, res, 413, { error: clean(error?.message || error) }); }

  if (req.method === 'POST' && url.pathname === '/scan') {
    if (live.snapshot().active) return json(req, res, 409, { error: 'A scan is already running. Use Stop scan before starting another one.' });
    let parsed = {};
    try { parsed = JSON.parse(body.toString('utf8') || '{}'); }
    catch { return json(req, res, 400, { error: 'Invalid scan request.' }); }

    // Reject duplicates before v19 creates a ledger record. The timeout prevents
    // a busy inner scanner from turning a duplicate click into a five-minute fake scan.
    try {
      const preflight = await innerFetch('/health', {}, 1, 1800);
      if (!preflight.ok) return json(req, res, 503, { error: 'Could not verify scanner state before starting.' });
      const health = await preflight.json();
      if (health.running || health.scanLedger?.current) {
        return json(req, res, 409, { error: 'A scan is already running. Use Stop scan before starting another one.' });
      }
    } catch (error) {
      return json(req, res, 503, { error: 'Could not verify scanner state before starting.', detail: clean(error?.message || error) });
    }

    live.start(parsed);
    let response;
    try {
      response = await innerFetch('/scan', { method: 'POST', headers: proxyHeaders(req), body }, 0, 0);
    } catch (error) {
      live.stop('failed');
      return json(req, res, 503, { error: 'Local scanner unavailable.', detail: clean(error?.message || error) });
    }
    let data;
    try { data = await response.json(); }
    catch {
      live.stop('failed');
      return json(req, res, 502, { error: 'Local scanner returned invalid JSON.' });
    }
    live.ingestFinal(data);
    if (response.status === 409) live.stop('rejected');
    else if (response.status === 499 || data.stopped) live.stop('stopped');
    else if (!response.ok) live.stop('failed');
    else live.stop(Array.isArray(data.evidence) && data.evidence.length ? 'complete' : 'zero');
    return json(req, res, response.status, data);
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    const result = await proxyJson(req, res, '/stop', body, { retries: 1, timeoutMs: 12000, transform: async (data) => {
      live.stop('stopped');
      return data;
    }});
    return result;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return proxyJson(req, res, '/health', body, { retries: 6, timeoutMs: 1500, transform: async (data) => {
      const ready = data.scanConnection === 'attached' ? true : await cdpReady();
      return {
        ...data,
        version: 20,
        scanner: 'viral-narrative-content-scout-v20',
        scanConnection: data.scanConnection === 'attached' ? 'attached' : ready ? 'cdp-ready' : 'waiting-for-front-chrome',
        capabilities: [...new Set([
          ...(Array.isArray(data.capabilities) ? data.capabilities : []),
          'live-dashboard-stream',
          'live-evidence-preview',
          'fast-duplicate-preflight',
          'cdp-ready-status',
        ])],
        liveScan: liveSummary(),
        gateway: { ...(data.gateway || {}), outerVersion: 20, innerLedgerVersion: 19, innerLedgerPort: V19_PORT },
      };
    }});
  }

  if (req.method === 'GET' && url.pathname === '/ledger') {
    return proxyJson(req, res, `${url.pathname}${url.search}`, body, { retries: 1, timeoutMs: 2500, transform: async (data) => ({ ...data, version: 20, live: liveSummary() }) });
  }
  if (req.method === 'POST' && url.pathname === '/ledger/clear') {
    return proxyJson(req, res, '/ledger/clear', body, { retries: 1, timeoutMs: 2500, transform: async (data) => ({ ...data, version: 20, live: liveSummary() }) });
  }
  if (req.method === 'GET' && url.pathname === '/content-health') {
    return proxyJson(req, res, '/content-health', body, { retries: 1, timeoutMs: 2500, transform: async (data) => ({ ...data, outerGatewayVersion: 20 }) });
  }

  return proxyJson(req, res, `${url.pathname}${url.search}`, body, { retries: url.pathname === '/open-login' ? 1 : 0, timeoutMs: url.pathname === '/open-login' ? 20000 : 0 });
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch((error) => json(req, res, 500, { error: clean(error?.message || error) }));
});
server.listen(PORT, HOST, () => {
  console.log(`Front v20 live supervisor listening on http://${HOST}:${PORT}`);
  console.log(`v19 ledger supervisor runs internally on http://${HOST}:${V19_PORT}`);
  console.log('v20 streams live scan findings to the dashboard, distinguishes CDP-ready Chrome, and rejects duplicate scans before ledger creation.');
});
startInner();
void waitForInner().then((ready) => { if (!ready) console.error('Front v20: inner scanner is still warming up.'); });

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  live.stopTimer();
  killProcessGroup(inner);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1400).unref?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
