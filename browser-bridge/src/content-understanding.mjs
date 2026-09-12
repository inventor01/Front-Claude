import fs from 'node:fs';
import path from 'node:path';

export const CONTENT_UNDERSTANDING_VERSION = 17;
const CACHE_TTL_MS = 7 * 24 * 3600000;
const FAILURE_TTL_MS = 5 * 60000;
const MAX_CONTEXT_TEXT = 2200;

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
  const videos = rows.filter((row) => row?.id && row?.url && looksLikeVideo(row));
  const byCreator = new Map();
  for (const row of videos.sort((a, b) => evidenceScore(b) - evidenceScore(a))) {
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
    const raw = JSON.parse(fenced.slice(first, last + 1));
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
      messages: [{
        role: 'user',
        content: context,
        images: frames.map((frame) => frame.base64),
      }],
      options: { temperature: 0.1 },
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

async function capturePostFrames(context, row, { maxFrames = 16, timeoutMs = 30000 } = {}) {
  const page = await context.newPage();
  const started = Date.now();
  try {
    await page.goto(row.url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 20000) });
    await page.waitForTimeout(1200);
    const title = clean(await page.title().catch(() => ''), 300);
    const video = await visibleVideo(page);
    if (!video) {
      const buffer = await page.screenshot({ type: 'jpeg', quality: 45, fullPage: false }).catch(() => null);
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
      const buffer = await video.screenshot({ type: 'jpeg', quality: 45 }).catch(() => null);
      if (!buffer) continue;
      const base64 = buffer.toString('base64');
      frames.push({ time, base64, dataUrl: `data:image/jpeg;base64,${base64}` });
    }
    const transcript = clean(await textTrackTranscript(video), 4000);
    return { frames, duration: metadata.duration || 0, transcript, pageTitle: title, captureType: 'video-timeline', elapsedMs: Date.now() - started };
  } finally {
    await page.close().catch(() => {});
  }
}

function modelFrames(frames, limit = 12) {
  if (frames.length <= limit) return frames;
  return Array.from({ length: limit }, (_, index) => frames[Math.round(index * (frames.length - 1) / (limit - 1))]);
}

function analysisPrompt(row, capture) {
  return [
    'You are Front\'s social-video content understanding layer. Determine what this post is actually about from the chronological frames plus the supplied post context.',
    'Treat the frames as a time sequence. Focus on the event, person/object, action, joke, reaction, visual template, on-screen text, transformation, reveal, or other details that would let an analyst recognize the same narrative in another post.',
    'Do not infer a real person\'s identity from appearance alone. Only use a person/name when the supplied caption, page text, or visible on-screen text supports it. Do not invent dialogue, audio, dates, places, or backstory that are not visible or supplied.',
    'Return ONLY valid JSON with keys: summary (1-2 specific sentences), event (short event phrase), entities (array), actions (array), onScreenText (array), visualMotifs (array), memePotential (0-1), confidence (0-1), uncertainties (array).',
    `Platform: ${clean(row.platform, 20)}`,
    `Author: ${clean(row.author, 120)}`,
    `Post caption/context: ${clean(row.content, MAX_CONTEXT_TEXT)}`,
    `Sound: ${clean(row.soundTitle || row.soundId, 240) || 'unknown'}`,
    `Page title: ${capture.pageTitle || 'unknown'}`,
    `Video duration: ${Number(capture.duration || 0).toFixed(2)} seconds`,
    capture.transcript ? `Available caption track text: ${capture.transcript}` : 'Available caption track text: none',
    'Frames are ordered from early to late and labeled with timestamps.',
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
  const original = clean(row.content, 6200);
  const enriched = clean(`${original} ${parts.join('. ')}`, 8000);
  return {
    ...row,
    content: enriched,
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
    };
  }

  cacheKey(row) { return `${row.platform}|${row.id}|${row.url}`; }

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

  async analyzeOne(context, row, { maxFrames = 16, timeoutMs = 45000 } = {}) {
    const cachedEntry = this.cacheEntry(row);
    if (cachedEntry?.ok === true && cachedEntry.analysis?.summary) return { analysis: cachedEntry.analysis, cached: true };
    if (cachedEntry?.ok === false) return { analysis: null, cached: false, cachedFailure: true, error: clean(cachedEntry.error, 300) || 'Recent content-analysis failure is cooling down.' };
    if (!this.provider.available) return { analysis: null, cached: false, skipped: this.provider.reason || 'provider-unavailable' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const capture = await capturePostFrames(context, row, { maxFrames, timeoutMs: Math.max(8000, timeoutMs - 8000) });
      if (!capture.frames.length) throw new Error('No visual frames could be captured from the post.');
      const chosen = modelFrames(capture.frames, Math.min(12, maxFrames));
      const prompt = analysisPrompt(row, capture);
      const raw = this.provider.provider === 'ollama'
        ? await analyzeOllama(chosen, prompt, this.provider, controller.signal)
        : await analyzeOpenAI(chosen, prompt, this.provider, controller.signal);
      const analysis = {
        ...raw,
        provider: this.provider.provider,
        model: this.provider.model,
        frameCount: capture.frames.length,
        modelFrameCount: chosen.length,
        duration: Number(capture.duration || 0),
        captureType: capture.captureType,
        analyzedAt: Date.now(),
        version: CONTENT_UNDERSTANDING_VERSION,
      };
      this.cache[this.cacheKey(row)] = { at: Date.now(), ok: true, analysis };
      this.persistCache();
      return { analysis, cached: false };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Content analysis timed out.' : clean(error?.message || error, 300);
      this.cache[this.cacheKey(row)] = { at: Date.now(), ok: false, error: message, analysis: null };
      this.persistCache();
      return { analysis: null, cached: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  async enrich(context, rows = [], { mode = 'deep', maxVideos } = {}) {
    const limit = Math.max(0, Math.min(8, Number(maxVideos ?? (mode === 'deep' ? 4 : 2)) || 0));
    const selected = selectVideoCandidates(rows, { limit });
    const byKey = new Map(rows.map((row) => [this.cacheKey(row), row]));
    const stats = { requested: selected.length, analyzed: 0, cached: 0, cachedFailures: 0, enriched: 0, failed: 0, skipped: 0, provider: this.provider.provider, model: this.provider.model || null };
    for (const row of selected) {
      const result = await this.analyzeOne(context, row, { maxFrames: mode === 'deep' ? 16 : 10, timeoutMs: mode === 'deep' ? 45000 : 30000 });
      if (result.cached) stats.cached++;
      else if (result.cachedFailure) { stats.cachedFailures++; stats.failed++; }
      else if (result.analysis) stats.analyzed++;
      else if (result.skipped) stats.skipped++;
      else stats.failed++;
      if (result.analysis?.summary) {
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
