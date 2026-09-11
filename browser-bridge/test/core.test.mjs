import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeEvidence, extractTikTokItemsFromJson, metricFromAria, normalizeConfig, parseCompactNumber, sanitizeTopic, stableId } from '../src/core.mjs';

test('normalizes and caps bridge config', () => {
  const cfg = normalizeConfig({
    intervalMinutes: 1,
    maxTrendQueries: 99,
    resultsPerQuery: 100,
    xAccounts: ['@abc', 'abc', 'bad handle'],
    keywords: [' Dejon Love ', '', 'x'],
  });
  assert.equal(cfg.intervalMinutes, 10);
  assert.equal(cfg.maxTrendQueries, 10);
  assert.equal(cfg.resultsPerQuery, 20);
  assert.deepEqual(cfg.xAccounts, ['abc']);
  assert.deepEqual(cfg.keywords, ['Dejon Love']);
});

test('parses compact metrics', () => {
  assert.equal(parseCompactNumber('12.5K'), 12500);
  assert.equal(parseCompactNumber('1.2M'), 1200000);
  assert.equal(metricFromAria('12 replies, 44 likes, 8.2K views', 'views'), 8200);
  assert.equal(metricFromAria('12 replies, 44 likes, 8.2K views', 'likes'), 44);
});

test('stable ids are deterministic', () => {
  assert.equal(stableId('X', 'https://x.com/a/status/1', 'hello'), stableId('X', 'https://x.com/a/status/1', 'hello'));
});

test('dedupes evidence by platform and URL', () => {
  const rows = dedupeEvidence([
    { platform: 'X', author: 'a', url: 'https://x.com/a/status/1', content: 'one', views: 10 },
    { platform: 'X', author: 'a', url: 'https://x.com/a/status/1', content: 'one', views: 20 },
    { platform: 'X', author: 'a', url: 'https://example.com/nope', content: 'bad' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].views, 20);
});

test('extracts TikTok items from nested JSON safely', () => {
  const items = extractTikTokItemsFromJson({
    deep: { id: '1234567890123456789', desc: 'A meme is taking off', author: { uniqueId: 'creator' }, createTime: 1700000000, stats: { playCount: 4000, diggCount: 200 } },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].author, 'creator');
  assert.equal(items[0].views, 4000);
});

test('sanitizes topics', () => {
  assert.equal(sanitizeTopic('  #Dejon Love  '), 'Dejon Love');
});
