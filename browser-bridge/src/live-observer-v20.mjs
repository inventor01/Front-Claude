import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { detectTopics } from './topic-engine.mjs';
import { attachSoundSignals, consolidateTopicAliases, mergeRichEvidence } from './adaptive-intelligence.mjs';
import { attachVisualSignals, semanticConsolidateTopics } from './advanced-intelligence.mjs';
import { rankInvestigationCandidates } from './scout-skill.mjs';

const clean = (value, max = 2000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const hasText = (value) => {
  const text = clean(value, 2000);
  if (text.length < 3 || !/[\p{L}]/u.test(text)) return false;
  if (/^(?:home|explore|for you|following|search|profile|video|photo|sound|show more|more|views?|likes?|shares?|comments?)$/i.test(text)) return false;
  return true;
};
const hashId = (platform, url) => `live:${platform.toLowerCase()}:${createHash('sha1').update(url).digest('hex').slice(0, 28)}`;

function normalizeUrl(raw, platform) {
  try {
    const url = new URL(raw, platform === 'X' ? 'https://x.com' : 'https://www.tiktok.com');
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const allowed = platform === 'X'
      ? new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'])
      : new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
    if (!allowed.has(host)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseMetric(value) {
  const text = clean(value, 80).replace(/,/g, '');
  const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*([KMB])?(?:\s|$)/i);
  if (!match) return null;
  const multiplier = match[2]?.toUpperCase() === 'K' ? 1e3 : match[2]?.toUpperCase() === 'M' ? 1e6 : match[2]?.toUpperCase() === 'B' ? 1e9 : 1;
  const number = Number(match[1]) * multiplier;
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function deriveTopics(evidence) {
  if (!evidence.length) return [];
  try {
    const at = Date.now();
    let topics = detectTopics(evidence, at, 24);
    topics = attachSoundSignals(topics, evidence);
    topics = attachVisualSignals(topics, evidence, at);
    topics = semanticConsolidateTopics(topics, evidence, at);
    topics = consolidateTopicAliases(topics);
    return rankInvestigationCandidates(topics, evidence, { limit: 24, now: at });
  } catch {
    return [];
  }
}

async function extractX(page) {
  const raw = await page.evaluate(() => {
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0, 48);
    return articles.map((article) => {
      const status = [...article.querySelectorAll('a[href*="/status/"]')]
        .map((node) => node.getAttribute('href'))
        .find(Boolean);
      const content = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
      const published = article.querySelector('time')?.getAttribute('datetime') || null;
      const aria = article.getAttribute('aria-label') || '';
      return { status, content, published, aria };
    });
  }).catch(() => []);
  const out = [];
  for (const row of raw) {
    if (!row?.status || !hasText(row.content)) continue;
    const url = normalizeUrl(row.status, 'X');
    if (!url) continue;
    let author = '';
    try {
      const pathname = new URL(url).pathname;
      author = decodeURIComponent(pathname.split('/').filter(Boolean)[0] || '').replace(/^@/, '');
    } catch {}
    if (!author) continue;
    const published = row.published && Number.isFinite(Date.parse(row.published)) ? Date.parse(row.published) : null;
    const viewsMatch = clean(row.aria, 500).match(/([\d.,]+\s*[KMB]?)\s+views?/i);
    const likesMatch = clean(row.aria, 500).match(/([\d.,]+\s*[KMB]?)\s+likes?/i);
    out.push({
      id: hashId('X', url),
      platform: 'X',
      author,
      url,
      content: clean(row.content, 8000),
      published,
      views: parseMetric(viewsMatch?.[1]),
      likes: parseMetric(likesMatch?.[1]),
      provenance: 'X live scan preview',
      firstObserved: Date.now(),
    });
  }
  return out;
}

async function extractTikTok(page) {
  const raw = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/video/"]')].slice(0, 80);
    const seen = new Set();
    const rows = [];
    for (const link of links) {
      const href = link.href || link.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      let container = link.closest('[data-e2e*="recommend-list-item-container"], [data-e2e*="search-card"], article');
      if (!container) container = link.parentElement?.parentElement?.parentElement || link.parentElement;
      const text = container?.innerText || link.getAttribute('aria-label') || link.textContent || '';
      rows.push({ href, text });
    }
    return rows;
  }).catch(() => []);
  const out = [];
  for (const row of raw) {
    const url = normalizeUrl(row?.href, 'TikTok');
    if (!url || !hasText(row?.text)) continue;
    let author = '';
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      author = decodeURIComponent(parts.find((part) => part.startsWith('@')) || '').replace(/^@/, '');
    } catch {}
    if (!author) continue;
    out.push({
      id: hashId('TikTok', url),
      platform: 'TikTok',
      author,
      url,
      content: clean(row.text, 8000),
      published: null,
      views: null,
      likes: null,
      provenance: 'TikTok live scan preview',
      firstObserved: Date.now(),
    });
  }
  return out;
}

export class LiveScanObserver {
  constructor({ cdpUrl, intervalMs = 1500 } = {}) {
    this.cdpUrl = cdpUrl;
    this.intervalMs = Math.max(750, Number(intervalMs) || 1500);
    this.browser = null;
    this.context = null;
    this.timer = null;
    this.polling = false;
    this.rows = new Map();
    this.state = this.emptyState();
  }

  emptyState() {
    return {
      active: false,
      status: 'idle',
      phase: 'idle',
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      observed: 0,
      candidateTopics: 0,
      platformCounts: {},
      sourcePages: [],
      errors: [],
      request: null,
    };
  }

  async ensureContext() {
    if (this.context && this.browser?.isConnected?.()) return this.context;
    this.browser = await chromium.connectOverCDP(this.cdpUrl, { noDefaults: true });
    this.context = this.browser.contexts()[0];
    if (!this.context) throw new Error('Front Chrome did not expose a context for live scan observation.');
    this.browser.on('disconnected', () => {
      this.browser = null;
      this.context = null;
    });
    return this.context;
  }

  start(request = {}) {
    this.stopTimer();
    this.rows.clear();
    this.state = {
      ...this.emptyState(),
      active: true,
      status: 'running',
      phase: 'starting',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      request: {
        mode: request.mode === 'scout' ? 'scout' : 'deep',
        targetUniqueFeedItems: Number(request.targetUniqueFeedItems || 0) || null,
      },
    };
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stop(status = 'complete') {
    this.stopTimer();
    this.state = {
      ...this.state,
      active: false,
      status,
      phase: status,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  setPhase(phase) {
    if (!this.state.active || !phase) return;
    this.state = { ...this.state, phase, updatedAt: Date.now() };
  }

  addRows(rows = []) {
    for (const row of rows) {
      if (!row?.id || !row?.url || !hasText(row.content)) continue;
      const prior = this.rows.get(row.id);
      this.rows.set(row.id, prior ? { ...prior, ...row, firstObserved: prior.firstObserved || row.firstObserved } : row);
    }
    if (this.rows.size > 500) {
      const keep = [...this.rows.values()].slice(-500);
      this.rows = new Map(keep.map((row) => [row.id, row]));
    }
    this.refreshDerived();
  }

  refreshDerived() {
    const evidence = mergeRichEvidence([...this.rows.values()]);
    const topics = deriveTopics(evidence);
    const platformCounts = evidence.reduce((acc, row) => {
      acc[row.platform] = (acc[row.platform] || 0) + 1;
      return acc;
    }, {});
    this.state = {
      ...this.state,
      observed: evidence.length,
      candidateTopics: topics.length,
      platformCounts,
      updatedAt: Date.now(),
    };
    this.topics = topics;
  }

  async poll() {
    if (!this.state.active || this.polling) return;
    this.polling = true;
    try {
      const context = await this.ensureContext();
      const pages = context.pages();
      const sourcePages = [];
      for (const page of pages) {
        const pageUrl = page.url();
        if (!pageUrl || pageUrl === 'about:blank') continue;
        let host = '';
        try { host = new URL(pageUrl).hostname.toLowerCase(); } catch { continue; }
        if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) {
          sourcePages.push(pageUrl);
          this.addRows(await extractX(page));
        } else if (/(^|\.)tiktok\.com$/.test(host)) {
          sourcePages.push(pageUrl);
          this.addRows(await extractTikTok(page));
        }
      }
      this.state = {
        ...this.state,
        phase: this.state.phase === 'starting' ? 'primary' : this.state.phase,
        sourcePages: [...new Set(sourcePages)].slice(0, 12),
        updatedAt: Date.now(),
      };
    } catch (error) {
      const message = clean(error?.message || error, 500);
      const errors = [...this.state.errors, message].slice(-8);
      this.state = { ...this.state, errors, updatedAt: Date.now() };
    } finally {
      this.polling = false;
    }
  }

  ingestFinal(payload = {}) {
    if (Array.isArray(payload.evidence)) this.addRows(payload.evidence);
    if (Array.isArray(payload.inferredTopics) && payload.inferredTopics.length) this.topics = payload.inferredTopics;
    const evidence = mergeRichEvidence([...this.rows.values()]);
    const platformCounts = evidence.reduce((acc, row) => {
      acc[row.platform] = (acc[row.platform] || 0) + 1;
      return acc;
    }, {});
    this.state = {
      ...this.state,
      observed: evidence.length,
      candidateTopics: Array.isArray(this.topics) ? this.topics.length : 0,
      platformCounts,
      updatedAt: Date.now(),
    };
  }

  snapshot() {
    const evidence = mergeRichEvidence([...this.rows.values()]).slice(-250);
    return {
      ok: true,
      version: 20,
      ...this.state,
      evidence,
      inferredTopics: Array.isArray(this.topics) ? this.topics.slice(0, 50) : [],
    };
  }
}
