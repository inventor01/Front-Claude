const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalize = (value) => clean(value, 400).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}$#@]+/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (value) => normalize(value).split(' ').filter(Boolean);
const creatorKey = (row) => normalize(String(row?.author || '').replace(/^@/, ''));
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const STOP = new Set('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really have has had do does did can could would should will may might about into over under after before more most some any all one two what when where who why how'.split(/\s+/));
const GENERIC = new Set('viral trend trends trending video videos post posts clip clips meme memes reaction reactions funny update updates news breaking official original sound audio photo photos image images tiktok twitter x fyp foryou people person guy guys girl girls man men woman women thing things stuff something anything everything crypto solana coin coins token tokens market markets pump pumpfun'.split(/\s+/));
const EVENT_WORDS = new Set('react reacts reacting reacted remix remixes remixed remixing spread spreads spreading reuse reuses reused reusing turns turned turning becomes became become jokes joking dance dancing sings singing says saying said shows showing showed celebrates celebrating mocks mocking parodies parodying launches launched announcing announced reveals revealed wins won loses lost scores scored performs performed arrested charged resigns resigned apologizes apologized'.split(/\s+/));
const PLATFORM_LABELS = new Map([['x', 'X'], ['twitter', 'X'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['instagram', 'Instagram'], ['reddit', 'Reddit']]);

function meaningfulTokens(value) {
  return tokens(value).filter((word) => word.length >= 2 && !STOP.has(word) && !GENERIC.has(word) && !/^\d+$/.test(word));
}

function isSpecificSubject(value) {
  const all = tokens(value);
  if (!all.length) return false;
  const meaningful = meaningfulTokens(value);
  if (meaningful.length >= 2) return true;
  if (meaningful.length === 1 && all.length <= 3 && meaningful[0].length >= 4) return true;
  return false;
}

function isUsefulEvent(value) {
  const all = tokens(value);
  if (!all.length) return false;
  const meaningful = meaningfulTokens(value);
  if (meaningful.length >= 2) return true;
  return all.some((word) => EVENT_WORDS.has(word)) && all.length >= 2;
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

function tokenEquivalent(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return editDistanceAtMostOne(a, b);
}

function phraseSimilarity(a, b) {
  const left = meaningfulTokens(a);
  const right = meaningfulTokens(b);
  if (!left.length || !right.length) return 0;
  let shared = 0;
  const used = new Set();
  for (const word of left) {
    const index = right.findIndex((candidate, idx) => !used.has(idx) && tokenEquivalent(word, candidate));
    if (index >= 0) { shared++; used.add(index); }
  }
  const overlap = shared / Math.max(1, Math.min(left.length, right.length));
  if (normalize(a) === normalize(b)) return 1;
  if (normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a))) return Math.max(overlap, 0.9);
  return overlap;
}

function titleCase(value) {
  return clean(value, 140).split(/\s+/).map((word) => {
    if (!word) return word;
    if (/^(x|tiktok|youtube|instagram|reddit)$/i.test(word)) return PLATFORM_LABELS.get(word.toLowerCase()) || word;
    if (/^[A-Z0-9$]{2,}$/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function groupPhrases(rows, field, predicate) {
  const groups = [];
  for (const row of rows) {
    const label = clean(row?.[field], 180);
    if (!label || !predicate(label)) continue;
    let group = groups.find((item) => phraseSimilarity(item.label, label) >= 0.78);
    if (!group) {
      group = { label, rows: [], creators: new Set(), platforms: new Set(), weight: 0, confidenceTotal: 0 };
      groups.push(group);
    }
    group.rows.push(row);
    const creator = creatorKey(row);
    if (creator) group.creators.add(creator);
    if (row?.platform) group.platforms.add(String(row.platform));
    const confidence = clamp01(row?.postUnderstandingConfidence || 0.5);
    group.weight += 0.5 + confidence;
    group.confidenceTotal += confidence;
    if (label.length > group.label.length && phraseSimilarity(group.label, label) >= 0.9) group.label = label;
  }
  const eligibleRows = rows.filter((row) => creatorKey(row));
  const totalCreators = new Set(eligibleRows.map(creatorKey)).size;
  for (const group of groups) {
    group.creatorRatio = totalCreators ? group.creators.size / totalCreators : 0;
    group.rowRatio = eligibleRows.length ? group.rows.length / eligibleRows.length : 0;
    group.modelConfidence = group.rows.length ? group.confidenceTotal / group.rows.length : 0;
    group.score = group.creatorRatio * 0.5 + group.rowRatio * 0.25 + group.modelConfidence * 0.25;
  }
  return groups.sort((a, b) => b.score - a.score || b.creators.size - a.creators.size || b.rows.length - a.rows.length || b.label.length - a.label.length);
}

function supportedPlatforms(rows) {
  const byPlatform = new Map();
  for (const row of rows) {
    const platform = String(row?.platform || '').trim();
    const creator = creatorKey(row);
    if (!platform || !creator) continue;
    const key = platform.toLowerCase();
    if (!byPlatform.has(key)) byPlatform.set(key, new Set());
    byPlatform.get(key).add(creator);
  }
  return [...byPlatform.entries()].filter(([, creators]) => creators.size >= 1).map(([key]) => PLATFORM_LABELS.get(key) || titleCase(key));
}

function independentEvidence(group) {
  return {
    evidenceIds: [...new Set(group?.rows?.map((row) => row?.id).filter(Boolean) || [])].slice(0, 24),
    creators: [...(group?.creators || [])].slice(0, 16),
    platforms: [...(group?.platforms || [])].slice(0, 8),
  };
}

function stripSubjectFromEvent(subject, event) {
  const subjectWords = new Set(tokens(subject));
  const eventWords = clean(event, 180).split(/\s+/).filter(Boolean);
  const remaining = eventWords.filter((word) => !subjectWords.has(normalize(word)));
  const phrase = remaining.join(' ').replace(/^[-–—:;,.]+|[-–—:;,.]+$/g, '').trim();
  return clean(phrase || event, 120);
}

function candidateScore({ claimConfidence, specificity, clarity, crossPostAgreement, brevity, crossPlatformBonus = 0 }) {
  return Number((claimConfidence * 40 + specificity * 20 + clarity * 10 + crossPostAgreement * 20 + brevity * 10 + crossPlatformBonus).toFixed(2));
}

export function buildNarrativeTitleIntelligenceV28(topic = {}, rows = []) {
  const validRows = rows.filter((row) => creatorKey(row) && Number(row?.postUnderstandingConfidence || 0) >= 0.4);
  const creators = new Set(validRows.map(creatorKey));
  if (validRows.length < 2 || creators.size < 2) return null;

  const subjects = groupPhrases(validRows, 'postSubject', isSpecificSubject);
  const events = groupPhrases(validRows, 'postEvent', isUsefulEvent);
  const subject = subjects[0];
  if (!subject || subject.creators.size < 2) return null;

  const runnerUp = subjects[1];
  const contradictionRatio = runnerUp && subject.creators.size === runnerUp.creators.size
    ? Math.min(1, runnerUp.score / Math.max(0.01, subject.score))
    : runnerUp ? Math.min(1, runnerUp.score / Math.max(0.01, subject.score)) : 0;
  const subjectConfidence = clamp01(subject.score * (contradictionRatio >= 0.82 ? 0.62 : 1));
  if (contradictionRatio >= 0.92 && subject.creatorRatio < 0.67) return null;

  const event = events.find((group) => group.creators.size >= 2 && group.creatorRatio >= 0.5) || null;
  const eventConfidence = event ? clamp01(event.score) : 0;
  const platforms = supportedPlatforms(validRows);
  const eventPlatforms = event ? supportedPlatforms(event.rows) : [];
  const canClaimSpread = platforms.length >= 2 && creators.size >= 3 && validRows.length >= 4 && (!event || eventPlatforms.length >= 2);
  const avgUnderstanding = validRows.reduce((sum, row) => sum + clamp01(row?.postUnderstandingConfidence || 0), 0) / validRows.length;
  const baseUnderstanding = clamp01(subjectConfidence * 0.55 + eventConfidence * 0.2 + Math.min(1, creators.size / 4) * 0.1 + avgUnderstanding * 0.15);

  const candidates = [];
  const subjectTitle = titleCase(subject.label);
  const subjectEvidence = independentEvidence(subject);
  const common = {
    subject: subject.label,
    subjectConfidence: Number(subjectConfidence.toFixed(3)),
    evidenceCount: subject.rows.length,
    creatorCount: subject.creators.size,
  };

  if (event) {
    const eventText = stripSubjectFromEvent(subject.label, event.label);
    if (eventText && phraseSimilarity(subject.label, eventText) < 0.95) {
      const title = `${subjectTitle}: ${titleCase(eventText)}`;
      const claimConfidence = Math.min(subjectConfidence, eventConfidence);
      candidates.push({
        title,
        score: candidateScore({ claimConfidence, specificity: Math.min(1, meaningfulTokens(title).length / 6), clarity: 1, crossPostAgreement: Math.min(subject.creatorRatio, event.creatorRatio), brevity: title.length <= 82 ? 1 : 0.5 }),
        claims: [
          { type: 'subject', text: subject.label, confidence: Number(subjectConfidence.toFixed(3)), ...subjectEvidence },
          { type: 'event', text: event.label, confidence: Number(eventConfidence.toFixed(3)), ...independentEvidence(event) },
        ],
        ...common,
      });
      if (canClaimSpread && title.length <= 76) {
        candidates.push({
          title: `${title} Across ${platforms.join(' and ')}`,
          score: candidateScore({ claimConfidence: Math.min(claimConfidence, 0.9), specificity: 1, clarity: 0.9, crossPostAgreement: Math.min(subject.creatorRatio, event.creatorRatio), brevity: title.length <= 64 ? 0.8 : 0.55, crossPlatformBonus: 3 }),
          claims: [
            { type: 'subject', text: subject.label, confidence: Number(subjectConfidence.toFixed(3)), ...subjectEvidence },
            { type: 'event', text: event.label, confidence: Number(eventConfidence.toFixed(3)), ...independentEvidence(event) },
            { type: 'cross-platform', text: platforms.join(' and '), confidence: 0.9, evidenceIds: [...new Set((event ? event.rows : validRows).map((row) => row.id).filter(Boolean))].slice(0, 24), creators: [...new Set((event ? event.rows : validRows).map(creatorKey).filter(Boolean))].slice(0, 16), platforms: event ? eventPlatforms : platforms },
          ],
          ...common,
        });
      }
    }
  }

  candidates.push({
    title: subjectTitle,
    score: candidateScore({ claimConfidence: subjectConfidence, specificity: Math.min(1, meaningfulTokens(subjectTitle).length / 4), clarity: 1, crossPostAgreement: subject.creatorRatio, brevity: 1 }),
    claims: [{ type: 'subject', text: subject.label, confidence: Number(subjectConfidence.toFixed(3)), ...subjectEvidence }],
    ...common,
  });

  const verified = candidates
    .filter((candidate) => candidate.claims.every((claim) => claim.type === 'cross-platform' ? claim.platforms.length >= 2 : claim.creators.length >= 2))
    .sort((a, b) => b.score - a.score || a.title.length - b.title.length);
  if (!verified.length) return null;

  const winner = verified[0];
  const confidence = clamp01(baseUnderstanding * 0.7 + Math.min(1, winner.score / 100) * 0.3);
  const status = confidence >= 0.86 && event ? 'specific' : confidence >= 0.68 ? 'conservative' : 'provisional';

  return {
    version: 28,
    title: winner.title,
    confidence: Number(confidence.toFixed(3)),
    status,
    consensus: {
      subject: subject.label,
      subjectConfidence: Number(subjectConfidence.toFixed(3)),
      event: event?.label || null,
      eventConfidence: Number(eventConfidence.toFixed(3)),
      creators: creators.size,
      platforms,
      averagePostUnderstandingConfidence: Number(avgUnderstanding.toFixed(3)),
      contradictionRatio: Number(contradictionRatio.toFixed(3)),
    },
    evidence: {
      ids: [...new Set(winner.claims.flatMap((claim) => claim.evidenceIds || []))].slice(0, 30),
      creators: [...new Set(winner.claims.flatMap((claim) => claim.creators || []))].slice(0, 20),
      platforms: [...new Set(winner.claims.flatMap((claim) => claim.platforms || []))].slice(0, 8),
      claims: winner.claims,
    },
    candidates: verified.slice(0, 5).map(({ title, score, claims }) => ({ title, score, claims: claims.map((claim) => ({ type: claim.type, text: claim.text, confidence: claim.confidence })) })),
    policy: 'evidence-consensus-claim-verified',
  };
}

export function chooseNarrativeTitleV28(topic = {}, rows = []) {
  return buildNarrativeTitleIntelligenceV28(topic, rows)?.title || null;
}
