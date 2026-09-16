import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNarrativeTitleV28, validateV28RealScan } from '../src/title-release-gate-v28.mjs';

const goodTopic = {
  narrativeTitle: 'DeJon Love: Reaction Clip Reused As Meme Across X and TikTok',
  topic: 'DeJon Love: Reaction Clip Reused As Meme Across X and TikTok',
  titleIntelligenceVersion: 28,
  titleConfidence: 0.88,
  titleStatus: 'specific',
  titleConsensus: { subject: 'DeJon Love', event: 'reaction clip reused as meme', creators: 4, platforms: ['TikTok','X'] },
  titleEvidence: {
    ids: ['1','2','3','4'], creators: ['a','b','c','d'], platforms: ['TikTok','X'],
    claims: [
      { type:'subject', text:'DeJon Love', evidenceIds:['1','2','3','4'], creators:['a','b','c','d'], platforms:['TikTok','X'] },
      { type:'event', text:'reaction clip reused as meme', evidenceIds:['1','2','3','4'], creators:['a','b','c','d'], platforms:['TikTok','X'] },
      { type:'cross-platform', text:'X and TikTok', evidenceIds:['1','2','3','4'], creators:['a','b','c','d'], platforms:['X','TikTok'] },
    ],
  },
  titleCandidates: [{ title:'DeJon Love: Reaction Clip Reused As Meme Across X and TikTok', score:91 }],
  titlePolicy: 'evidence-consensus-claim-verified',
};

test('accepts a fully evidence-backed v28 title', () => {
  assert.deepEqual(validateNarrativeTitleV28(goodTopic), { ok:true, title:goodTopic.narrativeTitle, issues:[] });
});

test('rejects cross-platform wording without a cross-platform claim', () => {
  const topic = structuredClone(goodTopic);
  topic.titleEvidence.claims = topic.titleEvidence.claims.filter((claim) => claim.type !== 'cross-platform');
  const result = validateNarrativeTitleV28(topic);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /cross-platform wording/i.test(issue)));
});

test('rejects event claims supported by only one creator', () => {
  const topic = structuredClone(goodTopic);
  topic.narrativeTitle = topic.topic = 'DeJon Love: Reaction Clip Reused As Meme';
  topic.titleEvidence.claims = topic.titleEvidence.claims.filter((claim) => claim.type !== 'cross-platform');
  topic.titleEvidence.claims.find((claim) => claim.type === 'event').creators = ['a'];
  const result = validateNarrativeTitleV28(topic);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /event claim lacks two independent creators/i.test(issue)));
});

test('accepts conservative subject-only title with two independent creators', () => {
  const topic = structuredClone(goodTopic);
  topic.narrativeTitle = topic.topic = 'DeJon Love';
  topic.titleStatus = 'conservative';
  topic.titleEvidence.claims = [topic.titleEvidence.claims[0]];
  const result = validateNarrativeTitleV28(topic);
  assert.equal(result.ok, true);
});

test('real scan gate passes with no emitted title and no replay title because absence of a trend is not a software failure', () => {
  const result = validateV28RealScan({ topics:[], replayedTopics:[] });
  assert.equal(result.ok, true);
  assert.equal(result.noQualifiedNarratives, true);
});

test('real scan gate fails when either emitted or replayed title violates evidence policy', () => {
  const bad = structuredClone(goodTopic);
  bad.titleEvidence.claims.find((claim) => claim.type === 'subject').creators = ['a'];
  const result = validateV28RealScan({ topics:[goodTopic], replayedTopics:[bad] });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
});
