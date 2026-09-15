import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';
import {PostUnderstandingEngineV26,semanticAliasPairs} from '../src/post-understanding-v26.mjs';
const rows=[{id:'a',platform:'X',author:'alice',url:'https://x.com/alice/status/1',content:'Google maps fruit fly brain',postSubject:'Google fruit fly brain map',postEvent:'Brain mapping',semanticNarrativeKey:'google fruit fly brain map',postUnderstandingMethod:'semantic-model'},{id:'b',platform:'X',author:'bob',url:'https://x.com/bob/status/2',content:'AI uses fruit fly brain map',postSubject:'AI fruit fly brain map',postEvent:'Brain map demonstration',semanticNarrativeKey:'ai fruit fly brain map',postUnderstandingMethod:'semantic-model'}];
test('shared generic language and same creators do not nominate aliases',()=>{assert.equal(semanticAliasPairs(rows).length,1);assert.equal(semanticAliasPairs([rows[0],{...rows[1],author:'alice'}]).length,0);assert.equal(semanticAliasPairs(rows.map(r=>({...r,semanticNarrativeKey:r.id+' viral video people love face'}))).length,0);});
for(const [same,confidence,merged] of [[true,.95,true],[true,.8,false],[false,.95,false]])test(`alias requires explicit same-story decision above confidence threshold: ${same}/${confidence}`,async()=>{
 const dir=fs.mkdtempSync(os.tmpdir()+'/front-alias-test-');const original=globalThis.fetch;
 try{const engine=new PostUnderstandingEngineV26({dataDir:dir});engine.provider={available:true,provider:'ollama',endpoint:'http://test',model:'test'};
 for(const row of rows)engine.cache[engine.key(row)]={at:Date.now(),frame:{subject:row.postSubject,event:row.postEvent,narrativeKey:row.semanticNarrativeKey,confidence:.9,method:'semantic-model'}};
 let requests=0;globalThis.fetch=async()=>{requests++;return Response.json({message:{content:JSON.stringify([{index:0,same,confidence}])}});};
 const result=await engine.enrich(rows);assert.equal(result.stats.failed,0);assert.equal(requests,1);assert.equal(result.rows[0].semanticNarrativeKey===result.rows[1].semanticNarrativeKey,merged);await engine.enrich(rows);assert.equal(requests,1,'unchanged decisions cached');
 }finally{globalThis.fetch=original;fs.rmSync(dir,{recursive:true,force:true});}
});
