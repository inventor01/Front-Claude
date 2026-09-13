import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScanLedgerEntry} from '../src/scan-ledger-v26.mjs';
test('v26 persists full counts and model audit independently of truncated samples',()=>{
 const evidence=Array.from({length:40},(_,i)=>({platform:i<35?'X':'TikTok',author:`a${i}`,url:`https://x.com/a${i}/status/${i}`,content:'caption',contentSummary:i===39?'Visual summary':null,provenance:i<35?'discovery X':'discovery TikTok'}));
 const stages={visualUnderstanding:{requested:1,enriched:1,failed:0},postUnderstanding:{modeled:40,failed:0}};
 const row=buildScanLedgerEntry({id:'scan',finalStatus:'complete',startedAt:100,completedAt:200,request:{},connected:true,contentStatus:{enabled:true,model:'qwen3-vl:8b'},postStatus:{enabled:true},latestLive:{phase:'complete',evidence,observed:40,candidateTopics:2,platformCounts:{X:35,TikTok:5},stages,errors:[],sourcePages:['https://x.com/home','https://www.tiktok.com/foryou']}});
 assert.equal(row.schemaVersion,26);assert.equal(row.durationMs,100);assert.equal(row.usableEvidence,40);assert.equal(row.uniqueCreators,40);assert.equal(row.inferredTopics,2);assert.equal(row.sourceCounts['discovery TikTok'],5);assert.equal(row.samples.length,30);assert.equal(row.vision.visuallyUnderstood,1);assert.deepEqual(row.stages,stages);
});
