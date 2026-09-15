import { ensureOwnedPageVisible } from './feed-scroll.mjs';
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

export function isKnownTikTokFeedContainerE2E(value) {
  return /(?:^|[-_])(?:recommend-list-item-container|recommend-item|feed-item|search-card)(?:$|[-_])/i.test(String(value || ''))
    || /^(?:recommend-list-item-container|recommend-item|feed-item|search-card)$/i.test(String(value || ''));
}

export function isTikTokLocalActivityE2E(value) {
  return /(?:user-post-item|inbox-list-item|notification-item|activity-item|message-item|profile)/i.test(String(value || ''));
}

export async function extractTikTokAnchors(page, provenance) {
  const result = await page.evaluate(() => {
    const feedContainerSelector = [
      '[data-e2e*="recommend-list-item-container"]',
      '[data-e2e*="recommend-item"]',
      '[data-e2e*="feed-item"]',
      '[data-e2e*="search-card"]',
      'article',
    ].join(', ');
    const localActivitySelector = [
      '[data-e2e="inbox-list-item"]',
      '[data-e2e*="notification-item"]',
      '[data-e2e*="activity-item"]',
      '[data-e2e*="message-item"]',
      '[data-e2e*="user-post-item"]',
      '[role="dialog"]',
    ].join(', ');
    const transcriptFor = (container) => {
      const parts = [];
      const add = (value) => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length < 3 || text.length > 1200) return;
        if (/^(?:captions?|subtitles?|auto captions?)$/i.test(text)) return;
        if (!parts.some((item) => item.toLowerCase() === text.toLowerCase())) parts.push(text);
      };
      for (const node of container.querySelectorAll('[data-e2e*="subtitle"], [data-e2e*="caption-line"], [class*="subtitle" i], [class*="captions" i], [aria-live="polite"]')) add(node.textContent);
      const video = container.querySelector('video');
      if (video?.textTracks) {
        for (const track of [...video.textTracks]) {
          for (const cue of [...(track.activeCues || [])]) add(cue?.text);
        }
      }
      return parts.join(' · ').slice(0, 4000);
    };
    const links = [...document.querySelectorAll('a[href*="/video/"]')].slice(0, 700);
    const rows = [];
    const seen = new Set();
    let withoutContainer = 0;
    let localActivityRejected = 0;
    let containerRejected = 0;
    let activityTextRejected = 0;
    for (const link of links) {
      const href = link.href || link.getAttribute('href') || '';
      if (!href || seen.has(href)) continue;
      const container = link.closest(feedContainerSelector);
      if (!container) { withoutContainer += 1; continue; }
      if (link.closest(localActivitySelector) || container.closest(localActivitySelector)) {
        localActivityRejected += 1;
        continue;
      }
      const e2e = String(container.getAttribute('data-e2e') || '').toLowerCase();
      if (/user-post-item|profile|inbox-list-item|notification-item|activity-item|message-item/.test(e2e)) {
        containerRejected += 1;
        continue;
      }
      const containerText = (container.innerText || '').trim();
      if (/\b(?:liked your video|liked your post|liked your comment|commented on your video|commented on your post|replied to your comment|shared your video|reposted your video|viewed your profile|mentioned you|tagged you|followed you|started following you|sent you a message)\b/i.test(containerText)) {
        activityTextRejected += 1;
        continue;
      }
      seen.add(href);
      const image = link.querySelector('img') || container.querySelector?.('img');
      const transcript = transcriptFor(container);
      rows.push({
        href,
        aria: link.getAttribute('aria-label') || '',
        title: link.getAttribute('title') || '',
        alt: image?.getAttribute('alt') || '',
        coverUrl: image?.getAttribute('src') || '',
        transcript,
        transcriptSource: transcript ? 'platform-visible-captions' : '',
        containerText: containerText.slice(0, 8000),
        containerE2E: e2e,
      });
    }
    let playerCardsAccepted = 0;
    for (const container of document.querySelectorAll('[data-e2e="recommend-list-item-container"]')) {
      if (container.closest(localActivitySelector)) continue;
      const player = container.querySelector('[id^="xgwrapper-"]');
      const id = player?.id.match(/^xgwrapper-\d+-(\d{10,25})$/)?.[1];
      const authorLink = container.querySelector('a[data-e2e="video-author-avatar"]');
      const author = authorLink?.getAttribute('href')?.match(/^\/@([A-Za-z0-9_.]+)\/?$/)?.[1];
      if (!id || !author) continue;
      const href = `https://www.tiktok.com/@${author}/video/${id}`;
      if (seen.has(href)) continue;
      const image = container.querySelector('[data-e2e="feed-video"] picture img');
      const content = container.querySelector('[data-e2e="video-desc"]')?.textContent?.trim() || image?.getAttribute('alt') || '';
      if (/\b(?:liked your video|commented on your video|followed you|sent you a message)\b/i.test(content)) continue;
      const transcript = transcriptFor(container);
      seen.add(href);
      rows.push({href, content, transcript, transcriptSource: transcript ? 'platform-visible-captions' : '', coverUrl:image?.getAttribute('src') || '', containerE2E:'recommend-list-item-container'});
      playerCardsAccepted++;
    }
    return {
      rows,
      diagnostics: {
        rawVideoAnchors: links.length,
        feedContainers: document.querySelectorAll(feedContainerSelector).length,
        acceptedAnchors: rows.length - playerCardsAccepted,
        playerCardsAccepted, acceptedCards: rows.length,
        transcriptCards: rows.filter((row) => row.transcript).length,
        withoutContainer,
        localActivityRejected,
        containerRejected,
        activityTextRejected,
      },
    };
  });
  const at = Date.now();
  return {
    observations: result.rows.map((row) => normalizeTikTokObservation({ ...row, provenance }, at)).filter(Boolean),
    diagnostics: result.diagnostics,
  };
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
      scrolls: 0,
      sourcePages: [],
      errors: [],
      diagnostics: {
        rawVideoAnchors: 0,
        feedContainers: 0,
        acceptedAnchors: 0,
        transcriptCards: 0,
        withoutContainer: 0,
        localActivityRejected: 0,
        containerRejected: 0,
        activityTextRejected: 0,
      },
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
      const visibility = await ensureOwnedPageVisible(page);
      this.state.visibility = visibility.visibility;
      this.state.focusRecoveries = (this.state.focusRecoveries || 0) + Number(visibility.recovered);
      const sourceUrl = page.url();
      const extracted = await extractTikTokAnchors(page, 'TikTok dedicated discovery observation');
      this.add(extracted.observations);
      if (this.state.observed < this.state.target && shouldDriveTikTokFeed(sourceUrl, extracted.observations.length > 0)) {
        await page.evaluate(() => {
          const card = document.querySelector('[data-e2e="recommend-list-item-container"]');
          let scroller = card?.parentElement;
          while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
          (scroller || window).scrollBy(0, card ? card.getBoundingClientRect().height + 16 : 820);
        });
        this.state.scrolls = (this.state.scrolls || 0) + 1;
      }
      this.state = {
        ...this.state,
        sourcePages: [sourceUrl],
        diagnostics: extracted.diagnostics,
        updatedAt: Date.now(),
      };
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
        id: row.id, author: row.author, url: row.url, content: row.content, transcript: row.transcript,
        firstObserved: row.firstObserved, observedOnly: row.observedOnly,
      })),
    };
  }
}
