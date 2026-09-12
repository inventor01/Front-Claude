import { LiveScanObserver } from './live-observer-v20.mjs';

const MARKER = Symbol.for('front.live.preview.sanitize.v1');

const clean = (value, max = 8000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function canonicalXUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
    if (!match) return null;
    return `https://x.com/${encodeURIComponent(decodeURIComponent(match[1]))}/status/${match[2]}`;
  } catch {
    return null;
  }
}

function canonicalTikTokUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(@[^/]+)\/video\/(\d+)/i);
    if (!match) return null;
    return `https://www.tiktok.com/${encodeURI(decodeURIComponent(match[1]))}/video/${match[2]}`;
  } catch {
    return null;
  }
}

function looksLikeTikTokActivity(text) {
  const value = clean(text).toLowerCase();
  if (!value) return true;
  const phrases = ['started following you', 'liked your video', 'follow back'];
  const hits = phrases.reduce((sum, phrase) => sum + (value.split(phrase).length - 1), 0);
  if (hits >= 2) return true;
  return /(?:notifications?|activity)\b/.test(value) && hits > 0;
}

function sanitizeRow(row) {
  if (!row || !row.id || !row.platform) return null;
  const content = clean(row.content);
  if (content.length < 3 || !/[\p{L}]/u.test(content)) return null;
  if (row.platform === 'X') {
    const url = canonicalXUrl(row.url);
    if (!url) return null;
    return { ...row, url, content };
  }
  if (row.platform === 'TikTok') {
    const url = canonicalTikTokUrl(row.url);
    const author = clean(row.author, 120).replace(/^@/, '');
    if (!url || !author) return null;
    if (/^\d{10,}$/.test(author)) return null;
    if (looksLikeTikTokActivity(content)) return null;
    return { ...row, author, url, content };
  }
  return null;
}

function sanitizeSnapshot(snapshot = {}) {
  const evidence = (Array.isArray(snapshot.evidence) ? snapshot.evidence : []).map(sanitizeRow).filter(Boolean);
  const ids = new Set(evidence.map((row) => row.id));
  const byId = new Map(evidence.map((row) => [row.id, row]));
  const inferredTopics = (Array.isArray(snapshot.inferredTopics) ? snapshot.inferredTopics : []).filter((topic) => {
    const topicIds = Array.isArray(topic.evidenceIds) ? topic.evidenceIds.filter((id) => ids.has(id)) : [];
    if (topicIds.length < 2) return false;
    const creators = new Set(topicIds.map((id) => {
      const row = byId.get(id);
      return row ? `${row.platform}:${String(row.author || '').toLowerCase()}` : '';
    }).filter(Boolean));
    return creators.size >= 2;
  });
  const platformCounts = evidence.reduce((acc, row) => {
    acc[row.platform] = (acc[row.platform] || 0) + 1;
    return acc;
  }, {});
  const errors = Array.isArray(snapshot.errors) ? [...snapshot.errors] : [];
  if (snapshot.status === 'failed' && errors.length === 0) {
    errors.push('Canonical deep scan failed; inspect /ledger for the underlying scanner error.');
  }
  return {
    ...snapshot,
    observed: evidence.length,
    candidateTopics: inferredTopics.length,
    platformCounts,
    errors,
    evidence,
    inferredTopics,
  };
}

if (!globalThis[MARKER]) {
  const originalSnapshot = LiveScanObserver.prototype.snapshot;
  LiveScanObserver.prototype.snapshot = function frontSanitizedSnapshot(...args) {
    return sanitizeSnapshot(originalSnapshot.apply(this, args));
  };
  globalThis[MARKER] = true;
}

export const frontLivePreviewCompatibilityEnabled = true;
export { canonicalXUrl, canonicalTikTokUrl, looksLikeTikTokActivity, sanitizeRow, sanitizeSnapshot };
