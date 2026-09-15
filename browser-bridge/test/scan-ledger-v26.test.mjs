import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildScanLedgerEntry} from '../src/scan-ledger-v26.mjs';
import {buildScanSignals,countScanSignals} from '../src/scan-signals-v26.mjs';

function withTempBridgeData(fn){
 const previous=process.env.FRONT_BRIDGE_DATA;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-ledger-v26-'));
 process.env.FRONT_BRIDGE_DATA=dir;
 try{return fn(dir);}finally{if(previous===undefined)delete process.env.FRONT_BRIDGE_DATA;else process.env.FRONT_BRIDGE_DATA=previous;fs.rmSync(dir,{recursive:true,force:true});}
}

const semanticEvidence=[{platform:'X',author:'a',url:'https://x.com/a/status/1',id:'id-1',content:'fruit fly connectome experiment',postSubject:'Fruit fly connectome experiment',postEvent:'connectome experiment spreads',semanticNarrativeKey:'fruit fly connectome experiment',postUnderstandingConfidence:.9,postUnderstandingMethod:'semantic-model',provenance:'test'}];
const baseLive=(evidence=semanticEvidence)=>({phase:'complete',evidence,observed:evidence.length,candidateTopics:0,inferredTopics:[],platformCounts:{X:evidence.length},stages:{visualUnderstanding:{requested:0,enriched:0,failed:0},postUnderstanding:{modeled:evidence.length,failed:0}},errors:[],sourcePages:['https://x.com/home']});

test('v26 persists full counts, transcript coverage, understanding frames, memory, and scan signals independently of truncated samples',()=>withTempBridgeData((dir)=>{
 const evidence=Array.from({length:40},(_,i)=>({platform:i<35?'X':'TikTok',author:`a${i}`,url:`https://x.com/a${i}/status/${i}`,id:`id-${i}`,content:i<2?'fruit fly connectome experiment':'caption',transcript:i===39?'This started on Discord':null,transcriptSource:i===39?'active-text-track':null,contentSummary:i===39?'Visual summary':null,provenance:i<35?'discovery X':'discovery TikTok',postSubject:i<2?'Fruit fly connectome experiment':null,postEvent:i<2?'connectome experiment spreads':null,semanticNarrativeKey:i<2?'fruit fly connectome experiment':null,postUnderstandingConfidence:i<2?.9:0,postUnderstandingMethod:i<2?'semantic-model':null}));
 const stages={visualUnderstanding:{requested:1,enriched:1,failed:0},postUnderstanding:{modeled:2,failed:0}};
 const row=buildScanLedgerEntry({id:'scan',finalStatus:'complete',startedAt:100,completedAt:200,request:{},connected:true,contentStatus:{enabled:true,model:'qwen3-vl:4b-instruct'},postStatus:{enabled:true},latestLive:{phase:'complete',evidence,observed:40,candidateTopics:0,inferredTopics:[],platformCounts:{X:35,TikTok:5},stages,errors:[],sourcePages:['https://x.com/home','https://www.tiktok.com/foryou']}});
 assert.equal(row.schemaVersion,26);assert.equal(row.durationMs,100);assert.equal(row.usableEvidence,40);assert.equal(row.uniqueCreators,40);assert.equal(row.inferredTopics,0);assert.equal(row.sourceCounts['discovery TikTok'],5);assert.equal(row.samples.length,30);assert.equal(row.vision.visuallyUnderstood,1);assert.equal(row.transcriptEvidence,1);assert.equal(row.understandingFrames,2);assert.deepEqual(row.stages,stages);
 assert.equal(row.narrativeMemory.persisted,true);assert(row.narrativeMemory.retained>=1);assert.equal(fs.existsSync(path.join(dir,'narrative-memory-v26.json')),true);
 assert(row.scanSignals.some(signal=>['EARLY','RISING'].includes(signal.scanStatus)));assert(row.scanSignalCounts.EARLY+row.scanSignalCounts.RISING>=1);assert.equal(row.scanSignalCounts.QUALIFIED,0);
 assert(row.samples.some(sample=>sample.understanding));
}));

test('failed scans never teach or persist long-term narrative memory',()=>withTempBridgeData((dir)=>{
 const row=buildScanLedgerEntry({id:'failed-scan',finalStatus:'failed',startedAt:100,completedAt:200,request:{},connected:true,contentStatus:{enabled:true,model:'qwen3-vl:4b-instruct'},postStatus:{enabled:true},latestLive:baseLive()});
 assert.equal(row.narrativeMemory.eligible,false);
 assert.equal(row.narrativeMemory.persisted,false);
 assert.equal(row.narrativeMemory.retained,0);
 assert.equal(fs.existsSync(path.join(dir,'narrative-memory-v26.json')),false);
}));

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
