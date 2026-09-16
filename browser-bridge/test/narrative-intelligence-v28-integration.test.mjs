import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceNarrativesV26, chooseNarrativeTitle } from '../src/narrative-intelligence-v26.mjs';

const now = Date.now();
const row = (id, author, platform, subject, event, key = 'dejon love reaction', confidence = 0.92) => ({
  id, author, platform, postSubject: subject, postEvent: event, semanticNarrativeKey: key,
  postUnderstandingConfidence: confidence, firstObserved: now - 60_000, published: now - 120_000,
  views: 5000, likes: 400,
});

test('enhancement exposes v28 title confidence, consensus, evidence, candidates, and policy', () => {
  const evidence = [
    row('1','a','TikTok','DeJon Love','DeJon Love reaction clip reused as meme'),
    row('2','b','TikTok','DeJon Love','DeJon Love reaction clip reused as meme'),
    row('3','c','X','DeJon Love','DeJon Love reaction clip reused as meme'),
    row('4','d','X','DeJon Love','DeJon Love reaction clip reused as meme'),
  ];
  const topics = enhanceNarrativesV26([], evidence, now);
  assert.equal(topics.length, 1);
  const topic = topics[0];
  assert.equal(topic.intelligenceVersion, 26);
  assert.equal(topic.titleIntelligenceVersion, 28);
  assert.ok(topic.titleConfidence >= 0.8);
  assert.equal(topic.titlePolicy, 'evidence-consensus-claim-verified');
  assert.ok(Array.isArray(topic.titleEvidence.claims));
  assert.ok(Array.isArray(topic.titleCandidates));
  assert.match(topic.narrativeTitle, /DeJon Love/i);
});

test('chooseNarrativeTitle uses the v28 evidence gate', () => {
  const evidence = [
    row('1','same','TikTok','DeJon Love','reaction clip'),
    row('2','same','X','DeJon Love','reaction clip'),
  ];
  assert.equal(chooseNarrativeTitle({}, evidence), null);
});
