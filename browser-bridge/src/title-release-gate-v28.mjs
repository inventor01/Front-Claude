const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = (value) => clean(value).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

function topicTitle(topic = {}) {
  return clean(topic.narrativeTitle || topic.topic);
}

export function validateNarrativeTitleV28(topic = {}) {
  const issues = [];
  const title = topicTitle(topic);
  const confidence = Number(topic.titleConfidence);
  const evidence = topic.titleEvidence;
  const claims = Array.isArray(evidence?.claims) ? evidence.claims : [];

  if (topic.titleIntelligenceVersion !== 28) issues.push('titleIntelligenceVersion must equal 28');
  if (topic.titlePolicy !== 'evidence-consensus-claim-verified') issues.push('titlePolicy must be evidence-consensus-claim-verified');
  if (!title) issues.push('title is missing');
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) issues.push('titleConfidence must be within (0, 1]');
  if (!['specific', 'conservative', 'provisional'].includes(String(topic.titleStatus || ''))) issues.push('titleStatus is invalid');
  if (!topic.titleConsensus || typeof topic.titleConsensus !== 'object') issues.push('titleConsensus is missing');
  if (!evidence || typeof evidence !== 'object') issues.push('titleEvidence is missing');
  if (!claims.length) issues.push('titleEvidence.claims is empty');
  if (!Array.isArray(topic.titleCandidates) || topic.titleCandidates.length < 1) issues.push('titleCandidates is empty');

  const subjectClaims = claims.filter((claim) => claim?.type === 'subject');
  const eventClaims = claims.filter((claim) => claim?.type === 'event');
  const spreadClaims = claims.filter((claim) => claim?.type === 'cross-platform');
  if (subjectClaims.length !== 1) issues.push('exactly one subject claim is required');

  for (const claim of [...subjectClaims, ...eventClaims]) {
    const creators = new Set(Array.isArray(claim?.creators) ? claim.creators.map(normalize).filter(Boolean) : []);
    if (creators.size < 2) issues.push(`${claim?.type || 'unknown'} claim lacks two independent creators`);
    if (!clean(claim?.text)) issues.push(`${claim?.type || 'unknown'} claim text is missing`);
  }
  for (const claim of spreadClaims) {
    const platforms = new Set(Array.isArray(claim?.platforms) ? claim.platforms.map(normalize).filter(Boolean) : []);
    const creators = new Set(Array.isArray(claim?.creators) ? claim.creators.map(normalize).filter(Boolean) : []);
    if (platforms.size < 2) issues.push('cross-platform claim lacks two platforms');
    if (creators.size < 2) issues.push('cross-platform claim lacks two independent creators');
    if (Number(topic?.titleConsensus?.creators || 0) < 3) issues.push('cross-platform title lacks three-creator overall consensus');
  }

  if (/\bacross\b/i.test(title) && spreadClaims.length !== 1) issues.push('title uses cross-platform wording without exactly one cross-platform claim');
  if (!/\bacross\b/i.test(title) && spreadClaims.length) issues.push('cross-platform claim exists but title does not display it');

  const evidenceIds = new Set(Array.isArray(evidence?.ids) ? evidence.ids.map(clean).filter(Boolean) : []);
  const claimEvidenceIds = new Set(claims.flatMap((claim) => Array.isArray(claim?.evidenceIds) ? claim.evidenceIds.map(clean).filter(Boolean) : []));
  if (!evidenceIds.size) issues.push('titleEvidence.ids is empty');
  for (const id of claimEvidenceIds) if (!evidenceIds.has(id)) issues.push(`claim evidence id ${id} is missing from titleEvidence.ids`);

  return { ok: issues.length === 0, title, issues: [...new Set(issues)] };
}

export function validateV28RealScan({ topics = [], replayedTopics = [] } = {}) {
  const emitted = (Array.isArray(topics) ? topics : []).map(validateNarrativeTitleV28);
  const replayed = (Array.isArray(replayedTopics) ? replayedTopics : []).map(validateNarrativeTitleV28);
  const failures = [
    ...emitted.filter((row) => !row.ok).map((row) => ({ source:'emitted-topic', title:row.title, issues:row.issues })),
    ...replayed.filter((row) => !row.ok).map((row) => ({ source:'real-evidence-replay', title:row.title, issues:row.issues })),
  ];
  const checked = emitted.length + replayed.length;
  return {
    ok: failures.length === 0,
    noQualifiedNarratives: checked === 0,
    emitted,
    replayed,
    failures,
    counts: { emitted: emitted.length, replayed: replayed.length, checked },
  };
}
