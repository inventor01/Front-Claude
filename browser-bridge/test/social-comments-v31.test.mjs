import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSocialComment, selectCommentTargets, socialCommentId } from '../src/social-comments-v31.mjs';
import { deriveSocialArbCandidates } from '../src/social-arbitrage-v30.mjs';

test('normalizes TikTok comments as Social-Arb-only evidence',()=>{
  const row=normalizeSocialComment(
    {author:'@buyer_1',content:'I bought another one and my Target is sold out.'},
    {
      platform:'TikTok',
      parentUrl:'https://www.tiktok.com/@demo/video/1234567890123456789?is_from_webapp=1',
      parentEvidenceId:'tiktok:browser:1234567890123456789',
      subject:'Glow Bottle',
      now:1234,
    }
  );
  assert.ok(row);
  assert.equal(row.evidenceType,'comment');
  assert.equal(row.socialArbSubject,'Glow Bottle');
  assert.equal(row.url,'https://www.tiktok.com/@demo/video/1234567890123456789');
  assert.equal(row.author,'buyer_1');
  assert.equal(row.firstObserved,1234);
  assert.equal(row.id,socialCommentId({platform:'TikTok',parentUrl:row.url,author:'buyer_1',content:row.content}));
});

test('targets only TikTok evidence from strongest Social Arb candidates',()=>{
  const signals=[
    {
      key:'glow bottle',title:'Glow Bottle',status:'RISING',behaviorCount:3,
      evidence:[
        {id:'tt1',url:'https://www.tiktok.com/@one/video/1234567890123456789'},
        {id:'ig1',url:'https://www.instagram.com/reel/AbCdEf12/'},
        {id:'tt2',url:'https://www.tiktok.com/@two/video/2234567890123456789?foo=bar'},
      ],
    },
    {
      key:'other',title:'Other Product',status:'WATCH',behaviorCount:0,
      evidence:[{id:'tt3',url:'https://www.tiktok.com/@three/video/3234567890123456789'}],
    },
  ];
  const targets=selectCommentTargets(signals,{mode:'deep',maxSignals:2,maxPostsPerSignal:2});
  assert.equal(targets.length,2);
  assert.ok(targets.every((target)=>target.url.includes('tiktok.com/')));
  assert.equal(targets[1].url,'https://www.tiktok.com/@two/video/2234567890123456789');
  assert.ok(targets.every((target)=>target.signalKey==='glow bottle'));
});

test('commenters strengthen Social Arb without inflating creator counts',()=>{
  const post={
    id:'post1',platform:'TikTok',author:'creator',url:'https://www.tiktok.com/@creator/video/1234567890123456789',
    content:'Trying the Glow Bottle today',published:Date.now()-1000,
    postSubject:'Glow Bottle',semanticNarrativeKey:'glow bottle',postUnderstandingConfidence:.9,
  };
  const comments=[
    normalizeSocialComment({author:'buyer1',content:'I bought this yesterday and already ordered another.'},{platform:'TikTok',parentUrl:post.url,parentEvidenceId:post.id,subject:'Glow Bottle'}),
    normalizeSocialComment({author:'buyer2',content:'Where can I buy this? It is sold out everywhere.'},{platform:'TikTok',parentUrl:post.url,parentEvidenceId:post.id,subject:'Glow Bottle'}),
    normalizeSocialComment({author:'buyer3',content:'Everyone at school has one now.'},{platform:'TikTok',parentUrl:post.url,parentEvidenceId:post.id,subject:'Glow Bottle'}),
  ].filter(Boolean);
  const [signal]=deriveSocialArbCandidates([post,...comments],{history:{},now:Date.now()});
  assert.equal(signal.authorCount,1);
  assert.equal(signal.commenterCount,3);
  assert.equal(signal.independentVoiceCount,4);
  assert.equal(signal.evidence.filter((item)=>item.evidenceType==='comment').length,3);
  assert.ok(signal.behaviorCount>=4);
  assert.ok(signal.score>45);
});
