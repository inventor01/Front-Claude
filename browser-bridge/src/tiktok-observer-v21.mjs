import { chromium } from 'playwright';
import {
  groundedTikTokEvidence,
  mergeTikTokObservations,
  normalizeTikTokObservation,
} from './tiktok-observation-v21.mjs';

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function extractTikTokAnchors(page, provenance) {
  const raw = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/video/"]')].slice(0, 700);
    const rows = [];
    const seen = new Set();
    for (const link of links) {
      const href = link.href || link.getAttribute('href') || '';
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const preferred = link.closest('[data-e2e*="recommend-list-item-container"], [data-e2e*="search-card"], [data-e2e*="user-post-item"], article');
      let container = preferred;
      if (!container) {
        let cursor = link.parentElement;
        for (let depth = 0; cursor && depth < 7; depth += 1, cursor = cursor.parentElement) {
          const text = (cursor.innerText || '').trim();
          const videoLinks = cursor.querySelectorAll?.('a[href*="/video/"]')?.length || 0;
          if (text.length >= 3 && text.length <= 1800 && videoLinks <= 2) { container = cursor; break; }
        }
      }
      const image = link.querySelector('img') || container?.querySelector?.('img');
      rows.push({
        href,
        aria: link.getAttribute('aria-label') || '',
        title: link.getAttribute('title') || '',
        alt: image?.getAttribute('alt') || '',
        coverUrl: image?.getAttribute('src') || '',
        containerText: (container?.innerText || '').slice(0, 8000),
      });
    }
    return rows;
  }).catch(() => []);
  const at = Date.now();
  return raw.map((row) => normalizeTikTokObservation({ ...row, provenance }, at)).filter(Boolean);
}

export class BroadTikTokObserver {
  constructor({ cdpUrl, intervalMs = 850 } = {}) {
    this.cdpUrl = cdpUrl;
    this.intervalMs = Math.max(600, Number(intervalMs) || 850);
    this.browser = null;
    this.context = null;
    this.timer = null;
    this.polling = false;
    this.rows = [];
    this.state = this.emptyState();
  }

  emptyState() {
    return {
      active: false,
      status: 'idle',
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      target: 90,
      observed: 0,
      grounded: 0,
      sourcePages: [],
      errors: [],
    };
  }

  async ensureContext() {
    if (this.context && this.browser?.isConnected?.()) return this.context;
    this.browser = await chromium.connectOverCDP(this.cdpUrl, { noDefaults: true });
    this.context = this.browser.contexts()[0];
    if (!this.context) throw new Error('Front Chrome did not expose a context for broad TikTok observation.');
    this.browser.on('disconnected', () => { this.browser = null; this.context = null; });
    return this.context;
  }

  start(request = {}) {
    this.stopTimer();
    this.rows = [];
    this.state = {
      ...this.emptyState(),
      active: true,
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      target: Math.max(30, Math.min(180, Number(request.targetUniqueFeedItems || 90))),
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
    this.state = { ...this.state, active: false, status, completedAt: Date.now(), updatedAt: Date.now() };
  }

  add(rows = []) {
    this.rows = mergeTikTokObservations(this.rows, rows, { limit: 1200 });
    const grounded = groundedTikTokEvidence(this.rows).length;
    this.state = { ...this.state, observed: this.rows.length, grounded, updatedAt: Date.now() };
  }

  async poll() {
    if (!this.state.active || this.polling) return;
    this.polling = true;
    try {
      const context = await this.ensureContext();
      const pages = context.pages();
      const sourcePages = [];
      for (const page of pages) {
        let host = '';
        const url = page.url();
        try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
        if (!/(^|\.)tiktok\.com$/.test(host)) continue;
        sourcePages.push(url);
        this.add(await extractTikTokAnchors(page, 'TikTok broad live observation'));
        if (this.state.observed < this.state.target && /\/(?:foryou|explore|search)(?:\/|$|\?)/i.test(new URL(url).pathname + new URL(url).search)) {
          await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 1.05, 820))).catch(() => {});
        }
      }
      this.state = { ...this.state, sourcePages: [...new Set(sourcePages)].slice(0, 16), updatedAt: Date.now() };
    } catch (error) {
      const errors = [...this.state.errors, clean(error?.message || error, 500)].slice(-8);
      this.state = { ...this.state, errors, updatedAt: Date.now() };
    } finally {
      this.polling = false;
    }
  }

  groundedEvidence() { return groundedTikTokEvidence(this.rows); }

  snapshot() {
    return {
      ...this.state,
      evidence: this.groundedEvidence().slice(-300),
      observations: this.rows.slice(-300).map((row) => ({
        id: row.id, author: row.author, url: row.url, content: row.content,
        firstObserved: row.firstObserved, observedOnly: row.observedOnly,
      })),
    };
  }
}
