import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeEvidence, extractHashtags, extractTikTokItemsFromJson, inferTopics, metricFromAria, normalizeConfig, parseCompactNumber, sanitizeTopic, stableId, xTrendLabel } from '../src/core.mjs';

test('normalizes and caps bridge config', () => {
  const cfg = normalizeConfig({ intervalMinutes: 1, maxTrendQueries: 99, inferredTopicSearches: 99, scrollPasses: 99, maxFeedItems: 999, resultsPerQuery: 100, xAccounts: ['@abc', 'abc', 'bad handle'], keywords: [' Dejon Love ', '', 'x'] });
  assert.equal(cfg.intervalMinutes, 10); assert.equal(cfg.maxTrendQueries, 10); assert.equal(cfg.inferredTopicSearches, 10); assert.equal(cfg.scrollPasses, 10); assert.equal(cfg.maxFeedItems, 120); assert.equal(cfg.resultsPerQuery, 20); assert.equal(cfg.scanXHome, true); assert.equal(cfg.scanTikTokExplore, true); assert.deepEqual(cfg.xAccounts, ['abc']); assert.deepEqual(cfg.keywords, ['Dejon Love']);
});

test('parses compact metrics', () => { assert.equal(parseCompactNumber('12.5K'), 12500); assert.equal(parseCompactNumber('1.2M'), 1200000); assert.equal(metricFromAria('12 replies, 44 likes, 8.2K views', 'views'), 8200); assert.equal(metricFromAria('12 replies, 44 likes, 8.2K views', 'likes'), 44); });
test('stable ids are deterministic', () => { assert.equal(stableId('X', 'https://x.com/a/status/1', 'hello'), stableId('X', 'https://x.com/a/status/1', 'hello')); });
test('dedupes evidence by platform and URL', () => { const rows = dedupeEvidence([{ platform: 'X', author: 'a', url: 'https://x.com/a/status/1', content: 'one', views: 10 },{ platform: 'X', author: 'a', url: 'https://x.com/a/status/1', content: 'one', views: 20 },{ platform: 'X', author: 'a', url: 'https://example.com/nope', content: 'bad' }]); assert.equal(rows.length, 1); assert.equal(rows[0].views, 20); });
test('preserves unknown metrics as null', () => { const [row] = dedupeEvidence([{platform:'X',author:'a',url:'https://x.com/a/status/2',content:'hello',views:null,likes:null}]); assert.equal(row.views, null); assert.equal(row.likes, null); });
test('extracts TikTok items from nested JSON safely', () => { const items = extractTikTokItemsFromJson({ deep: { id: '1234567890123456789', desc: 'A meme is taking off', author: { uniqueId: 'creator' }, createTime: 1700000000, stats: { playCount: 4000, diggCount: 200 } } }); assert.equal(items.length, 1); assert.equal(items[0].author, 'creator'); assert.equal(items[0].views, 4000); });
test('extracts unique hashtag fallbacks', () => { assert.deepEqual(extractHashtags('Now #DejonLove then #viral and #DejonLove again', 5), ['DejonLove', 'viral']); });
test('extracts an X trend label without metadata noise', () => { assert.equal(xTrendLabel('Trending in United States\n#DejonLove\n12.5K posts'), '#DejonLove'); });
test('never promotes X interface labels such as show as a trend', () => { assert.equal(xTrendLabel('Show\nTrending in United States\n49ers\n18.2K posts'), '49ers'); assert.equal(xTrendLabel('Show more\nView more\n12K posts'), ''); });

test('infers only corroborated topics from multiple authors', () => {
  const now = 1789100000000;
  const rows = [
    {platform:'X',author:'alice',url:'https://x.com/alice/status/1',content:'Everybody is posting #DejonLove after that reaction',published:now-60000,views:50000,likes:2000},
    {platform:'X',author:'bob',url:'https://x.com/bob/status/2',content:'The #DejonLove reaction keeps showing up everywhere',published:now-120000,views:90000,likes:4000},
    {platform:'TikTok',author:'carol',url:'https://www.tiktok.com/@carol/video/1234567890123456789',content:'This #DejonLove meme is spreading fast',published:now-180000,views:400000,likes:30000},
    {platform:'X',author:'solo',url:'https://x.com/solo/status/3',content:'#OneOffThing',published:now-10000,views:900000,likes:50000},
  ];
  const topics = inferTopics(rows, now, 10); const hit = topics.find((row) => row.key === 'dejon love' || row.key === 'dejonlove' || row.topic.toLowerCase().includes('dejon'));
  assert(hit); assert.equal(hit.authorCount, 3); assert.equal(hit.evidenceCount, 3); assert.deepEqual(new Set(hit.platforms), new Set(['X','TikTok'])); assert.equal(hit.niche, true); assert(hit.specificityScore > 0); assert.equal(hit.anchors.length, 3); assert(!topics.some((row) => row.key === 'oneoffthing'));
});

test('clusters narrative wording variants across creators and platforms', () => {
  const now = 1789100000000;
  const rows = [
    {platform:'X',author:'alice',url:'https://x.com/alice/status/11',content:'Dejon Love reaction is taking over my feed',published:now-30000,views:12000,likes:900},
    {platform:'TikTok',author:'bob',url:'https://www.tiktok.com/@bob/video/2234567890123456789',content:'that Dejon reaction has me crying #DejonLove',published:now-60000,views:180000,likes:14000},
    {platform:'X',author:'carol',url:'https://x.com/carol/status/12',content:'Everyone keeps reposting the Dejon clip',published:now-90000,views:44000,likes:2500},
  ];
  const topics = inferTopics(rows, now, 10); const hit = topics.find((row) => row.topic.toLowerCase().includes('dejon') || row.key.includes('dejon'));
  assert(hit); assert.equal(hit.authorCount, 3); assert.equal(hit.evidenceCount, 3); assert.deepEqual(new Set(hit.platforms), new Set(['X','TikTok'])); assert.equal(hit.niche, true); assert(hit.nicheEvidenceCount >= 2); assert.equal(topics.filter((row) => row.topic.toLowerCase().includes('dejon') || row.key.includes('dejon')).length, 1);
});

test('links a niche meme to repeated parent context without collapsing them', () => {
  const now = 1789100000000;
  const rows = [
    {platform:'X',author:'alice',url:'https://x.com/alice/status/51',content:'49ers fans keep posting the Dejon Love reaction meme',published:now-20000,views:22000,likes:1400},
    {platform:'TikTok',author:'bob',url:'https://www.tiktok.com/@bob/video/6234567890123456789',content:'49ers timeline is full of that #DejonLove clip',published:now-40000,views:180000,likes:15000},
    {platform:'X',author:'carol',url:'https://x.com/carol/status/52',content:'49ers people are remixing the Dejon Love reaction again',published:now-60000,views:53000,likes:3100},
  ];
  const topics = inferTopics(rows, now, 10); const dejon = topics.find((row) => row.topic.toLowerCase().includes('dejon') || row.key.includes('dejon'));
  assert(dejon, 'expected Dejon Love to remain the niche narrative');
  const relation = dejon.relatedContexts.find((row) => row.key.includes('49ers') || row.title.toLowerCase().includes('49ers'));
  assert(relation, 'expected 49ers to be linked as related context');
  assert.equal(relation.relation, 'repeated-cooccurrence'); assert.equal(relation.authorCount, 3); assert.equal(relation.evidenceCount, 3);
  assert(!topics.some((row) => row.key === '49ers'), 'broad context must not replace the niche narrative');
});

test('does not infer a relationship from one creator only', () => {
  const now = 1789100000000;
  const rows = [
    {platform:'X',author:'alice',url:'https://x.com/alice/status/61',content:'49ers Dejon Love reaction meme',published:now-10000,views:1000,likes:100},
    {platform:'X',author:'alice',url:'https://x.com/alice/status/62',content:'49ers Dejon Love clip again',published:now-20000,views:2000,likes:200},
    {platform:'TikTok',author:'bob',url:'https://www.tiktok.com/@bob/video/7234567890123456789',content:'Dejon Love reaction everywhere',published:now-30000,views:3000,likes:300},
  ];
  const dejon = inferTopics(rows, now, 10).find((row) => row.topic.toLowerCase().includes('dejon') || row.key.includes('dejon'));
  assert(dejon); assert(!dejon.relatedContexts.some((row) => row.key.includes('49ers')));
});

test('does not promote generic viral words by themselves', () => { const now=1789100000000; const topics=inferTopics([{platform:'X',author:'alice',url:'https://x.com/alice/status/21',content:'This viral meme is funny',published:now-10000,views:1000,likes:100},{platform:'TikTok',author:'bob',url:'https://www.tiktok.com/@bob/video/3234567890123456789',content:'another viral meme trend',published:now-20000,views:2000,likes:200}],now,10); assert(!topics.some((row)=>['viral','meme','trend','reaction'].includes(row.key))); });
test('rejects broad category narratives without a niche hook', () => { const now=1789100000000; const topics=inferTopics([{platform:'X',author:'alice',url:'https://x.com/alice/status/31',content:'Crypto market news is moving today',published:now-10000,views:20000,likes:500},{platform:'TikTok',author:'bob',url:'https://www.tiktok.com/@bob/video/4234567890123456789',content:'More crypto market news this morning',published:now-20000,views:30000,likes:800}],now,10); assert.equal(topics.length,0); });
test('keeps a niche meme phrase instead of collapsing to a broad category', () => { const now=1789100000000; const rows=[{platform:'X',author:'alice',url:'https://x.com/alice/status/41',content:'Everyone is posting the Banana Phone Kid meme again',published:now-15000,views:42000,likes:2200},{platform:'TikTok',author:'bob',url:'https://www.tiktok.com/@bob/video/5234567890123456789',content:'Banana Phone Kid reaction audio is everywhere',published:now-30000,views:210000,likes:19000},{platform:'X',author:'carol',url:'https://x.com/carol/status/42',content:'That Banana Phone Kid clip is all over my feed',published:now-45000,views:65000,likes:3400}]; const topics=inferTopics(rows,now,10); const hit=topics.find((row)=>row.topic.toLowerCase().includes('banana phone kid')); assert(hit); assert.equal(hit.niche,true); assert(hit.specificityScore>=4); assert(hit.anchors.some((anchor)=>/meme|reaction|clip/i.test(anchor.content))); });
test('sanitizes topics', () => { assert.equal(sanitizeTopic('  #Dejon Love  '), 'Dejon Love'); });
