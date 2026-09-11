import {
  detectTopics as baseDetectTopics,
  enrichMomentum as baseEnrichMomentum,
  sameTopicKey,
  topicSnapshot as baseTopicSnapshot,
} from './topic-engine-base.mjs';

export { sameTopicKey };

const GENERIC_SINGLE = new Set((
  'original originals official officially sound sounds audio caption captions video videos photo photos image images ' +
  'post posts repost reposts reply replies comment comments share shares view views like likes follow follows ' +
  'part parts episode episodes full live new latest today tonight yesterday tomorrow update updates breaking news ' +
  'meme memes viral trend trends trending funny reaction reactions clip clips edit edits creator creators account accounts ' +
  'user users profile profiles people person guy guys girl girls man men woman women bro dude someone somebody anyone anybody ' +
  'everyone everybody thing things stuff something anything everything name names word words topic topics story stories ' +
  'love hate trade trading buy buying sell selling market markets coin coins token tokens crypto solana tiktok twitter x fyp foryou'
).split(/\s+/));
const STOP = new Set((
  'the a an and or but if then than this that these those to of in on at for from with without is are was were be been being ' +
  'it its i you your we our they their he she his her not no yes just very really now have has had do does did can could would ' +
  'should will may might about into over under after before more most some any all one two via amp rt get got like know think ' +
  'make made going go went see saw says said say look looks looking why how what when where who which there here want wants wanted'
).split(/\s+/));

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .replace(/^#/, '')
  .replace(/[_-]+/g, ' ')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const tokens = (value) => normalize(value).split(' ').filter(Boolean);
const creatorKey = (row) => `${row.platform}:${String(row.author || '').toLowerCase()}`;
const cleanLabel = (value) => String(value ?? '').replace(/^#/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

function genericLabel(value) {
  const parts = tokens(value);
  if (!parts.length) return true;
  if (parts.length === 1 && GENERIC_SINGLE.has(parts[0])) return true;
  return parts.every((word) => GENERIC_SINGLE.has(word) || STOP.has(word) || /^\d+$/.test(word));
}

function supportingRows(topic, evidence) {
  const ids = new Set(topic?.evidenceIds || []);
  if (ids.size) return evidence.filter((row) => ids.has(row.id));
  const labels = [topic?.topic, ...(topic?.aliases || [])].map(normalize).filter(Boolean);
  return evidence.filter((row) => {
    const text = ` ${normalize(row.content)} `;
    return labels.some((label) => label.length >= 3 && text.includes(` ${label} `));
  });
}

function exactSupport(label, rows) {
  const key = normalize(label);
  if (!key) return { creators: 0, evidence: 0, platforms: 0 };
  const matches = rows.filter((row) => ` ${normalize(row.content)} `.includes(` ${key} `));
  return {
    creators: new Set(matches.map(creatorKey)).size,
    evidence: matches.length,
    platforms: new Set(matches.map((row) => row.platform)).size,
  };
}

function repeatedContiguousPhrases(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const words = normalize(row.content).split(' ').filter(Boolean).slice(0, 90);
    const author = creatorKey(row);
    for (let size = 2; size <= 5; size++) {
      for (let i = 0; i <= words.length - size; i++) {
        const slice = words.slice(i, i + size);
        if (slice.some((word) => /^https?$|^www$|^com$/.test(word))) continue;
        const meaningful = slice.filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC_SINGLE.has(word));
        if (meaningful.length < Math.min(2, size)) continue;
        const phrase = slice.join(' ');
        if (genericLabel(phrase)) continue;
        const old = buckets.get(phrase) || { authors: new Set(), platforms: new Set(), count: 0 };
        old.authors.add(author); old.platforms.add(row.platform); old.count += 1;
        buckets.set(phrase, old);
      }
    }
  }
  return [...buckets.entries()]
    .filter(([, stat]) => stat.authors.size >= 2)
    .map(([label, stat]) => ({ label, creators: stat.authors.size, platforms: stat.platforms.size, count: stat.count }))
    .sort((a, b) => b.creators - a.creators || b.platforms - a.platforms || b.count - a.count || tokens(b.label).length - tokens(a.label).length);
}

function bestDisplayLabel(topic, rows) {
  const candidates = [...new Set([topic.topic, ...(topic.aliases || [])].map(cleanLabel).filter(Boolean))]
    .filter((label) => !genericLabel(label))
    .map((label) => ({ label, ...exactSupport(label, rows) }))
    .filter((item) => item.creators >= 2)
    .sort((a, b) => {
      const aWords = tokens(a.label).length, bWords = tokens(b.label).length;
      const aScore = a.creators * 8 + a.platforms * 3 + Math.min(4, aWords) * 1.5 - (aWords > 6 ? 6 : 0);
      const bScore = b.creators * 8 + b.platforms * 3 + Math.min(4, bWords) * 1.5 - (bWords > 6 ? 6 : 0);
      return bScore - aScore || bWords - aWords || a.label.length - b.label.length;
    });
  if (candidates[0]) return candidates[0].label;
  const repeated = repeatedContiguousPhrases(rows);
  if (repeated[0]) return repeated[0].label;
  const fallback = cleanLabel(topic.topic || topic.key);
  return fallback && !genericLabel(fallback) ? fallback : '';
}

function keepTopic(topic) {
  const label = cleanLabel(topic.topic || topic.key);
  const parts = tokens(label);
  if (!label || genericLabel(label)) return false;
  const creators = Number(topic.authorCount || 0);
  const evidenceCount = Number(topic.evidenceCount || 0);
  if (creators < 2 || evidenceCount < 2) return false;
  if (parts.length === 1) {
    if (GENERIC_SINGLE.has(parts[0])) return false;
    // Base v11 has already established natural independent support. Keep a
    // specific emerging one-word name in pre-breakout with two creators, but
    // require three creators before presenting it as a promoted candidate.
    return topic.tier === 'candidate' ? creators >= 3 : creators >= 2;
  }
  // Multi-word topics that have already cleared the base detector remain
  // eligible even when spelling variants or semantic/media context mean the
  // exact full phrase does not occur verbatim in every supporting post.
  return creators >= 2;
}

export function detectTopics(events = [], now = Date.now(), limit = 15) {
  const raw = baseDetectTopics(events, now, Math.max(limit * 3, 30));
  const out = [];
  for (const topic of raw) {
    const rows = supportingRows(topic, events);
    if (!keepTopic(topic)) continue;
    const display = bestDisplayLabel(topic, rows);
    if (!display || genericLabel(display)) continue;
    const repaired = {
      ...topic,
      topic: display,
      key: normalize(display),
      aliases: [...new Set([display, topic.topic, ...(topic.aliases || [])].map(cleanLabel).filter((value) => value && !genericLabel(value)))].slice(0, 18),
      labelEvidence: exactSupport(display, rows),
      labelPolicy: 'natural-post-phrase',
    };
    const duplicate = out.find((item) => sameTopicKey(item.key || item.topic, repaired.key || repaired.topic));
    if (!duplicate) out.push(repaired);
  }
  return out.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.authorCount || 0) - (a.authorCount || 0)).slice(0, Math.max(0, limit));
}

export function enrichMomentum(topics = [], history = [], now = Date.now()) {
  const enriched = baseEnrichMomentum(topics, history, now).map((topic) => {
    const hot = Array.isArray(topic.hotPosts) ? topic.hotPosts : [];
    const maxViewsPerHour = Number(topic.maxViewsPerHour || 0);
    const crossPostedCreators = Number(topic.crossPostedCreators || 0);
    const creators = Number(topic.authorCount || 0);
    const shouldFlag = creators >= 2 && (maxViewsPerHour >= 100000 || hot.some((post) => Number(post.views || 0) >= 100000 && Number(post.ageHours || 99) <= 6) || crossPostedCreators >= 3 && maxViewsPerHour >= 25000);
    if (!shouldFlag || topic.momentum?.label === 'Accelerating') return topic;
    return { ...topic, momentum: { ...(topic.momentum || {}), label: 'Accelerating', score: Number(((topic.momentum?.score || 0) + Math.min(35, Math.log10(1 + maxViewsPerHour) * 6)).toFixed(2)), engagementAcceleration: true } };
  });
  return enriched.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || (b.momentum?.score || 0) - (a.momentum?.score || 0) || (b.score || 0) - (a.score || 0));
}

export function topicSnapshot(topics = [], at = Date.now()) {
  const snapshot = baseTopicSnapshot(topics, at);
  const byKey = new Map(topics.map((topic) => [normalize(topic.key || topic.topic), topic]));
  snapshot.topics = snapshot.topics.map((row) => {
    const source = byKey.get(normalize(row.key || row.topic));
    return {
      ...row,
      priorityScore: source?.priorityScore || 0,
      maxViewsPerHour: source?.maxViewsPerHour || 0,
      crossPostedCreators: source?.crossPostedCreators || 0,
      hotPostCount: source?.hotPosts?.length || 0,
    };
  });
  return snapshot;
}
