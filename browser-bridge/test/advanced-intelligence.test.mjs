import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachOriginResearch,
  attachVisualSignals,
  semanticConsolidateTopics,
  semanticTextSimilarity,
  shouldAutoDeep,
  visualHashSimilarity,
} from '../src/advanced-intelligence.mjs';

test('semantic similarity keeps typo/name variants closer than unrelated phrases', () => {
  const typo = semanticTextSimilarity('DeJean Love', 'Dejon Love');
  const unrelated = semanticTextSimilarity('DeJean Love', 'kitchen organization hacks');
  assert.ok(typo > 0.4, `expected useful typo similarity > .4, got ${typo}`);
  assert.ok(typo > unrelated + 0.25, `expected typo similarity to exceed unrelated: ${typo} vs ${unrelated}`);
});

test('semantic consolidation can connect alternate captions through shared evidence/media context', () => {
  const evidence = [
    { id:'x1', platform:'X', author:'a', content:'DeJean Love is everywhere', soundId:null, visualHash:'aaaaaaaaaaaaaaaa', outboundUrls:[] },
    { id:'t1', platform:'TikTok', author:'b', content:'bro is in LOVE 😭', soundId:'sound-1', visualHash:'aaaaaaaaaaaaaaab', outboundUrls:[] },
  ];
  const topics = [
    { topic:'DeJean Love', key:'dejean love', aliases:['DeJean Love'], evidenceIds:['x1','t1'], platforms:['X','TikTok'], authorCount:2, score:18, corroborated:true },
    { topic:'bro is in LOVE', key:'bro is in love', aliases:['bro is in LOVE'], evidenceIds:['t1'], platforms:['TikTok'], authorCount:1, score:10, corroborated:false },
  ];
  const merged = semanticConsolidateTopics(topics, evidence);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].aliases.some((alias) => /bro is in love/i.test(alias)));
  assert.equal(merged[0].semanticMerged, true);
});

test('visual signals use perceptual-hash similarity instead of exact URL matching', () => {
  assert.ok(visualHashSimilarity('aaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaab') > 0.9);
  const evidence = [
    { id:'1', platform:'TikTok', author:'one', visualHash:'aaaaaaaaaaaaaaaa' },
    { id:'2', platform:'TikTok', author:'two', visualHash:'aaaaaaaaaaaaaaab' },
  ];
  const [topic] = attachVisualSignals([{ topic:'same template', evidenceIds:['1','2'] }], evidence);
  assert.equal(topic.visualSignals.length, 1);
  assert.equal(topic.visualSignals[0].creators, 2);
});

test('scout auto-escalates on cross-platform corroboration and feed acceleration', () => {
  const decision = shouldAutoDeep([{
    topic:'new meme', key:'new meme', authorCount:4, platforms:['X','TikTok'], score:16,
    feedPenetrationVelocity:1.4, momentum:{label:'Accelerating'}, soundSignals:[], visualSignals:[],
  }], { uniqueCreators:12, risingFeedTopics:1 });
  assert.equal(decision.trigger, true);
  assert.ok(decision.reasons.length >= 2);
});

test('origin research prefers the earliest dated supporting evidence and keeps absolute=false', () => {
  const now = Date.now();
  const topics = [{ topic:'DeJean Love', key:'dejean love', aliases:['DeJean Love'], evidenceIds:['newer'] }];
  const evidence = [
    { id:'newer', platform:'X', author:'b', url:'https://x.com/b/status/2', content:'DeJean Love', published:now-10_000, provenance:'candidate investigation' },
    { id:'older', platform:'TikTok', author:'a', url:'https://www.tiktok.com/@a/video/1', content:'DeJean Love original clip', published:now-60_000, provenance:'Local Chrome browser · TikTok origin research' },
  ];
  const [topic] = attachOriginResearch(topics, evidence, now);
  assert.equal(topic.originCandidate.url, evidence[1].url);
  assert.equal(topic.originCandidate.absolute, false);
  assert.equal(topic.originCandidate.targetedOriginRows, 1);
});
