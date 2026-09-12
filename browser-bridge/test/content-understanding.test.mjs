import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyUnderstanding,
  ContentUnderstandingEngine,
  frameSchedule,
  parseUnderstandingJson,
  selectVideoCandidates,
} from '../src/content-understanding.mjs';

test('frame schedule covers the whole short-video timeline without exploding frame count',()=>{
  const times=frameSchedule(9,16);
  assert(times.length>=10&&times.length<=16);
  assert.equal(times[0],0);
  assert(times.at(-1)>8.8);
  for(let i=1;i<times.length;i++)assert(times[i]>times[i-1]);
});

test('long videos use representative timeline coverage capped at maxFrames',()=>{
  const times=frameSchedule(180,12);
  assert.equal(times.length,12);
  assert.equal(times[0],0);
  assert(times.at(-1)>179);
});

test('video candidates diversify independent creators instead of spending the budget on one account',()=>{
  const rows=[
    {id:'1',platform:'TikTok',author:'a',url:'https://www.tiktok.com/@a/video/1',content:'',views:900000,likes:50000,mediaType:'video',provenance:'TikTok For You'},
    {id:'2',platform:'TikTok',author:'a',url:'https://www.tiktok.com/@a/video/2',content:'second post',views:800000,likes:40000,mediaType:'video',provenance:'TikTok For You'},
    {id:'3',platform:'TikTok',author:'b',url:'https://www.tiktok.com/@b/video/3',content:'',views:120000,likes:9000,mediaType:'video',provenance:'TikTok For You'},
    {id:'4',platform:'X',author:'c',url:'https://x.com/c/status/4',content:'caption',views:50000,likes:3000,mediaType:'video',provenance:'X For You'},
  ];
  const selected=selectVideoCandidates(rows,{limit:3});
  assert.equal(selected.length,3);
  assert.equal(new Set(selected.map((row)=>`${row.platform}:${row.author}`)).size,3);
});

test('strict JSON parser keeps grounded content fields and confidence',()=>{
  const result=parseUnderstandingJson('```json\n{"summary":"A mascot slips during a sideline dance while the crowd reacts.","event":"mascot sideline slip","entities":["mascot","crowd"],"actions":["dancing","slipping"],"onScreenText":["HALFTIME"],"visualMotifs":["reaction shot"],"memePotential":0.82,"confidence":0.91,"uncertainties":[]}\n```');
  assert(result);
  assert.equal(result.event,'mascot sideline slip');
  assert.deepEqual(result.entities,['mascot','crowd']);
  assert.equal(result.confidence,0.91);
});

test('high-confidence understanding enriches evidence text without replacing the source caption',()=>{
  const row={id:'x:1',platform:'X',author:'a',url:'https://x.com/a/status/1',content:'bro 😭',mediaType:'video'};
  const enriched=applyUnderstanding(row,{
    summary:'A mascot slips during a sideline dance and the crowd reacts.',
    event:'mascot sideline slip',
    entities:['mascot','crowd'],actions:['slipping'],onScreenText:['HALFTIME'],visualMotifs:['reaction shot'],memePotential:.8,confidence:.9,provider:'openai',model:'test-model',frameCount:8,duration:7,analyzedAt:1,
  });
  assert.match(enriched.content,/bro/);
  assert.match(enriched.content,/mascot sideline slip/i);
  assert.equal(enriched.contentSummary,'A mascot slips during a sideline dance and the crowd reacts.');
  assert.equal(enriched.contentUnderstandingVersion,17);
});

test('low-confidence model output never rewrites evidence content',()=>{
  const row={id:'x:2',platform:'X',author:'a',url:'https://x.com/a/status/2',content:'source caption'};
  const enriched=applyUnderstanding(row,{summary:'Maybe something happens',confidence:.2});
  assert.equal(enriched.content,'source caption');
});

test('content health distinguishes successful and failed persistent cache entries after restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-content-health-'));
  const previousModel=process.env.FRONT_OLLAMA_MODEL;
  const previousProvider=process.env.FRONT_CONTENT_PROVIDER;
  try{
    process.env.FRONT_OLLAMA_MODEL='qwen-test';
    process.env.FRONT_CONTENT_PROVIDER='ollama';
    const now=Date.now();
    const successRow={id:'ok',platform:'TikTok',author:'a',url:'https://www.tiktok.com/@a/video/1000000000001'};
    const failRow={id:'bad',platform:'TikTok',author:'b',url:'https://www.tiktok.com/@b/video/1000000000002'};
    fs.writeFileSync(path.join(dir,'content-understanding-v17.json'),JSON.stringify({
      [`${successRow.platform}|${successRow.id}|${successRow.url}`]:{at:now-1000,ok:true,analysis:{summary:'A mascot falls while dancing.',confidence:.91,provider:'ollama',model:'qwen-test',frameCount:11,modelFrameCount:11,duration:8.4,captureType:'video-timeline',analyzedAt:now-1200}},
      [`${failRow.platform}|${failRow.id}|${failRow.url}`]:{at:now,ok:false,error:'Content analysis timed out.',analysis:null},
    }));
    const engine=new ContentUnderstandingEngine({dataDir:dir});
    const status=engine.status();
    assert.equal(status.enabled,true);
    assert.equal(status.cachedVideos,2);
    assert.equal(status.successfulCachedVideos,1);
    assert.equal(status.failedCachedVideos,1);
    assert.equal(status.latestSuccess.captureType,'video-timeline');
    assert.equal(status.latestSuccess.frameCount,11);
    assert.equal(status.latestFailure.error,'Content analysis timed out.');
    assert.equal(status.state,'cached-ready');
  }finally{
    if(previousModel===undefined)delete process.env.FRONT_OLLAMA_MODEL;else process.env.FRONT_OLLAMA_MODEL=previousModel;
    if(previousProvider===undefined)delete process.env.FRONT_CONTENT_PROVIDER;else process.env.FRONT_CONTENT_PROVIDER=previousProvider;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('recent failed content analysis is cached for cooldown instead of immediately retrying Ollama',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-content-failure-'));
  try{
    const row={id:'bad',platform:'TikTok',author:'b',url:'https://www.tiktok.com/@b/video/1000000000003',content:'',mediaType:'video'};
    fs.writeFileSync(path.join(dir,'content-understanding-v17.json'),JSON.stringify({
      [`${row.platform}|${row.id}|${row.url}`]:{at:Date.now(),ok:false,error:'Previous Ollama timeout',analysis:null},
    }));
    const engine=new ContentUnderstandingEngine({dataDir:dir});
    const result=await engine.analyzeOne(null,row);
    assert.equal(result.cachedFailure,true);
    assert.equal(result.analysis,null);
    assert.match(result.error,/Previous Ollama timeout/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
