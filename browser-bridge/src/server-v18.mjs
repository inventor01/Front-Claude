import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const V17_PORT = Number(process.env.FRONT_BRIDGE_V17_PORT || (PORT + 10));
const V16_PORT = Number(process.env.FRONT_BRIDGE_INTERNAL_PORT || (V17_PORT + 3));
const CDP_PORT = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const here = path.dirname(fileURLToPath(import.meta.url));
const innerGateway = path.join(here, 'server-v17.mjs');
const fallbackWorkerScript = path.join(here, 'fallback-worker-v18.mjs');
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set((process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',').map((value) => value.trim()).filter(Boolean));

let inner;
let fallbackWorker;
let restartTimer;
let restarting = false;
let shuttingDown = false;
let stopGeneration = 0;
let lastStop = null;
let lastSupervisorError = null;
let lastFallbackContentStatus = null;

const clean = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function scheduleStart(delay = 900) {
  if (shuttingDown || restarting || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    startInner();
  }, delay);
  restartTimer.unref?.();
}

function startInner() {
  if (shuttingDown || restarting || inner) return;
  const proc = spawn(process.execPath, [innerGateway], {
    env: {
      ...process.env,
      FRONT_BRIDGE_PORT: String(V17_PORT),
      FRONT_BRIDGE_INTERNAL_PORT: String(V16_PORT),
      FRONT_BRIDGE_CDP_PORT: String(CDP_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  inner = proc;
  proc.stdout?.on('data', (chunk) => process.stdout.write(`[gateway-v17] ${chunk}`));
  proc.stderr?.on('data', (chunk) => process.stderr.write(`[gateway-v17] ${chunk}`));
  proc.on('exit', (code, signal) => {
    if (inner === proc) inner = undefined;
    if (shuttingDown || restarting) return;
    lastSupervisorError = `v17 gateway exited (${signal || code || 'unknown'}); restarting.`;
    scheduleStart();
  });
}

function killProcessGroup(proc) {
  const pid = proc?.pid;
  if (!pid) return false;
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    try { proc.kill('SIGKILL'); return true; } catch { return false; }
  }
}

async function innerFetch(urlPath, init = {}, retries = 0) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fetch(`http://${HOST}:${V17_PORT}${urlPath}`, init); }
    catch (error) {
      last = error;
      if (attempt < retries) await sleep(150);
    }
  }
  throw last || new Error('v17 gateway unavailable');
}

async function waitForInner(timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await innerFetch('/health');
      if (response.ok) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}

async function stopAndRestart() {
  stopGeneration += 1;
  lastStop = Date.now();
  restarting = true;
  clearTimeout(restartTimer);
  restartTimer = undefined;

  // The regular v17/v16 path is one detached process group. Zero-result visual
  // recovery is a second detached worker. Killing both makes Stop Scan immediate
  // even if the local Ollama model is currently analyzing frames.
  killProcessGroup(fallbackWorker);
  fallbackWorker = undefined;
  killProcessGroup(inner);
  inner = undefined;

  await sleep(550);
  restarting = false;
  startInner();
  const ready = await waitForInner(7000);
  if (!ready) lastSupervisorError = 'Scanner was stopped, but the restarted gateway is still warming up.';
  else lastSupervisorError = null;
  return ready;
}

function runFallbackWorker(scanBody) {
  return new Promise((resolve, reject) => {
    if (fallbackWorker) return reject(new Error('A zero-result recovery pass is already running.'));
    const proc = spawn(process.execPath, [fallbackWorkerScript], {
      env: {
        ...process.env,
        FRONT_BRIDGE_CDP_PORT: String(CDP_PORT),
        FRONT_V18_FALLBACK_REQUEST: JSON.stringify({ scanBody }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    fallbackWorker = proc;
    const stdout = [];
    const stderr = [];
    let size = 0;
    let stderrSize = 0;
    let overflow = false;
    proc.stdout?.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8_000_000) { overflow = true; killProcessGroup(proc); return; }
      stdout.push(chunk);
    });
    proc.stderr?.on('data', (chunk) => {
      if (stderrSize < 20000) {
        stderr.push(chunk);
        stderrSize += chunk.length;
      }
    });
    proc.on('error', (error) => {
      if (fallbackWorker === proc) fallbackWorker = undefined;
      reject(error);
    });
    proc.on('exit', (code, signal) => {
      if (fallbackWorker === proc) fallbackWorker = undefined;
      if (overflow) return reject(new Error('Zero-result recovery produced too much output.'));
      const raw = Buffer.concat(stdout).toString('utf8').trim();
      let parsed;
      try { parsed = JSON.parse(raw || '{}'); }
      catch {
        return reject(new Error(`Zero-result recovery returned invalid JSON${stderr.length ? `: ${clean(Buffer.concat(stderr).toString('utf8'), 240)}` : '.'}`));
      }
      if (signal || code !== 0 || parsed.ok === false) {
        return reject(new Error(parsed.error || `Zero-result recovery stopped (${signal || code || 'unknown'}).`));
      }
      resolve(parsed);
    });
  });
}

function newestContentStatus(innerStatus) {
  if (!lastFallbackContentStatus) return innerStatus || null;
  if (!innerStatus) return lastFallbackContentStatus;
  const innerAt = Number(innerStatus.lastRun || 0);
  const fallbackAt = Number(lastFallbackContentStatus.lastRun || 0);
  return fallbackAt > innerAt ? lastFallbackContentStatus : innerStatus;
}

async function zeroResultFallback(scanBody, basePayload) {
  const result = await runFallbackWorker(scanBody);
  if (result.contentUnderstanding) lastFallbackContentStatus = result.contentUnderstanding;
  return {
    ...basePayload,
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    inferredTopics: Array.isArray(result.inferredTopics) ? result.inferredTopics : [],
    errors: [...(Array.isArray(basePayload.errors) ? basePayload.errors : []), ...(Array.isArray(result.errors) ? result.errors : [])],
    audit: { ...(basePayload.audit || {}), fallbackDiscovery: result.audit || { version: 18, triggered: true } },
    contentUnderstanding: result.contentUnderstanding || basePayload.contentUnderstanding || null,
    v18Fallback: true,
  };
}

function normalizeHealth(data) {
  const staleInnerError = data?.gateway?.lastError && /Scanner child unavailable: fetch failed/i.test(String(data.gateway.lastError));
  const recoveryRunning = Boolean(fallbackWorker);
  return {
    ...data,
    version: 18,
    scanner: 'viral-narrative-content-scout-v18',
    running: Boolean(data?.running || recoveryRunning),
    scanPhase: recoveryRunning ? 'visual-recovery' : data?.running ? 'primary' : 'idle',
    capabilities: [...new Set([
      ...(Array.isArray(data?.capabilities) ? data.capabilities : []),
      'manual-scan-stop',
      'zero-result-visual-fallback',
      'media-without-caption-discovery',
      'duplicate-scan-guard',
    ])],
    contentUnderstanding: newestContentStatus(data?.contentUnderstanding),
    gateway: {
      version: 18,
      innerGatewayVersion: 17,
      innerPort: V17_PORT,
      internalScannerPort: V16_PORT,
      lastStop,
      lastError: staleInnerError ? null : (lastSupervisorError || data?.gateway?.lastError || null),
      inner: data?.gateway || null,
    },
  };
}

async function handle(req, res) {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(req), 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (req.url === '/stop' && req.method === 'POST') {
    const ready = await stopAndRestart();
    return json(req, res, 200, {
      ok: true,
      stopped: true,
      restarted: ready,
      at: lastStop,
      message: ready ? 'Scan stopped. Scanner restarted and is ready.' : 'Scan stopped. Scanner is restarting.',
    });
  }

  let body = Buffer.alloc(0);
  try { if (!['GET', 'HEAD'].includes(req.method || 'GET')) body = await readBody(req); }
  catch (error) { return json(req, res, 413, { error: clean(error?.message || error) }); }

  let scanBody = {};
  if (req.url === '/scan' && req.method === 'POST' && body.length) {
    try { scanBody = JSON.parse(body.toString('utf8') || '{}'); }
    catch { return json(req, res, 400, { error: 'Invalid scan request.' }); }
    // Do not forward a duplicate manual scan into v16: v16 historically wrote
    // the collision message into lastError even though the original scan was healthy.
    try {
      const healthResponse = await innerFetch('/health', {}, 4);
      if (healthResponse.ok) {
        const health = await healthResponse.json();
        if (health.running || fallbackWorker) return json(req, res, 409, { error: 'A scan is already running. Use Stop scan before starting another one.' });
      }
    } catch {}
  }

  const generation = stopGeneration;
  let response;
  try {
    response = await innerFetch(req.url || '/', {
      method: req.method,
      headers: proxyHeaders(req),
      body: body.length ? body : undefined,
    }, req.url === '/health' ? 8 : 0);
  } catch (error) {
    if (generation !== stopGeneration) return json(req, res, 499, { stopped: true, error: 'Scan stopped by user.' });
    lastSupervisorError = `Inner gateway unavailable: ${clean(error?.message || error)}`;
    return json(req, res, 503, { error: 'The local scanner is starting or unavailable.', detail: lastSupervisorError });
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

  if (req.url === '/health' && req.method === 'GET' && response.ok) {
    lastSupervisorError = null;
    return json(req, res, 200, normalizeHealth(data));
  }

  if (req.url === '/content-health' && req.method === 'GET' && response.ok) {
    const merged = newestContentStatus(data);
    return json(req, res, 200, { ok: true, ...(merged || data), gatewayVersion: 18, lastStop, lastGatewayError: lastSupervisorError || null });
  }

  if (req.url === '/scan' && req.method === 'POST' && response.ok) {
    if (!Array.isArray(data.evidence) || data.evidence.length === 0) {
      try { data = await zeroResultFallback(scanBody, data); }
      catch (error) {
        if (generation !== stopGeneration) return json(req, res, 499, { stopped: true, error: 'Scan stopped by user.' });
        data = {
          ...data,
          errors: [...(Array.isArray(data.errors) ? data.errors : []), `v18 zero-result fallback failed: ${clean(error?.message || error, 300)}`],
          audit: { ...(data.audit || {}), fallbackDiscovery: { version: 18, triggered: true, failed: true } },
        };
      }
    }
    return json(req, res, 200, data);
  }

  return json(req, res, response.status, data);
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch((error) => json(req, res, 500, { error: clean(error?.message || error) }));
});

server.listen(PORT, HOST, () => {
  console.log(`Front v18 supervisor listening on http://${HOST}:${PORT}`);
  console.log(`v17 content gateway runs internally on http://${HOST}:${V17_PORT}`);
  console.log('v18 adds manual scan stop, duplicate-scan protection, and visual fallback when normal extraction returns zero evidence.');
});
startInner();

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  killProcessGroup(fallbackWorker);
  killProcessGroup(inner);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
