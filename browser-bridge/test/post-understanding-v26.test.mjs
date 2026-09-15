import test from 'node:test';
import assert from 'node:assert/strict';
import { isGenericSubject, applyPostUnderstanding } from '../src/post-understanding-v26.mjs';
import { chooseNarrativeTitle, enhanceNarrativesV26 } from '../src/narrative-intelligence-v26.mjs';

test('generic standalone words cannot become semantic subjects', () => {
  for (const value of ['face', 'take', 'grow', 'love', 'look', 'make', 'viral', 'video', 'thing']) {
    assert.equal(isGenericSubject(value), true, `${value} should be rejected as generic`);
  }
  assert.equal(isGenericSubject('N3ON AI stream incident'), false);
  assert.equal(isGenericSubject('NEO robot X Ads campaign'), false);
  assert.equal(isGenericSubject('mascot halftime fall'), false);
});

test('post understanding stores a subject/event frame separate from raw caption words', () => {
  const row = { id: '1', platform: 'X', author: 'a', url: 'https://x.com/a/status/1', content: 'grow your business with X Ads' };
  const enriched = applyPostUnderstanding(row, {
    subject: 'NEO robot X Ads campaign',
    event: 'NEO robot campaign promoted with X Ads',
    entities: ['NEO robot', 'X Ads'],
    action: 'promoting',
    object: 'robot campaign',
    context: 'product launch marketing',
    narrativeKey: 'neo robot x ads campaign',
    confidence: 0.93,
    method: 'semantic-model',
  });
  assert.equal(enriched.postSubject, 'NEO robot X Ads campaign');
  assert.equal(enriched.semanticNarrativeKey, 'neo robot x ads campaign');
  assert.notEqual(enriched.semanticNarrativeKey, 'grow');
});

test('same generic verb in unrelated posts does not imply the same semantic narrative', () => {
  const marketing = applyPostUnderstanding({ id: 'm', platform: 'X', author: 'brand', url: 'https://x.com/brand/status/1', content: 'Launch products now and grow your business with X Ads. NEO robot campaign.' }, {
    subject: 'NEO robot X Ads campaign', event: 'robot campaign promoted on X', entities: ['NEO robot', 'X Ads'], action: 'promoting', object: 'campaign', context: 'marketing', narrativeKey: 'neo robot x ads campaign', confidence: 0.92, method: 'semantic-model',
  });
  const office = applyPostUnderstanding({ id: 'o', platform: 'X', author: 'office', url: 'https://x.com/office/status/2', content: "Office just opened. We're looking for AI startups who want to grow together." }, {
    subject: 'AI startup coworking office opening', event: 'office opens for AI startups', entities: ['AI startups'], action: 'opening', object: 'coworking office', context: 'startup workspace', narrativeKey: 'ai startup coworking office opening', confidence: 0.9, method: 'semantic-model',
  });
  assert.notEqual(marketing.semanticNarrativeKey, office.semanticNarrativeKey);
});

test('v26 narrative naming rejects one-word generic labels', () => {
  const rows = [
    { id: '1', platform: 'X', author: 'a', content: 'NEO robot campaign promoted with X Ads' },
    { id: '2', platform: 'X', author: 'b', content: 'NEO robot campaign uses X Ads for product launch' },
  ];
  assert.equal(chooseNarrativeTitle({ topic: 'grow', aliases: ['grow'] }, rows), null);
  assert.equal(chooseNarrativeTitle({ topic: 'NEO robot X Ads campaign', aliases: ['grow'] }, rows), 'NEO Robot X Ads Campaign');
});

test('v26 exposes age, lifecycle, velocity, and pre-coin classification', () => {
  const now = 1_800_000_000_000;
  const evidence = [
    { id: '1', platform: 'TikTok', author: 'a', content: 'N3ON AI stream incident', postSubject:'N3ON AI stream incident', semanticNarrativeKey:'n3on ai stream incident', postUnderstandingConfidence:0.9, published: now - 20 * 60000, views: 120000, likes: 9000 },
    { id: '2', platform: 'X', author: 'b', content: 'N3ON AI stream incident', postSubject:'N3ON AI stream incident', semanticNarrativeKey:'n3on ai stream incident', postUnderstandingConfidence:0.9, published: now - 10 * 60000, views: 80000, likes: 5000 },
    { id: '3', platform: 'TikTok', author: 'c', content: 'N3ON AI stream incident', postSubject:'N3ON AI stream incident', semanticNarrativeKey:'n3on ai stream incident', postUnderstandingConfidence:0.9, published: now - 5 * 60000, views: 50000, likes: 4000 },
  ];
  const [topic] = enhanceNarrativesV26([{ topic: 'N3ON AI stream incident', key: 'n3on-ai-stream-incident', evidenceIds: ['1','2','3'], authorCount: 3, evidenceCount: 3, score: 50 }], evidence, now);
  assert(topic);
  assert.equal(topic.opportunityStatus, 'PRE-COIN');
  assert(topic.ageMinutes >= 19 && topic.ageMinutes <= 21);
  assert(topic.velocityScore > 0);
  assert(['EMERGING','EARLY BREAKOUT','VIRAL'].includes(topic.lifecycleStage));
});

test('legacy lexical candidates cannot bypass semantic corroboration',()=>{
 const rows=[{id:'1',platform:'X',author:'a',content:'Office opening'},{id:'2',platform:'X',author:'b',content:'Office opening'}];
 assert.deepEqual(enhanceNarrativesV26([{topic:'Office opening',key:'office opening',evidenceIds:['1','2']}],rows),[]);
});

test('semantic event needs independent creators and confidence',()=>{
 const row={platform:'X',author:'a',postSubject:'Mascot halftime fall',semanticNarrativeKey:'mascot halftime fall',postUnderstandingConfidence:0.9};
 assert.equal(enhanceNarrativesV26([],[{...row,id:'1'},{...row,id:'2'}]).length,0);
 assert.equal(enhanceNarrativesV26([],[{...row,id:'1'},{...row,id:'2',author:'b',postUnderstandingConfidence:0.4}]).length,0);
 assert.equal(enhanceNarrativesV26([],[{...row,id:'1'},{...row,id:'2',author:'b'}]).length,1);
});

test('malformed semantic responses report failures and do not cache fallback as success',async()=>{
 const {PostUnderstandingEngineV26}=await import('../src/post-understanding-v26.mjs');
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-context-'));
 const original=globalThis.fetch;const env=process.env.FRONT_CONTEXT_PROVIDER;
 try{
  process.env.FRONT_CONTEXT_PROVIDER='off';
  const engine=new PostUnderstandingEngineV26({dataDir:dir});engine.provider={available:true,provider:'ollama',endpoint:'http://model.test',model:'test'};
  globalThis.fetch=async()=>Response.json({message:{content:'not JSON'}});
  const rows=[{id:'1',platform:'X',url:'https://x.com/a/status/1',content:'Mascot halftime fall'}];
  const result=await engine.enrich(rows);assert.equal(result.stats.failed,1);assert.equal(result.stats.fallback,1);assert.equal(engine.cached(rows[0]),null);
  assert.match(result.stats.errors.join(' '),/unreadable JSON array/i);
  const key=engine.key(rows[0]);assert.notEqual(engine.key({...rows[0],contentSummary:'A new grounded visual summary'}),key);
  assert.notEqual(engine.key({...rows[0],transcript:'spoken detail changes the story'}),key);
 }finally{globalThis.fetch=original;if(env===undefined)delete process.env.FRONT_CONTEXT_PROVIDER;else process.env.FRONT_CONTEXT_PROVIDER=env;fs.rmSync(dir,{recursive:true,force:true});}
});

test('semantic batching hard-caps local requests at two posts and uses compact transcript-aware payloads',async()=>{
 const {PostUnderstandingEngineV26}=await import('../src/post-understanding-v26.mjs');
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-context-batches-'));
 const original=globalThis.fetch;
 try{
  const engine=new PostUnderstandingEngineV26({dataDir:dir});
  engine.provider={available:true,provider:'ollama',endpoint:'http://model.test',model:'qwen-test'};
  const sizes=[];
  globalThis.fetch=async(_url,{body})=>{
    const payload=JSON.parse(body);
    assert.equal(payload.keep_alive,'30m');
    assert.equal(payload.options.num_predict,400);
    const input=JSON.parse(payload.messages[0].content.split('\n').at(-1));
    sizes.push(input.length);
    assert(input.every(row=>Object.hasOwn(row,'spoken')));
    const result=input.map((row,index)=>({i:index,s:`Specific subject ${row.index}`,e:`specific event ${row.index}`,k:`specific subject ${row.index}`,c:.9}));
    return Response.json({message:{content:JSON.stringify(result)}});
  };
  const rows=Array.from({length:5},(_,i)=>({id:String(i+1),platform:'X',author:`a${i}`,url:`https://x.com/a${i}/status/${i+1}`,content:`Specific event caption ${i+1}`,transcript:i===0?'spoken context from the video':null}));
  const result=await engine.enrich(rows,{batchSize:8});
  assert.deepEqual(sizes,[2,2,1]);
  assert.equal(result.stats.batchSize,2);
  assert.equal(result.stats.transcriptRows,1);
  assert.equal(result.stats.requestCount,3);
  assert.equal(result.rows[0].postSubject,'Specific subject 0');
  assert.equal(result.stats.modeled,5);
  assert.equal(result.stats.failed,0);
  assert.deepEqual(result.stats.errors,[]);
 }finally{globalThis.fetch=original;fs.rmSync(dir,{recursive:true,force:true});}
});

test('semantic timeout is surfaced in stage diagnostics instead of failing silently',async()=>{
 const {PostUnderstandingEngineV26}=await import('../src/post-understanding-v26.mjs');
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-context-timeout-'));
 const original=globalThis.fetch;
 try{
  const engine=new PostUnderstandingEngineV26({dataDir:dir});engine.provider={available:true,provider:'ollama',endpoint:'http://model.test',model:'test'};
  globalThis.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
  const rows=[{id:'1',platform:'X',author:'a',url:'https://x.com/a/status/1',content:'Mascot halftime fall'}];
  const result=await engine.enrich(rows,{batchSize:1,timeoutMs:20});
  assert.equal(result.stats.failed,1);
  assert.match(result.stats.errors.join(' '),/timed out after 20ms/i);
 }finally{globalThis.fetch=original;fs.rmSync(dir,{recursive:true,force:true});}
});

test('same creator handle across platforms and missing creators cannot corroborate',()=>{
 const row={id:'1',platform:'X',author:'same',postSubject:'Mascot halftime fall',semanticNarrativeKey:'mascot halftime fall',postUnderstandingConfidence:.9};
 assert.equal(enhanceNarrativesV26([],[row,{...row,id:'2',platform:'TikTok',author:'@same'}]).length,0);
 assert.equal(enhanceNarrativesV26([],[{...row,author:''},{...row,id:'2',platform:'TikTok',author:''}]).length,0);
});
