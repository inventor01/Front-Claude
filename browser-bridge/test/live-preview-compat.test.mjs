import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalXUrl,
  canonicalTikTokUrl,
  looksLikeTikTokActivity,
  sanitizeRow,
  sanitizeSnapshot,
} from '../src/live-preview-compat.mjs';

test('canonical social URLs remove analytics/query noise',()=>{
  assert.equal(canonicalXUrl('https://x.com/espn/status/2097299139423781106/analytics'),'https://x.com/espn/status/2097299139423781106');
  assert.equal(canonicalTikTokUrl('https://www.tiktok.com/@creator/video/1234567890123456789?is_from_webapp=1'),'https://www.tiktok.com/@creator/video/1234567890123456789');
});

test('TikTok notification/activity text is rejected from live preview',()=>{
  const activity='Alice started following you. Follow back Bob and 20 others liked your video. Follow back';
  assert.equal(looksLikeTikTokActivity(activity),true);
  assert.equal(sanitizeRow({
    id:'live:tiktok:x',platform:'TikTok',author:'7222886419424461866',
    url:'https://www.tiktok.com/@7222886419424461866/video/7222918052449439019',
    content:activity,
  }),null);
});

test('legitimate TikTok and X posts survive live preview sanitation',()=>{
  const x=sanitizeRow({id:'x1',platform:'X',author:'creator',url:'https://x.com/creator/status/123/analytics',content:'A real event is unfolding right now'});
  const t=sanitizeRow({id:'t1',platform:'TikTok',author:'creator2',url:'https://www.tiktok.com/@creator2/video/456?foo=1',content:'Everyone is remixing this dance today'});
  assert.equal(x.url,'https://x.com/creator/status/123');
  assert.equal(t.url,'https://www.tiktok.com/@creator2/video/456');
});

test('snapshot counts and topics use only sanitized evidence',()=>{
  const snapshot=sanitizeSnapshot({
    status:'failed',
    errors:[],
    evidence:[
      {id:'x1',platform:'X',author:'a',url:'https://x.com/a/status/1',content:'same event is happening'},
      {id:'t1',platform:'TikTok',author:'b',url:'https://www.tiktok.com/@b/video/2',content:'same event is happening'},
      {id:'junk',platform:'TikTok',author:'7222886419424461866',url:'https://www.tiktok.com/@7222886419424461866/video/3',content:'Alice started following you. Bob liked your video. Follow back'},
    ],
    inferredTopics:[{topic:'same event',evidenceIds:['x1','t1','junk']}],
  });
  assert.equal(snapshot.observed,2);
  assert.deepEqual(snapshot.platformCounts,{X:1,TikTok:1});
  assert.equal(snapshot.candidateTopics,1);
  assert.equal(snapshot.inferredTopics.length,1);
  assert.match(snapshot.errors[0],/inspect \/ledger/i);
});
