const STOP = new Set(('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really new now today tonight yesterday tomorrow have has had do does did can could would should will may might about into over under after before more most some any all one two via amp rt https http com www video videos post posts clip clips meme memes viral trend trends trending people thing things time day get got like know think make made going go went see saw says said say look looks looking why how what when where who which there here fyp foryou tiktok twitter social media').split(' '));
const clean = (value, max = 320) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (value) => clean(value, 2000).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (value) => norm(value).split(' ').filter((word) => word.length >= 3 && !STOP.has(word));
const uniq = (items) => [...new Set(items.filter(Boolean))];

function hash32(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function vectorFor(value, dimensions = 192) {
  const tokens = words(value);
  const vector = new Float64Array(dimensions);
  const features = [];
  for (let i = 0; i < tokens.length; i++) {
    features.push([`w:${tokens[i]}`, 1]);
    if (i < tokens.length - 1) features.push([`b:${tokens[i]}_${tokens[i + 1]}`, 1.35]);
    const token = tokens[i];
    if (token.length >= 5) {
      for (let j = 0; j <= token.length - 3; j++) features.push([`c:${token.slice(j, j + 3)}`, 0.18]);
    }
  }
  for (const [feature, weight] of features) {
    const h = hash32(feature);
    const index = h % dimensions;
    const sign = (h & 0x80000000) ? -1 : 1;
    vector[index] += sign * weight;
  }
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] /= magnitude;
  return vector;
}

function cosine(a, b) {
  let score = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) score += a[i] * b[i];
  return Math.max(-1, Math.min(1, score));
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

export function semanticTextSimilarity(a, b) {
  const left = norm(a), right = norm(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const lv = vectorFor(left), rv = vectorFor(right);
  const embedding = Math.max(0, cosine(lv, rv));
  const edit = 1 - editDistance(left, right) / Math.max(left.length, right.length, 1);
  const leftWords = new Set(words(left)), rightWords = new Set(words(right));
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  const overlapScore = overlap / Math.max(1, Math.min(leftWords.size, rightWords.size));
  const containment = (left.includes(right) || right.includes(left)) && Math.min(left.length, right.length) >= 5 ? 0.92 : 0;
  return Number(Math.max(containment, embedding * 0.72 + Math.max(0, edit) * 0.18 + overlapScore * 0.22).toFixed(4));
}

function evidenceOverlap(a, b) {
  const left = new Set(a?.evidenceIds || []), right = new Set(b?.evidenceIds || []);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((id) => right.has(id)).length;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    if (!Number.isFinite(x)) return Infinity;
    bits += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return bits;
}

export function visualHashSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const distance = hammingHex(a, b);
  if (!Number.isFinite(distance)) return 0;
  return Number((1 - distance / (a.length * 4)).toFixed(4));
}

function topicEvidence(topic, byId) {
  return (topic?.evidenceIds || []).map((id) => byId.get(id)).filter(Boolean);
}

function topicSignals(topic, byId) {
  const rows = topicEvidence(topic, byId);
  return {
    sounds: new Set(rows.map((row) => row.soundId).filter(Boolean)),
    visuals: rows.map((row) => row.visualHash).filter(Boolean),
    outbound: new Set(rows.flatMap((row) => Array.isArray(row.outboundUrls) ? row.outboundUrls : []).filter(Boolean)),
    parents: new Set(rows.flatMap((row) => [row.quotedUrl, row.relatedVideoId].filter(Boolean))),
    authors: new Set(rows.map((row) => `${row.platform}:${String(row.author || '').toLowerCase()}`)),
  };
}

function sharedSet(left, right) {
  return [...left].some((value) => right.has(value));
}

function sharedVisual(left, right) {
  for (const a of left) for (const b of right) if (visualHashSimilarity(a, b) >= 0.86) return true;
  return false;
}

function labelsFor(topic) {
  return uniq([topic?.topic, topic?.key, ...(topic?.aliases || [])]).slice(0, 20);
}

function bestSemantic(a, b) {
  let best = 0;
  for (const left of labelsFor(a)) for (const right of labelsFor(b)) best = Math.max(best, semanticTextSimilarity(left, right));
  return best;
}

function mergeTopicInto(target, source) {
  const preferred = (source.score || 0) > (target.score || 0) ? source.topic : target.topic;
  target.topic = preferred;
  target.key = norm(preferred) || target.key || source.key;
  target.aliases = uniq([...(target.aliases || []), target.topic, source.topic, ...(source.aliases || [])]).slice(0, 24);
  target.evidenceIds = uniq([...(target.evidenceIds || []), ...(source.evidenceIds || [])]);
  target.platforms = uniq([...(target.platforms || []), ...(source.platforms || [])]);
  target.soundIds = uniq([...(target.soundIds || []), ...(source.soundIds || [])]).slice(0, 16);
  target.visualHashes = uniq([...(target.visualHashes || []), ...(source.visualHashes || [])]).slice(0, 16);
  target.soundSignals = [...(target.soundSignals || []), ...(source.soundSignals || [])].sort((a, b) => (b.creators || 0) - (a.creators || 0)).slice(0, 8);
  target.visualSignals = [...(target.visualSignals || []), ...(source.visualSignals || [])].sort((a, b) => (b.creators || 0) - (a.creators || 0)).slice(0, 8);
  target.evidenceCount = target.evidenceIds.length || Math.max(target.evidenceCount || 0, source.evidenceCount || 0);
  target.authorCount = Math.max(target.authorCount || 0, source.authorCount || 0);
  target.score = Math.max(target.score || 0, source.score || 0);
  target.specificityScore = Math.max(target.specificityScore || 0, source.specificityScore || 0);
  target.corroborated = Boolean(target.corroborated || source.corroborated);
  target.semanticMerged = true;
  return target;
}

export function semanticConsolidateTopics(topics = [], evidence = []) {
  const byId = new Map(evidence.map((row) => [row.id, row]));
  const groups = [];
  for (const raw of topics) {
    const topic = { ...raw, aliases: uniq([raw.topic, ...(raw.aliases || [])]) };
    const signals = topicSignals(topic, byId);
    let match = null;
    let matchScore = 0;
    let matchReason = '';
    for (const group of groups) {
      const semantic = bestSemantic(group, topic);
      const overlap = evidenceOverlap(group, topic);
      const groupSignals = topicSignals(group, byId);
      const strongSignal = sharedSet(signals.sounds, groupSignals.sounds)
        || sharedVisual(signals.visuals, groupSignals.visuals)
        || sharedSet(signals.outbound, groupSignals.outbound)
        || sharedSet(signals.parents, groupSignals.parents);
      const score = Math.max(
        semantic,
        overlap >= 0.35 ? 0.88 + Math.min(0.1, overlap * 0.1) : 0,
        strongSignal && semantic >= 0.18 ? 0.84 + semantic * 0.1 : 0,
      );
      const acceptable = semantic >= 0.82 || overlap >= 0.35 || (strongSignal && semantic >= 0.18);
      if (acceptable && score > matchScore) {
        match = group;
        matchScore = score;
        matchReason = overlap >= 0.35 ? 'shared-evidence' : strongSignal ? 'shared-media-context' : 'semantic-vector';
      }
    }
    if (!match) {
      groups.push(topic);
      continue;
    }
    mergeTopicInto(match, topic);
    match.semanticMergeScore = Number(matchScore.toFixed(4));
    match.semanticMergeReason = matchReason;
  }
  return groups.sort((a, b) => (b.score || 0) - (a.score || 0));
}

export function attachVisualSignals(topics = [], evidence = []) {
  const rows = evidence.filter((row) => row.visualHash);
  return topics.map((topic) => {
    const evidenceIds = new Set(topic.evidenceIds || []);
    const own = rows.filter((row) => evidenceIds.has(row.id));
    const clusters = [];
    for (const row of own) {
      let cluster = clusters.find((item) => visualHashSimilarity(item.hash, row.visualHash) >= 0.86);
      if (!cluster) {
        cluster = { hash: row.visualHash, creators: new Set(), ids: new Set(), platforms: new Set() };
        clusters.push(cluster);
      }
      cluster.creators.add(`${row.platform}:${String(row.author || '').toLowerCase()}`);
      cluster.ids.add(row.id);
      cluster.platforms.add(row.platform);
    }
    const visualSignals = clusters
      .filter((cluster) => cluster.creators.size >= 2)
      .map((cluster) => ({ hash: cluster.hash, creators: cluster.creators.size, overlap: cluster.ids.size, platforms: [...cluster.platforms] }))
      .sort((a, b) => b.creators - a.creators || b.overlap - a.overlap)
      .slice(0, 6);
    return { ...topic, visualHashes: uniq(own.map((row) => row.visualHash)).slice(0, 16), visualSignals };
  });
}

function topicMatchesEvidence(topic, row) {
  const aliases = labelsFor(topic);
  const text = clean(row.content, 4000);
  const normalizedText = ` ${norm(text)} `;
  for (const alias of aliases) {
    const normalizedAlias = norm(alias);
    if (normalizedAlias && normalizedText.includes(` ${normalizedAlias} `)) return true;
    if (semanticTextSimilarity(alias, text) >= 0.58) return true;
  }
  return false;
}

export function attachOriginResearch(topics = [], evidence = [], now = Date.now()) {
  return topics.map((topic) => {
    const candidates = evidence
      .filter((row) => Number.isFinite(row.published) && row.published > 0 && (topicMatchesEvidence(topic, row) || (topic.evidenceIds || []).includes(row.id)))
      .sort((a, b) => a.published - b.published);
    if (!candidates.length) return topic;
    const first = candidates[0];
    const originRows = candidates.filter((row) => /origin research/i.test(row.provenance || ''));
    const platforms = new Set(candidates.map((row) => row.platform));
    const parentSignals = candidates.filter((row) => row.quotedUrl || row.relatedVideoId).length;
    const confidence = originRows.length >= 6 && platforms.size > 1 ? 'high' : originRows.length >= 3 || candidates.length >= 5 ? 'medium' : 'low';
    return {
      ...topic,
      originCandidate: {
        url: first.url,
        published: first.published,
        author: first.author,
        platform: first.platform,
        ageMinutes: Math.max(0, Math.round((now - first.published) / 60000)),
        confidence,
        absolute: false,
        evidenceCount: candidates.length,
        targetedOriginRows: originRows.length,
        parentSignals,
        method: `Earliest dated supporting post found after targeted alias, ancestry, and deep-scroll origin research across ${platforms.size} platform${platforms.size === 1 ? '' : 's'}. This is Front's earliest verified find, not an absolute-internet-origin guarantee.`,
      },
    };
  });
}

export function shouldAutoDeep(topics = [], audit = {}, now = Date.now()) {
  const candidates = topics.slice(0, 8);
  for (const topic of candidates) {
    const creators = Number(topic.authorCount || 0);
    const platforms = Array.isArray(topic.platforms) ? topic.platforms.length : 0;
    const score = Number(topic.score || 0);
    const velocity = Number(topic.feedPenetrationVelocity || 0);
    const accelerating = topic.momentum?.label === 'Accelerating';
    const soundCreators = Math.max(0, ...(topic.soundSignals || []).map((signal) => Number(signal.creators || 0)));
    const visualCreators = Math.max(0, ...(topic.visualSignals || []).map((signal) => Number(signal.creators || 0)));
    const reasons = [];
    if (platforms >= 2 && creators >= 3 && score >= 12) reasons.push('cross-platform corroboration');
    if (velocity >= 0.75 && creators >= 2) reasons.push(`For You penetration +${velocity.toFixed(2)} pts/hr`);
    if (accelerating && creators >= 3) reasons.push('creator/evidence acceleration');
    if (soundCreators >= 3) reasons.push(`${soundCreators} creators repeating one TikTok sound`);
    if (visualCreators >= 3) reasons.push(`${visualCreators} creators repeating one visual template`);
    if (reasons.length) return { trigger: true, topic: topic.topic || topic.key, key: norm(topic.key || topic.topic), reasons, at: now, strength: Math.min(1, 0.25 + reasons.length * 0.2 + Math.min(0.35, creators / 20)) };
  }
  if ((audit?.risingFeedTopics || 0) >= 2 && (audit?.uniqueCreators || 0) >= 8) return { trigger: true, topic: null, key: 'multi-topic-rise', reasons: ['multiple topics gaining recommendation-feed share'], at: now, strength: 0.6 };
  return { trigger: false, topic: null, key: null, reasons: [], at: now, strength: 0 };
}
