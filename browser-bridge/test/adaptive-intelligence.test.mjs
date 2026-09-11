import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aliasSimilarity,
  attachFeedPenetration,
  chooseSentinelAccounts,
  consolidateTopicAliases,
  mergeRichEvidence,
  normalizeAdaptiveConfig,
  scanNovelty,
  updateSourceReputation,
} from '../src/adaptive-intelligence.mjs';

test('adaptive config caps sentinels and raises scan quality defaults', () => {
  const config = normalizeAdaptiveConfig({ enabled: true }, { xAccounts: Array.from({ length: 50 }, (_, i) => `acct${i}`) });
  assert.equal(config.xAccounts.length, 30);
  assert.equal(config.scanXForYou, true);
  assert.equal(config.scanTikTokForYou, true);
  assert.equal(config.deepResultsPerQuery >= 12, true);
  assert.equal(config.targetUniqueFeedItems >= 75, true);
});

test('sentinel selection blends trusted sources with rotation', () => {
  const accounts = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
  const reputation = { alpha: { score: .9 }, beta: { score: .8 }, gamma: { score: .1 } };
  const first = chooseSentinelAccounts(accounts, reputation, 2, 4);
  assert.equal(first.accounts.includes('alpha'), true);
  assert.equal(first.accounts.includes('beta'), true);
  assert.equal(first.accounts.length, 4);
  const second = chooseSentinelAccounts(accounts, reputation, first.nextCursor, 4);
  assert.equal(second.accounts.length, 4);
});

test('rich evidence preserves better metrics while deduping URLs', () => {
  const rows = mergeRichEvidence([
    { id: '1', platform: 'X', url: 'https://x.com/a/status/1', author: 'a', content: 'meme', views: 10, likes: 2, hashtags: ['one'] },
    { id: '1b', platform: 'X', url: 'https://x.com/a/status/1', author: 'a', content: 'meme', views: 50, likes: 7, reposts: 3, hashtags: ['two'] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].views, 50);
  assert.deepEqual(rows[0].hashtags.sort(), ['one', 'two']);
});

test('novelty distinguishes new For You items from scan history', () => {
  const result = scanNovelty([
    { id: 'old', platform: 'TikTok', url: 'https://www.tiktok.com/@a/video/1' },
    { id: 'new', platform: 'TikTok', url: 'https://www.tiktok.com/@b/video/2' },
  ], ['old']);
  assert.equal(result.newRows.length, 1);
  assert.equal(result.newRows[0].id, 'new');
  assert.equal(result.newRatio, .5);
});

test('alias consolidation joins spelling variants instead of double-counting', () => {
  assert.equal(aliasSimilarity('DeJean Love', 'DejeanLove') >= .72, true);
  const topics = consolidateTopicAliases([
    { topic: 'DeJean Love', score: 8, evidenceIds: ['a', 'b'], platforms: ['X'], aliases: [] },
    { topic: 'DejeanLove', score: 7, evidenceIds: ['c'], platforms: ['TikTok'], aliases: [] },
  ]);
  assert.equal(topics.length, 1);
  assert.deepEqual(new Set(topics[0].platforms), new Set(['X', 'TikTok']));
  assert.equal(topics[0].evidenceIds.length, 3);
});

test('feed penetration reports recommendation-surface acceleration', () => {
  const evidence = [
    { id: 'a', provenance: 'Local Chrome browser · X For You feed' },
    { id: 'b', provenance: 'Local Chrome browser · TikTok For You feed' },
    { id: 'c', provenance: 'Local Chrome browser · X For You feed' },
    { id: 'd', provenance: 'Local Chrome browser · X sentinel @foo' },
  ];
  const current = attachFeedPenetration([{ key: 'meme', topic: 'Meme', evidenceIds: ['a', 'b'] }], evidence, { meme: { ratio: .25, at: 0 } }, 3_600_000);
  assert.equal(current.feedSampleSize, 3);
  assert.equal(current.topics[0].feedPenetration, 66.67);
  assert.equal(current.topics[0].feedPenetrationDelta > 0, true);
});

test('source reputation rewards early sentinel hits', () => {
  const now = Date.now();
  const evidence = [{ id: 'x1', platform: 'X', author: 'ScoutA', provenance: 'Local Chrome browser · X sentinel @ScoutA', published: now - 30 * 60000 }];
  const updated = updateSourceReputation({}, evidence, [{ evidenceIds: ['x1'] }], now);
  assert.equal(updated.scouta.hits, 1);
  assert.equal(updated.scouta.earlyHits, 1);
  assert.equal(updated.scouta.score, 1);
});
