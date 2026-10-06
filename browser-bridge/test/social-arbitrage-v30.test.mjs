import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectBehaviorSignals, deriveSocialArbCandidates, SocialArbitrageEngineV30 } from '../src/social-arbitrage-v30.mjs';

function row(id,author,content,extra={}){
 return{
  id,author,content,platform:'TikTok',url:`https://www.tiktok.com/@${author}/video/${id.padStart(10,'1')}`,
  published:Date.now()-60000,postSubject:'Glow Bottle',semanticNarrativeKey:'glow bottle',postUnderstandingConfidence:.9,...extra,
 };
}

test('classifies consumer-behavior language instead of stock chatter',()=>{
 const tags=detectBehaviorSignals("I bought another one today. My Target is sold out and I'm switching from my old bottle.");
 assert.ok(tags.includes('PURCHASED'));
 assert.ok(tags.includes('STOCKOUT'));
 assert.ok(tags.includes('SWITCHING'));
});

test('builds a change signal from independent creators and behavior evidence',()=>{
 const rows=[
  row('1','alice','I bought this yesterday and already ordered another one.'),
  row('2','bob',"Where can I buy this? It's sold out everywhere."),
  row('3','carol','Everyone at school has one now and I switched from my old bottle.',{platform:'Instagram',url:'https://www.instagram.com/reel/AbCdEf12/'}),
 ];
 const [signal]=deriveSocialArbCandidates(rows,{history:{},now:Date.now()});
 assert.equal(signal.key,'glow bottle');
 assert.equal(signal.authorCount,3);
 assert.equal(signal.evidenceCount,3);
 assert.equal(signal.change.newToBaseline,true);
 assert.ok(signal.behaviorCount>=5);
 assert.ok(['RISING','HIGH_SIGNAL'].includes(signal.status));
 assert.equal(signal.direction,'positive');
});

test('compares a scan with historical baseline',()=>{
 const now=Date.now();
 const history={'glow bottle':[
  {at:now-86400000,evidenceCount:1,authorCount:1,behaviorCount:1},
  {at:now-2*86400000,evidenceCount:1,authorCount:1,behaviorCount:1},
 ]};
 const rows=[
  row('10','a','I bought one.'),
  row('11','b','I bought another one and they are sold out.'),
  row('12','c','Where can I buy this?'),
  row('13','d','Everyone at work has one now.'),
 ];
 const [signal]=deriveSocialArbCandidates(rows,{history,now});
 assert.equal(signal.change.growthMultiple,4);
 assert.equal(signal.change.authorMultiple,4);
 assert.ok(signal.score>60);
});

test('engine works without a model provider and retains evidence-first output',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-social-arb-'));
 try{
  const oldProvider=process.env.FRONT_SOCIAL_ARB_PROVIDER;
  process.env.FRONT_SOCIAL_ARB_PROVIDER='off';
  const engine=new SocialArbitrageEngineV30({dataDir:dir});
  const result=await engine.analyze([
   row('20','one','I bought it and need another one.'),
   row('21','two','Sold out at every store near me.'),
  ],{mode:'deep'});
  assert.ok(result.signals.length>=1);
  assert.equal(result.signals[0].mappingStatus,'unmapped');
  assert.equal(result.stats.provider,'off');
  if(oldProvider===undefined)delete process.env.FRONT_SOCIAL_ARB_PROVIDER;else process.env.FRONT_SOCIAL_ARB_PROVIDER=oldProvider;
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
