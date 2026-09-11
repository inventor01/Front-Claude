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
});

test('recovers repeated lowercase Astra without promoting random neighboring words',()=>{
 const rows=[
  x('a','101','astra is all over my timeline right now',1),
  t('b','1234567890123456701','people keep talking about astra today',2),
  x('c','102','why is everyone posting astra suddenly',3),
  x('d','103','completely unrelated sandwich review',4),
 ];
 const topics=detectTopics(rows,NOW,20);
 assert(topics.some(row=>row.key==='astra'||row.topic.toLowerCase()==='astra'),'expected Astra to surface');
 assert(!topics.some(row=>row.key==='sandwich'),'one-off lowercase tokens must not surface');
});

test('keeps niche Daejon/Dejon variant cluster and independent creators',()=>{
 const rows=[
  x('a','201','Daejon Love reaction is taking over',1),
  t('b','1234567890123456702','#DejonLove clip is everywhere',2),
  x('c','202','that Dejon Love meme keeps getting reposted',3),
 ];
 const topics=detectTopics(rows,NOW,20);
 const hit=topics.find(row=>/d[ae]+jon/i.test(row.topic)||/d[ae]+jon/.test(row.key));
 assert(hit);assert(hit.authorCount>=3);assert(hit.evidenceCount>=3);
});

test('momentum marks creator acceleration across scans',()=>{
 const scan1=detectTopics([x('a','301','astra everywhere',20),t('b','1234567890123456703','astra again',19),x('c','302','astra discussion',18)],NOW-15*60000,20);
 const history=[topicSnapshot(scan1,NOW-15*60000)];
 const scan2=detectTopics([x('a','301','astra everywhere',20),t('b','1234567890123456703','astra again',19),x('c','302','astra discussion',18),x('d','303','astra keeps spreading',2),t('e','1234567890123456704','astra on my fyp',1)],NOW,20);
 const enriched=enrichMomentum(scan2,history,NOW);
 const astra=enriched.find(row=>row.key==='astra'||row.topic.toLowerCase()==='astra');
 assert(astra);assert.equal(astra.momentum.label,'Accelerating');assert(astra.momentum.creatorDelta>=2);
});

test('golden quality suite rejects 100 UI/metric/notification rows before detection',()=>{
 const junk=[];
 const templates=['743.6K','1.2M views','Show','Show more','Hashtag','Caption','Video','Profile','Likes','Quote','throwing100s, Kay.Mareee and 47 others liked your video.'];
 for(let i=0;i<100;i++)junk.push(t(`junk${i}`,String(8234567890123456000n+BigInt(i)),templates[i%templates.length],i+1));
 const cleaned=dedupeEvidence(junk);
 const topics=detectTopics(cleaned,NOW,100);
 assert.equal(topics.length,0,'junk replay must produce zero topics');
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
