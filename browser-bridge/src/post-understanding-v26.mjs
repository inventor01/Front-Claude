import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 26;
const CACHE_TTL_MS = 7 * 24 * 3600000;
const clean = (value, max = 800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalize = (value) => clean(value, 1200).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}$#@]+/gu, ' ').replace(/\s+/g, ' ').trim();
const uniq = (items = [], limit = 12) => [...new Set(items.map((x) => clean(x, 160)).filter(Boolean))].slice(0, limit);
const clamp01 = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; };
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };

const GENERIC = new Set((
  'face faces take takes took taking grow grows growing grown love loves loved loving look looks looking looked see sees seeing saw make makes making made get gets getting got go goes going went '+
  'come comes coming came use uses using used say says saying said tell tells telling told want wants wanting wanted need needs needing needed give gives giving gave '+
  'good bad big small new old first last best worst crazy insane wild funny viral trend trending meme memes clip clips video videos post posts photo photos image images '+
  'thing things stuff something anything everything people person guy guys girl girls man men woman women bro dude time times day days today tonight now '+
  'home live stream streams watch watching watched reaction reactions news update updates original sound audio tiktok twitter x fyp foryou '+
  'coin coins token tokens crypto solana pump pumpfun market markets'
).split(/\s+/));
const STOP = new Set((
  'the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i me my you your we our they their he she his her '+
  'not no yes just very really have has had do does did can could would should will may might about into over under after before more most some any all one two what when where who why how'
).split(/\s+/));

export function isGenericSubject(value) {
  const parts = normalize(value).split(' ').filter(Boolean);
  if (!parts.length) return true;
  const meaningful = parts.filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC.has(word) && !/^\d+$/.test(word));
  if (parts.length === 1) return meaningful.length === 0;
  return meaningful.length < Math.min(2, Math.ceil(parts.length / 3));
}

function extractHashtags(text) {
  return uniq([...String(text || '').matchAll(/#([\p{L}\p{N}_]{2,50})/gu)].map((m) => m[1]), 8);
}
function extractHandles(text) {
  return uniq([...String(text || '').matchAll(/@([A-Za-z0-9_]{2,40})/g)].map((m) => m[1]), 8);
}
function extractCapitalized(text) {
  const raw = String(text || '').replace(/https?:\/\/\S+/g, ' ');
  const found = [...raw.matchAll(/\b([A-Z][A-Za-z0-9$]*(?:\s+[A-Z][A-Za-z0-9$]*){0,3})\b/g)].map((m) => m[1]);
  return uniq(found.filter((value) => !/^(I|The|This|That|We|You|They|He|She|It|And|But|For|With|From|When|What|Why|How)$/i.test(value)), 10);
}

function phraseCandidates(text) {
  const tokens = normalize(text).split(' ').filter(Boolean).slice(0, 80);
  const out = [];
  for (let size = 2; size <= 6; size++) {
    for (let i = 0; i <= tokens.length - size; i++) {
      const slice = tokens.slice(i, i + size);
      const meaningful = slice.filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC.has(word));
      if (meaningful.length < Math.min(2, size)) continue;
      const phrase = slice.join(' ');
      if (!isGenericSubject(phrase)) out.push(phrase);
    }
  }
  return uniq(out, 30);
}

function fallbackFrame(row) {
  const source = clean(row?.contentSummary || row?.content || '', 2400);
  const entities = uniq([
    ...(Array.isArray(row?.contentEntities) ? row.contentEntities : []),
    ...extractCapitalized(source),
    ...extractHashtags(source),
    ...extractHandles(source),
  ], 12);
  const phrases = phraseCandidates(source);
  const event = clean(row?.contentEvent || '', 180);
  const subject = !isGenericSubject(event) ? event : (phrases[0] || entities.slice(0, 3).join(' ') || clean(source, 120));
  return {
    subject: isGenericSubject(subject) ? '' : clean(subject, 160),
    event: !isGenericSubject(event) ? event : '',
    entities,
    action: '',
    object: '',
    context: '',
    narrativeKey: '',
    confidence: subject && !isGenericSubject(subject) ? 0.42 : 0.18,
    method: 'deterministic-fallback',
  };
}

function providerConfig() {
  const requested = String(process.env.FRONT_CONTEXT_PROVIDER || process.env.FRONT_CONTENT_PROVIDER || 'auto').toLowerCase();
  if (requested === 'off' || requested === 'disabled') return { available: false, provider: 'off', reason: 'disabled' };
  const openaiKey = process.env.FRONT_CONTEXT_API_KEY || process.env.FRONT_CONTENT_API_KEY || process.env.OPENAI_API_KEY || '';
  if ((requested === 'auto' || requested === 'openai') && openaiKey) return {
    available: true, provider: 'openai', key: openaiKey,
    endpoint: process.env.FRONT_CONTEXT_ENDPOINT || process.env.FRONT_CONTENT_ENDPOINT || 'https://api.openai.com/v1/responses',
    model: process.env.FRONT_CONTEXT_MODEL || process.env.FRONT_CONTENT_MODEL || 'gpt-5.6-luna',
  };
  const ollamaModel = process.env.FRONT_CONTEXT_OLLAMA_MODEL || process.env.FRONT_OLLAMA_MODEL || '';
  if ((requested === 'auto' || requested === 'ollama') && ollamaModel) return {
    available: true, provider: 'ollama', endpoint: process.env.FRONT_CONTEXT_OLLAMA_ENDPOINT || process.env.FRONT_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/api/chat', model: ollamaModel,
  };
  return { available: false, provider: requested, reason: 'no-model-provider' };
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) for (const content of Array.isArray(item?.content) ? item.content : []) if (typeof content?.text === 'string') parts.push(content.text);
  return parts.join('\n');
}

function parseJson(value) {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const first = fenced.indexOf('['), last = fenced.lastIndexOf(']');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(fenced.slice(first, last + 1)); } catch { return null; }
}

function batchPrompt(rows) {
  const payload = rows.map((row, index) => ({
    index,
    platform: row.platform,
    author: row.author,
    caption: clean(row.content, 1400),
    visualSummary: clean(row.contentSummary, 500) || null,
    visualEvent: clean(row.contentEvent, 240) || null,
    visualEntities: Array.isArray(row.contentEntities) ? row.contentEntities.slice(0, 10) : [],
  }));
  return [
    'You are Front\'s contextual post-understanding engine. Analyze EACH social post by meaning, not by repeated isolated words.',
    'For each post identify the actual SUBJECT and EVENT. A subject is the specific person, object, product, incident, meme, announcement, performance, controversy, or situation the post is about.',
    'Never use generic standalone verbs/adjectives/body words as subject labels. Forbidden examples include: face, take, grow, love, look, make, get, use, good, bad, crazy, viral, video, post, people, thing.',
    'A word shared by two posts does NOT make them the same subject. Example: "grow your business with X Ads" and "AI startups want to grow together" describe different subjects.',
    'Prefer concrete named entities plus the event/action: e.g. "N3ON AI stream incident", "NEO robot X Ads campaign", "mascot halftime fall".',
    'If the caption is too vague, use visualSummary/visualEvent/entities when present. Do not invent facts not supplied.',
    'Return ONLY a JSON array with one object per input in the same order. Keys: index, subject (2-8 specific words), event (short phrase), entities (array), action (short phrase), object (short phrase), context (short phrase), narrativeKey (stable lowercase semantic key, 2-8 words), confidence (0-1).',
    JSON.stringify(payload),
  ].join('\n');
}

function normalizeFrame(raw, fallback) {
  if (!raw || typeof raw !== 'object' || isGenericSubject(raw.subject)) return fallback;
  const subject = clean(raw.subject, 180);
  const event = clean(raw.event, 220);
  const narrativeKey = clean(raw.narrativeKey, 180).toLowerCase();
  const confidence = clamp01(raw.confidence, 0.5);
  const frame = {
    subject: isGenericSubject(subject) ? fallback.subject : subject,
    event: isGenericSubject(event) ? fallback.event : event,
    entities: uniq([...(Array.isArray(raw.entities) ? raw.entities : []), ...fallback.entities], 12),
    action: clean(raw.action, 120),
    object: clean(raw.object, 160),
    context: clean(raw.context, 180),
    narrativeKey: isGenericSubject(narrativeKey) ? '' : narrativeKey,
    confidence,
    method: 'semantic-model',
  };
  if (!frame.narrativeKey) frame.narrativeKey = normalize(frame.subject || frame.event).split(' ').filter((word) => !STOP.has(word) && !GENERIC.has(word)).slice(0, 8).join(' ');
  return frame;
}

async function analyzeOllama(rows, provider, signal) {
  const response = await fetch(provider.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: provider.model, stream: false, think: false, messages: [{ role: 'user', content: batchPrompt(rows) }], options: { temperature: 0.05 } }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ollama context analysis failed (${response.status}): ${clean(data?.error || response.statusText, 220)}`);
  return parseJson(data?.message?.content || data?.response || '');
}

async function analyzeOpenAI(rows, provider, signal) {
  const response = await fetch(provider.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` }, signal,
    body: JSON.stringify({ model: provider.model, store: false, max_output_tokens: 2200, input: batchPrompt(rows) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI context analysis failed (${response.status}): ${clean(data?.error?.message || response.statusText, 220)}`);
  return parseJson(extractResponseText(data));
}

export function applyPostUnderstanding(row, frame) {
  return {
    ...row,
    postSubject: frame.subject || null,
    postEvent: frame.event || null,
    postEntities: frame.entities || [],
    postAction: frame.action || null,
    postObject: frame.object || null,
    postContext: frame.context || null,
    semanticNarrativeKey: frame.narrativeKey || null,
    postUnderstandingConfidence: frame.confidence || 0,
    postUnderstandingMethod: frame.method || 'unknown',
    postUnderstandingVersion: VERSION,
  };
}

export class PostUnderstandingEngineV26 {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.cachePath = path.join(dataDir, 'post-understanding-v26.json');
    this.cache = readJson(this.cachePath, {});
    this.provider = providerConfig();
    this.lastStats = null;
  }
  key(row) {
    const fingerprint = createHash('sha256').update(JSON.stringify([row.content, row.contentSummary, row.contentEvent, row.contentEntities, this.provider.provider, this.provider.model, 'grounded-v2'])).digest('hex');
    return `${row.platform}|${row.id}|${row.url}|${fingerprint}`;
  }
  cached(row) {
    const entry = this.cache[this.key(row)];
    if (!entry || Date.now() - Number(entry.at || 0) > CACHE_TTL_MS) return null;
    return entry.frame?.method === 'semantic-model' ? entry.frame : null;
  }
  persist() {
    const entries = Object.entries(this.cache).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 2500);
    this.cache = Object.fromEntries(entries);
    writeJson(this.cachePath, this.cache);
  }
  status() {
    return { version: VERSION, enabled: this.provider.available, provider: this.provider.provider, model: this.provider.model || null, cachedPosts: Object.keys(this.cache).length, lastStats: this.lastStats };
  }
  async enrich(rows = [], { batchSize = 8, timeoutMs = 45000 } = {}) {
    const output = new Map();
    const pending = [];
    let cached = 0;
    for (const row of rows) {
      const existing = this.cached(row);
      if (existing) { output.set(this.key(row), applyPostUnderstanding(row, existing)); cached++; }
      else pending.push(row);
    }
    let modeled = 0, failed = 0;
    for (let offset = 0; offset < pending.length; offset += Math.max(1, batchSize)) {
      const batch = pending.slice(offset, offset + Math.max(1, batchSize));
      const fallbacks = batch.map(fallbackFrame);
      let analyzed = null;
      if (this.provider.available) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          analyzed = this.provider.provider === 'ollama' ? await analyzeOllama(batch, this.provider, controller.signal) : await analyzeOpenAI(batch, this.provider, controller.signal);
        } catch { analyzed = null; }
        finally { clearTimeout(timer); }
      }
      batch.forEach((row, index) => {
        const matches = Array.isArray(analyzed) ? analyzed.filter(item => Number.isInteger(item?.index) && item.index === index) : [];
        const raw = matches.length === 1 ? matches[0] : null;
        const valid = raw && typeof raw.subject === 'string' && Number.isFinite(raw.confidence);
        if (this.provider.available && !valid) failed++;
        const frame = valid ? normalizeFrame(raw, fallbacks[index]) : fallbacks[index];
        if (frame.method === 'semantic-model') modeled++;
        this.cache[this.key(row)] = { at: Date.now(), frame };
        output.set(this.key(row), applyPostUnderstanding(row, frame));
      });
      this.persist();
    }
    this.lastStats = { total: rows.length, cached, modeled, fallback: rows.length - cached - modeled, failed, batchSize: Math.max(1, batchSize), provider: this.provider.provider, model: this.provider.model || null };
    return { rows: rows.map((row) => output.get(this.key(row)) || applyPostUnderstanding(row, fallbackFrame(row))), stats: this.lastStats };
  }
}
