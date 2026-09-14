const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalize = (value) => clean(value, 400).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (value) => normalize(value).split(' ').filter(Boolean);
const creatorKey = (row) => String(row?.author || '').replace(/^@/, '').trim().toLowerCase();
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));
const STOP = new Set('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really have has had do does did can could would should will may might about into over under after before more most some any all one two what when where who why how'.split(/\s+/));
const GENERIC = new Set('face faces take takes took taking grow grows growing grown love loves loved loving look looks looking looked make makes making made get gets getting got use uses using used good bad big small new old today tonight now thing things stuff something anything everything people person guy guys girl girls man men woman women bro dude video videos post posts clip clips live stream streams viral trend trends trending meme memes funny reaction reactions update updates news breaking official original sound audio photo photos image images tiktok twitter x fyp foryou crypto solana coin coins token tokens market markets pump pumpfun'.split(/\s+/));

export function isGenericNarrativeLabel(value) {
  const parts = words(value);
  if (!parts.length) return true;
  const meaningful = parts.filter((word) => word.length >= 3 && !STOP.has(word) && !GENERIC.has(word) && !/^\d+$/.test(word));
  if (parts.length === 1) return meaningful.length === 0;
  return meaningful.length < Math.min(2, Math.ceil(parts.length / 3));
}

function supportRows(topic, evidence) {
  const ids = new Set(Array.isArray(topic?.evidenceIds) ? topic.evidenceIds : []);
  if (ids.size) {
    const linked = evidence.filter((row) => ids.has(row?.id));
    if (linked.length) return linked;
  }
  const key = normalize(topic?.semanticNarrativeKey || topic?.key || topic?.topic || '');
  if (!key) return [];
  return evidence.filter((row) => normalize(row?.semanticNarrativeKey || '') === key);
}

function titleCase(value) {
  return clean(value, 100).split(' ').map((word) => {
    if (!word) return word;
    if (/^[A-Z0-9$]{2,}$/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

export function chooseNarrativeTitle(topic, rows = []) {
  const semantic = rows.map((row) => clean(row?.postSubject, 120)).filter((value) => value && !isGenericNarrativeLabel(value));
  const candidates = [...semantic, topic?.narrativeTitle, topic?.topic, ...(Array.isArray(topic?.aliases) ? topic.aliases : []), topic?.key]
    .map((value) => clean(value, 120)).filter((value) => value && !isGenericNarrativeLabel(value));
  if (!candidates.length) return null;
  const scored = [...new Set(candidates)].map((label) => {
    const support = rows.filter((row) => normalize(row?.postSubject || row?.postEvent || '').includes(normalize(label)) || normalize(label).includes(normalize(row?.postSubject || row?.postEvent || ''))).length;
    const specificity = words(label).filter((word) => !STOP.has(word) && !GENERIC.has(word)).length;
    const shape = words(label).length >= 2 && words(label).length <= 8 ? 8 : 0;
    return { label, score: support * 10 + specificity * 3 + shape };
  }).sort((a, b) => b.score - a.score || b.label.length - a.label.length);
  return titleCase(scored[0].label);
}

function rowTime(row) {
  for (const value of [row?.published, row?.firstObserved, row?.lastObserved]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function rate(value, at, now) {
  const n = Number(value), t = Number(at);
  if (!Number.isFinite(n) || n < 0 || !Number.isFinite(t) || t <= 0) return 0;
  return n / Math.max(1, (now - t) / 60000);
}

export function measureNarrativeVelocity(topic, rows = [], now = Date.now()) {
  const creators = new Set(rows.map(creatorKey)).size;
  const platforms = new Set(rows.map((row) => row?.platform).filter(Boolean)).size;
  const times = rows.map(rowTime).filter(Number.isFinite).sort((a, b) => a - b);
  const earliestAt = times[0] || null;
  const latestAt = times[times.length - 1] || earliestAt;
  const ageMinutes = earliestAt ? Math.max(0, (now - earliestAt) / 60000) : null;
  const spanHours = earliestAt && latestAt ? Math.max(0.25, (latestAt - earliestAt) / 3600000) : 1;
  const creatorSpreadPerHour = creators / spanHours;
  const viewsPerMinute = Math.max(Number(topic?.maxViewsPerHour || 0) / 60, ...rows.map((row) => rate(row?.views, row?.published || row?.firstObserved, now)), 0);
  const likesPerMinute = Math.max(...rows.map((row) => rate(row?.likes, row?.published || row?.firstObserved, now)), 0);
  const observations = rows.map(row => Number(row.firstObserved)).filter(t => Number.isFinite(t) && t > 0);
  const firstObservedAt = observations.length ? Math.min(...observations) : null;
  const currentPublications = rows.map(row => Number(row.published)).filter(t => Number.isFinite(t) && t > 0 && t <= now && now - t <= 72 * 3600000);
  const breakoutWindowStart = currentPublications.length ? Math.min(...currentPublications) : null;
  const breakoutWindowEnd = currentPublications.length ? Math.max(...currentPublications) : null;
  const breakoutAgeMinutes = breakoutWindowStart ? (now - breakoutWindowStart) / 60000 : null;
  const recencyAge = breakoutAgeMinutes ?? ageMinutes;
  const recency = recencyAge == null ? 8 : recencyAge <= 30 ? 20 : recencyAge <= 120 ? 17 : recencyAge <= 360 ? 12 : recencyAge <= 1440 ? 7 : 2;
  const engagement = Math.min(25, Math.log10(1 + viewsPerMinute) * 7 + Math.log10(1 + likesPerMinute) * 4);
  const spread = Math.min(25, creators * 3 + Math.log10(1 + creatorSpreadPerHour) * 8);
  const crossPlatform = platforms >= 2 ? 15 : 0;
  const repetition = Math.min(15, rows.length * 1.5);
  const score = clamp(recency + engagement + spread + crossPlatform + repetition);
  return { score: Number(score.toFixed(1)), label: score >= 85 ? 'explosive' : score >= 65 ? 'fast' : score >= 45 ? 'building' : score >= 25 ? 'emerging' : 'slow', viewsPerMinute: Number(viewsPerMinute.toFixed(2)), likesPerMinute: Number(likesPerMinute.toFixed(2)), creatorSpreadPerHour: Number(creatorSpreadPerHour.toFixed(2)), creators, platforms, earliestAt, latestAt, firstObservedAt, breakoutWindowStart, breakoutWindowEnd, breakoutAgeMinutes, ageMinutes: ageMinutes == null ? null : Number(ageMinutes.toFixed(1)) };
}

export function lifecycleForNarrative(topic, velocity) {
  const score = Number(velocity?.score || 0), creators = Number(velocity?.creators || 0), age = velocity?.breakoutAgeMinutes ?? velocity?.ageMinutes;
  if (age != null && age > 72 * 60) return score >= 65 ? 'VIRAL' : 'SATURATED';
  if (age != null && age > 24 * 60 && score < 45) return 'SATURATED';
  if (score >= 82 && creators >= 5) return 'VIRAL';
  if (score >= 55 && creators >= 3) return 'EARLY BREAKOUT';
  if (creators >= 2 || score >= 30) return 'EMERGING';
  return 'SEED';
}

function originConfidence(rows, velocity) {
  let score = rows.length ? 35 : 0;
  const published = rows.filter((row) => Number.isFinite(Number(row?.published)) && Number(row.published) > 0).length;
  if (published) score += 20;
  if (published >= 2) score += 10;
  if (Number(velocity?.platforms || 0) >= 2) score += 10;
  if (Number(velocity?.creators || 0) >= 3) score += 10;
  if (rows.length >= 5) score += 8;
  return Math.round(clamp(score, 0, 95));
}

export function classifyCoinOpportunity(topic) {
  const matches = [topic?.coinMatches, topic?.matchedCoins, topic?.coins].find(Array.isArray) || [];
  const direct = topic?.pumpFunUrl || topic?.coinCreatedAt || topic?.matchedMint || topic?.mint;
  const created = Boolean(matches.length || direct), first = matches[0] || {};
  return { status: created ? 'COIN-CREATED' : 'PRE-COIN', verifiedMatchCount: matches.length + (direct && !matches.length ? 1 : 0), matchedMint: clean(first?.mint || topic?.matchedMint || topic?.mint, 120) || null, createdAt: Number(first?.createdAt || first?.seen || topic?.coinCreatedAt || 0) || null, basis: created ? 'verified-match-attached' : 'no-verified-match-attached' };
}

export function deriveSemanticNarrativesV26(evidence = [], now = Date.now()) {
  const buckets = new Map();
  for (const row of evidence) {
    const key = normalize(row?.semanticNarrativeKey || '');
    const subject = clean(row?.postSubject, 140);
    const confidence = Number(row?.postUnderstandingConfidence || 0);
    if (!creatorKey(row) || !key || confidence < 0.5 || !subject || isGenericNarrativeLabel(subject)) continue;
    const bucket = buckets.get(key) || { key, rows: [], subjects: new Map(), creators: new Set(), platforms: new Set() };
    bucket.rows.push(row); bucket.creators.add(creatorKey(row)); bucket.platforms.add(row.platform);
    bucket.subjects.set(subject, (bucket.subjects.get(subject) || 0) + 1);
    buckets.set(key, bucket);
  }
  const topics = [];
  for (const bucket of buckets.values()) {
    if (bucket.creators.size < 2 || bucket.rows.length < 2) continue;
    const title = [...bucket.subjects.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
    if (!title || isGenericNarrativeLabel(title)) continue;
    const velocity = measureNarrativeVelocity({}, bucket.rows, now);
    const topic = {
      topic: titleCase(title), key: bucket.key, semanticNarrativeKey: bucket.key, aliases: [...bucket.subjects.keys()].slice(0, 12),
      tier: bucket.creators.size >= 3 ? 'candidate' : 'pre-breakout', corroborated: bucket.creators.size >= 3,
      evidenceCount: bucket.rows.length, authorCount: bucket.creators.size, platforms: [...bucket.platforms], evidenceIds: bucket.rows.map((row) => row.id),
      score: Number((velocity.score + bucket.creators.size * 3 + bucket.platforms.size * 4).toFixed(2)), detector: 'semantic-subject-v26', labelPolicy: 'context-first-subject-event',
    };
    topics.push(topic);
  }
  return topics.sort((a, b) => b.score - a.score || b.authorCount - a.authorCount);
}

const LIFECYCLE_RANK = { 'EARLY BREAKOUT': 5, VIRAL: 4, EMERGING: 3, SEED: 2, SATURATED: 1, DECLINING: 0 };
export function enhanceNarrativesV26(topics = [], evidence = [], now = Date.now()) {
  // Legacy lexical candidates may contribute metadata only after semantic
  // corroboration; they must never bypass the subject/key/confidence gate.
  const merged = deriveSemanticNarrativesV26(evidence, now).map(semantic => {
    const prior = topics.find(topic => normalize(topic.semanticNarrativeKey || topic.key) === semantic.key);
    return {...prior, ...semantic};
  });
  const deduped = new Map();
  for (const topic of merged) {
    const rows = supportRows(topic, evidence);
    const narrativeTitle = chooseNarrativeTitle(topic, rows);
    if (!narrativeTitle) continue;
    const key = normalize(topic?.semanticNarrativeKey || topic?.key || narrativeTitle);
    if (!key || isGenericNarrativeLabel(narrativeTitle)) continue;
    const velocity = measureNarrativeVelocity(topic, rows, now);
    const lifecycleStage = lifecycleForNarrative(topic, velocity);
    const opportunity = classifyCoinOpportunity(topic);
    const enriched = { ...topic, narrativeTitle, topic: narrativeTitle, key, intelligenceVersion: 26, firstObservedAt: velocity.firstObservedAt, breakoutWindowStart: velocity.breakoutWindowStart, breakoutWindowEnd: velocity.breakoutWindowEnd, firstEvidenceAt: velocity.earliestAt, latestEvidenceAt: velocity.latestAt, ageMinutes: velocity.ageMinutes, originConfidence: originConfidence(rows, velocity), velocity, velocityScore: velocity.score, lifecycleStage, opportunityStatus: opportunity.status, coinOpportunity: opportunity };
    const prior = deduped.get(key);
    if (!prior || Number(enriched.score || 0) > Number(prior.score || 0) || Number(enriched.evidenceCount || 0) > Number(prior.evidenceCount || 0)) deduped.set(key, enriched);
  }
  return [...deduped.values()].sort((a, b) => (LIFECYCLE_RANK[b.lifecycleStage] || 0) - (LIFECYCLE_RANK[a.lifecycleStage] || 0) || Number(b.velocityScore || 0) - Number(a.velocityScore || 0) || Number(b.score || 0) - Number(a.score || 0));
}
