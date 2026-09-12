import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeRecoveryEvidence,
  mergeRecoveryTopics,
  visualRecoveryReason,
} from '../src/recovery-policy-v18.mjs';

test('zero canonical evidence always triggers visual recovery',()=>{
  assert.equal(visualRecoveryReason({scanTikTokForYou:true},{evidence:[]}), 'zero-evidence');
});

test('thin evidence with enabled content understanding but no selected videos triggers recovery',()=>{
  const payload={
    evidence:Array.from({length:6},(_,i)=>({id:`x${i}`,platform:'X',url:`https://x.com/a/status/${i}`})),
    contentUnderstanding:{enabled:true,visuallyUnderstood:0,scan:{requested:0,analyzed:0,cached:0,enriched:0,failed:0}},
  };
  assert.equal(visualRecoveryReason({scanTikTokForYou:true},payload,{thinEvidenceThreshold:12}), 'thin-evidence-no-video-analysis');
});

test('healthy video analysis does not trigger supplemental recovery',()=>{
  const payload={
    evidence:Array.from({length:6},(_,i)=>({id:`t${i}`,platform:'TikTok',url:`https://www.tiktok.com/@a/video/${1000000000000+i}`})),
    contentUnderstanding:{enabled:true,visuallyUnderstood:2,scan:{requested:2,analyzed:2,enriched:2,failed:0}},
  };
  assert.equal(visualRecoveryReason({scanTikTokForYou:true},payload,{thinEvidenceThreshold:12}), null);
});

test('recovery evidence prefers grounded visual understanding and deduplicates URLs',()=>{
  const base=[{id:'1',platform:'TikTok',url:'https://www.tiktok.com/@a/video/1',author:'a',content:'lol',firstObserved:20}];
  const recovery=[{id:'r1',platform:'TikTok',url:'https://www.tiktok.com/@a/video/1',author:'a',content:'Visual summary: mascot falls',contentSummary:'A mascot falls.',contentConfidence:.9,mediaType:'video',firstObserved:10}];
  const merged=mergeRecoveryEvidence(base,recovery);
  assert.equal(merged.length,1);
  assert.equal(merged[0].contentSummary,'A mascot falls.');
  assert.equal(merged[0].firstObserved,10);
});

test('recovery topics add support without duplicating canonical topic identity',()=>{
  const merged=mergeRecoveryTopics(
    [{key:'mascot fall',topic:'Mascot Fall',tier:'pre-breakout',evidenceIds:['a'],platforms:['X'],evidenceCount:1,authorCount:1,score:40}],
    [{key:'mascot fall',topic:'mascot fall',tier:'candidate',corroborated:true,evidenceIds:['b'],platforms:['TikTok'],evidenceCount:2,authorCount:2,score:70}],
  );
  assert.equal(merged.length,1);
  assert.equal(merged[0].topic,'Mascot Fall');
  assert.equal(merged[0].tier,'candidate');
  assert.equal(merged[0].corroborated,true);
  assert.deepEqual(new Set(merged[0].evidenceIds),new Set(['a','b']));
  assert.deepEqual(new Set(merged[0].platforms),new Set(['X','TikTok']));
});
