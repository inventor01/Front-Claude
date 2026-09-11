import {
  attachOriginResearch as baseAttachOriginResearch,
  attachVisualSignals as baseAttachVisualSignals,
  semanticConsolidateTopics as baseSemanticConsolidateTopics,
  semanticTextSimilarity,
  shouldAutoDeep as baseShouldAutoDeep,
  visualHashSimilarity,
} from './advanced-intelligence-base.mjs';

export { semanticTextSimilarity, visualHashSimilarity };

const norm = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const creatorKey = (row) => `${row.platform}:${String(row.author || '').toLowerCase()}`;
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function postRate(row, now = Date.now()) {
  const views = finite(row.views);
  const likes = finite(row.likes) || 0;
  const reposts = finite(row.reposts) || 0;
  const replies = finite(row.replies) || 0;
  const quotes = finite(row.quotes) || 0;
  const comments = finite(row.comments) || 0;
  const shares = finite(row.shares) || 0;
  const saves = finite(row.saves) || 0;
  const published = finite(row.published);
  const ageHours = published && published > 0 ? Math.max(1 / 60, (now - published) / 3600000) : null;
  const viewsPerHour = views != null && ageHours != null ? views / ageHours : null;
  const weightedEngagement = likes + reposts * 2.2 + quotes * 2.4 + replies * 1.15 + comments * 1.15 + shares * 2.4 + saves * 1.5;
  const engagementPerHour = ageHours != null ? weightedEngagement / ageHours : null;
  const viewEngagementRate = views && views > 0 ? weightedEngagement / views : null;
  const explosive = Boolean(ageHours != null && ((views != null && views >= 100000 && ageHours <= 6) || (viewsPerHour != null && viewsPerHour >= 100000)));
  const hot = Boolean(explosive || (ageHours != null && views != null && views >= 50000 && ageHours <= 3) || (viewsPerHour != null && viewsPerHour >= 25000));
  let velocityScore = 0;
  if (viewsPerHour != null) velocityScore += Math.min(28, Math.log10(1 + viewsPerHour) * 5.2);
  if (views != null) velocityScore += Math.min(12, Math.log10(1 + views) * 1.7);
  if (engagementPerHour != null) velocityScore += Math.min(10, Math.log10(1 + engagementPerHour) * 2.2);
  if (explosive) velocityScore += 18; else if (hot) velocityScore += 9;
  return {
    id: row.id,
    platform: row.platform,
    author: row.author,
    url: row.url,
    published: published || null,
    views,
    likes: finite(row.likes),
    ageHours: ageHours == null ? null : Number(ageHours.toFixed(3)),
    viewsPerHour: viewsPerHour == null ? null : Math.round(viewsPerHour),
    engagementPerHour: engagementPerHour == null ? null : Math.round(engagementPerHour),
    engagementRate: viewEngagementRate == null ? null : Number((viewEngagementRate * 100).toFixed(2)),
    explosive,
    hot,
    velocityScore: Number(velocityScore.toFixed(2)),
  };
}

function wordSet(value) {
  return new Set(norm(value).split(' ').filter((word) => word.length >= 3));
}
function textSimilarity(a, b) {
  const left = wordSet(a), right = wordSet(b);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(1, Math.min(left.size, right.size));
}
function sharedUrl(a, b) {
  const left = new Set(Array.isArray(a.outboundUrls) ? a.outboundUrls : []);
  return (Array.isArray(b.outboundUrls) ? b.outboundUrls : []).some((url) => left.has(url));
}
function likelyCrossPost(a, b) {
  if (creatorKey(a) === creatorKey(b)) return false;
  if (a.soundId && a.soundId === b.soundId) return true;
  if (a.visualHash && b.visualHash && visualHashSimilarity(a.visualHash, b.visualHash) >= 0.86) return true;
  if (a.quotedUrl && b.quotedUrl && a.quotedUrl === b.quotedUrl) return true;
  if (a.relatedVideoId && b.relatedVideoId && a.relatedVideoId === b.relatedVideoId) return true;
  if (sharedUrl(a, b)) return true;
  const similarity = textSimilarity(a.content, b.content);
  return similarity >= 0.72 || semanticTextSimilarity(a.content, b.content) >= 0.78;
}

function attachPostPriority(topics = [], evidence = [], now = Date.now()) {
  const byId = new Map(evidence.map((row) => [row.id, row]));
  return topics.map((topic) => {
    const rows = (topic.evidenceIds || []).map((id) => byId.get(id)).filter(Boolean);
    const rates = rows.map((row) => postRate(row, now));
    const hotPosts = rates.filter((row) => row.hot).sort((a, b) => b.velocityScore - a.velocityScore || (b.views || 0) - (a.views || 0)).slice(0, 6);
    const maxViewsPerHour = Math.max(0, ...rates.map((row) => row.viewsPerHour || 0));
    const maxViews = Math.max(0, ...rates.map((row) => row.views || 0));
    const crossPosted = new Set();
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (!likelyCrossPost(rows[i], rows[j])) continue;
        crossPosted.add(creatorKey(rows[i]));
        crossPosted.add(creatorKey(rows[j]));
      }
    }
    const crossPostedCreators = crossPosted.size;
    const sameEventCrossPlatform = Boolean(topic.crossPlatform?.corroborated);
    const authorCount = Number(topic.authorCount || new Set(rows.map(creatorKey)).size || 0);
    const baseNarrativeScore = Number(topic.baseNarrativeScore ?? topic.score ?? 0);
    let priorityScore = baseNarrativeScore;
    priorityScore += Math.min(42, hotPosts.reduce((sum, row) => sum + Math.min(20, row.velocityScore * .55), 0));
    priorityScore += Math.min(18, Math.log10(1 + maxViewsPerHour) * 3.2);
    priorityScore += Math.min(12, crossPostedCreators * 2.5);
    priorityScore += sameEventCrossPlatform ? 10 : 0;
    priorityScore += Math.min(10, authorCount * 1.4);
    if (hotPosts.some((row) => row.explosive)) priorityScore += 16;
    const priorityReasons = [];
    if (hotPosts.some((row) => row.explosive)) priorityReasons.push('100K+ fast post');
    else if (hotPosts.length) priorityReasons.push('fast engagement');
    if (crossPostedCreators >= 2) priorityReasons.push(`${crossPostedCreators} cross-post creators`);
    if (sameEventCrossPlatform) priorityReasons.push('X ↔ TikTok same event');
    if (maxViewsPerHour >= 100000) priorityReasons.push(`${Math.round(maxViewsPerHour / 1000)}K views/hr`);
    return {
      ...topic,
      baseNarrativeScore,
      score: Number((baseNarrativeScore + Math.min(36, Math.max(0, priorityScore - baseNarrativeScore) * .42)).toFixed(2)),
      priorityScore: Number(priorityScore.toFixed(2)),
      priorityReasons,
      hotPosts,
      maxViewsPerHour: Math.round(maxViewsPerHour),
      maxViews: Math.round(maxViews),
      crossPostedCreators,
      postsAnalyzed: rows.length,
    };
  }).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || (b.score || 0) - (a.score || 0));
}

export function attachVisualSignals(topics = [], evidence = [], now = Date.now()) {
  return attachPostPriority(baseAttachVisualSignals(topics, evidence), evidence, now);
}

export function semanticConsolidateTopics(topics = [], evidence = [], now = Date.now()) {
  return attachPostPriority(baseSemanticConsolidateTopics(topics, evidence), evidence, now);
}

export function attachOriginResearch(topics = [], evidence = [], now = Date.now()) {
  return baseAttachOriginResearch(topics, evidence, now);
}

export function shouldAutoDeep(topics = [], audit = {}, now = Date.now()) {
  for (const topic of topics.slice(0, 8)) {
    const creators = Number(topic.authorCount || 0);
    const hotPosts = Array.isArray(topic.hotPosts) ? topic.hotPosts : [];
    const explosive = hotPosts.find((post) => post.explosive || (Number(post.views || 0) >= 100000 && Number(post.ageHours || 99) <= 6));
    const fast = Number(topic.maxViewsPerHour || 0) >= 50000;
    const crossPostedCreators = Number(topic.crossPostedCreators || 0);
    if (creators >= 2 && (explosive || (fast && crossPostedCreators >= 2))) {
      const reasons = [];
      if (explosive) reasons.push(`${Math.round(Number(explosive.views || 0) / 1000)}K views in ${Number(explosive.ageHours || 0).toFixed(1)}h`);
      if (fast) reasons.push(`${Math.round(Number(topic.maxViewsPerHour || 0) / 1000)}K views/hr`);
      if (crossPostedCreators >= 2) reasons.push(`${crossPostedCreators} creators cross-posting related media/text`);
      return { trigger: true, topic: topic.topic || topic.key, key: norm(topic.key || topic.topic), reasons, at: now, strength: Math.min(1, .62 + reasons.length * .11) };
    }
  }
  // The legacy deep-escalation engine used raw platform count as a shortcut for
  // corroboration. Strip that shortcut unless v13 has verified that X and
  // TikTok are discussing the same event.
  const safeTopics = topics.map((topic) => topic.crossPlatform?.corroborated ? topic : { ...topic, platforms: (topic.platforms || []).slice(0, 1) });
  return baseShouldAutoDeep(safeTopics, audit, now);
}
