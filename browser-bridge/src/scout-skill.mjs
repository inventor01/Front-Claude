const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const creatorKey = (row) => `${row.platform}:${String(row.author || '').toLowerCase()}`;
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export const SCOUT_SKILL_VERSION = 16;

const STOP = new Set([
  'the','and','for','with','from','this','that','you','your','are','was','were','have','has','had','will','would','could','should','about','into','out','not','but','they','them','their','its','our','his','her','she','him','who','what','when','where','why','how','just','more','like','likes','view','views','video','videos','clip','clips','photo','photos','post','posts','tweet','tweets','tiktok','twitter','viral','trending','trend','meme','memes','sound','audio','original','created','create','today','tonight','now','new','again','everywhere','feed','timeline','discussion','appearing','spreading','popping','becoming','keeps','solo','ever','esta','hacer','escucha','sonido','originalmente','звук','оригинальный',
]);

function words(value) {
  return normalize(value).split(' ').filter((word) => word.length >= 4 && !STOP.has(word) && !/^\d+$/.test(word));
}

function rowVelocity(row, now) {
  const published = finite(row.published);
  const views = finite(row.views);
  const likes = finite(row.likes);
  const ageHours = published && published > 0 ? Math.max(1 / 60, (now - published) / 3600000) : null;
  const measuredViewsPerMinute = finite(row.viewsPerMinute);
  const measuredLikesPerMinute = finite(row.likesPerMinute);
  const derivedViewsPerHour = views != null && ageHours != null ? views / ageHours : null;
  const derivedLikesPerHour = likes != null && ageHours != null ? likes / ageHours : null;
  const measuredViewsPerHour = measuredViewsPerMinute != null ? measuredViewsPerMinute * 60 : null;
  const measuredLikesPerHour = measuredLikesPerMinute != null ? measuredLikesPerMinute * 60 : null;
  const viewsPerHour = Math.max(0, derivedViewsPerHour || 0, measuredViewsPerHour || 0);
  const likesPerHour = Math.max(0, derivedLikesPerHour || 0, measuredLikesPerHour || 0);
  const explosive = Boolean(
    (views != null && ageHours != null && views >= 100000 && ageHours <= 6)
    || viewsPerHour >= 100000
    || (likes != null && ageHours != null && likes >= 10000 && ageHours <= 6)
    || likesPerHour >= 5000
  );
  const fast = explosive
    || Boolean(views != null && ageHours != null && views >= 50000 && ageHours <= 3)
    || viewsPerHour >= 25000
    || Boolean(likes != null && ageHours != null && likes >= 5000 && ageHours <= 3)
    || likesPerHour >= 2000;
  return { viewsPerHour, likesPerHour, explosive, fast };
}

function phraseHints(content) {
  const list = words(content);
  const hints = new Set(list);
  for (let i = 0; i < list.length - 1; i++) hints.add(`${list[i]} ${list[i + 1]}`);
  return [...hints].filter((hint) => hint.length >= 5).slice(0, 24);
}

function repeatedContext(rows) {
  const groups = new Map();
  const add = (key, creator) => {
    if (!key) return;
    const set = groups.get(key) || new Set();
    set.add(creator);
    groups.set(key, set);
  };
  for (const row of rows) {
    const creator = creatorKey(row);
    if (row.soundId) add(`sound:${row.soundId}`, creator);
    if (row.visualHash) add(`visual:${row.visualHash}`, creator);
    if (row.relatedVideoId) add(`parent:${row.relatedVideoId}`, creator);
    if (row.quotedUrl) add(`quote:${row.quotedUrl}`, creator);
    for (const url of Array.isArray(row.outboundUrls) ? row.outboundUrls : []) add(`url:${url}`, creator);
  }
  const strongest = [...groups.entries()].map(([key, creators]) => ({ key, creators: creators.size })).sort((a, b) => b.creators - a.creators)[0];
  return strongest || { key: null, creators: 0 };
}

function repeatedLanguage(rows) {
  const groups = new Map();
  for (const row of rows) {
    const creator = creatorKey(row);
    for (const hint of phraseHints(row.content)) {
      const set = groups.get(hint) || new Set();
      set.add(creator);
      groups.set(hint, set);
    }
  }
  return [...groups.entries()]
    .map(([hint, creators]) => ({ hint, creators: creators.size }))
    .filter((row) => row.creators >= 2)
    .sort((a, b) => b.creators - a.creators || b.hint.split(' ').length - a.hint.split(' ').length)[0]
    || { hint: null, creators: 0 };
}

export function evaluateDiscoveryPass(rows = [], { pass = 0, platform = '', now = Date.now(), minSample = 12 } = {}) {
  const uniqueCreators = new Set(rows.map(creatorKey)).size;
  const rates = rows.map((row) => ({ row, ...rowVelocity(row, now) }));
  const fastCreators = new Set(rates.filter((entry) => entry.fast).map((entry) => creatorKey(entry.row)));
  const explosiveCreators = new Set(rates.filter((entry) => entry.explosive).map((entry) => creatorKey(entry.row)));
  const language = repeatedLanguage(rows);
  const context = repeatedContext(rows);
  const reasons = [];
  let score = 0;

  if (language.creators >= 3) { score += Math.min(36, 12 + language.creators * 6); reasons.push(`${language.creators} creators repeating “${language.hint}”`); }
  if (context.creators >= 2) { score += Math.min(32, 12 + context.creators * 7); reasons.push(`${context.creators} creators share related media/context`); }
  if (fastCreators.size >= 2) { score += Math.min(30, 10 + fastCreators.size * 7); reasons.push(`${fastCreators.size} independent fast posts`); }
  if (explosiveCreators.size >= 2) { score += 18; reasons.push(`${explosiveCreators.size} independent breakout posts`); }
  if (uniqueCreators >= 8) score += 4;

  const enoughSample = rows.length >= minSample || pass >= 2;
  const focus = enoughSample && (
    score >= 38
    || language.creators >= 4
    || context.creators >= 3
    || (fastCreators.size >= 2 && (language.creators >= 2 || context.creators >= 2))
  );

  return {
    platform,
    focus,
    score: Math.min(100, score),
    reasons,
    repeatedLanguage: language,
    repeatedContext: context,
    fastCreators: fastCreators.size,
    explosiveCreators: explosiveCreators.size,
    uniqueCreators,
    sample: rows.length,
  };
}

export function rankInvestigationCandidates(topics = [], evidence = [], { limit = 4, now = Date.now() } = {}) {
  const byId = new Map(evidence.map((row) => [row.id, row]));
  return topics.map((topic) => {
    const rows = (topic.evidenceIds || []).map((id) => byId.get(id)).filter(Boolean);
    const creators = Number(topic.authorCount || new Set(rows.map(creatorKey)).size || 0);
    const fastCreators = new Set(rows.filter((row) => rowVelocity(row, now).fast).map(creatorKey)).size;
    const media = repeatedContext(rows).creators;
    const crossPlatform = topic.crossPlatform?.corroborated === true;
    const momentum = topic.momentum?.label === 'Accelerating' ? 18 : topic.momentum?.label === 'Spreading' ? 10 : 0;
    const penetration = Math.max(0, Number(topic.feedPenetrationVelocity || 0));
    const base = Number(topic.priorityScore ?? topic.score ?? 0);
    const score = base
      + Math.min(24, creators * 4)
      + Math.min(18, fastCreators * 7)
      + Math.min(14, media * 4)
      + (crossPlatform ? 20 : 0)
      + momentum
      + Math.min(10, penetration * 1.5);
    return { ...topic, scoutFocusScore: Number(score.toFixed(2)), scoutFocusReasons: [
      creators >= 3 ? `${creators} creators` : null,
      fastCreators >= 2 ? `${fastCreators} fast creators` : null,
      media >= 2 ? `${media} repeated-media creators` : null,
      crossPlatform ? 'same-event X ↔ TikTok' : null,
      momentum ? topic.momentum?.label : null,
    ].filter(Boolean) };
  }).sort((a, b) => b.scoutFocusScore - a.scoutFocusScore || Number(b.priorityScore || b.score || 0) - Number(a.priorityScore || a.score || 0)).slice(0, limit);
}

export function scoutBroadeningPlan(candidates = [], scanMode = 'scout') {
  const top = candidates[0];
  if (!top) return { focusFirst: false, reduceBroadSeeds: false, reason: 'no-qualified-focus' };
  const score = Number(top.scoutFocusScore || 0);
  const focusFirst = score >= 62;
  return {
    focusFirst,
    reduceBroadSeeds: scanMode === 'scout' && score >= 80,
    reason: focusFirst ? `focus-score-${Math.round(score)}` : 'broad-scan-still-needed',
  };
}

export function attachObservedMetricVelocity(rows = [], previous = {}, now = Date.now(), { minElapsedMs = 60_000, maxAgeMs = 24 * 3600000 } = {}) {
  const next = {};
  const enriched = rows.map((row) => {
    const key = String(row.id || row.url || '');
    const prior = key ? previous[key] : null;
    const views = finite(row.views);
    const likes = finite(row.likes);
    let viewsPerMinute = null;
    let likesPerMinute = null;
    const elapsed = prior ? now - Number(prior.at || 0) : 0;
    if (prior && elapsed >= minElapsedMs && elapsed <= maxAgeMs) {
      const minutes = elapsed / 60000;
      if (views != null && finite(prior.views) != null && views >= Number(prior.views)) viewsPerMinute = (views - Number(prior.views)) / minutes;
      if (likes != null && finite(prior.likes) != null && likes >= Number(prior.likes)) likesPerMinute = (likes - Number(prior.likes)) / minutes;
    }
    if (key) next[key] = { at: now, views, likes };
    return {
      ...row,
      viewsPerMinute: viewsPerMinute == null ? row.viewsPerMinute ?? null : Number(viewsPerMinute.toFixed(3)),
      likesPerMinute: likesPerMinute == null ? row.likesPerMinute ?? null : Number(likesPerMinute.toFixed(3)),
    };
  });
  const cutoff = now - maxAgeMs;
  for (const [key, value] of Object.entries(previous)) if (!next[key] && Number(value?.at || 0) >= cutoff) next[key] = value;
  return { rows: enriched, state: next };
}
