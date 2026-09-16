import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSemanticNarrativesV26, enhanceNarrativesV26 } from '../src/narrative-intelligence-v26.mjs';

const now = 1_800_000_000_000;

function row(overrides={}) {
  return {
    id: 'id',
    platform: 'X',
    author: 'creator',
    url: 'https://x.com/creator/status/1',
    content: 'caption does not contain the full model subject',
    firstObserved: now - 60_000,
    postUnderstandingConfidence: .9,
    postEntities: [],
    ...overrides,
  };
}

test('near-identical semantic descriptions from independent creators form one pre-breakout narrative', () => {
  const evidence = [
    row({
      id:'x-1', author:'creator-a', platform:'X',
      postSubject:'AOC criticizes Ed Sheeran',
      postEvent:'AOC criticizes Ed Sheeran appearance',
      semanticNarrativeKey:'aoc criticizes ed sheeran',
      postEntities:['AOC','Ed Sheeran'],
    }),
    row({
      id:'t-1', author:'creator-b', platform:'TikTok',
      url:'https://www.tiktok.com/@creator-b/video/1234567890123456789',
      postSubject:'Rep AOC criticizes Ed Sheeran',
      postEvent:'Rep AOC criticizes Ed Sheeran appearance',
      semanticNarrativeKey:'rep aoc criticizes ed sheeran',
      postEntities:['AOC','Ed Sheeran'],
    }),
  ];

  const topics = deriveSemanticNarrativesV26(evidence, now);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].authorCount, 2);
  assert.equal(topics[0].tier, 'pre-breakout');
  assert.equal(topics[0].corroborated, false);
  assert.equal(topics[0].detector, 'semantic-near-match-v30');
  assert.equal(topics[0].semanticClusterKeys.length, 2);

  const enhanced = enhanceNarrativesV26([], evidence, now);
  assert.equal(enhanced.length, 1);
  assert.equal(enhanced[0].authorCount, 2);
  assert.match(enhanced[0].topic, /AOC/i);
  assert.match(enhanced[0].topic, /Ed Sheeran/i);
});

test('two unrelated stories sharing only a generic actor/action are not merged', () => {
  const evidence = [
    row({id:'1',author:'a',postSubject:'AOC criticizes Ed Sheeran',postEvent:'AOC criticizes Ed Sheeran appearance',semanticNarrativeKey:'aoc criticizes ed sheeran',postEntities:['AOC','Ed Sheeran']}),
    row({id:'2',author:'b',platform:'TikTok',postSubject:'AOC criticizes tax bill',postEvent:'AOC criticizes tax bill vote',semanticNarrativeKey:'aoc criticizes tax bill',postEntities:['AOC','tax bill']}),
  ];
  assert.deepEqual(deriveSemanticNarrativesV26(evidence, now), []);
});

test('a single semantic post never becomes a narrative candidate by itself', () => {
  const evidence = [row({id:'1',author:'a',postSubject:'Young B performs Chicken Noodle Soup',postEvent:'Young B performs Chicken Noodle Soup',semanticNarrativeKey:'young b chicken noodle soup performance',postEntities:['Young B','Chicken Noodle Soup']})];
  assert.deepEqual(deriveSemanticNarrativesV26(evidence, now), []);
  assert.deepEqual(enhanceNarrativesV26([], evidence, now), []);
});

test('exact semantic keys retain the existing two-creator threshold', () => {
  const evidence = [
    row({id:'1',author:'a',postSubject:'Young B performs Chicken Noodle Soup',postEvent:'Young B performs Chicken Noodle Soup',semanticNarrativeKey:'young b chicken noodle soup performance'}),
    row({id:'2',author:'b',platform:'TikTok',postSubject:'Young B performs Chicken Noodle Soup',postEvent:'Young B performs Chicken Noodle Soup',semanticNarrativeKey:'young b chicken noodle soup performance'}),
  ];
  const topics = deriveSemanticNarrativesV26(evidence, now);
  assert.equal(topics.length,1);
  assert.equal(topics[0].authorCount,2);
  assert.equal(topics[0].tier,'pre-breakout');
  assert.equal(topics[0].detector,'semantic-subject-v26');
});
