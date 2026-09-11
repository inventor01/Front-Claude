import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTopics } from '../src/topic-engine.mjs';
import { attachVisualSignals, shouldAutoDeep } from '../src/advanced-intelligence.mjs';

const NOW=1789159800000;
const x=(author,id,content,mins,views,extra={})=>({id:`x:${id}`,platform:'X',author,url:`https://x.com/${author}/status/${id}`,content,published:NOW-mins*60000,views,likes:Math.round(views*.02),...extra});
const t=(author,id,content,mins,views,extra={})=>({id:`t:${id}`,platform:'TikTok',author,url:`https://www.tiktok.com/@${author}/video/${id}`,content,published:NOW-mins*60000,views,likes:Math.round(views*.04),...extra});

test('generic Original never becomes a narrative even when repeated',()=>{
 const rows=[x('a','1','Original',1,120000),x('b','2','Original',2,90000),t('c','1234567890123456789','Original #fyp',3,180000),x('d','4','original sound',4,50000)];
 const topics=detectTopics(rows,NOW,20);
 assert(!topics.some((topic)=>/^original(?:s)?$/i.test(topic.topic)||/^original(?:s)?$/i.test(topic.key)));
});

test('multilingual sound boilerplate and ordinary words never become narratives',()=>{
 const rows=[
  t('a','1234567890123456701','sonido original',1,90000),t('b','1234567890123456702','Sonido Original #fyp',2,100000),
  t('c','1234567890123456703','оригинальный звук',3,120000),t('d','1234567890123456704','оригинальный звук',4,80000),
  x('e','41','ever',2,30000),x('f','42','ever',3,25000),t('g','1234567890123456705','ever',4,50000),
  x('h','43','created',2,30000),x('i','44','created',3,25000),t('j','1234567890123456706','created',4,50000),
 ];
 const topics=detectTopics(rows,NOW,30).map((topic)=>topic.key);
 for(const junk of ['sonido','sonido original','оригинальный','оригинальный звук','ever','created'])assert(!topics.includes(junk),`${junk} must stay out of narratives`);
});

test('specific one-word names can still surface with independent support',()=>{
 const rows=[x('a','11','astra is suddenly all over my timeline',1,30000),x('b','12','everyone is posting astra today',2,25000),t('c','1234567890123456790','astra keeps showing up on my fyp',3,40000)];
 const topic=detectTopics(rows,NOW,20).find((row)=>row.key==='astra');
 assert(topic,'Astra should remain eligible with three independent creators');
});

test('person-name fragments collapse into the fuller event entity',()=>{
 const rows=[
  x('a','51','Madison Cassaday airport reaction is everywhere',2,30000),
  t('b','1234567890123456711','Madison Cassaday airport reaction is everywhere',4,42000),
  x('c','52','people keep reposting Madison Cassaday airport reaction',6,18000),
  t('d','1234567890123456712','Madison Cassaday airport reaction again',8,26000),
 ];
 const topics=detectTopics(rows,NOW,30);
 assert(topics.some((topic)=>/madison cassaday/i.test(topic.topic)),'full entity should survive');
 assert(!topics.some((topic)=>/^madison$/i.test(topic.topic)||/^cassaday$/i.test(topic.topic)),'single-name fragments should be suppressed when the same evidence supports the full name');
});

test('cross-platform badge requires the same event, not merely two platforms',()=>{
 const rows=[
  x('a','61','Nova Harbor mascot falls off the stage',2,45000),
  t('b','1234567890123456721','Nova Harbor mascot falls off the stage',3,52000),
  x('c','62','Nova Harbor mascot stage fall remix',5,32000),
 ];
 const hit=detectTopics(rows,NOW,20).find((topic)=>/nova harbor/i.test(topic.topic));
 assert(hit,'specific event should surface');
 assert.equal(hit.crossPlatform?.corroborated,true);
 assert(hit.crossPlatform.creators>=2);
});

test('100K fast post plus cross-post evidence becomes highest priority and triggers Deep',()=>{
 const sound='sound-viral-1';
 const rows=[
  x('early','21','Daejon Love sideline reaction is everywhere',45,180000,{reposts:5000,quotes:700}),
  t('remix','1234567890123456791','Daejon Love sideline reaction is everywhere',60,130000,{shares:9000,soundId:sound}),
  t('third','1234567890123456792','people keep reposting the Daejon Love sideline reaction',70,95000,{shares:4000,soundId:sound}),
 ];
 const base=detectTopics(rows,NOW,20);
 const enriched=attachVisualSignals(base,rows);
 const hit=enriched.find((row)=>/daejon love/i.test(row.topic));
 assert(hit,'specific narrative should surface');
 assert(hit.hotPosts?.some((post)=>post.hot),'fast post should be analyzed as hot');
 assert(hit.maxViewsPerHour>=100000,'views/hour should be computed post by post');
 assert(hit.crossPostedCreators>=2,'shared sound/text across independent creators should count as cross-post spread');
 assert(hit.priorityScore>hit.baseNarrativeScore,'post velocity should boost priority');
 const decision=shouldAutoDeep(enriched,{uniqueCreators:3},NOW);
 assert.equal(decision.trigger,true);
 assert(decision.reasons.some((reason)=>/views|cross-post/i.test(reason)));
});

test('high views from one creator alone cannot clear narrative gate',()=>{
 const rows=[x('solo','31','Banana Spaceship Dance is exploding',10,800000)];
 assert.equal(detectTopics(rows,NOW,20).length,0);
});
