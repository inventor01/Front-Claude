import { chromium } from 'playwright';
import {
  groundedTikTokEvidence,
  mergeTikTokObservations,
  normalizeTikTokObservation,
} from './tiktok-observation-v21.mjs';

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function shouldDriveTikTokFeed(urlValue, hasVideoAnchors = false) {
  try {
    const url = new URL(urlValue);
    if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) return false;
    if (url.pathname === '/' && hasVideoAnchors) return true;
    return /\/(?:foryou|explore|search)(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isTikTokDiscoveryPage(urlValue) {
  try {
    const url = new URL(urlValue);
    if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) return false;
    if (url.pathname === '/') return true;
    return /\/(?:foryou|explore|search)(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function extractTikTokAnchors(page, provenance) {
  const raw = await page.evaluate(() => {
    const feedContainerSelector = [
      '[data-e2e*="recommend-list-item-container"]',
      '[data-e2e*="recommend-item"]',
      '[data-e2e*="feed-item"]',
      '[data-e2e*="search-card"]',
      'article',
    ].join(', ');
    const activitySelector = [
      '[data-e2e*="inbox"]',
      '[data-e2e*="notification"]',
      '[data-e2e*="activity"]',
      '[data-e2e*="message"]',
      '[role="dialog"]',
    ].join(', ');
    const links = [...document.querySelectorAll('a[href*="/video/"]')].slice(0, 700);
    const rows = [];
    const seen = new Set();
    for (const link of links) {
      const href = link.href || link.getAttribute('href') || '';
      if (!href || seen.has(href)) continue;
      if (link.closest(activitySelector)) continue;
      const container = link.closest(feedContainerSelector);
      if (!container) continue;
      if (container.closest(activitySelector)) continue;
      const e2e = String(container.getAttribute('data-e2e') || '').toLowerCase();
      if (/user-post-item|profile|inbox|notification|activity|message/.test(e2e)) continue;
      const containerText = (container.innerText || '').trim();
      if (/\b(?:liked your video|liked your post|liked your comment|commented on your video|commented on your post|replied to your comment|shared your video|reposted your video|viewed your profile|mentioned you|tagged you|followed you|started following you|sent you a message)\b/i.test(containerText)) continue;
      seen.add(href);
      const image = link.querySelector('img') || container.querySelector?.('img');
      rows.push({
        href,
        aria: link.getAttribute('aria-label') || '',
        title: link.getAttribute('title') || '',
        alt: image?.getAttribute('alt') || '',
        coverUrl: image?.getAttribute('src') || '',
        containerText: containerText.slice(0, 8000),
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
    this.discoveryPage = null;
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
    this.browser.on('disconnected', () => {
      this.browser = null;
      this.context = null;
      this.discoveryPage = null;
    });
    return this.context;
  }

  async ensureDiscoveryPage() {
    const context = await this.ensureContext();
    if (this.discoveryPage && !this.discoveryPage.isClosed()) return this.discoveryPage;
    const page = await context.newPage();
    this.discoveryPage = page;
    try {
      await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'commit', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2200);
      return page;
    } catch (error) {
      await page.close().catch(() => {});
      if (this.discoveryPage === page) this.discoveryPage = null;
      throw error;
    }
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
    const page = this.discoveryPage;
    this.discoveryPage = null;
    if (page && !page.isClosed()) void page.close().catch(() => {});
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
      const page = await this.ensureDiscoveryPage();
      const url = page.url();
      if (!isTikTokDiscoveryPage(url)) {
        await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'commit', timeout: 20000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1800);
      }
      const sourceUrl = page.url();
      const observations = await extractTikTokAnchors(page, 'TikTok dedicated discovery observation');
      this.add(observations);
      if (this.state.observed < this.state.target && shouldDriveTikTokFeed(sourceUrl, observations.length > 0)) {
        await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 1.05, 820))).catch(() => {});
      }
      this.state = { ...this.state, sourcePages: [sourceUrl], updatedAt: Date.now() };
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
