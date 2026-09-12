const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function videoDiscoveryRequested(scanBody = {}) {
  return scanBody.scanTikTokForYou !== false
    || scanBody.scanTikTokTrends !== false
    || scanBody.scanTikTokExplore !== false
    || scanBody.scanXForYou !== false;
}

/**
 * Decide whether the v18 media-first recovery pass should supplement the
 * canonical scanner. Historically v18 only ran when canonical evidence was
 * exactly zero, which meant a thin text-only result could suppress video
 * understanding even while caption-light videos were visible in the feeds.
 */
export function visualRecoveryReason(scanBody = {}, payload = {}, { thinEvidenceThreshold = 12 } = {}) {
  const evidence = Array.isArray(payload?.evidence) ? payload.evidence : [];
  if (!evidence.length) return 'zero-evidence';

  const content = payload?.contentUnderstanding;
  if (!content?.enabled || !videoDiscoveryRequested(scanBody)) return null;

  const scan = content.scan && typeof content.scan === 'object' ? content.scan : {};
  const requested = number(scan.requested);
  const visuallyUnderstood = number(content.visuallyUnderstood);
  const threshold = Math.max(2, Math.min(40, Math.trunc(Number(thinEvidenceThreshold) || 12)));

  if (evidence.length < threshold && requested === 0 && visuallyUnderstood === 0) {
    return 'thin-evidence-no-video-analysis';
  }
  return null;
}

function evidenceQuality(row = {}) {
  let score = 0;
  if (row.contentSummary) score += 100;
  if (number(row.contentConfidence) >= 0.5) score += 40;
  if (/video/i.test(String(row.mediaType || '')) || row.platform === 'TikTok') score += 8;
  score += Math.min(30, clean(row.content, 8000).length / 120);
  if (Number.isFinite(Number(row.views))) score += 3;
  if (Number.isFinite(Number(row.likes))) score += 2;
  return score;
}

/** Merge recovery rows without double-counting a post already found canonically. */
export function mergeRecoveryEvidence(base = [], recovery = []) {
  const map = new Map();
  for (const raw of [...base, ...recovery]) {
    if (!raw?.platform || !raw?.url || !raw?.id) continue;
    const key = `${raw.platform}|${raw.url}`;
    const old = map.get(key);
    if (!old) { map.set(key, raw); continue; }
    const primary = evidenceQuality(raw) >= evidenceQuality(old) ? raw : old;
    const secondary = primary === raw ? old : raw;
    const observed = [primary.firstObserved, secondary.firstObserved].filter(Number.isFinite);
    map.set(key, {
      ...secondary,
      ...primary,
      ...(observed.length ? { firstObserved: Math.min(...observed) } : {}),
      hashtags: [...new Set([...(secondary.hashtags || []), ...(primary.hashtags || [])])].slice(0, 30),
    });
  }
  return [...map.values()];
}

const norm = (value) => clean(value, 180).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Keep canonical topic identity while allowing grounded recovery support to add evidence. */
export function mergeRecoveryTopics(base = [], recovery = []) {
  const out = new Map();
  for (const raw of [...base, ...recovery]) {
    const key = norm(raw?.key || raw?.topic);
    if (!key) continue;
    const old = out.get(key);
    if (!old) { out.set(key, { ...raw }); continue; }
    const evidenceIds = [...new Set([...(old.evidenceIds || []), ...(raw.evidenceIds || [])])];
    out.set(key, {
      ...raw,
      ...old,
      topic: old.topic || raw.topic,
      key: old.key || raw.key,
      aliases: [...new Set([...(old.aliases || []), ...(raw.aliases || [])])].slice(0, 18),
      evidenceIds,
      platforms: [...new Set([...(old.platforms || []), ...(raw.platforms || [])])],
      evidenceCount: Math.max(evidenceIds.length, number(old.evidenceCount), number(raw.evidenceCount)),
      authorCount: Math.max(number(old.authorCount), number(raw.authorCount)),
      score: Math.max(number(old.score), number(raw.score)),
      priorityScore: Math.max(number(old.priorityScore), number(raw.priorityScore)),
      corroborated: Boolean(old.corroborated || raw.corroborated),
      tier: old.tier === 'candidate' || raw.tier === 'candidate' ? 'candidate' : (old.tier || raw.tier),
      contentUnderstandingSupport: Math.max(number(old.contentUnderstandingSupport), number(raw.contentUnderstandingSupport)),
      contentUnderstandingCreators: Math.max(number(old.contentUnderstandingCreators), number(raw.contentUnderstandingCreators)),
    });
  }
  return [...out.values()].sort((a, b) => number(b.priorityScore || b.score) - number(a.priorityScore || a.score)).slice(0, 60);
}
