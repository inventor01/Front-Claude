import test from 'node:test';
import assert from 'node:assert/strict';
import { isGenericSubject, applyPostUnderstanding } from '../src/post-understanding-v26.mjs';
import { chooseNarrativeTitle, enhanceNarrativesV26 } from '../src/narrative-intelligence-v26.mjs';

test('generic standalone words cannot become semantic subjects', () => {
  for (const value of ['face', 'take', 'grow', 'love', 'look', 'make', 'viral', 'video', 'thing']) {
    assert.equal(isGenericSubject(value), true, `${value} should be rejected as generic`);
  }
  assert.equal(isGenericSubject('N3ON AI stream incident'), false);
  assert.equal(isGenericSubject('NEO robot X Ads campaign'), false);
  assert.equal(isGenericSubject('mascot halftime fall'), false);
});

test('post understanding stores a subject/event frame separate from raw caption words', () => {
  const row = { id: '1', platform: 'X', author: 'a', url: 'https://x.com/a/status/1', content: 'grow your business with X Ads' };
  const enriched = applyPostUnderstanding(row, {
    subject: 'NEO robot X Ads campaign',
    event: 'NEO robot campaign promoted with X Ads',
    entities: ['NEO robot', 'X Ads'],
    action: 'promoting',
    object: 'robot campaign',
    context: 'product launch marketing',
    narrativeKey: 'neo robot x ads campaign',
    confidence: 0.93,
    method: 'semantic-model',
  });
  assert.equal(enriched.postSubject, 'NEO robot X Ads campaign');
  assert.equal(enriched.semanticNarrativeKey, 'neo robot x ads campaign');
  assert.notEqual(enriched.semanticNarrativeKey, 'grow');
});

test('same generic verb in unrelated posts does not imply the same semantic narrative', () => {
  const marketing = applyPostUnderstanding({ id: 'm', platform: 'X', author: 'brand', url: 'https://x.com/brand/status/1', content: 'Launch products now and grow your business with X Ads. NEO robot campaign.' }, {
    subject: 'NEO robot X Ads campaign', event: 'robot campaign promoted on X', entities: ['NEO robot', 'X Ads'], action: 'promoting', object: 'campaign', context: 'marketing', narrativeKey: 'neo robot x ads campaign', confidence: 0.92, method: 'semantic-model',
  });
  const office = applyPostUnderstanding({ id: 'o', platform: 'X', author: 'office', url: 'https://x.com/office/status/2', content: "Office just opened. We're looking for AI startups who want to grow together." }, {
    subject: 'AI startup coworking office opening', event: 'office opens for AI startups', entities: ['AI startups'], action: 'opening', object: 'coworking office', context: 'startup workspace', narrativeKey: 'ai startup coworking office opening', confidence: 0.9, method: 'semantic-model',
  });
  assert.notEqual(marketing.semanticNarrativeKey, office.semanticNarrativeKey);
});

test('v26 narrative naming rejects one-word generic labels', () => {
  const rows = [
    { id: '1', platform: 'X', author: 'a', content: 'NEO robot campaign promoted with X Ads' },
    { id: '2', platform: 'X', author: 'b', content: 'NEO robot campaign uses X Ads for product launch' },
  ];
  assert.equal(chooseNarrativeTitle({ topic: 'grow', aliases: ['grow'] }, rows), null);
  assert.equal(chooseNarrativeTitle({ topic: 'NEO robot X Ads campaign', aliases: ['grow'] }, rows), 'NEO Robot X Ads Campaign');
});

test('v26 exposes age, lifecycle, velocity, and pre-coin classification', () => {
  const now = 1_800_000_000_000;
  const evidence = [
    { id: '1', platform: 'TikTok', author: 'a', content: 'N3ON AI stream incident', published: now - 20 * 60000, views: 120000, likes: 9000 },
    { id: '2', platform: 'X', author: 'b', content: 'N3ON AI stream incident', published: now - 10 * 60000, views: 80000, likes: 5000 },
    { id: '3', platform: 'TikTok', author: 'c', content: 'N3ON AI stream incident', published: now - 5 * 60000, views: 50000, likes: 4000 },
  ];
  const [topic] = enhanceNarrativesV26([{ topic: 'N3ON AI stream incident', key: 'n3on-ai-stream-incident', evidenceIds: ['1','2','3'], authorCount: 3, evidenceCount: 3, score: 50 }], evidence, now);
  assert(topic);
  assert.equal(topic.opportunityStatus, 'PRE-COIN');
  assert(topic.ageMinutes >= 19 && topic.ageMinutes <= 21);
  assert(topic.velocityScore > 0);
  assert(['EMERGING','EARLY BREAKOUT','VIRAL'].includes(topic.lifecycleStage));
});
