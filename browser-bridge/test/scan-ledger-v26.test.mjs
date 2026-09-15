import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScanLedgerEntry} from '../src/scan-ledger-v26.mjs';
import {buildScanSignals,countScanSignals} from '../src/scan-signals-v26.mjs';

test('v26 persists full counts, transcript coverage, and scan signals independently of truncated samples',()=>{
 const evidence=Array.from({length:40},(_,i)=>({platform:i<35?'X':'TikTok',author:`a${i}`,url:`https://x.com/a${i}/status/${i}`,id:`id-${i}`,content:i<2?'fruit fly connectome experiment':'caption',transcript:i===39?'spoken transcript evidence':null,contentSummary:i===39?'Visual summary':null,provenance:i<35?'discovery X':'discovery TikTok'}));
 const stages={visualUnderstanding:{requested:1,enriched:1,failed:0},postUnderstanding:{modeled:40,failed:0}};
 const row=buildScanLedgerEntry({id:'scan',finalStatus:'complete',startedAt:100,completedAt:200,request:{},connected:true,contentStatus:{enabled:true,model:'qwen3-vl:4b-instruct'},postStatus:{enabled:true},latestLive:{phase:'complete',evidence,observed:40,candidateTopics:0,inferredTopics:[],platformCounts:{X:35,TikTok:5},stages,errors:[],sourcePages:['https://x.com/home','https://www.tiktok.com/foryou']}});
 assert.equal(row.schemaVersion,26);assert.equal(row.durationMs,100);assert.equal(row.usableEvidence,40);assert.equal(row.uniqueCreators,40);assert.equal(row.inferredTopics,0);assert.equal(row.sourceCounts['discovery TikTok'],5);assert.equal(row.samples.length,30);assert.equal(row.vision.visuallyUnderstood,1);assert.equal(row.transcriptEvidence,1);assert.deepEqual(row.stages,stages);
 assert(row.scanSignals.some(signal=>signal.scanStatus==='EARLY'));assert(row.scanSignalCounts.EARLY>=1);assert.equal(row.scanSignalCounts.QUALIFIED,0);
});

test('scan signal status counts retain EARLY RISING and QUALIFIED separately',()=>{
 const evidence=[
  {id:'1',platform:'X',author:'a',content:'Daejon Love interview meme'},
  {id:'2',platform:'TikTok',author:'b',content:'Daejon Love interview meme'},
  {id:'3',platform:'TikTok',author:'c',content:'Daejon Love interview meme'},
 ];
 const signals=buildScanSignals(evidence,[{topic:'Qualified Story Event',key:'qualified story event',tier:'candidate',corroborated:true,evidenceCount:2,authorCount:2,score:80,platforms:['X','TikTok'],evidenceIds:['q1','q2']}]);
 const counts=countScanSignals(signals);
 assert.equal(counts.QUALIFIED,1);
 assert(signals.some(signal=>signal.scanStatus==='RISING'));
 assert.equal(signals.find(signal=>signal.scanStatus==='RISING')?.corroborated,false);
});
