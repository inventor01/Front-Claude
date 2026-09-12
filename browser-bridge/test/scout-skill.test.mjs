import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachObservedMetricVelocity,
  evaluateDiscoveryPass,
  rankInvestigationCandidates,
  scoutBroadeningPlan,
} from '../src/scout-skill.mjs';

const NOW = 2_000_000_000_000;
const x = (author, id, content, views, minutesAgo = 30, extra = {}) => ({
  id:`x:${id}`, platform:'X', author, url:`https://x.com/${author}/status/${id}`, content,
  published:NOW-minutesAgo*60_000, views, likes:Math.round((views||0)*.04), ...extra,
});
const t = (author, id, content, views, minutesAgo = 30, extra = {}) => ({
  id:`tiktok:browser:${id}`, platform:'TikTok', author, url:`https://www.tiktok.com/@${author}/video/${id}`, content,
  published:NOW-minutesAgo*60_000, views, likes:Math.round((views||0)*.06), ...extra,
});

test('discovery pass focuses when a specific event repeats across independent fast creators',()=>{
  const rows=[
    x('a','1','blue astronaut dance at the arena',120000,40),
    x('b','2','blue astronaut dance is everywhere',90000,35),
    x('c','3','the blue astronaut dance clip is taking over',80000,28),
    x('d','4','unrelated lunch post',120,30),
  ];
  const result=evaluateDiscoveryPass(rows,{pass:2,platform:'X',now:NOW,minSample:4});
  assert.equal(result.focus,true);
  assert(result.repeatedLanguage.creators>=3);
  assert(result.reasons.some((reason)=>reason.includes('creators repeating')));
});

test('one viral creator alone never causes focus',()=>{
  const rows=[
    x('solo','1','blue astronaut dance',2_000_000,20),
    x('other','2','completely unrelated story',300,20),
    x('third','3','another unrelated subject',200,20),
  ];
  const result=evaluateDiscoveryPass(rows,{pass:3,platform:'X',now:NOW,minSample:3});
  assert.equal(result.focus,false);
});

test('repeated media context across independent creators is a focus signal',()=>{
  const rows=[
    t('a','1111111111111111111','look at this',20000,20,{soundId:'sound-9'}),
    t('b','2222222222222222222','this version is wild',18000,18,{soundId:'sound-9'}),
    t('c','3333333333333333333','another remix',24000,15,{soundId:'sound-9'}),
  ];
  const result=evaluateDiscoveryPass(rows,{pass:2,platform:'TikTok',now:NOW,minSample:3});
  assert.equal(result.focus,true);
  assert.equal(result.repeatedContext.creators,3);
});

test('candidate ranking prefers same-event cross-platform and fast independent support',()=>{
  const evidence=[
    x('a','1','Daejon Love interview moment',120000,50),
    t('b','1111111111111111111','Daejon Love interview clip',160000,45),
    x('c','2','Daejon Love reaction',70000,40),
    x('z','9','other topic',900,30),
    x('y','8','other topic again',800,30),
  ];
  const topics=[
    {topic:'Daejon Love',key:'daejon love',authorCount:3,evidenceIds:evidence.slice(0,3).map((row)=>row.id),score:30,crossPlatform:{corroborated:true}},
    {topic:'Other Topic',key:'other topic',authorCount:2,evidenceIds:evidence.slice(3).map((row)=>row.id),score:38,crossPlatform:{corroborated:false}},
  ];
  const ranked=rankInvestigationCandidates(topics,evidence,{limit:2,now:NOW});
  assert.equal(ranked[0].key,'daejon love');
  assert.equal(scoutBroadeningPlan(ranked,'scout').focusFirst,true);
});

test('observed velocity requires two real snapshots instead of inventing age',()=>{
  const first=attachObservedMetricVelocity([{id:'p1',views:100000,likes:5000,published:null}],{},NOW,{minElapsedMs:60_000});
  assert.equal(first.rows[0].viewsPerMinute,null);
  const second=attachObservedMetricVelocity([{id:'p1',views:130000,likes:6500,published:null}],first.state,NOW+10*60_000,{minElapsedMs:60_000});
  assert.equal(second.rows[0].viewsPerMinute,3000);
  assert.equal(second.rows[0].likesPerMinute,150);
});
