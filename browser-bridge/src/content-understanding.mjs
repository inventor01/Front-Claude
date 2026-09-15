import { publicationAgeDays, prioritizeAnalysis } from './analysis-priority.mjs';
import { canonicalSocialPostUrl } from './social-post-url.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const CONTENT_UNDERSTANDING_VERSION = 17;
const CACHE_TTL_MS = 7 * 24 * 3600000;
const FAILURE_TTL_MS = 5 * 60000;
const MAX_CONTEXT_TEXT = 2200;
const OLLAMA_KEEP_ALIVE = String(process.env.FRONT_OLLAMA_KEEP_ALIVE || '30m');
const MODEL_FRAME_LIMIT = Math.max(4, Math.min(12, Number(process.env.FRONT_CONTENT_MODEL_FRAMES || 8)));
const DEEP_TIMEOUT_MS = Math.max(30000, Number(process.env.FRONT_CONTENT_TIMEOUT_MS || 75000));
const SCOUT_TIMEOUT_MS = Math.max(20000, Number(process.env.FRONT_CONTENT_SCOUT_TIMEOUT_MS || 45000));
const OLLAMA_NUM_PREDICT = Math.max(160, Math.min(900, Number(process.env.FRONT_CONTENT_NUM_PREDICT || 420)));

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
};
const creatorKey = (row) => `${row.platform}:${String(row.author || '').toLowerCase()}`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function normalize(value) {
  return clean(value, 500).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function weakCaption(value) {
  const text = clean(value, 800);
  if (!text || text.length < 20) return true;
  const useful = normalize(text).split(' ').filter((word) => word.length >= 4 && !['viral','video','trend','trending','foryou','fyp','tiktok','twitter','original','sound'].includes(word));
  return useful.length < 3;
}
function looksLikeVideo(row) {
  return /video/i.test(String(row.mediaType || '')) || row.platform === 'TikTok';
}
function evidenceScore(row) {
  let score = 0;
  const views = Math.max(0, finite(row.views) || 0);
  const likes = Math.max(0, finite(row.likes) || 0);
  const viewsPerMinute = Math.max(0, finite(row.viewsPerMinute) || 0);
  const likesPerMinute = Math.max(0, finite(row.likesPerMinute) || 0);
  score += Math.min(34, Math.log10(1 + views) * 5.2);
  score += Math.min(18, Math.log10(1 + likes) * 3.2);
  score += Math.min(28, Math.log10(1 + viewsPerMinute * 60) * 5.2);
  score += Math.min(12, Math.log10(1 + likesPerMinute * 60) * 2.8);
  if (/For You/i.test(row.provenance || '')) score += 10;
  if (/Investigation/i.test(row.provenance || '')) score += 12;
  if (row.soundId) score += 5;
  if (row.visualHash) score += 5;
  if (weakCaption(row.content)) score += 14;
  return score;
}

export function frameSchedule(durationSeconds, maxFrames = 16) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const limit = Math.max(1, Math.min(24, Math.trunc(Number(maxFrames) || 16)));
  if (!duration) return [0];
  let desired;
  if (duration <= 12) desired = Math.ceil(duration / 0.75) + 1;
  else if (duration <= 30) desired = Math.ceil(duration / 1.5) + 1;
  else desired = limit;
  const count = Math.max(2, Math.min(limit, desired));
  if (count === 2) return [0, Math.max(0, duration - 0.05)];
  const end = Math.max(0, duration - 0.05);
  return Array.from({ length: count }, (_, index) => Number((end * index / (count - 1)).toFixed(3)));
}

export function selectVideoCandidates(rows = [], { limit = 4 } = {}) {
  const videos = prioritizeAnalysis(rows).filter(row => {const age=publicationAgeDays(row);return age === null || age <= 14;}).filter((row) => row?.id && canonicalSocialPostUrl(row?.url, row?.platform) && looksLikeVideo(row));
  const byCreator = new Map();
  for (const row of videos) {
    const key = creatorKey(row);
    const list = byCreator.get(key) || [];
    list.push(row);
    byCreator.set(key, list);
  }
  const selected = [];
  const creatorKeys = [...byCreator.keys()];
  while (selected.length < limit && creatorKeys.length) {
    let added = false;
    for (const key of [...creatorKeys]) {
      const list = byCreator.get(key) || [];
      const row = list.shift();
      if (row) { selected.push(row); added = true; }
      if (!list.length) creatorKeys.splice(creatorKeys.indexOf(key), 1);
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected.sort((a, b) => evidenceScore(b) - evidenceScore(a)).slice(0, limit);
}

function providerConfig() {
  const requested = String(process.env.FRONT_CONTENT_PROVIDER || 'auto').toLowerCase();
  if (requested === 'off' || requested === 'disabled') return { available: false, provider: 'off', reason: 'disabled' };
  const openaiKey = process.env.FRONT_CONTENT_API_KEY || process.env.OPENAI_API_KEY || '';
  if ((requested === 'auto' || requested === 'openai') && openaiKey) {
    return {
      available: true,
      provider: 'openai',
      key: openaiKey,
      endpoint: process.env.FRONT_CONTENT_ENDPOINT || 'https://api.openai.com/v1/responses',
      model: process.env.FRONT_CONTENT_MODEL || 'gpt-5.6-luna',
    };
  }
  const ollamaModel = process.env.FRONT_OLLAMA_MODEL || '';
  if ((requested === 'auto' || requested === 'ollama') && ollamaModel) {
    return {
      available: true,
      provider: 'ollama',
      endpoint: process.env.FRONT_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/api/chat',
      model: ollamaModel,
    };
  }
  return {
    available: false,
    provider: requested,
    reason: requested === 'openai' ? 'missing-openai-key' : requested === 'ollama' ? 'missing-ollama-model' : 'no-model-provider',
  };
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string' && /output_text|text/.test(String(content.type || 'text'))) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

export function parseUnderstandingJson(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const first = fenced.indexOf('{'), last = fenced.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(fenced.slice(first, last + 1));
    const raw = parsed.s ? {...parsed,summary:parsed.s,event:parsed.e,entities:parsed.n,onScreenText:parsed.t,memePotential:parsed.m,confidence:parsed.c,uncertainties:parsed.u} : parsed;
    const summary = clean(raw.summary, 420);
    if (!summary) return null;
    return {
      summary,
      event: clean(raw.event, 280),
      entities: Array.isArray(raw.entities) ? [...new Set(raw.entities.map((x) => clean(x, 100)).filter(Boolean))].slice(0, 12) : [],
      actions: Array.isArray(raw.actions) ? [...new Set(raw.actions.map((x) => clean(x, 120)).filter(Boolean))].slice(0, 12) : [],
      onScreenText: Array.isArray(raw.onScreenText) ? [...new Set(raw.onScreenText.map((x) => clean(x, 160)).filter(Boolean))].slice(0, 16) : [],
      visualMotifs: Array.isArray(raw.visualMotifs) ? [...new Set(raw.visualMotifs.map((x) => clean(x, 120)).filter(Boolean))].slice(0, 12) : [],
      memePotential: clamp01(raw.memePotential, 0),
      confidence: clamp01(raw.confidence, 0.5),
      uncertainties: Array.isArray(raw.uncertainties) ? [...new Set(raw.uncertainties.map((x) => clean(x, 160)).filter(Boolean))].slice(0, 8) : [],
    };
  } catch { return null; }
}

async function analyzeOpenAI(frames, context, provider, signal) {
  const content = [{ type: 'input_text', text: context }];
  for (const frame of frames) {
    content.push({ type: 'input_text', text: `Video frame at ${frame.time.toFixed(2)} seconds:` });
    content.push({ type: 'input_image', image_url: frame.dataUrl, detail: 'low' });
  }
  const response = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
    signal,
    body: JSON.stringify({
      model: provider.model,
      store: false,
      max_output_tokens: 700,
      input: [{ role: 'user', content }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI content analysis failed (${response.status}): ${clean(data?.error?.message || response.statusText, 220)}`);
  const parsed = parseUnderstandingJson(extractResponseText(data));
  if (!parsed) throw new Error('Content model returned an unreadable analysis payload.');
  return parsed;
}

async function analyzeOllama(frames, context, provider, signal) {
  const response = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      think: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      format: { type:'object', additionalProperties:false, properties:{ s:{type:'string',maxLength:100}, e:{type:'string',maxLength:45}, n:{type:'array',maxItems:3,items:{type:'string',maxLength:40}}, t:{type:'array',maxItems:2,items:{type:'string',maxLength:35}}, m:{type:'number',minimum:0,maximum:1}, c:{type:'number',minimum:0,maximum:1}, u:{type:'array',maxItems:1,items:{type:'string',maxLength:60}} }, required:['s','e','n','t','m','c','u'] },
      messages: [{
        role: 'user',
        content: context,
        images: frames.map((frame) => frame.base64),
      }],
      options: { temperature: 0.1, num_predict: OLLAMA_NUM_PREDICT },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ollama content analysis failed (${response.status}): ${clean(data?.error || response.statusText, 220)}`);
  const parsed = parseUnderstandingJson(data?.message?.content || data?.response || '');
  if (!parsed) throw new Error('Local content model returned an unreadable analysis payload.');
  return parsed;
}

async function visibleVideo(page) {
  const videos = page.locator('video');
  const count = Math.min(await videos.count().catch(() => 0), 8);
  for (let index = 0; index < count; index++) {
    const candidate = videos.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return count ? videos.first() : null;
}

async function waitForVideoMetadata(video) {
  if (!video) return { duration: 0, width: 0, height: 0 };
  return video.evaluate(async (element) => {
    element.muted = true;
    element.pause();
    if (!Number.isFinite(element.duration) || element.duration <= 0) {
      await new Promise((resolve) => {
        const finish = () => resolve();
        element.addEventListener('loadedmetadata', finish, { once: true });
        setTimeout(finish, 5000);
      });
    }
    return {
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      width: element.videoWidth || 0,
      height: element.videoHeight || 0,
    };
  }).catch(() => ({ duration: 0, width: 0, height: 0 }));
}

async function seekVideo(video, time) {
  if (!video) return false;
  return video.evaluate(async (element, target) => {
    try {
      element.muted = true;
      element.pause();
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      const safe = duration > 0 ? Math.max(0, Math.min(duration - 0.03, target)) : 0;
      if (Math.abs((element.currentTime || 0) - safe) < 0.04) return true;
      await new Promise((resolve) => {
        const done = () => resolve();
        element.addEventListener('seeked', done, { once: true });
        element.currentTime = safe;
        setTimeout(done, 1800);
      });
      return true;
    } catch { return false; }
  }, time).catch(() => false);
}

async function textTrackTranscript(video) {
  if (!video) return '';
  return video.evaluate((element) => {
    const lines = [];
    for (const track of Array.from(element.textTracks || [])) {
      try { track.mode = 'hidden'; } catch {}
      const cues = Array.from(track.cues || []);
      for (const cue of cues) if (cue && typeof cue.text === 'string') lines.push(cue.text);
    }
    return [...new Set(lines)].join(' ');
  }).catch(() => '');
}

async function capturePostFrames(context, row, { maxFrames = 16, timeoutMs = 30000, contactSheet = false } = {}) {
  const url = canonicalSocialPostUrl(row?.url, row?.platform);
  if (!url) throw new Error('Unsupported or malformed social post URL');
  const page = await context.newPage();
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 20000) });
    await page.locator('video').first().waitFor({state:'attached', timeout:15000}).catch(() => {});
    await page.waitForTimeout(300);
    const title = clean(await page.title().catch(() => ''), 300);
    const video = await visibleVideo(page);
    if (!video) {
      const post = page.locator(row.platform === 'X' ? 'article[data-testid="tweet"]' : '[data-e2e="recommend-list-item-container"]').first();
      await post.waitFor({state:'visible', timeout:5000});
      const buffer = await post.screenshot({ type: 'jpeg', quality: 60, timeout:5000 }).catch(() => null);
      if (!buffer) return { frames: [], duration: 0, transcript: '', pageTitle: title, captureType: 'none', elapsedMs: Date.now() - started };
      const base64 = buffer.toString('base64');
      return { frames: [{ time: 0, base64, dataUrl: `data:image/jpeg;base64,${base64}` }], duration: 0, transcript: '', pageTitle: title, captureType: 'post-screenshot', elapsedMs: Date.now() - started };
    }
    const metadata = await waitForVideoMetadata(video);
    const times = frameSchedule(metadata.duration, maxFrames);
    const frames = [];
    for (const time of times) {
      if (Date.now() - started > timeoutMs) break;
      await seekVideo(video, time);
      await page.waitForTimeout(80);
      const decoded = await video.evaluate(element => {
        if (!element.videoWidth || !element.videoHeight || element.readyState < 2) return null;
        const scale = Math.min(1, 640 / Math.max(element.videoWidth, element.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
        canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      }).catch(() => null);
      const buffer = decoded ? Buffer.from(decoded, 'base64') : await video.screenshot({ type: 'jpeg', quality: 45, timeout: 2500 }).catch(() => null);
      if (!buffer) continue;
      const base64 = buffer.toString('base64');
      frames.push({ time, base64, dataUrl: `data:image/jpeg;base64,${base64}` });
    }
    const transcript = clean(await textTrackTranscript(video), 4000);
    const sheet = contactSheet && frames.length > 1 ? await buildTimelineContactSheet(page, modelFrames(frames, MODEL_FRAME_LIMIT)) : null;
    return { frames, modelFrames: sheet ? [sheet] : null, contactSheet: Boolean(sheet), duration: metadata.duration || 0, transcript, pageTitle: title, captureType: 'video-timeline', elapsedMs: Date.now() - started };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function buildTimelineContactSheet(page, frames) {
  const base64 = await page.evaluate(async input => {
    const images = await Promise.all(input.map(frame => new Promise((resolve,reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = `data:image/jpeg;base64,${frame.base64}`;
    })));
    const columns = Math.min(3, images.length), rows = Math.ceil(images.length / columns);
    const cellWidth = 168, imageHeight = Math.min(398, Math.round(cellWidth * images[0].height / images[0].width)), labelHeight = 24;
    const canvas = document.createElement('canvas'); canvas.width = columns * cellWidth; canvas.height = rows * (imageHeight + labelHeight);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    images.forEach((image,index) => {
      const x = (index % columns) * cellWidth, y = Math.floor(index / columns) * (imageHeight + labelHeight);
      const scale = Math.min(cellWidth/image.width,imageHeight/image.height);
      ctx.drawImage(image,x+(cellWidth-image.width*scale)/2,y+labelHeight,image.width*scale,image.height*scale);
      ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.fillText(`${index+1}: ${Number(input[index].time).toFixed(1)}s`,x+6,y+18);
    });
    return canvas.toDataURL('image/jpeg',0.7).split(',')[1];
  }, frames.map(({base64,time})=>({base64,time})));
  return {base64, representedFrames:frames.length, time:0};
}

function modelFrames(frames, limit = 12) {
  if (frames.length <= limit) return frames;
  return Array.from({ length: limit }, (_, index) => frames[Math.round(index * (frames.length - 1) / (limit - 1))]);
}

export function excludeCaptureAnnotations(texts = [], contactSheet = false) {
  return contactSheet ? texts.filter(text => !/^\d+\s*:\s*\d+(?:\.\d+)?s$/i.test(String(text).trim())) : texts;
}

function analysisPrompt(row, capture) {
  return [
    'Identify the specific story/action/joke from these chronological video frames and post context. Names require caption or visible-text support; never identify faces or invent audio, dialogue, dates, places, or backstory.',
    'Return compact JSON only: s (grounded summary <=12 words), e (event <=4 words), n (<=3 entities), t (<=2 visible text phrases, each <=4 words), m (meme potential 0-1), c (confidence 0-1), u (uncertainty, <=1 short phrase). Empty arrays when absent; no redundant prose.',
    `Platform: ${clean(row.platform, 20)}`,
    `Author: ${clean(row.author, 120)}`,
    `Post caption/context: ${clean(row.content, MAX_CONTEXT_TEXT)}`,
    `Sound: ${clean(row.soundTitle || row.soundId, 240) || 'unknown'}`,
    `Page title: ${capture.pageTitle || 'unknown'}`,
    `Video duration: ${Number(capture.duration || 0).toFixed(2)} seconds`,
    capture.transcript ? `Available caption track text: ${capture.transcript}` : 'Available caption track text: none',
    capture.contactSheet ? 'The image is a chronological contact sheet. Read panels left to right, then top to bottom; each panel has a frame number and timestamp. These are successive frames from ONE video, not separate events. Panel numbers and timestamps are capture annotations, never source on-screen text.' : 'Frames are ordered from early to late and labeled with timestamps.',
  ].join('\n');
}

export function applyUnderstanding(row, analysis) {
  if (!analysis?.summary || analysis.confidence < 0.5) return { ...row, contentUnderstanding: analysis || null };
  const parts = [
    `Visual summary: ${analysis.summary}`,
    analysis.event ? `Event: ${analysis.event}` : '',
    analysis.entities?.length ? `Entities: ${analysis.entities.join(', ')}` : '',
    analysis.actions?.length ? `Actions: ${analysis.actions.join(', ')}` : '',
    analysis.onScreenText?.length ? `On-screen text: ${analysis.onScreenText.join(' · ')}` : '',
    analysis.visualMotifs?.length ? `Visual motifs: ${analysis.visualMotifs.join(', ')}` : '',
  ].filter(Boolean);
  const original = clean(row.sourceContent ?? row.content, 6200);
  const enriched = clean(`${original} ${parts.join('. ')}`, 8000);
  return {
    ...row,
    content: enriched,
    sourceContent: original,
    contentSummary: analysis.summary,
    contentEvent: analysis.event || null,
    contentEntities: analysis.entities || [],
    contentActions: analysis.actions || [],
    onScreenText: analysis.onScreenText || [],
    visualMotifs: analysis.visualMotifs || [],
    contentConfidence: analysis.confidence,
    memePotential: analysis.memePotential,
    contentProvider: analysis.provider || null,
    contentModel: analysis.model || null,
    contentFrameCount: analysis.frameCount || 0,
    contentDuration: analysis.duration || 0,
    contentAnalyzedAt: analysis.analyzedAt || Date.now(),
    contentUnderstandingVersion: CONTENT_UNDERSTANDING_VERSION,
    contentUnderstanding: analysis,
  };
}

function latestByAt(entries = []) {
  return [...entries].sort((a, b) => Number(b?.[1]?.at || 0) - Number(a?.[1]?.at || 0))[0] || null;
}

function successfulAnalysisSnapshot(entry) {
  if (!entry?.ok || !entry.analysis?.summary) return null;
  const analysis = entry.analysis;
  return {
    cachedAt: Number(entry.at || 0) || null,
    analyzedAt: Number(analysis.analyzedAt || 0) || null,
    summary: clean(analysis.summary, 420),
    confidence: finite(analysis.confidence),
    provider: analysis.provider || null,
    model: analysis.model || null,
    frameCount: Number(analysis.frameCount || 0),
    modelFrameCount: Number(analysis.modelFrameCount || 0),
    duration: Number(analysis.duration || 0),
    captureType: analysis.captureType || null,
  };
}

export class ContentUnderstandingEngine {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.cachePath = path.join(dataDir, 'content-understanding-v17.json');
    this.cache = readJson(this.cachePath, {});
    this.provider = providerConfig();
    this.lastRun = null;
    this.lastError = null;
    this.lastStats = null;
  }

  status() {
    const entries = Object.entries(this.cache || {});
    const successes = entries.filter(([, entry]) => entry?.ok === true && entry?.analysis?.summary);
    const failures = entries.filter(([, entry]) => entry?.ok === false);
    const latestSuccessEntry = latestByAt(successes)?.[1] || null;
    const latestFailureEntry = latestByAt(failures)?.[1] || null;
    let state = 'configured-not-run';
    if (!this.provider.available) state = 'inactive';
    else if (this.lastStats && Number(this.lastStats.failed || 0) > 0 && Number(this.lastStats.enriched || 0) === 0 && Number(this.lastStats.cached || 0) === 0) state = 'failed';
    else if (this.lastError) state = 'degraded';
    else if (this.lastRun && (Number(this.lastStats?.enriched || 0) > 0 || Number(this.lastStats?.cached || 0) > 0)) state = 'healthy';
    else if (successes.length) state = 'cached-ready';
    return {
      version: CONTENT_UNDERSTANDING_VERSION,
      enabled: this.provider.available,
      provider: this.provider.provider,
      model: this.provider.model || null,
      reason: this.provider.reason || null,
      state,
      cachedVideos: entries.length,
      successfulCachedVideos: successes.length,
      failedCachedVideos: failures.length,
      latestSuccess: successfulAnalysisSnapshot(latestSuccessEntry),
      latestFailure: latestFailureEntry ? { cachedAt: Number(latestFailureEntry.at || 0) || null, error: clean(latestFailureEntry.error, 300) || 'Unknown content-analysis failure' } : null,
      lastRun: this.lastRun,
      lastError: this.lastError,
      lastStats: this.lastStats,
      modelFrameLimit: MODEL_FRAME_LIMIT,
      deepTimeoutMs: DEEP_TIMEOUT_MS,
      scoutTimeoutMs: SCOUT_TIMEOUT_MS,
      keepAlive: this.provider.provider === 'ollama' ? OLLAMA_KEEP_ALIVE : null,
    };
  }

  cacheKey(row) {
    return `${row.platform}|${row.id}|${row.url}|${this.provider.provider}|${this.provider.model || 'none'}|v${CONTENT_UNDERSTANDING_VERSION}|timeline-sheet-v7`;
  }

  cacheEntry(row) {
    const entry = this.cache[this.cacheKey(row)];
    if (!entry) return null;
    const ttl = entry.ok === false ? FAILURE_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - Number(entry.at || 0) > ttl) return null;
    return entry;
  }

  cached(row) {
    const entry = this.cacheEntry(row);
    return entry?.ok === true ? (entry.analysis || null) : null;
  }

  applyCached(rows = []) {
    return rows.map((row) => {
      const analysis = this.cached(row);
      return analysis?.summary ? applyUnderstanding(row, analysis) : row;
    });
  }

  persistCache() {
    const entries = Object.entries(this.cache).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 500);
    this.cache = Object.fromEntries(entries);
    writeJson(this.cachePath, this.cache);
  }

  capture(context, row, options) { return capturePostFrames(context, row, options); }

  async analyzeOne(context, row, { maxFrames = 16, timeoutMs = DEEP_TIMEOUT_MS } = {}) {
    const cachedEntry = this.cacheEntry(row);
    if (cachedEntry?.ok === true && cachedEntry.analysis?.summary) return { analysis: cachedEntry.analysis, cached: true };
    if (cachedEntry?.ok === false) return { analysis: null, cached: false, cachedFailure: true, error: clean(cachedEntry.error, 300) || 'Recent content-analysis failure is cooling down.' };
    if (!this.provider.available) return { analysis: null, cached: false, skipped: this.provider.reason || 'provider-unavailable' };
    const controller = new AbortController();
    let timer;
    const started = Date.now();
    let captureMs = 0;
    try {
      const capture = await this.capture(context, row, { maxFrames, contactSheet: this.provider.provider === 'ollama', timeoutMs: Math.max(8000, timeoutMs - 8000) });
      captureMs = Date.now() - started;
      if (!capture.frames.length) throw new Error('No visual frames could be captured from the post.');
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const chosen = capture.modelFrames || modelFrames(capture.frames, Math.min(MODEL_FRAME_LIMIT, maxFrames));
      const prompt = analysisPrompt(row, capture);
      const raw = this.provider.provider === 'ollama'
        ? await analyzeOllama(chosen, prompt, this.provider, controller.signal)
        : await analyzeOpenAI(chosen, prompt, this.provider, controller.signal);
      const analysis = {
        ...raw,
        onScreenText: excludeCaptureAnnotations(raw.onScreenText, capture.contactSheet),
        provider: this.provider.provider,
        model: this.provider.model,
        frameCount: capture.frames.length,
        modelFrameCount: chosen.reduce((sum, frame) => sum + (frame.representedFrames || 1), 0), modelImageCount: chosen.length,
        duration: Number(capture.duration || 0),
        captureType: capture.captureType, captureMs, modelMs: Date.now() - started - captureMs,
        analyzedAt: Date.now(),
        version: CONTENT_UNDERSTANDING_VERSION,
      };
      this.cache[this.cacheKey(row)] = { at: Date.now(), ok: true, analysis };
      this.persistCache();
      return { analysis, cached: false };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Content analysis timed out.' : clean(error?.message || error, 300);
      this.cache[this.cacheKey(row)] = { at: Date.now(), ok: false, error: message, captureMs, totalMs: Date.now() - started, analysis: null };
      this.persistCache();
      return { analysis: null, cached: false, error: message, captureMs, modelMs:Date.now()-started-captureMs, totalMs:Date.now()-started };
    } finally {
      clearTimeout(timer);
    }
  }

  async enrich(context, rows = [], { mode = 'deep', maxVideos } = {}) {
    const limit = Math.max(0, Math.min(8, Number(maxVideos ?? (mode === 'deep' ? 4 : 2)) || 0));
    const selected = selectVideoCandidates(rows, { limit });
    const byKey = new Map(rows.map((row) => [this.cacheKey(row), row]));
    const stats = { requested: selected.length, analyzed: 0, cached: 0, cachedFailures: 0, enriched: 0, failed: 0, skipped: 0, provider: this.provider.provider, model: this.provider.model || null, modelFrameLimit: MODEL_FRAME_LIMIT, timeoutMs:mode === 'deep' ? DEEP_TIMEOUT_MS : SCOUT_TIMEOUT_MS, errors:[], items:[] };
    for (const row of selected) {
      const result = await this.analyzeOne(context, row, { maxFrames: mode === 'deep' ? 16 : 10, timeoutMs: mode === 'deep' ? DEEP_TIMEOUT_MS : SCOUT_TIMEOUT_MS });
      stats.items.push({url:row.url, cached:Boolean(result.cached), error:result.error || null, confidence:result.analysis?.confidence ?? null, captureMs:result.analysis?.captureMs ?? result.captureMs ?? null, modelMs:result.analysis?.modelMs ?? result.modelMs ?? null});
      if (result.error) stats.errors.push(result.error);
      if (result.cached) stats.cached++;
      else if (result.cachedFailure) { stats.cachedFailures++; stats.failed++; }
      else if (result.analysis) stats.analyzed++;
      else if (result.skipped) stats.skipped++;
      else stats.failed++;
      if (result.analysis?.summary && result.analysis.confidence >= 0.5) {
        byKey.set(this.cacheKey(row), applyUnderstanding(row, result.analysis));
        stats.enriched++;
      }
    }
    this.lastRun = Date.now();
    this.lastStats = stats;
    this.lastError = stats.failed ? `${stats.failed} content analysis item(s) failed` : null;
    const output = rows.map((row) => byKey.get(this.cacheKey(row)) || row);
    return { rows: this.applyCached(output), stats };
  }
}
