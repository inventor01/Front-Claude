import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SOCIAL_ARB_VERSION = 30;
const HISTORY_TTL_MS = 45 * 86400000;
const CACHE_TTL_MS = 14 * 86400000;
const OLLAMA_KEEP_ALIVE = String(process.env.FRONT_OLLAMA_KEEP_ALIVE || '30m');
const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (value) => clean(value, 500).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}$#@]+/gu, ' ').replace(/\s+/g, ' ').trim();
const uniq = (items = [], limit = 20) => [...new Set(items.map((x) => clean(x, 180)).filter(Boolean))].slice(0, limit);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };

const STOP = new Set(('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i me my you your we our they their he she his her not no yes just very really have has had do does did can could would should will may might about into over under after before more most some any all one two what when where who why how video videos post posts tiktok twitter instagram reel reels viral trending trend meme memes people person thing things stuff today tonight now').split(/\s+/));
const GENERIC = new Set(('product products brand brands item items store stores company companies buy buying bought get got use using used new favorite favorites review reviews ad ads commercial haul unboxing try trying tried consumer consumers customer customers').split(/\s+/));

const BEHAVIORS = Object.freeze({
  PURCHASED: /\b(?:bought|purchased|ordered|picked\s+up|grabbed|copped|got\s+mine|just\s+got|came\s+in\s+the\s+mail)\b/i,
  PURCHASE_INTENT: /\b(?:want\s+(?:one|this|it)|need\s+(?:one|this|it)|where\s+(?:can|do)\s+i\s+(?:buy|get|find)|adding\s+to\s+(?:my\s+)?cart|about\s+to\s+buy|going\s+to\s+buy|gonna\s+buy|must\s+have|need\s+to\s+try|want\s+to\s+try)\b/i,
  REPEAT_PURCHASE: /\b(?:keep\s+buying|reordered|re-order(?:ed|ing)?|bought\s+another|another\s+one|every\s+day|daily|every\s+week|weekly|second\s+(?:one|time)|third\s+(?:one|time)|stocked\s+up)\b/i,
  SWITCHING: /\b(?:switched\s+from|switching\s+from|instead\s+of|replaced\s+(?:my|the)|ditched|stopped\s+(?:buying|using)|quit\s+(?:buying|using)|better\s+than|moving\s+from)\b/i,
  STOCKOUT: /\b(?:sold\s+out|out\s+of\s+stock|cant\s+find|can't\s+find|cannot\s+find|hard\s+to\s+find|gone\s+everywhere|empty\s+shelves?|back\s+in\s+stock|restock(?:ed|ing)?)\b/i,
  ADOPTION: /\b(?:everyone\s+(?:has|uses|wears|drinks|owns)|everybody\s+(?:has|uses|wears|drinks|owns)|all\s+my\s+friends|everyone\s+at\s+(?:school|work)|started\s+using|using\s+this\s+now|new\s+favorite|obsessed\s+with)\b/i,
  ABANDONMENT: /\b(?:stopped\s+(?:buying|using)|dont\s+buy\s+anymore|don't\s+buy\s+anymore|never\s+buying\s+again|quit\s+using|cancelled\s+my|canceled\s+my|ditched)\b/i,
  COMPLAINT: /\b(?:hate\s+this|awful|terrible|broke|broken|returning\s+it|refund|worst|disappointed|doesnt\s+work|doesn't\s+work)\b/i,
  PRICE_RESISTANCE: /\b(?:too\s+expensive|overpriced|not\s+worth\s+it|price\s+is\s+(?:crazy|insane)|cant\s+justify|can't\s+justify|costs\s+too\s+much)\b/i,
});

const POSITIVE = new Set(['PURCHASED','PURCHASE_INTENT','REPEAT_PURCHASE','ADOPTION','STOCKOUT']);
const NEGATIVE = new Set(['ABANDONMENT','COMPLAINT','PRICE_RESISTANCE']);

export function detectBehaviorSignals(text) {
  const source = clean(text, 6000);
  return Object.entries(BEHAVIORS).filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

function phraseQuality(value) {
  const words = norm(value).split(' ').filter(Boolean);
  if (!words.length || words.length > 10) return 0;
  const useful = words.filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC.has(word) && !/^\d+$/.test(word));
  if (!useful.length) return 0;
  const ratio = useful.length / words.length;
  return ratio * 60 + Math.min(40, useful.length * 10);
}

function contentPhrase(text) {
  const raw = clean(text, 900).replace(/https?:\/\/\S+/g, ' ');
  const proper = [...raw.matchAll(/\b([A-Z][A-Za-z0-9&+'-]*(?:\s+[A-Z][A-Za-z0-9&+'-]*){0,3})\b/g)]
    .map((m) => m[1]).filter((value) => phraseQuality(value) >= 55 && !/^(?:The|This|That|I|We|You|They|TikTok|Instagram|Twitter|X)$/i.test(value));
  if (proper.length) return proper[0];
  const words = norm(raw).split(' ').filter((word) => word.length >= 4 && !STOP.has(word) && !GENERIC.has(word));
  return words.slice(0, 4).join(' ');
}

function rowSubject(row) {
  const candidates = [
    row.socialArbSubject,
    row.semanticNarrativeKey,
    row.postObject,
    row.postSubject,
    row.videoSubject,
    row.postEvent,
    row.videoEvent,
    ...(Array.isArray(row.postEntities) ? row.postEntities : []),
    ...(Array.isArray(row.contentEntities) ? row.contentEntities : []),
  ].map((value) => clean(value, 180)).filter(Boolean).sort((a, b) => phraseQuality(b) - phraseQuality(a));
  const best = candidates.find((value) => phraseQuality(value) >= 45);
  return best || contentPhrase([row.content, row.transcript, row.videoAbout].filter(Boolean).join(' '));
}

function rowBrandCandidate(row, subject) {
  const structured = uniq([
    ...(Array.isArray(row.postEntities) ? row.postEntities : []),
    ...(Array.isArray(row.contentEntities) ? row.contentEntities : []),
  ], 12).filter((value) => phraseQuality(value) >= 55 && norm(value) !== norm(subject));
  if (structured.length) return structured[0];
  const proper = contentPhrase(row.content);
  return proper && phraseQuality(proper) >= 60 && norm(proper) !== norm(subject) ? proper : null;
}

function evidenceText(row) {
  return clean([row.content, row.transcript, row.videoAbout, row.postEvent, row.postContext].filter(Boolean).join(' '), 6000);
}

function candidateStatus(score, creators, commenters, behaviors) {
  const independentVoices = creators + Math.min(commenters, 12);
  if (score >= 80 && independentVoices >= 4 && behaviors >= 3) return 'HIGH_SIGNAL';
  if (score >= 64 && independentVoices >= 2) return 'RISING';
  if (score >= 45) return 'EARLY';
  return 'WATCH';
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function baselineFor(history, key) {
  const rows = Array.isArray(history?.[key]) ? history[key].filter((row) => Date.now() - Number(row.at || 0) <= HISTORY_TTL_MS) : [];
  return {
    samples: rows.length,
    evidence: median(rows.map((row) => Number(row.evidenceCount || 0))),
    authors: median(rows.map((row) => Number(row.authorCount || 0))),
    behaviors: median(rows.map((row) => Number(row.behaviorCount || 0))),
    comments: median(rows.map((row) => Number(row.commenterCount || 0))),
  };
}

export function deriveSocialArbCandidates(rows = [], { history = {}, now = Date.now(), limit = 30 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!row?.id || !row?.author || !row?.platform) continue;
    const text = evidenceText(row);
    const behaviors = detectBehaviorSignals(text);
    const subject = rowSubject(row);
    if (!subject || phraseQuality(subject) < 40) continue;
    const key = norm(subject);
    if (key.length < 3) continue;
    const existing = groups.get(key) || { key, title: clean(subject, 120), rows: [], behaviorCounts: {}, brandCandidates: new Map() };
    existing.rows.push(row);
    for (const behavior of behaviors) existing.behaviorCounts[behavior] = (existing.behaviorCounts[behavior] || 0) + 1;
    const brand = rowBrandCandidate(row, subject);
    if (brand) existing.brandCandidates.set(brand, (existing.brandCandidates.get(brand) || 0) + 1);
    groups.set(key, existing);
  }

  const out = [];
  for (const group of groups.values()) {
    const evidence = [];
    const evidenceIds = new Set();
    const authors = new Set();
    const commenters = new Set();
    const platforms = new Set();
    let confidenceTotal = 0;
    let confidenceCount = 0;
    for (const row of group.rows) {
      if (evidenceIds.has(row.id)) continue;
      evidenceIds.add(row.id);
      const voice=String(row.author).replace(/^@/, '').toLowerCase();
      if (row.evidenceType === 'comment') commenters.add(voice);
      else authors.add(voice);
      platforms.add(row.platform);
      const c = Number(row.postUnderstandingConfidence ?? row.videoMeaningConfidence);
      if (Number.isFinite(c)) { confidenceTotal += c; confidenceCount++; }
      evidence.push({
        id: clean(row.id, 180),
        platform: clean(row.platform, 20),
        author: clean(row.author, 120),
        url: clean(row.url, 2048),
        content: clean(row.content, 900),
        published: Number.isFinite(Number(row.published)) ? Number(row.published) : null,
        evidenceType: row.evidenceType === 'comment' ? 'comment' : 'post',
        parentUrl: row.parentUrl ? clean(row.parentUrl, 2048) : null,
      });
    }
    const behaviorCount = Object.values(group.behaviorCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    const positive = [...POSITIVE].reduce((sum, key) => sum + Number(group.behaviorCounts[key] || 0), 0);
    const negative = [...NEGATIVE].reduce((sum, key) => sum + Number(group.behaviorCounts[key] || 0), 0);
    const baseline = baselineFor(history, group.key);
    const current = evidence.length;
    const growthMultiple = baseline.samples && baseline.evidence > 0 ? current / baseline.evidence : null;
    const authorMultiple = baseline.samples && baseline.authors > 0 ? authors.size / baseline.authors : null;
    const commentMultiple = baseline.samples && baseline.comments > 0 ? commenters.size / baseline.comments : null;
    const behaviorMultiple = baseline.samples && baseline.behaviors > 0 ? behaviorCount / baseline.behaviors : null;
    const novelty = baseline.samples ? Math.max(0, Math.min(1, ((growthMultiple || 1) - 1) / 3)) : Math.min(1, current / 3);
    const modeledConfidence = confidenceCount ? confidenceTotal / confidenceCount : 0.35;
    const score = clamp(
      Math.min(26, authors.size * 9) +
      Math.min(18, commenters.size * 2.25) +
      Math.min(14, evidence.filter((item) => item.evidenceType !== 'comment').length * 3.5) +
      Math.min(20, behaviorCount * 4.5) +
      (platforms.size >= 2 ? 10 : 0) +
      novelty * 16 +
      modeledConfidence * 10
    );
    const direction = positive > negative * 1.4 ? 'positive' : negative > positive * 1.4 ? 'negative' : positive || negative ? 'mixed' : 'unknown';
    const brands = [...group.brandCandidates.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    out.push({
      key: group.key,
      title: clean(group.title, 120),
      product: clean(group.title, 120),
      brandCandidate: brands[0]?.[0] || null,
      direction,
      behaviors: group.behaviorCounts,
      behaviorCount,
      evidenceCount: evidence.length,
      authorCount: authors.size,
      commenterCount: commenters.size,
      independentVoiceCount: authors.size + commenters.size,
      platforms: [...platforms],
      evidenceIds: [...evidenceIds],
      evidence: evidence.slice(0, 8),
      score: Number(score.toFixed(1)),
      status: candidateStatus(score, authors.size, commenters.size, behaviorCount),
      baseline,
      change: {
        growthMultiple: growthMultiple == null ? null : Number(growthMultiple.toFixed(2)),
        authorMultiple: authorMultiple == null ? null : Number(authorMultiple.toFixed(2)),
        commentMultiple: commentMultiple == null ? null : Number(commentMultiple.toFixed(2)),
        behaviorMultiple: behaviorMultiple == null ? null : Number(behaviorMultiple.toFixed(2)),
        newToBaseline: baseline.samples === 0,
      },
      modeledConfidence: Number(modeledConfidence.toFixed(3)),
      firstObserved: Math.min(...evidence.map((item) => Number(item.published || now)).filter(Number.isFinite)),
      lastObserved: now,
      mappingStatus: 'unmapped',
      companyName: null,
      ticker: null,
      relation: null,
      materiality: null,
      thesis: null,
      mappingConfidence: 0,
      version: SOCIAL_ARB_VERSION,
    });
  }

  return out.sort((a, b) => b.score - a.score || b.authorCount - a.authorCount || b.evidenceCount - a.evidenceCount).slice(0, limit);
}

function providerConfig() {
  const requested = String(process.env.FRONT_SOCIAL_ARB_PROVIDER || process.env.FRONT_CONTEXT_PROVIDER || process.env.FRONT_CONTENT_PROVIDER || 'auto').toLowerCase();
  if (requested === 'off' || requested === 'disabled') return { available: false, provider: 'off', reason: 'disabled' };
  const openaiKey = process.env.FRONT_SOCIAL_ARB_API_KEY || process.env.FRONT_CONTEXT_API_KEY || process.env.FRONT_CONTENT_API_KEY || process.env.OPENAI_API_KEY || '';
  if ((requested === 'auto' || requested === 'openai') && openaiKey) return {
    available: true,
    provider: 'openai',
    key: openaiKey,
    endpoint: process.env.FRONT_SOCIAL_ARB_ENDPOINT || process.env.FRONT_CONTEXT_ENDPOINT || process.env.FRONT_CONTENT_ENDPOINT || 'https://api.openai.com/v1/responses',
    model: process.env.FRONT_SOCIAL_ARB_MODEL || process.env.FRONT_CONTEXT_MODEL || process.env.FRONT_CONTENT_MODEL || 'gpt-5.6-luna',
  };
  const ollamaModel = process.env.FRONT_SOCIAL_ARB_OLLAMA_MODEL || process.env.FRONT_CONTEXT_OLLAMA_MODEL || process.env.FRONT_OLLAMA_MODEL || '';
  if ((requested === 'auto' || requested === 'ollama') && ollamaModel) return {
    available: true,
    provider: 'ollama',
    endpoint: process.env.FRONT_SOCIAL_ARB_OLLAMA_ENDPOINT || process.env.FRONT_CONTEXT_OLLAMA_ENDPOINT || process.env.FRONT_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/api/chat',
    model: ollamaModel,
  };
  return { available: false, provider: requested, reason: 'no-model-provider' };
}

function responseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  return (Array.isArray(data?.output) ? data.output : []).flatMap((item) => item?.content || []).map((item) => item?.text || '').join('\n');
}

function parseArray(value) {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const first = fenced.indexOf('['), last = fenced.lastIndexOf(']');
  if (first < 0 || last <= first) return null;
  try { const parsed = JSON.parse(fenced.slice(first, last + 1)); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
}

function mappingPrompt(candidates) {
  return [
    'You are mapping real-world consumer/cultural changes to potentially affected publicly traded companies for research. Do NOT give trading advice.',
    'For each candidate, identify the concrete product/category and brand only when supported by the evidence. Then identify a public parent company/ticker only when you are reasonably confident of the ownership or direct economic exposure. If uncertain, use null rather than guessing.',
    'Ticker/company is a hypothesis that will be independently verified against SEC data. Subsidiary ownership is NOT verified by this step.',
    'Materiality is only a rough hypothesis: "low", "medium", "high", or null. relation must be one of "owner","supplier","retailer","competitor","platform","other", or null.',
    'Return ONLY compact JSON array: [{"i":0,"product":"...","brand":"...","companyName":"...","ticker":"...","relation":"owner","direction":"positive","materiality":"medium","thesis":"one short causal sentence","confidence":0.82}].',
    JSON.stringify(candidates.map((candidate, i) => ({
      i,
      title: candidate.title,
      direction: candidate.direction,
      behaviors: candidate.behaviors,
      authors: candidate.authorCount,
      platforms: candidate.platforms,
      brandCandidate: candidate.brandCandidate,
      evidence: candidate.evidence.slice(0, 5).map((item) => ({ platform: item.platform, content: item.content })),
    }))),
  ].join('\n');
}

async function analyzeMappings(candidates, provider, timeoutMs) {
  const prompt = mappingPrompt(candidates);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (provider.provider === 'ollama') {
      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: provider.model,
          stream: false,
          think: false,
          keep_alive: OLLAMA_KEEP_ALIVE,
          format: 'json',
          messages: [{ role: 'user', content: prompt }],
          options: { temperature: 0.05, num_predict: 1200 },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Ollama Social Arb mapping failed (${response.status}): ${clean(data?.error || response.statusText, 220)}`);
      return parseArray(data?.message?.content || data?.response || '');
    }
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
      signal: controller.signal,
      body: JSON.stringify({ model: provider.model, store: false, max_output_tokens: 1400, input: prompt }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenAI Social Arb mapping failed (${response.status}): ${clean(data?.error?.message || response.statusText, 220)}`);
    return parseArray(responseText(data));
  } finally { clearTimeout(timer); }
}

function applyMapping(candidate, raw) {
  if (!raw || typeof raw !== 'object') return candidate;
  const tickerRaw = clean(raw.ticker, 12).toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const relation = ['owner','supplier','retailer','competitor','platform','other'].includes(String(raw.relation)) ? String(raw.relation) : null;
  const materiality = ['low','medium','high'].includes(String(raw.materiality)) ? String(raw.materiality) : null;
  const direction = ['positive','negative','mixed','unknown'].includes(String(raw.direction)) ? String(raw.direction) : candidate.direction;
  const companyName = clean(raw.companyName, 160) || null;
  const ticker = tickerRaw || null;
  return {
    ...candidate,
    product: clean(raw.product, 140) || candidate.product,
    brandCandidate: clean(raw.brand, 140) || candidate.brandCandidate,
    companyName,
    ticker,
    relation,
    direction,
    materiality,
    thesis: clean(raw.thesis, 360) || null,
    mappingConfidence: Number(confidence.toFixed(3)),
    mappingStatus: ticker && companyName && confidence >= 0.6 ? 'company-hypothesis' : candidate.mappingStatus,
  };
}

export class SocialArbitrageEngineV30 {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.historyPath = path.join(dataDir, 'social-arb-history-v30.json');
    this.cachePath = path.join(dataDir, 'social-arb-mapping-cache-v30.json');
    this.history = readJson(this.historyPath, {});
    this.cache = readJson(this.cachePath, {});
    this.provider = providerConfig();
    this.lastStats = null;
  }

  status() {
    return {
      version: SOCIAL_ARB_VERSION,
      enabled: true,
      providerEnabled: Boolean(this.provider.available),
      provider: this.provider.provider,
      model: this.provider.model || null,
      historyKeys: Object.keys(this.history || {}).length,
      cachedMappings: Object.keys(this.cache || {}).length,
      lastStats: this.lastStats,
    };
  }

  cacheKey(candidate) {
    return createHash('sha256').update(JSON.stringify([
      candidate.key,
      candidate.brandCandidate,
      candidate.direction,
      candidate.behaviors,
      candidate.evidence.slice(0, 5).map((item) => item.content),
      this.provider.provider,
      this.provider.model,
      'social-arb-v30',
    ])).digest('hex');
  }

  updateHistory(candidates, at) {
    for (const candidate of candidates) {
      const prior = Array.isArray(this.history[candidate.key]) ? this.history[candidate.key] : [];
      prior.push({ at, evidenceCount: candidate.evidenceCount, authorCount: candidate.authorCount, commenterCount: candidate.commenterCount || 0, behaviorCount: candidate.behaviorCount, score: candidate.score });
      this.history[candidate.key] = prior.filter((row) => at - Number(row.at || 0) <= HISTORY_TTL_MS).slice(-120);
    }
    writeJson(this.historyPath, this.history);
  }

  async analyze(rows = [], { mode = 'scout', maxMappings, timeoutMs = 60000, updateHistory = true } = {}) {
    const startedAt = Date.now();
    let candidates = deriveSocialArbCandidates(rows, { history: this.history, now: startedAt, limit: 30 });
    const mappingLimit = Math.max(1, Math.min(10, Number(maxMappings || (mode === 'deep' ? 6 : 3))));
    const selected = candidates.filter((candidate) => candidate.score >= 36 || candidate.behaviorCount >= 2).slice(0, mappingLimit);
    let modeled = 0, cached = 0, failed = 0;
    const errors = [];
    const byKey = new Map();

    for (const candidate of selected) {
      const entry = this.cache[this.cacheKey(candidate)];
      if (entry && Date.now() - Number(entry.at || 0) <= CACHE_TTL_MS) {
        byKey.set(candidate.key, applyMapping(candidate, entry.mapping));
        cached++;
      }
    }

    const pending = selected.filter((candidate) => !byKey.has(candidate.key));
    if (pending.length && this.provider.available) {
      try {
        const mapped = await analyzeMappings(pending, this.provider, timeoutMs);
        if (!Array.isArray(mapped)) throw new Error('Social Arb mapping model returned unreadable JSON.');
        pending.forEach((candidate, index) => {
          const raw = mapped.find((item) => Number(item?.i) === index);
          if (!raw) { failed++; return; }
          const next = applyMapping(candidate, raw);
          byKey.set(candidate.key, next);
          this.cache[this.cacheKey(candidate)] = { at: Date.now(), mapping: raw };
          modeled++;
        });
        writeJson(this.cachePath, this.cache);
      } catch (error) {
        failed += pending.length;
        errors.push(clean(error?.name === 'AbortError' ? `Social Arb mapping timed out after ${timeoutMs}ms.` : error?.message || error, 300));
      }
    }

    candidates = candidates.map((candidate) => byKey.get(candidate.key) || candidate);
    if (updateHistory) this.updateHistory(candidates, startedAt);
    this.lastStats = {
      version: SOCIAL_ARB_VERSION,
      totalEvidence: rows.length,
      candidates: candidates.length,
      selectedForMapping: selected.length,
      modeled,
      cached,
      failed,
      provider: this.provider.provider,
      model: this.provider.model || null,
      errors,
      elapsedMs: Date.now() - startedAt,
    };
    return { signals: candidates, stats: this.lastStats };
  }
}
