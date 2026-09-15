import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyNarrativeMemory,memoryScanSignals,narrativeMemoryWeight,summarizeNarrativeMemory,updateNarrativeMemory} from '../src/narrative-memory-v26.mjs';

const now=1_800_000_000_000;
const row=(id,author,platform,offsetHours=0,extra={})=>({id,platform,author,url:`https://example.test/${id}`,postSubject:'Daejon Love interview meme',postEvent:'interview clip becomes meme',semanticNarrativeKey:'daejon love interview meme',postUnderstandingConfidence:.9,firstObserved:now-offsetHours*3600000,...extra});

test('weak semantic evidence accumulates across scans without auto-qualifying',()=>{
 let memory=emptyNarrativeMemory();
 memory=updateNarrativeMemory(memory,[row('1','a','X')],[],{now,scanId:'s1'});
 let signals=memoryScanSignals(memory,{now,currentEvidenceIds:['1']});
 assert.equal(signals[0].scanStatus,'WATCH');
 memory=updateNarrativeMemory(memory,[row('2','b','TikTok')],[],{now:now+1000,scanId:'s2'});
 signals=memoryScanSignals(memory,{now:now+1000,currentEvidenceIds:['2']});
 assert.equal(signals[0].scanStatus,'EARLY');
 assert.equal(signals[0].corroborated,false);
 assert.equal(signals[0].tier,'pre-breakout');
 memory=updateNarrativeMemory(memory,[row('3','c','TikTok')],[],{now:now+2000,scanId:'s3'});
 signals=memoryScanSignals(memory,{now:now+2000,currentEvidenceIds:['3']});
 assert.equal(signals[0].scanStatus,'RISING');
 assert.equal(signals[0].corroborated,false);
});

test('same creator handle across platforms counts once in rolling memory',()=>{
 let memory=emptyNarrativeMemory();
 memory=updateNarrativeMemory(memory,[row('1','same','X'),row('2','@same','TikTok')],[],{now,scanId:'same-scan'});
 const record=memory.narratives['daejon love interview meme'];
 const summary=summarizeNarrativeMemory(record,now);
 assert.equal(summary.creatorCount,1);
 assert.equal(summary.independentCreatorCount,1);
 const [signal]=memoryScanSignals(memory,{now,currentEvidenceIds:['1','2']});
 assert.equal(signal.scanStatus,'WATCH');
});

test('many comments remain supporting context and cannot replace independent top-level creators',()=>{
 let memory=emptyNarrativeMemory();
 const evidence=[row('top','creator','TikTok'),...Array.from({length:12},(_,i)=>row(`c${i}`,`commenter${i}`,'TikTok',0,{evidenceRole:'comment',parentId:'top'}))];
 memory=updateNarrativeMemory(memory,evidence,[],{now,scanId:'comments'});
 const summary=summarizeNarrativeMemory(memory.narratives['daejon love interview meme'],now);
 assert.equal(summary.independentCreatorCount,1);
 assert.equal(summary.creatorCount,13);
 assert(summary.commentSupport>0);
 const [signal]=memoryScanSignals(memory,{now,currentEvidenceIds:evidence.map(item=>item.id)});
 assert.equal(signal.scanStatus,'WATCH');
 assert.equal(signal.authorCount,1);
});

test('recent memory strengthens only a topic actually seen again in the current scan',()=>{
 let memory=emptyNarrativeMemory();
 memory=updateNarrativeMemory(memory,[row('1','a','X'),row('2','b','TikTok')],[],{now,scanId:'prior'});
 assert.equal(memoryScanSignals(memory,{now:now+1000,currentEvidenceIds:[]}).length,0);
 assert.equal(memoryScanSignals(memory,{now:now+1000,currentEvidenceIds:['unrelated-current-id']}).length,0);
 const signals=memoryScanSignals(memory,{now:now+1000,currentEvidenceIds:['2']});
 assert.equal(signals.length,1);
 assert.equal(signals[0].scanStatus,'EARLY');
});

test('stale evidence decays to history and cannot create current momentum by itself',()=>{
 assert.equal(narrativeMemoryWeight(5*3600000),1);
 assert.equal(narrativeMemoryWeight(2*24*3600000),.7);
 assert.equal(narrativeMemoryWeight(10*24*3600000),.15);
 assert.equal(narrativeMemoryWeight(15*24*3600000),0);
 let memory=emptyNarrativeMemory();
 memory=updateNarrativeMemory(memory,[row('old1','a','X',24*20),row('old2','b','TikTok',24*20)],[],{now,scanId:'old'});
 assert.equal(memoryScanSignals(memory,{now,currentEvidenceIds:[]}).length,0);
});
