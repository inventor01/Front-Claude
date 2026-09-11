import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTopics, enrichMomentum, sameTopicKey, topicSnapshot } from '../src/topic-engine.mjs';
import { dedupeEvidence } from '../src/core.mjs';

const NOW=1789125000000;
const x=(author,id,content,mins=1)=>({platform:'X',author,url:`https://x.com/${author}/status/${id}`,content,published:NOW-mins*60000,views:5000+mins*100,likes:300+mins*10});
const t=(author,id,content,mins=1)=>({platform:'TikTok',author,url:`https://www.tiktok.com/@${author}/video/${id}`,content,published:NOW-mins*60000,views:15000+mins*300,likes:1200+mins*20});

test('clusters obvious formatting and near spelling variants',()=>{
 assert.equal(sameTopicKey('Astra','#ASTRA'),true);
 assert.equal(sameTopicKey('Daejon Love','Dejon Love'),true);
 assert.equal(sameTopicKey('Astra','Asteroid'),false);
 assert.equal(sameTopicKey('Banana Phone Kid','Banana Phone Kid reaction'),true);
});

test('recovers repeated lowercase Astra without promoting random neighboring words',()=>{
 const rows=[x('a','101','astra is all over my timeline right now',1),t('b','1234567890123456701','people keep talking about astra today',2),x('c','102','why is everyone posting astra suddenly',3),x('d','103','completely unrelated sandwich review',4)];
 const topics=detectTopics(rows,NOW,20);
 assert(topics.some(row=>row.key==='astra'||row.topic.toLowerCase()==='astra'),'expected Astra to surface');
 assert(!topics.some(row=>row.key==='sandwich'),'one-off lowercase tokens must not surface');
});

test('rejects repeated plain English words as topics while keeping a specific phrase',()=>{
 const rows=[
  x('a','111','Never thought someone would trade the Blue one',1),
  x('b','112','someone said never trade the blue version',2),
  t('c','1234567890123456711','Blue is what someone picked, never trade it',3),
  x('d','113','trade it blue if someone says never',4),
  x('e','114','the Blue Smurf Cat meme is suddenly everywhere',5),
  t('f','1234567890123456712','people keep posting Blue Smurf Cat today',6),
  x('g','115','Blue Smurf Cat is all over my feed',7),
 ];
 const topics=detectTopics(rows,NOW,30);
 const labels=topics.map(row=>row.topic.toLowerCase());
 for(const word of ['never','blue','trade','someone']) assert(!labels.includes(word),`${word} must not become an early candidate`);
 assert(topics.some(row=>/blue smurf cat/i.test(row.topic)),'specific multi-word narrative should still surface');
});

test('keeps niche Daejon/Dejon variant cluster while requiring natural-language creator support',()=>{
 const rows=[x('a','201','Daejon Love reaction is taking over',1),t('b','1234567890123456702','#DejonLove clip is everywhere',2),x('c','202','that Dejon Love meme keeps getting reposted',3)];
 const topics=detectTopics(rows,NOW,20);const hit=topics.find(row=>/d[ae]+jon/i.test(row.topic)||/d[ae]+jon/.test(row.key));
 assert(hit);assert(hit.authorCount>=2);assert(hit.evidenceCount>=2);assert.equal(hit.tier,'candidate');
});

test('two independent lowercase mentions can enter pre-breakout without being promoted',()=>{
 const rows=[x('a','211','astra just popped up on my feed',1),x('b','212','anyone else seeing astra?',2)];
 const hit=detectTopics(rows,NOW,20).find(row=>row.key==='astra'||row.topic.toLowerCase()==='astra');
 assert(hit);assert.equal(hit.tier,'pre-breakout');assert.equal(hit.corroborated,false);assert.equal(hit.authorCount,2);
});

test('momentum marks creator acceleration across scans',()=>{
 const scan1=detectTopics([x('a','301','astra everywhere',20),t('b','1234567890123456703','astra again',19),x('c','302','astra discussion',18)],NOW-15*60000,20);
 const history=[topicSnapshot(scan1,NOW-15*60000)];
 const scan2=detectTopics([x('a','301','astra everywhere',20),t('b','1234567890123456703','astra again',19),x('c','302','astra discussion',18),x('d','303','astra keeps spreading',2),t('e','1234567890123456704','astra on my fyp',1)],NOW,20);
 const astra=enrichMomentum(scan2,history,NOW).find(row=>row.key==='astra'||row.topic.toLowerCase()==='astra');
 assert(astra);assert.equal(astra.momentum.label,'Accelerating');assert(astra.momentum.creatorDelta>=2);
});

test('multi-window momentum exposes 15m and 1h creator growth',()=>{
 const old=detectTopics([x('a','701','astra everywhere',120),t('b','1234567890123456771','astra everywhere too',119)],NOW-60*60000,20);
 const recent=detectTopics([x('a','701','astra everywhere',120),t('b','1234567890123456771','astra everywhere too',119),x('c','702','astra spreading',12)],NOW-15*60000,20);
 const current=detectTopics([x('a','701','astra everywhere',120),t('b','1234567890123456771','astra everywhere too',119),x('c','702','astra spreading',12),x('d','703','astra everywhere now',2),t('e','1234567890123456772','astra keeps appearing',1)],NOW,20);
 const enriched=enrichMomentum(current,[topicSnapshot(old,NOW-60*60000),topicSnapshot(recent,NOW-15*60000)],NOW);
 const astra=enriched.find(row=>row.key==='astra'||row.topic.toLowerCase()==='astra');
 assert(astra);assert(astra.momentum.windows['15']);assert(astra.momentum.windows['60']);assert(astra.momentum.windows['15'].creatorDelta>=2);assert(astra.momentum.windows['60'].creatorDelta>=3);
});

test('origin candidate uses earliest dated supporting evidence',()=>{
 const rows=[x('a','801','astra everywhere',3),t('b','1234567890123456781','astra again',9),x('c','802','astra discussion',5)];
 const astra=detectTopics(rows,NOW,20).find(row=>row.key==='astra'||row.topic.toLowerCase()==='astra');
 assert(astra?.originCandidate);assert.equal(astra.originCandidate.published,NOW-9*60000);assert.match(astra.originCandidate.url,/tiktok\.com/);
});

test('golden quality suite rejects 100 UI/metric/notification rows before detection',()=>{
 const junk=[];const templates=['743.6K','1.2M views','Show','Show more','Hashtag','Caption','Video','Profile','Likes','Quote','throwing100s, Kay.Mareee and 47 others liked your video.'];
 for(let i=0;i<100;i++)junk.push(t(`junk${i}`,String(8234567890123456000n+BigInt(i)),templates[i%templates.length],i+1));
 const cleaned=dedupeEvidence(junk);const topics=detectTopics(cleaned,NOW,100);assert.equal(topics.length,0,'junk replay must produce zero topics');
});

test('golden mixed replay finds known narratives while suppressing one-offs',()=>{
 const rows=[];
 for(let i=0;i<5;i++)rows.push(i%2?x(`astra${i}`,`4${i}1`,`astra is becoming a thing on my feed`,i+1):t(`astra${i}`,`92345678901234567${10+i}`,`astra keeps popping up everywhere`,i+1));
 for(let i=0;i<4;i++)rows.push(i%2?x(`dejon${i}`,`5${i}1`,`Dejon Love reaction clip is spreading`,i+3):t(`dejon${i}`,`92345678901234568${10+i}`,`#DaejonLove reaction meme again`,i+3));
 for(let i=0;i<20;i++)rows.push(x(`one${i}`,`6${i}1`,`uniquephrase${i} something unrelated today`,20+i));
 const topics=detectTopics(rows,NOW,30);
 assert(topics.some(row=>row.key==='astra'||row.topic.toLowerCase()==='astra'));
 assert(topics.some(row=>/d[ae]+jon/i.test(row.topic)||/d[ae]+jon/.test(row.key)));
 assert(!topics.some(row=>/^uniquephrase/.test(row.key)));
});

test('TikTok boilerplate hashtags are discovery seeds, never narratives',()=>{
 const rows=[];
 for(let i=0;i<10;i++)rows.push(t(`tag${i}`,`93345678901234567${10+i}`,'#fyp #viral #funny #capcut #trending',i+1));
 const topics=detectTopics(rows,NOW,30);
 assert.equal(topics.length,0,'platform boilerplate hashtags must not become narrative results');
});

test('Creative Center seed rows do not count as independent creators',()=>{
 const seed={...t('TikTok Creative Center','9434567890123456701','#Astra',1),author:'TikTok Creative Center',url:'https://ads.tiktok.com/business/creativecenter/hashtag/astra',provenance:'Local Chrome browser · TikTok Creative Center trends'};
 const rows=[seed,t('tagger','9434567890123456702','#Astra',2),x('a','901','astra is starting to pop up everywhere',3)];
 assert(!detectTopics(rows,NOW,20).some(row=>row.key==='astra'||row.topic.toLowerCase()==='astra'),'one real text creator plus seed/hashtag rows must not qualify');
 const withSecond=[...rows,x('b','902','people keep talking about astra today',4)];
 const astra=detectTopics(withSecond,NOW,20).find(row=>row.key==='astra'||row.topic.toLowerCase()==='astra');
 assert(astra);assert.equal(astra.authorCount,2);assert.equal(astra.tier,'pre-breakout');
});

test('natural narrative phrase outranks its TikTok hashtag alias',()=>{
 const rows=[
  x('a','911','Daejon Love sideline reaction is everywhere #DaejonLove',1),
  t('b','9534567890123456701','people keep reposting the Daejon Love sideline reaction #fyp #DaejonLove',2),
  x('c','912','Daejon Love sideline reaction became a meme overnight',3),
 ];
 const hit=detectTopics(rows,NOW,30).find(row=>/daejon love/i.test(row.topic)||/daejon love/i.test(row.key));
 assert(hit,'expected the narrative cluster to surface');
 assert(!hit.topic.startsWith('#'));
 assert(!['fyp','viral','trending','capcut'].includes(hit.topic.toLowerCase()));
 assert(hit.authorCount>=2);
});
