import { dedupeEvidence, extractHashtags, inferTopics } from './core.mjs';

const STOP = new Set(('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really new now today tonight yesterday tomorrow have has had do does did can could would should will may might about into over under after before more most some any all one two via amp rt https http com www video watch post posts people thing things time day get got like know think make made going go went see saw says said say look looks looking why how what when where who which there here want wants wanted gonna gotta lol omg yeah yep okay ok good great best bad big small still even much many another first last every literally actually').split(' '));
const GENERIC = new Set(('meme memes viral virality reaction reactions reacts reacted clip clips trend trends trending story stories update updates breaking news funny wild crazy internet tiktok twitter tweet tweets social media creator creators account accounts hashtag hashtags caption video videos photo photos sound user username profile').split(' '));
const BROAD = new Set(('crypto cryptocurrency bitcoin btc ethereum eth solana market markets stocks stock politics political election elections sports football basketball baseball soccer music entertainment technology tech ai artificial intelligence gaming games celebrity celebrities world national local economy economic finance financial').split(' '));
const UI = /^(?:show|show more|more|view|view more|read more|explore|home|for you|trending|trend|hashtag|caption|video|profile|user|username|quote|reply|repost|like|likes|share|views?)$/i;
const METRIC = /^\s*[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T|%|x)?(?:\s+(?:views?|likes?|posts?|shares?|comments?|replies?|reposts?))?\s*$/i;

const clean = (value) => String(value ?? '').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 100);
const normalize = (value) => clean(value).normalize('NFKC').toLocaleLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = (value) => normalize(value).replace(/\s+/g, '');
const tokens = (value) => normalize(value).split(' ').filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC.has(word) && !BROAD.has(word) && !/^\d+$/.test(word));

function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = old;
    }
  }
  return prev[b.length];
}

export function sameTopicKey(a, b) {
  const left = compact(a), right = compact(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 5) return false;
  return editDistance(left, right) <= 1;
}

function validLabel(label) {
  const value = clean(label);
  if (!value || value.length < 3 || UI.test(value) || METRIC.test(value)) return false;
  return tokens(value).length > 0;
}

function candidatesFor(event) {
  const out = new Map();
  const add = (raw, kind, weight) => {
    const label = clean(raw), key = normalize(label);
    if (!validLabel(label) || !key) return;
    const previous = out.get(key);
    if (!previous || weight > previous.weight) out.set(key, { key, label, kind, weight });
  };
  for (const tag of extractHashtags(event.content, 15)) add(tag, 'hashtag', 3.4);
  for (const match of String(event.content).matchAll(/\b[A-Z][\p{L}\p{N}'’_-]{2,30}(?:\s+[A-Z][\p{L}\p{N}'’_-]{2,30}){0,2}\b/gu)) add(match[0], 'name', 2.8);
  const words = normalize(event.content).split(' ').filter((word) => word.length >= 4 && word.length <= 30 && !STOP.has(word) && !GENERIC.has(word) && !BROAD.has(word) && !/\d/.test(word)).slice(0, 70);
  for (const word of words) add(word, 'token', 0.75);
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i <= words.length - size; i++) add(words.slice(i, i + size).join(' '), 'phrase', size === 3 ? 1.2 : 1);
  }
  return [...out.values()];
}

function supplementalTopics(events, now) {
  const buckets = new Map();
  for (const event of dedupeEvidence(events)) {
    for (const candidate of candidatesFor(event)) {
      const row = buckets.get(candidate.key) || { key: candidate.key, labels: new Map(), evidence: new Map(), authors: new Set(), platforms: new Set(), kinds: new Set(), weights: 0 };
      row.evidence.set(event.id, event);
      row.authors.add(`${event.platform}:${String(event.author).toLocaleLowerCase()}`);
      row.platforms.add(event.platform);
      row.kinds.add(candidate.kind);
      row.weights += candidate.weight;
      row.labels.set(candidate.label, (row.labels.get(candidate.label) || 0) + candidate.weight);
      buckets.set(candidate.key, row);
    }
  }
  return [...buckets.values()].flatMap((row) => {
    const evidence = [...row.evidence.values()], authorCount = row.authors.size, platformCount = row.platforms.size;
    const structured = row.kinds.has('hashtag') || row.kinds.has('name');
    const enough = structured ? authorCount >= 2 : authorCount >= 3 || (platformCount >= 2 && authorCount >= 2);
    if (!enough) return [];
    const label = [...row.labels.entries()].sort((a, b) => b[1] - a[1] || tokens(b[0]).length - tokens(a[0]).length || a[0].length - b[0].length)[0]?.[0] || row.key;
    if (!validLabel(label)) return [];
    const dated = evidence.map((item) => item.published).filter((value) => Number.isFinite(value));
    const engagement = evidence.reduce((sum, item) => sum + Math.log10(1 + (item.views || 0)) + .35 * Math.log10(1 + (item.likes || 0)), 0);
    const recency = evidence.reduce((sum, item) => {
      const ageHours = item.published ? Math.max(0, (now - item.published) / 3600000) : 6;
      return sum + Math.max(.15, 1 / (1 + ageHours / 3));
    }, 0);
    const specificityScore = Math.min(10, tokens(label).length * 1.4 + (structured ? 1.6 : 0) + (platformCount > 1 ? .8 : 0) + Math.min(2, authorCount * .4));
    const score = row.weights + authorCount * 3.2 + platformCount * 2.5 + recency * 1.4 + Math.min(8, engagement * .35) + specificityScore;
    const anchors = [...evidence].sort((a, b) => ((b.views || 0) + 4 * (b.likes || 0)) - ((a.views || 0) + 4 * (a.likes || 0)) || (b.published || 0) - (a.published || 0)).slice(0, 3).map((item) => ({ id: item.id, platform: item.platform, author: item.author, url: item.url, content: String(item.content).slice(0, 260), published: item.published, views: item.views, likes: item.likes }));
    return [{ topic: label, key: row.key, evidenceCount: evidence.length, authorCount, platforms: [...row.platforms], oldestPublished: dated.length ? Math.min(...dated) : null, newestPublished: dated.length ? Math.max(...dated) : null, engagementEvidence: evidence.reduce((sum, item) => sum + (item.views || 0) + (item.likes || 0), 0), score: Number(score.toFixed(2)), specificityScore: Number(specificityScore.toFixed(2)), niche: true, nicheEvidenceCount: 0, corroborated: true, evidenceIds: evidence.slice(0, 8).map((item) => item.id), anchors, relatedContexts: [], detector: structured ? 'structured-repeat' : 'repeat-cluster' }];
  });
}

function overlap(a, b) {
  const right = new Set(b.evidenceIds || []);
  return (a.evidenceIds || []).filter((id) => right.has(id)).length;
}

export function detectTopics(events, now = Date.now(), limit = 10) {
  const base = inferTopics(events, now, Math.max(limit * 2, 20)).map((topic) => ({ ...topic, detector: 'niche-inference' }));
  const extra = supplementalTopics(events, now);
  const merged = [];
  for (const topic of [...base, ...extra].sort((a, b) => b.score - a.score)) {
    const index = merged.findIndex((existing) => sameTopicKey(existing.key || existing.topic, topic.key || topic.topic) && (compact(existing.key) === compact(topic.key) || overlap(existing, topic) > 0));
    if (index < 0) { merged.push(topic); continue; }
    const existing = merged[index];
    const prefer = (topic.specificityScore || 0) > (existing.specificityScore || 0) || ((topic.specificityScore || 0) === (existing.specificityScore || 0) && topic.authorCount > existing.authorCount);
    const primary = prefer ? topic : existing, secondary = prefer ? existing : topic;
    primary.evidenceIds = [...new Set([...(primary.evidenceIds || []), ...(secondary.evidenceIds || [])])].slice(0, 8);
    primary.authorCount = Math.max(primary.authorCount || 0, secondary.authorCount || 0);
    primary.evidenceCount = Math.max(primary.evidenceCount || 0, secondary.evidenceCount || 0, primary.evidenceIds.length);
    primary.platforms = [...new Set([...(primary.platforms || []), ...(secondary.platforms || [])])];
    primary.relatedContexts = primary.relatedContexts?.length ? primary.relatedContexts : (secondary.relatedContexts || []);
    merged[index] = primary;
  }
  return merged.sort((a, b) => b.score - a.score || b.authorCount - a.authorCount).slice(0, Math.max(0, limit));
}

export function enrichMomentum(topics, history = [], now = Date.now()) {
  const prior = [...history].filter((snapshot) => snapshot && snapshot.at < now && Array.isArray(snapshot.topics)).sort((a, b) => b.at - a.at)[0];
  return topics.map((topic) => {
    const previous = prior?.topics?.find((item) => sameTopicKey(item.key || item.topic, topic.key || topic.topic));
    const creatorDelta = previous ? topic.authorCount - Number(previous.authorCount || 0) : topic.authorCount;
    const evidenceDelta = previous ? topic.evidenceCount - Number(previous.evidenceCount || 0) : topic.evidenceCount;
    const platformDelta = previous ? topic.platforms.length - Number(previous.platformCount || previous.platforms?.length || 0) : topic.platforms.length;
    const creatorGrowthPct = previous && previous.authorCount > 0 ? Math.round(100 * creatorDelta / previous.authorCount) : null;
    const newTopic = !previous;
    const momentumScore = Math.max(0, creatorDelta) * 4 + Math.max(0, evidenceDelta) * 1.5 + Math.max(0, platformDelta) * 3 + (topic.platforms.length > 1 ? 2 : 0) + (newTopic ? 1 : 0);
    const label = newTopic ? 'New' : creatorDelta >= 2 || (creatorGrowthPct != null && creatorGrowthPct >= 75) ? 'Accelerating' : creatorDelta > 0 || evidenceDelta >= 2 ? 'Rising' : creatorDelta < 0 ? 'Cooling' : 'Steady';
    return { ...topic, momentum: { label, score: Number(momentumScore.toFixed(2)), creatorDelta, evidenceDelta, platformDelta, creatorGrowthPct, newTopic, comparedAt: prior?.at ?? null } };
  }).sort((a, b) => (b.momentum?.score || 0) - (a.momentum?.score || 0) || b.score - a.score);
}

export function topicSnapshot(topics, at = Date.now()) {
  return { at, topics: topics.slice(0, 30).map((topic) => ({ key: topic.key, topic: topic.topic, authorCount: topic.authorCount, evidenceCount: topic.evidenceCount, platformCount: topic.platforms?.length || 0, platforms: topic.platforms || [], momentum: topic.momentum || null })) };
}
