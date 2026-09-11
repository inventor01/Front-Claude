import { dedupeEvidence, extractHashtags, inferTopics } from './core.mjs';

const STOP = new Set(('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really new now today tonight yesterday tomorrow have has had do does did can could would should will may might about into over under after before more most some any all one two via amp rt https http com www video watch post posts people thing things time day get got like know think make made going go went see saw says said say look looks looking why how what when where who which there here want wants wanted gonna gotta lol omg yeah yep okay ok good great best bad big small still even much many another first last every literally actually').split(' '));
const GENERIC = new Set(('meme memes viral virality reaction reactions reacts reacted clip clips trend trends trending story stories update updates breaking news funny wild crazy internet tiktok twitter tweet tweets x social media creator creators account accounts hashtag hashtags caption video videos photo photos sound user username profile').split(' '));
const BROAD = new Set(('crypto cryptocurrency bitcoin btc ethereum eth solana market markets stocks stock politics political election elections sports football basketball baseball soccer music entertainment technology tech ai artificial intelligence gaming games celebrity celebrities world national local economy economic finance financial').split(' '));
const COMMON_SINGLE = new Set(('never always sometimes often usually maybe probably perhaps someone somebody anyone anybody everyone everybody something anything everything nothing somewhere anywhere everywhere nowhere trade trading buy buying sell selling blue red green black white orange yellow pink purple brown grey gray dark light big small old young high low hot cold fast slow early late long short better worse best worst free paid money price prices cost costs deal deals work works working worked use used using try trying tried start started starting stop stopped stopping keep keeps keeping kept need needs needed want wants wanted help helps helped find finds found show shows showing see sees seeing look looks looking tell tells told ask asks asked say says said feel feels felt think thinks thought know knows knew believe believes believed love loves loved hate hates hated like likes liked follow follows followed watch watches watched share shares shared click clicks clicked open opens opened close closes closed run runs running ran play plays playing played move moves moving moved turn turns turned call calls called name names named word words post posts video videos photo photos account accounts profile profiles creator creators user users person persons people guy guys girl girls man men woman women kid kids child children friend friends bro dude team teams game games song songs movie movies food foods car cars phone phones app apps site sites page pages link links number numbers thing things stuff part parts way ways place places home homes room rooms school schools job jobs business businesses company companies product products service services market markets coin coins token tokens story stories news update updates topic topics idea ideas question questions answer answers comment comments reply replies').split(' '));
const PLATFORM_TAG = new Set(('fyp fy foryou foryoupage viral viralvideo viralvideos trending trend tiktok tiktokviral tiktoktrend tiktoktrending capcut edit edits funny comedy humor explore explorepage xyzbca xyzabc fypppp').split(' '));
const UI = /^(?:show|show more|more|view|view more|read more|explore|home|for you|trending|trend|hashtag|hashtags|caption|video|videos|photo|photos|sound|original sound|profile|user|username|creator|account|quote|reply|replies|repost|reposts|like|likes|share|shares|views?)$/i;
const METRIC = /^\s*[+$-]?\d+(?:[.,]\d+)?\s*(?:K|M|B|T|%|x)?(?:\s+(?:views?|likes?|posts?|shares?|comments?|replies?|reposts?))?\s*$/i;
const SOCIAL_NOTIFICATION = /\b(?:and\s+\d[\d,.]*\s+others?\s+)?(?:liked|likes|reposted|reposts|quoted|quotes|followed|follows|mentioned|mentions|shared|shares)\s+(?:your|a|this)\s+(?:video|post|tweet|photo|comment|reply)\b/i;
const SEED_PROVENANCE = /(?:X Explore (?:trending|hashtag fallback)|TikTok Creative Center trends)/i;

const clean = (value) => String(value ?? '').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 100);
const normalize = (value) => clean(value).normalize('NFKC').toLocaleLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = (value) => normalize(value).replace(/\s+/g, '');
const tokens = (value) => normalize(value).split(' ').filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC.has(word) && !BROAD.has(word) && !/^\d+$/.test(word));
const topicTokens = (value) => tokens(value).filter((word) => !COMMON_SINGLE.has(word));
const isPlainSingleWord = (value) => { const parts = normalize(value).split(' ').filter(Boolean); return parts.length === 1 && COMMON_SINGLE.has(parts[0]); };
const stripHashtags = (value) => String(value ?? '').replace(/#[\p{L}\p{N}_]{2,80}/gu, ' ').replace(/\s+/g, ' ').trim();

function lowValueTag(value) {
  const key = compact(value);
  if (!key) return true;
  if (PLATFORM_TAG.has(key)) return true;
  const parts = normalize(value).split(' ').filter(Boolean);
  return Boolean(parts.length) && parts.every((part) => GENERIC.has(part) || BROAD.has(part) || COMMON_SINGLE.has(part) || PLATFORM_TAG.has(compact(part)));
}

function isSeedEvidence(event) {
  const provenance = String(event?.provenance || '');
  const author = normalize(String(event?.author || ''));
  return SEED_PROVENANCE.test(provenance) || author === 'x explore' || author === 'tiktok creative center';
}

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
  if (editDistance(left, right) <= 1) return true;
  const lt = new Set(tokens(a)), rt = new Set(tokens(b));
  if (!lt.size || !rt.size) return false;
  const overlap = [...lt].filter((token) => rt.has(token)).length;
  return overlap >= 2 && overlap / Math.min(lt.size, rt.size) >= 0.8;
}

function validLabel(label) {
  const value = clean(label);
  if (!value || value.length < 3 || UI.test(value) || METRIC.test(value) || SOCIAL_NOTIFICATION.test(value) || isPlainSingleWord(value)) return false;
  return topicTokens(value).length > 0 || tokens(value).length >= 2;
}

function candidatesFor(event) {
  if (SOCIAL_NOTIFICATION.test(String(event.content || ''))) return [];
  const out = new Map();
  const add = (raw, kind, weight) => {
    const label = clean(raw), key = normalize(label);
    if (!validLabel(label) || !key || (kind === 'hashtag' && lowValueTag(label))) return;
    const previous = out.get(key);
    if (!previous || weight > previous.weight) out.set(key, { key, label, kind, weight });
  };
  for (const tag of extractHashtags(event.content, 15)) add(tag, 'hashtag', 0.45);
  const body = stripHashtags(event.content);
  for (const match of body.matchAll(/\b[A-Z][\p{L}\p{N}'’_-]{2,30}(?:\s+[A-Z][\p{L}\p{N}'’_-]{2,30}){0,2}\b/gu)) add(match[0], 'name', 2.8);
  const words = normalize(body).split(' ').filter((word) => word.length >= 4 && word.length <= 30 && !STOP.has(word) && !GENERIC.has(word) && !BROAD.has(word) && !COMMON_SINGLE.has(word) && !PLATFORM_TAG.has(compact(word)) && !/\d/.test(word)).slice(0, 70);
  for (const word of words) add(word, 'token', 0.8);
  for (let size = 2; size <= 4; size++) for (let i = 0; i <= words.length - size; i++) add(words.slice(i, i + size).join(' '), 'phrase', size >= 3 ? 1.5 : 1.15);
  return [...out.values()];
}

function originCandidate(evidence, now) {
  const dated = evidence.filter((item) => Number.isFinite(item.published) && item.published > 0).sort((a, b) => a.published - b.published);
  const first = dated[0];
  if (!first) return null;
  return {
    url: first.url,
    published: first.published,
    author: first.author,
    platform: first.platform,
    ageMinutes: Math.max(0, Math.round((now - first.published) / 60000)),
    confidence: dated.length >= 4 ? 'high' : dated.length >= 2 ? 'medium' : 'low',
    method: `Earliest dated evidence found in ${dated.length} sampled supporting post${dated.length === 1 ? '' : 's'}; not guaranteed absolute internet origin.`,
  };
}

function preferredLabel(row) {
  const ranked = [...row.labels.entries()].map(([label, stat]) => {
    const wordCount = normalize(label).split(' ').filter(Boolean).length;
    const hashtagOnly = stat.kinds.size === 1 && stat.kinds.has('hashtag');
    const kindBonus = stat.kinds.has('name') ? 4 : stat.kinds.has('phrase') ? 2.5 : stat.kinds.has('token') ? 1 : 0;
    const score = stat.weight + stat.authors.size * 1.25 + kindBonus + Math.min(2.5, Math.max(0, wordCount - 1) * .65) - (hashtagOnly ? 8 : 0);
    return { label, score, hashtagOnly, wordCount };
  }).sort((a, b) => b.score - a.score || b.wordCount - a.wordCount || a.label.length - b.label.length);
  return ranked.find((item) => !item.hashtagOnly)?.label || ranked[0]?.label || row.key;
}

function supplementalTopics(events, now) {
  const buckets = new Map();
  for (const event of dedupeEvidence(events).filter((item) => !isSeedEvidence(item))) {
    const authorKey = `${event.platform}:${String(event.author).toLocaleLowerCase()}`;
    for (const candidate of candidatesFor(event)) {
      const canonicalKey = [...buckets.keys()].find((key) => sameTopicKey(key, candidate.key)) || candidate.key;
      const row = buckets.get(canonicalKey) || { key: canonicalKey, labels: new Map(), evidence: new Map(), authors: new Set(), textAuthors: new Set(), platforms: new Set(), textPlatforms: new Set(), kinds: new Set(), weights: 0 };
      row.evidence.set(event.id, event);
      row.authors.add(authorKey);
      row.platforms.add(event.platform);
      row.kinds.add(candidate.kind);
      row.weights += candidate.weight;
      if (candidate.kind !== 'hashtag') { row.textAuthors.add(authorKey); row.textPlatforms.add(event.platform); }
      const stat = row.labels.get(candidate.label) || { weight: 0, authors: new Set(), kinds: new Set() };
      stat.weight += candidate.weight;
      stat.authors.add(authorKey);
      stat.kinds.add(candidate.kind);
      row.labels.set(candidate.label, stat);
      buckets.set(canonicalKey, row);
    }
  }
  return [...buckets.values()].flatMap((row) => {
    const evidence = [...row.evidence.values()], authorCount = row.authors.size, textAuthorCount = row.textAuthors.size, textPlatformCount = row.textPlatforms.size;
    const label = preferredLabel(row);
    if (!validLabel(label)) return [];
    const labelWordCount = normalize(label).split(' ').filter(Boolean).length;
    const hasNaturalStructure = labelWordCount >= 2 && (row.kinds.has('name') || row.kinds.has('phrase'));
    const crossText = textPlatformCount > 1;
    const candidateEnough = hasNaturalStructure ? textAuthorCount >= 2 : textAuthorCount >= 3 || (crossText && textAuthorCount >= 2);
    const preBreakoutEnough = textAuthorCount >= 2 && evidence.length >= 2;
    if (!candidateEnough && !preBreakoutEnough) return [];
    const tier = candidateEnough ? 'candidate' : 'pre-breakout';
    const dated = evidence.map((item) => item.published).filter((value) => Number.isFinite(value));
    const engagement = evidence.reduce((sum, item) => sum + Math.log10(1 + (item.views || 0)) + .35 * Math.log10(1 + (item.likes || 0)), 0);
    const recency = evidence.reduce((sum, item) => { const ageHours = item.published ? Math.max(0, (now - item.published) / 3600000) : 6; return sum + Math.max(.15, 1 / (1 + ageHours / 3)); }, 0);
    const specificityScore = Math.min(10, topicTokens(label).length * 1.5 + (hasNaturalStructure ? 2.1 : 0) + (crossText ? 1.2 : 0) + Math.min(2.4, textAuthorCount * .45));
    const hashtagSupport = Math.max(0, authorCount - textAuthorCount);
    const score = row.weights + textAuthorCount * 3.8 + textPlatformCount * 3 + Math.min(2, hashtagSupport) * .35 + recency * 1.4 + Math.min(8, engagement * .35) + specificityScore;
    const anchors = [...evidence].sort((a, b) => ((b.views || 0) + 4 * (b.likes || 0)) - ((a.views || 0) + 4 * (a.likes || 0)) || (b.published || 0) - (a.published || 0)).slice(0, 3).map((item) => ({ id: item.id, platform: item.platform, author: item.author, url: item.url, content: String(item.content).slice(0, 260), published: item.published, views: item.views, likes: item.likes }));
    const aliases = [...new Set([label, ...row.labels.keys()].filter((value) => !lowValueTag(value)))].slice(0, 12);
    return [{ topic: label, key: normalize(label), aliases, tier, evidenceCount: evidence.length, authorCount: textAuthorCount, platforms: [...row.textPlatforms], oldestPublished: dated.length ? Math.min(...dated) : null, newestPublished: dated.length ? Math.max(...dated) : null, engagementEvidence: evidence.reduce((sum, item) => sum + (item.views || 0) + (item.likes || 0), 0), score: Number(score.toFixed(2)), specificityScore: Number(specificityScore.toFixed(2)), niche: true, nicheEvidenceCount: 0, corroborated: candidateEnough, evidenceIds: evidence.slice(0, 8).map((item) => item.id), anchors, originCandidate: originCandidate(evidence, now), relatedContexts: [], detector: hasNaturalStructure ? 'narrative-phrase-repeat' : 'distinctive-repeat' }];
  });
}

function promotionEnough(topic) {
  const wordCount = normalize(topic.topic || topic.key).split(' ').filter(Boolean).length;
  const creators = Number(topic.authorCount || 0);
  const platforms = Array.isArray(topic.platforms) ? topic.platforms.length : 0;
  if (wordCount <= 1) return creators >= 3 || (platforms > 1 && creators >= 2);
  return creators >= 2;
}

export function detectTopics(events, now = Date.now(), limit = 15) {
  const evidence = dedupeEvidence(events).filter((item) => !isSeedEvidence(item));
  const naturalEvidence = evidence.map((item) => ({ ...item, content: stripHashtags(item.content) })).filter((item) => validLabel(item.content));
  const base = inferTopics(naturalEvidence, now, Math.max(limit * 2, 20)).filter((topic) => validLabel(topic.topic) && validLabel(topic.key)).map((topic) => {
    const supporting = evidence.filter((item) => topic.evidenceIds?.includes(item.id));
    const candidate = promotionEnough(topic);
    return { ...topic, tier: candidate ? 'candidate' : 'pre-breakout', corroborated: candidate, aliases: [topic.topic], originCandidate: originCandidate(supporting, now), detector: 'narrative-inference' };
  });
  const extra = supplementalTopics(evidence, now);
  const merged = [];
  for (const topic of [...base, ...extra].sort((a, b) => b.score - a.score)) {
    const index = merged.findIndex((existing) => sameTopicKey(existing.key || existing.topic, topic.key || topic.topic));
    if (index < 0) { merged.push(topic); continue; }
    const existing = merged[index];
    const prefer = (topic.tier === 'candidate' && existing.tier !== 'candidate') || (topic.specificityScore || 0) > (existing.specificityScore || 0) || ((topic.specificityScore || 0) === (existing.specificityScore || 0) && topic.authorCount > existing.authorCount);
    const primary = prefer ? topic : existing, secondary = prefer ? existing : topic;
    primary.evidenceIds = [...new Set([...(primary.evidenceIds || []), ...(secondary.evidenceIds || [])])].slice(0, 8);
    primary.authorCount = Math.max(primary.authorCount || 0, secondary.authorCount || 0);
    primary.evidenceCount = Math.max(primary.evidenceCount || 0, secondary.evidenceCount || 0, primary.evidenceIds.length);
    primary.platforms = [...new Set([...(primary.platforms || []), ...(secondary.platforms || [])])];
    primary.aliases = [...new Set([...(primary.aliases || []), ...(secondary.aliases || []), secondary.topic].filter((value) => !lowValueTag(value)))].slice(0, 12);
    primary.relatedContexts = primary.relatedContexts?.length ? primary.relatedContexts : (secondary.relatedContexts || []);
    primary.originCandidate = primary.originCandidate || secondary.originCandidate || null;
    if (secondary.tier === 'candidate') primary.tier = 'candidate';
    if (primary.tier === 'candidate' && !promotionEnough(primary)) primary.tier = 'pre-breakout';
    primary.corroborated = primary.tier === 'candidate';
    merged[index] = primary;
  }
  return merged.filter((topic) => validLabel(topic.topic) && !lowValueTag(topic.topic)).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'candidate' ? -1 : 1) || b.score - a.score || b.authorCount - a.authorCount).slice(0, Math.max(0, limit));
}

function snapshotAt(history, target, topic) {
  const eligible = history.filter((snapshot) => snapshot && snapshot.at <= target && Array.isArray(snapshot.topics)).sort((a, b) => b.at - a.at);
  for (const snapshot of eligible) {
    const found = snapshot.topics.find((item) => sameTopicKey(item.key || item.topic, topic.key || topic.topic));
    if (found) return { snapshot, topic: found };
  }
  return null;
}

function windowDelta(topic, history, now, minutes) {
  const found = snapshotAt(history, now - minutes * 60000, topic);
  if (!found) return null;
  const creators = Number(found.topic.authorCount || 0), evidence = Number(found.topic.evidenceCount || 0), platforms = Number(found.topic.platformCount || found.topic.platforms?.length || 0);
  return {
    minutes,
    comparedAt: found.snapshot.at,
    creatorDelta: topic.authorCount - creators,
    evidenceDelta: topic.evidenceCount - evidence,
    platformDelta: topic.platforms.length - platforms,
    creatorGrowthPct: creators > 0 ? Math.round(100 * (topic.authorCount - creators) / creators) : null,
  };
}

export function enrichMomentum(topics, history = [], now = Date.now()) {
  const immediate = [...history].filter((snapshot) => snapshot && snapshot.at < now && Array.isArray(snapshot.topics)).sort((a, b) => b.at - a.at)[0];
  return topics.map((topic) => {
    const previous = immediate?.topics?.find((item) => sameTopicKey(item.key || item.topic, topic.key || topic.topic));
    const creatorDelta = previous ? topic.authorCount - Number(previous.authorCount || 0) : topic.authorCount;
    const evidenceDelta = previous ? topic.evidenceCount - Number(previous.evidenceCount || 0) : topic.evidenceCount;
    const platformDelta = previous ? topic.platforms.length - Number(previous.platformCount || previous.platforms?.length || 0) : topic.platforms.length;
    const creatorGrowthPct = previous && previous.authorCount > 0 ? Math.round(100 * creatorDelta / previous.authorCount) : null;
    const windows = [15, 60, 360, 1440].map((minutes) => windowDelta(topic, history, now, minutes)).filter(Boolean);
    const byMinutes = Object.fromEntries(windows.map((window) => [String(window.minutes), window]));
    const weighted = windows.reduce((sum, window) => {
      const weight = window.minutes === 15 ? 1.4 : window.minutes === 60 ? 1 : window.minutes === 360 ? .55 : .25;
      return sum + weight * (Math.max(0, window.creatorDelta) * 4 + Math.max(0, window.evidenceDelta) * 1.2 + Math.max(0, window.platformDelta) * 3);
    }, 0);
    const newTopic = !previous;
    const crossPlatformBonus = topic.platforms.length > 1 ? 3 : 0;
    const tierBonus = topic.tier === 'candidate' ? 2 : 0;
    const momentumScore = weighted + Math.max(0, creatorDelta) * 2 + crossPlatformBonus + tierBonus + (newTopic ? 1 : 0);
    const hour = byMinutes['60'];
    const fastGrowth = (hour?.creatorDelta || 0) >= 3 || (hour?.creatorGrowthPct != null && hour.creatorGrowthPct >= 100) || creatorDelta >= 2;
    const label = newTopic ? 'New' : fastGrowth ? 'Accelerating' : creatorDelta > 0 || evidenceDelta >= 2 ? 'Rising' : creatorDelta < 0 ? 'Cooling' : 'Steady';
    return { ...topic, momentum: { label, score: Number(momentumScore.toFixed(2)), creatorDelta, evidenceDelta, platformDelta, creatorGrowthPct, newTopic, comparedAt: immediate?.at ?? null, windows: byMinutes } };
  }).sort((a, b) => (b.momentum?.score || 0) - (a.momentum?.score || 0) || (a.tier === b.tier ? 0 : a.tier === 'candidate' ? -1 : 1) || b.score - a.score);
}

export function topicSnapshot(topics, at = Date.now()) {
  return { at, topics: topics.slice(0, 50).map((topic) => ({ key: topic.key, topic: topic.topic, aliases: topic.aliases || [topic.topic], tier: topic.tier || 'candidate', authorCount: topic.authorCount, evidenceCount: topic.evidenceCount, platformCount: topic.platforms?.length || 0, platforms: topic.platforms || [], score: topic.score || 0, originCandidate: topic.originCandidate || null, momentum: topic.momentum || null })) };
}
