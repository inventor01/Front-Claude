const clean = (value, max = 180) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (value) => clean(value, 240).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (value) => norm(value).split(' ').filter((x) => x.length >= 3);
const clamp = (value, fallback, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(value) || fallback)));

export const ADAPTIVE_DEFAULTS = Object.freeze({
  intervalMinutes: 10,
  scanXForYou: true,
  scanTikTokForYou: true,
  targetUniqueFeedItems: 90,
  maxFeedScanSeconds: 70,
  maxAdaptiveScrolls: 14,
  stalePassLimit: 2,
  searchScrollPasses: 3,
  deepResultsPerQuery: 14,
  sentinelAccountsPerScout: 6,
  sentinelAccountsPerDeep: 10,
  maxSentinelAccounts: 30,
  sourceReputationWeight: 0.65,
});

export function normalizeAdaptiveConfig(base = {}, input = {}) {
  const merged = { ...base, ...input };
  const accounts = [...new Set((Array.isArray(merged.xAccounts) ? merged.xAccounts : [])
    .map((x) => clean(x, 32).replace(/^@/, ''))
    .filter((x) => /^[A-Za-z0-9_]{1,15}$/.test(x)))]
    .slice(0, ADAPTIVE_DEFAULTS.maxSentinelAccounts);
  return {
    ...merged,
    enabled: merged.enabled !== false,
    intervalMinutes: clamp(merged.intervalMinutes, ADAPTIVE_DEFAULTS.intervalMinutes, 10, 240),
    scanXForYou: merged.scanXForYou !== false,
    scanTikTokForYou: merged.scanTikTokForYou !== false,
    targetUniqueFeedItems: clamp(merged.targetUniqueFeedItems, ADAPTIVE_DEFAULTS.targetUniqueFeedItems, 30, 180),
    maxFeedScanSeconds: clamp(merged.maxFeedScanSeconds, ADAPTIVE_DEFAULTS.maxFeedScanSeconds, 20, 120),
    maxAdaptiveScrolls: clamp(merged.maxAdaptiveScrolls, ADAPTIVE_DEFAULTS.maxAdaptiveScrolls, 3, 25),
    stalePassLimit: clamp(merged.stalePassLimit, ADAPTIVE_DEFAULTS.stalePassLimit, 1, 5),
    searchScrollPasses: clamp(merged.searchScrollPasses, ADAPTIVE_DEFAULTS.searchScrollPasses, 1, 6),
    deepResultsPerQuery: clamp(merged.deepResultsPerQuery, ADAPTIVE_DEFAULTS.deepResultsPerQuery, 8, 24),
    sentinelAccountsPerScout: clamp(merged.sentinelAccountsPerScout, ADAPTIVE_DEFAULTS.sentinelAccountsPerScout, 0, 15),
    sentinelAccountsPerDeep: clamp(merged.sentinelAccountsPerDeep, ADAPTIVE_DEFAULTS.sentinelAccountsPerDeep, 0, 20),
    xAccounts: accounts,
  };
}

export function mergeRichEvidence(rows = []) {
  const map = new Map();
  for (const raw of rows) {
    if (!raw?.platform || !raw?.url || !raw?.id) continue;
    const key = `${raw.platform}|${raw.url}`;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, raw);
      continue;
    }
    const score = (row) => [row.views, row.likes, row.comments, row.reposts, row.shares].filter(Number.isFinite).reduce((a, b) => a + b, 0);
    const primary = score(raw) >= score(previous) ? raw : previous;
    const secondary = primary === raw ? previous : raw;
    map.set(key, {
      ...secondary,
      ...primary,
      firstObserved: Math.min(primary.firstObserved || Infinity, secondary.firstObserved || Infinity),
      hashtags: [...new Set([...(secondary.hashtags || []), ...(primary.hashtags || [])])].slice(0, 30),
    });
  }
  return [...map.values()];
}

export function chooseSentinelAccounts(accounts = [], reputation = {}, cursor = 0, count = 6) {
  const unique = [...new Set(accounts.map((x) => clean(x, 32).replace(/^@/, '')).filter(Boolean))];
  if (!unique.length || count <= 0) return { accounts: [], nextCursor: 0 };
  const cappedCount = Math.min(unique.length, count);
  const ranked = [...unique].sort((a, b) => (Number(reputation[b]?.score) || 0) - (Number(reputation[a]?.score) || 0));
  const trustedCount = Math.min(Math.floor(cappedCount / 2), ranked.length);
  const selected = ranked.slice(0, trustedCount);
  let offset = Math.max(0, Math.trunc(cursor)) % unique.length;
  while (selected.length < cappedCount) {
    const candidate = unique[offset % unique.length];
    if (!selected.includes(candidate)) selected.push(candidate);
    offset += 1;
    if (offset - cursor > unique.length * 2) break;
  }
  return { accounts: selected, nextCursor: offset % unique.length };
}

export function updateSourceReputation(previous = {}, evidence = [], topics = [], now = Date.now()) {
  const participating = new Set(topics.flatMap((topic) => Array.isArray(topic.evidenceIds) ? topic.evidenceIds : []));
  const next = { ...previous };
  for (const item of evidence) {
    if (item.platform !== 'X' || !item.author || !/sentinel/i.test(item.provenance || '')) continue;
    const key = item.author.replace(/^@/, '').toLowerCase();
    const old = next[key] || { samples: 0, hits: 0, earlyHits: 0, score: 0, lastSeen: 0 };
    const hit = participating.has(item.id) ? 1 : 0;
    const ageMinutes = item.published ? Math.max(0, (now - item.published) / 60000) : null;
    const early = hit && ageMinutes != null && ageMinutes <= 120 ? 1 : 0;
    const samples = old.samples + 1;
    const hits = old.hits + hit;
    const earlyHits = old.earlyHits + early;
    const precision = hits / samples;
    const earlyRate = hits ? earlyHits / hits : 0;
    next[key] = {
      samples,
      hits,
      earlyHits,
      score: Number((precision * 0.65 + earlyRate * 0.35).toFixed(4)),
      lastSeen: now,
    };
  }
  return next;
}

function jaccard(a, b) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((x) => right.has(x)).length;
  return intersection / new Set([...left, ...right]).size;
}

function editDistance(a, b) {
  const left = norm(a), right = norm(b);
  if (!left) return right.length;
  if (!right) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return prev[right.length];
}

export function aliasSimilarity(a, b) {
  const left = norm(a), right = norm(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if ((left.includes(right) || right.includes(left)) && Math.min(left.length, right.length) >= 5) return 0.9;
  const jac = jaccard(left, right);
  const edit = 1 - editDistance(left, right) / Math.max(left.length, right.length, 1);
  return Math.max(jac, edit * 0.85);
}

export function consolidateTopicAliases(topics = []) {
  const groups = [];
  for (const topic of topics) {
    const existing = groups.find((group) => aliasSimilarity(group.topic, topic.topic) >= 0.72 ||
      (group.soundIds?.length && topic.soundIds?.some((id) => group.soundIds.includes(id))));
    if (!existing) {
      groups.push({ ...topic, aliases: [...new Set([topic.topic, ...(topic.aliases || [])])], soundIds: [...new Set(topic.soundIds || [])] });
      continue;
    }
    const preferred = (topic.score || 0) > (existing.score || 0) ? topic.topic : existing.topic;
    existing.topic = preferred;
    existing.aliases = [...new Set([...(existing.aliases || []), topic.topic, ...(topic.aliases || [])])].slice(0, 18);
    existing.evidenceIds = [...new Set([...(existing.evidenceIds || []), ...(topic.evidenceIds || [])])];
    existing.platforms = [...new Set([...(existing.platforms || []), ...(topic.platforms || [])])];
    existing.soundIds = [...new Set([...(existing.soundIds || []), ...(topic.soundIds || [])])].slice(0, 12);
    existing.evidenceCount = existing.evidenceIds.length || Math.max(existing.evidenceCount || 0, topic.evidenceCount || 0);
    existing.authorCount = Math.max(existing.authorCount || 0, topic.authorCount || 0);
    existing.score = Math.max(existing.score || 0, topic.score || 0);
    existing.corroborated = Boolean(existing.corroborated || topic.corroborated);
  }
  return groups.sort((a, b) => (b.score || 0) - (a.score || 0));
}

export function attachFeedPenetration(topics = [], evidence = [], previous = {}, at = Date.now()) {
  const feedRows = evidence.filter((item) => /For You/i.test(item.provenance || ''));
  const feedIds = new Set(feedRows.map((item) => item.id));
  const nextState = {};
  const enriched = topics.map((topic) => {
    const hits = (topic.evidenceIds || []).filter((id) => feedIds.has(id)).length;
    const ratio = feedRows.length ? hits / feedRows.length : 0;
    const key = norm(topic.key || topic.topic);
    const prior = previous[key];
    const delta = prior && Number.isFinite(prior.ratio) ? ratio - prior.ratio : 0;
    const elapsedMinutes = prior?.at ? Math.max(1, (at - prior.at) / 60000) : null;
    const velocityPerHour = elapsedMinutes ? delta / elapsedMinutes * 60 : 0;
    nextState[key] = { ratio, at, hits, sample: feedRows.length };
    return {
      ...topic,
      feedPenetration: Number((ratio * 100).toFixed(2)),
      feedPenetrationDelta: Number((delta * 100).toFixed(2)),
      feedPenetrationVelocity: Number((velocityPerHour * 100).toFixed(2)),
    };
  });
  return { topics: enriched, state: nextState, feedSampleSize: feedRows.length };
}

export function attachSoundSignals(topics = [], evidence = []) {
  const bySound = new Map();
  for (const item of evidence) {
    if (item.platform !== 'TikTok' || !item.soundId) continue;
    const row = bySound.get(item.soundId) || { title: item.soundTitle || '', creators: new Set(), ids: new Set() };
    row.creators.add(String(item.author || '').toLowerCase());
    row.ids.add(item.id);
    if (!row.title && item.soundTitle) row.title = item.soundTitle;
    bySound.set(item.soundId, row);
  }
  return topics.map((topic) => {
    const evidenceIds = new Set(topic.evidenceIds || []);
    const soundIds = [];
    const soundSignals = [];
    for (const [soundId, row] of bySound) {
      const overlap = [...row.ids].filter((id) => evidenceIds.has(id)).length;
      if (!overlap) continue;
      soundIds.push(soundId);
      soundSignals.push({ soundId, title: row.title, creators: row.creators.size, overlap });
    }
    return { ...topic, soundIds, soundSignals: soundSignals.sort((a, b) => b.creators - a.creators).slice(0, 5) };
  });
}

export function scanNovelty(rows = [], priorSeen = []) {
  const seen = new Set(priorSeen);
  const unique = mergeRichEvidence(rows);
  const newRows = unique.filter((row) => !seen.has(row.id));
  return {
    unique,
    newRows,
    newRatio: unique.length ? newRows.length / unique.length : 0,
    seenIds: [...new Set([...priorSeen, ...unique.map((x) => x.id)])].slice(-2000),
  };
}
