import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { detectTopics } from './topic-engine.mjs';
import { attachSoundSignals, consolidateTopicAliases } from './adaptive-intelligence.mjs';
import { attachVisualSignals, semanticConsolidateTopics } from './advanced-intelligence.mjs';
import { frontCdpUrl } from './system-browser.mjs';
import { CONTENT_UNDERSTANDING_VERSION, ContentUnderstandingEngine } from './content-understanding.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FRONT_BRIDGE_PORT || 43981);
const INTERNAL_PORT = Number(process.env.FRONT_BRIDGE_INTERNAL_PORT || (PORT + 3));
const CDP_PORT = Number(process.env.FRONT_BRIDGE_CDP_PORT || 43982);
const dataDir = process.env.FRONT_BRIDGE_DATA || path.join(os.homedir(), '.front-browser-bridge');
const cdpUrl = frontCdpUrl(CDP_PORT);
const here = path.dirname(fileURLToPath(import.meta.url));
const legacyServer = path.join(here, 'server-v16.mjs');
const detector = new ContentUnderstandingEngine({ dataDir });
const DEFAULT_ALLOWED_ORIGINS = [
  'https://believable-inspiration-production-a68b.up.railway.app',
  'https://front-narrative-desk.austinrock2000.chatgpt.site',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const allowedOrigins = new Set((process.env.FRONT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',').map((value) => value.trim()).filter(Boolean));

let child;
let shuttingDown = false;
let contentBrowser;
let contentContext;
let prefetching = false;
let lastGatewayError = null;
let childRestartTimer;

function clean(value, max = 300) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function normalize(value) { return clean(value, 240).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
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
async function internalFetch(urlPath, init = {}) {
  return fetch(`http://${HOST}:${INTERNAL_PORT}${urlPath}`, init);
}

function startLegacyChild() {
  if (shuttingDown) return;
  child = spawn(process.execPath, [legacyServer], {
    env: { ...process.env, FRONT_BRIDGE_PORT: String(INTERNAL_PORT), FRONT_BRIDGE_GATEWAY_CHILD: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[scanner-v16] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[scanner-v16] ${chunk}`));
  child.on('exit', (code, signal) => {
    child = undefined;
    if (shuttingDown) return;
    lastGatewayError = `Scanner v16 child exited (${signal || code || 'unknown'}); restarting.`;
    clearTimeout(childRestartTimer);
    childRestartTimer = setTimeout(startLegacyChild, 1200);
    childRestartTimer.unref?.();
  });
}

async function getContentContext() {
  if (contentContext && contentBrowser?.isConnected?.()) return contentContext;
  contentBrowser = await chromium.connectOverCDP(cdpUrl);
  contentContext = contentBrowser.contexts()[0];
  if (!contentContext) throw new Error('Front Chrome did not expose a browser context for video understanding.');
  contentBrowser.on('disconnected', () => { contentBrowser = undefined; contentContext = undefined; });
  return contentContext;
}

function sanitizeAnalysisPrefixes(value) {
  return String(value || '')
    .replace(/\bVisual summary:\s*/gi, '')
    .replace(/\bEvent:\s*/gi, '')
    .replace(/\bEntities:\s*/gi, '')
    .replace(/\bActions:\s*/gi, '')
    .replace(/\bOn-screen text:\s*/gi, '')
    .replace(/\bVisual motifs:\s*/gi, '')
    .replace(/\s+/g, ' ').trim();
}

function deriveTopicsFromContent(evidence = [], at = Date.now()) {
  const sanitized = evidence.map((row) => ({ ...row, content: sanitizeAnalysisPrefixes(row.content) }));
  let topics = detectTopics(sanitized, at, 24);
  topics = attachSoundSignals(topics, sanitized);
  topics = attachVisualSignals(topics, sanitized, at);
  topics = semanticConsolidateTopics(topics, sanitized, at);
  topics = consolidateTopicAliases(topics);
  return topics;
}

function mergeTopics(existing = [], derived = [], evidence = []) {
  const understood = new Set(evidence.filter((row) => row.contentSummary).map((row) => row.id));
  const out = existing.map((topic) => ({ ...topic }));
  for (const topic of derived) {
    const key = normalize(topic.key || topic.topic);
    if (!key) continue;
    const contentSupport = (topic.evidenceIds || []).filter((id) => understood.has(id)).length;
    const index = out.findIndex((old) => normalize(old.key || old.topic) === key);
    if (index < 0) {
      if (contentSupport < 1) continue;
      out.push({ ...topic, contentUnderstandingSupport: contentSupport });
      continue;
    }
    const old = out[index];
    out[index] = {
      ...topic,
      ...old,
      topic: old.topic || topic.topic,
      key: old.key || topic.key,
      aliases: [...new Set([...(old.aliases || []), ...(topic.aliases || [])])].slice(0, 18),
      evidenceIds: [...new Set([...(old.evidenceIds || []), ...(topic.evidenceIds || [])])],
      platforms: [...new Set([...(old.platforms || []), ...(topic.platforms || [])])],
      authorCount: Math.max(Number(old.authorCount || 0), Number(topic.authorCount || 0)),
      evidenceCount: Math.max(Number(old.evidenceCount || 0), Number(topic.evidenceCount || 0)),
      score: Math.max(Number(old.score || 0), Number(topic.score || 0)),
      corroborated: Boolean(old.corroborated || topic.corroborated),
      tier: old.tier === 'candidate' || topic.tier === 'candidate' ? 'candidate' : 'pre-breakout',
      contentUnderstandingSupport: Math.max(Number(old.contentUnderstandingSupport || 0), contentSupport),
    };
  }
  return out.sort((a, b) => Number(b.priorityScore || b.score || 0) - Number(a.priorityScore || a.score || 0)).slice(0, 60);
}

async function enrichScanPayload(payload) {
  if (!payload || !Array.isArray(payload.evidence) || !payload.evidence.length) return payload;
  const mode = payload.audit?.mode === 'scout' ? 'scout' : 'deep';
  const status = detector.status();
  let enrichment = { rows: detector.applyCached(payload.evidence), stats: { requested: 0, analyzed: 0, cached: 0, enriched: 0, failed: 0, skipped: 0, provider: status.provider, model: status.model } };
  if (status.enabled) {
    try {
      const context = await getContentContext();
      enrichment = await detector.enrich(context, payload.evidence, {
        mode,
        maxVideos: mode === 'deep' ? Number(process.env.FRONT_CONTENT_DEEP_VIDEOS || 4) : Number(process.env.FRONT_CONTENT_SCOUT_VIDEOS || 2),
      });
    } catch (error) {
      const message = `Video understanding: ${clean(error?.message || error, 300)}`;
      payload.errors = [...(Array.isArray(payload.errors) ? payload.errors : []), message];
      lastGatewayError = message;
    }
  }
  const at = Number(payload.at || Date.now());
  const derived = deriveTopicsFromContent(enrichment.rows, at);
  return {
    ...payload,
    evidence: enrichment.rows,
    inferredTopics: mergeTopics(Array.isArray(payload.inferredTopics) ? payload.inferredTopics : [], derived, enrichment.rows),
    contentUnderstanding: {
      ...detector.status(),
      scan: enrichment.stats,
      visuallyUnderstood: enrichment.rows.filter((row) => row.contentSummary).length,
    },
  };
}

async function prefetchPending() {
  if (prefetching || !detector.status().enabled || shuttingDown) return;
  prefetching = true;
  try {
    const response = await internalFetch('/pending');
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.evidence) || !data.evidence.length) return;
    const context = await getContentContext();
    await detector.enrich(context, data.evidence, { mode: 'scout', maxVideos: Number(process.env.FRONT_CONTENT_BACKGROUND_VIDEOS || 2) });
  } catch (error) {
    lastGatewayError = `Background video understanding: ${clean(error?.message || error, 260)}`;
  } finally {
    prefetching = false;
  }
}

async function handle(req, res) {
  if (!originAllowed(req)) return json(req, res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(req), 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.url === '/content-health' && req.method === 'GET') {
    return json(req, res, 200, { ok: true, ...detector.status(), gatewayVersion: 17, lastGatewayError });
  }
  let body = Buffer.alloc(0);
  try { if (!['GET', 'HEAD'].includes(req.method || 'GET')) body = await readBody(req); }
  catch (error) { return json(req, res, 413, { error: clean(error?.message || error) }); }
  let response;
  try {
    response = await internalFetch(req.url || '/', {
      method: req.method,
      headers: proxyHeaders(req),
      body: body.length ? body : undefined,
    });
  } catch (error) {
    lastGatewayError = `Scanner child unavailable: ${clean(error?.message || error)}`;
    return json(req, res, 503, { error: 'The local scanner is starting or unavailable.', detail: lastGatewayError });
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/application\/json/i.test(contentType)) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const headers = { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', ...corsHeaders(req) };
    res.writeHead(response.status, headers);
    return res.end(bytes);
  }
  let data;
  try { data = await response.json(); }
  catch { return json(req, res, 502, { error: 'Local scanner returned invalid JSON.' }); }

  if (req.url === '/health' && req.method === 'GET' && response.ok) {
    void prefetchPending();
    const baseCapabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
    return json(req, res, 200, {
      ...data,
      version: 17,
      scanner: 'viral-narrative-content-scout-v17',
      capabilities: [...new Set([
        ...baseCapabilities,
        'timeline-video-frame-capture',
        'multimodal-post-understanding',
        'visual-event-grounding',
        'caption-light-video-detection',
        'content-analysis-cache',
      ])],
      contentUnderstanding: detector.status(),
      gateway: { version: 17, internalScannerVersion: data.version, internalPort: INTERNAL_PORT, lastError: lastGatewayError },
    });
  }

  if (req.url === '/scan' && req.method === 'POST' && response.ok) {
    data = await enrichScanPayload(data);
    return json(req, res, response.status, data);
  }

  if (req.url === '/pending' && req.method === 'GET' && response.ok) {
    const evidence = detector.applyCached(Array.isArray(data.evidence) ? data.evidence : []);
    void prefetchPending();
    return json(req, res, response.status, {
      ...data,
      evidence,
      contentUnderstanding: { ...detector.status(), visuallyUnderstood: evidence.filter((row) => row.contentSummary).length },
    });
  }

  return json(req, res, response.status, data);
}

const server = http.createServer((req, res) => { void handle(req, res).catch((error) => json(req, res, 500, { error: clean(error?.message || error) })); });
server.listen(PORT, HOST, () => {
  console.log(`Front v17 gateway listening on http://${HOST}:${PORT}`);
  console.log(`Scanner v16 runs internally on http://${HOST}:${INTERNAL_PORT}`);
  const status = detector.status();
  console.log(`Video understanding: ${status.enabled ? `${status.provider} · ${status.model}` : `inactive · ${status.reason}`}`);
});
startLegacyChild();

const prefetchTimer = setInterval(() => { void prefetchPending(); }, 45_000);
prefetchTimer.unref?.();

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(prefetchTimer);
  clearTimeout(childRestartTimer);
  try { child?.kill('SIGTERM'); } catch {}
  try { await contentBrowser?.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 2500).unref?.();
}
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
