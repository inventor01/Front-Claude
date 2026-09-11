import { dedupeEvidence } from './core.mjs';
import {
  detectTopics as baseDetectTopics,
  enrichMomentum as baseEnrichMomentum,
  sameTopicKey,
  topicSnapshot as baseTopicSnapshot,
} from './topic-engine-base.mjs';

export { sameTopicKey };

const GENERIC_SINGLE=new Set((
  'original originals originalsound official officially create creates created creating creation creations creator creators sound sounds audio caption captions video videos photo photos image images '+
  'post posts repost reposts reply replies comment comments share shares view views like likes follow follows part parts episode episodes full live new latest today tonight yesterday tomorrow update updates breaking news '+
  'meme memes viral virality trend trends trending funny reaction reactions clip clips edit edits account accounts user users profile profiles people person guy guys girl girls man men woman women bro dude someone somebody anyone anybody '+
  'everyone everybody thing things stuff something anything everything name names word words topic topics story stories love hate trade trading buy buying sell selling market markets coin coins token tokens crypto solana tiktok twitter x fyp foryou '+
  'ever solo human back everywhere feed timeline discussion discussions appearing appears appear spreading spreads spread popping popped becoming became keeps keep again '+
  'sonido sonidos originales esta este esto hacer hace haciendo hecho haber escucha escuchar escuchando canción cancion canciones música musica nuevo nueva nuevos nuevas hoy ayer mañana '+
  'звук звуки оригинальный оригинальная оригинальное оригинальные оригинал видео фото пост посты тренд тренды вирусный som sons originais postagem postagens compartilhar curtida curtidas tendance tendances originalton'
).split(/\s+/));
const STOP=new Set((
  'the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really now have has had do does did can could would '+
  'should will may might about into over under after before more most some any all one two via amp rt get got like know think make made going go went see saw says said say look looks looking why how what when where who which there here want wants wanted '+
  'el la los las un una unos unas y o pero si de del en por para con sin es son era eran ser fue fueron se su sus mi mis tu tus que como cuando donde quien quienes hay aqui allí ya muy más mas menos todo todos toda todas uno dos'
).split(/\s+/));
const BOILERPLATE=new Set(['original sound','sound original','sonido original','audio original','som original','son original','originalton','оригинальный звук','оригинальная музыка','original audio','official sound']);
const GENERIC_STEM=/^(?:creat(?:e|es|ed|ing|ion|ions|or|ors)|origin(?:al|als|ally)?|sound(?:s)?|audio|video(?:s)?|post(?:s)?|trend(?:s|ing)?|viral|meme(?:s)?|reaction(?:s)?|clip(?:s)?|update(?:s)?|share(?:s|d|ing)?|view(?:s|ed|ing)?|like(?:s|d|ing)?|follow(?:s|ed|ing)?|sonid(?:o|os)|escuch(?:a|ar|ando)|canci[oó]n(?:es)?|звук(?:и)?|оригинальн(?:ый|ая|ое|ые)|som(?:s)?|tend(?:ance|ances))$/iu;

const normalize=(value)=>String(value??'').normalize('NFKC').replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/^#/,'').replace(/[_-]+/g,' ').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const tokens=(value)=>normalize(value).split(' ').filter(Boolean);
const specificWords=(value)=>tokens(value).filter((word)=>word.length>=3&&!STOP.has(word)&&!GENERIC_SINGLE.has(word)&&!GENERIC_STEM.test(word)&&!/^\d+$/.test(word));
const creatorKey=(row)=>`${row.platform}:${String(row.author||'').toLowerCase()}`;
const cleanLabel=(value)=>String(value??'').replace(/^#/,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,100);

function genericLabel(value){
 const normalized=normalize(value),parts=tokens(value);if(!parts.length||BOILERPLATE.has(normalized))return true;
 if(parts.length===1){const word=parts[0];return word.length<4||GENERIC_SINGLE.has(word)||STOP.has(word)||GENERIC_STEM.test(word)||/^\d+$/.test(word);}
 const specific=specificWords(value);if(!specific.length)return true;
 const noise=parts.filter((word)=>STOP.has(word)||GENERIC_SINGLE.has(word)||GENERIC_STEM.test(word)||word.length<3).length;
 return parts.length>=3&&specific.length===1&&noise>=parts.length-1;
}
function supportingRows(topic,evidence){const ids=new Set(topic?.evidenceIds||[]);if(ids.size){const linked=evidence.filter((row)=>ids.has(row.id));if(linked.length)return linked;}const labels=[topic?.topic,...(topic?.aliases||[])].map(normalize).filter(Boolean);return evidence.filter((row)=>{const text=` ${normalize(row.content)} `;return labels.some((label)=>label.length>=3&&text.includes(` ${label} `));});}
function exactSupport(label,rows){const key=normalize(label);if(!key)return{creators:0,evidence:0,platforms:0};const matches=rows.filter((row)=>` ${normalize(row.content)} `.includes(` ${key} `));return{creators:new Set(matches.map(creatorKey)).size,evidence:matches.length,platforms:new Set(matches.map((row)=>row.platform)).size};}
function repeatedContiguousPhrases(rows){
 const buckets=new Map();for(const row of rows){const words=normalize(row.content).split(' ').filter(Boolean).slice(0,90);const author=creatorKey(row);for(let size=2;size<=5;size++)for(let i=0;i<=words.length-size;i++){const slice=words.slice(i,i+size);if(slice.some((word)=>/^https?$|^www$|^com$/.test(word)))continue;const meaningful=slice.filter((word)=>word.length>=3&&!STOP.has(word)&&!GENERIC_SINGLE.has(word)&&!GENERIC_STEM.test(word));if(meaningful.length<Math.min(2,size))continue;const phrase=slice.join(' ');if(genericLabel(phrase))continue;const old=buckets.get(phrase)||{authors:new Set(),platforms:new Set(),count:0};old.authors.add(author);old.platforms.add(row.platform);old.count+=1;buckets.set(phrase,old);}}
 return[...buckets.entries()].filter(([,stat])=>stat.authors.size>=2).map(([label,stat])=>({label,creators:stat.authors.size,platforms:stat.platforms.size,count:stat.count})).sort((a,b)=>b.creators-a.creators||b.platforms-a.platforms||b.count-a.count||tokens(b.label).length-tokens(a.label).length);
}
function bestDisplayLabel(topic,rows){
 const candidates=[...new Set([topic.topic,...(topic.aliases||[])].map(cleanLabel).filter(Boolean))].filter((label)=>!genericLabel(label)).map((label)=>({label,...exactSupport(label,rows)})).filter((item)=>item.creators>=2).sort((a,b)=>{const aw=tokens(a.label).length,bw=tokens(b.label).length;const as=a.creators*8+a.platforms*3+Math.min(4,aw)*1.5-(aw>6?6:0);const bs=b.creators*8+b.platforms*3+Math.min(4,bw)*1.5-(bw>6?6:0);return bs-as||bw-aw||a.label.length-b.label.length;});
 if(candidates[0])return candidates[0].label;const repeated=repeatedContiguousPhrases(rows);if(repeated[0])return repeated[0].label;const fallback=cleanLabel(topic.topic||topic.key);return fallback&&!genericLabel(fallback)?fallback:'';
}
function stableIdentity(topic,display,evidence){
 const original=cleanLabel(topic?.key||''),originalWords=specificWords(original);
 const candidates=[...new Set([...specificWords(display),...specificWords(topic?.topic||''),...specificWords(topic?.key||'')])];
 const support=candidates.map((term)=>({
  term,
  creators:new Set(evidence.filter((row)=>specificWords(row.content).includes(term)).map(creatorKey)).size,
 })).filter((entry)=>entry.creators>=2&&entry.term.length>=4).sort((a,b)=>b.creators-a.creators||b.term.length-a.term.length);
 if(support.length){
  const max=support[0].creators;
  const leaders=support.filter((entry)=>entry.creators===max);
  if(leaders.length===1)return leaders[0].term;
 }
 if(original&&!genericLabel(original)&&tokens(original).length===1&&originalWords.length===1)return normalize(original);
 if(original&&!genericLabel(original)&&originalWords.length)return normalize(original);
 return normalize(display);
}
function mediaKey(row){return[row.soundId?`sound:${row.soundId}`:null,row.visualHash?`visual:${row.visualHash}`:null,row.quotedUrl?`quote:${row.quotedUrl}`:null,row.relatedVideoId?`parent:${row.relatedVideoId}`:null].filter(Boolean);}
function semanticCrossPlatform(rows,label){
 const x=rows.filter((r)=>r.platform==='X').slice(0,50),t=rows.filter((r)=>r.platform==='TikTok').slice(0,50),labelTerms=specificWords(label);const creators=new Set();let pairs=0;
 for(const a of x)for(const b of t){if(creatorKey(a)===creatorKey(b))continue;const aMedia=new Set(mediaKey(a));const sharedMedia=mediaKey(b).some((key)=>aMedia.has(key));const left=new Set(specificWords(a.content)),right=new Set(specificWords(b.content));const shared=[...left].filter((word)=>right.has(word));const overlap=shared.length/Math.max(1,Math.min(left.size,right.size));const titleBoth=labelTerms.length>=2&&labelTerms.every((word)=>left.has(word)&&right.has(word));const oneWordContext=labelTerms.length===1&&left.has(labelTerms[0])&&right.has(labelTerms[0])&&shared.some((word)=>word!==labelTerms[0]);if(!sharedMedia&&!titleBoth&&!oneWordContext&&!(shared.length>=2&&overlap>=.5))continue;pairs++;creators.add(creatorKey(a));creators.add(creatorKey(b));}
 return{pairs,creators:creators.size,corroborated:pairs>0&&creators.size>=2};
}
function keepTopic(topic,display,rows){
 if(!display||genericLabel(display))return false;const support=exactSupport(display,rows),parts=tokens(display),creators=Number(topic.authorCount||0),evidenceCount=Number(topic.evidenceCount||0);if(creators<2||evidenceCount<2||support.creators<2)return false;
 if(parts.length===1){const required=topic.tier==='pre-breakout'?2:3;return specificWords(display)[0]?.length>=4&&support.creators>=required;}
 return specificWords(display).length>=1;
}
function evidenceOverlap(a,b){const left=new Set(a.evidenceIds||[]),right=new Set(b.evidenceIds||[]);const shared=[...left].filter((id)=>right.has(id)).length;return{shared,ratio:shared/Math.max(1,Math.min(left.size,right.size))};}
function isFragmentOf(shorter,longer){const a=specificWords(shorter.topic),b=specificWords(longer.topic);if(!a.length||a.length>=b.length)return false;return a.every((word)=>b.includes(word));}
function suppressFragments(rows){return rows.filter((candidate,index)=>!rows.some((other,j)=>{if(index===j||!isFragmentOf(candidate,other))return false;const overlap=evidenceOverlap(candidate,other);return overlap.shared>=2&&overlap.ratio>=.6&&Number(other.labelEvidence?.creators||0)>=2;}));}

export function detectTopics(events=[],now=Date.now(),limit=15){
 const evidence=dedupeEvidence(events);const raw=baseDetectTopics(evidence,now,Math.max(limit*4,40));const repaired=[];
 for(const topic of raw){const rows=supportingRows(topic,evidence);const display=bestDisplayLabel(topic,rows);if(!keepTopic(topic,display,rows))continue;const labelEvidence=exactSupport(display,rows),crossPlatform=semanticCrossPlatform(rows,display);repaired.push({...topic,topic:display,key:stableIdentity(topic,display,evidence),aliases:[...new Set([display,topic.topic,...(topic.aliases||[])].map(cleanLabel).filter((value)=>value&&!genericLabel(value)))].filter((alias)=>tokens(alias).length>1||normalize(alias)===normalize(display)).slice(0,18),labelEvidence,crossPlatform,labelPolicy:'event-level-natural-phrase'});}
 const out=[];for(const topic of suppressFragments(repaired)){const duplicate=out.find((item)=>sameTopicKey(item.key||item.topic,topic.key||topic.topic));if(!duplicate)out.push(topic);}
 return out.sort((a,b)=>(b.score||0)-(a.score||0)||(b.authorCount||0)-(a.authorCount||0)).slice(0,Math.max(0,limit));
}

export function enrichMomentum(topics=[],history=[],now=Date.now()){const enriched=baseEnrichMomentum(topics,history,now).map((topic)=>{const hot=Array.isArray(topic.hotPosts)?topic.hotPosts:[];const maxViewsPerHour=Number(topic.maxViewsPerHour||0),crossPostedCreators=Number(topic.crossPostedCreators||0),creators=Number(topic.authorCount||0);const shouldFlag=creators>=2&&(maxViewsPerHour>=100000||hot.some((post)=>Number(post.views||0)>=100000&&Number(post.ageHours||99)<=6)||crossPostedCreators>=3&&maxViewsPerHour>=25000);if(!shouldFlag||topic.momentum?.label==='Accelerating')return topic;return{...topic,momentum:{...(topic.momentum||{}),label:'Accelerating',score:Number(((topic.momentum?.score||0)+Math.min(35,Math.log10(1+maxViewsPerHour)*6)).toFixed(2)),engagementAcceleration:true}};});return enriched.sort((a,b)=>(b.priorityScore||0)-(a.priorityScore||0)||(b.momentum?.score||0)-(a.momentum?.score||0)||(b.score||0)-(a.score||0));}
export function topicSnapshot(topics=[],at=Date.now()){const snapshot=baseTopicSnapshot(topics,at),byKey=new Map(topics.map((topic)=>[normalize(topic.key||topic.topic),topic]));snapshot.topics=snapshot.topics.map((row)=>{const source=byKey.get(normalize(row.key||row.topic));return{...row,priorityScore:source?.priorityScore||0,maxViewsPerHour:source?.maxViewsPerHour||0,crossPostedCreators:source?.crossPostedCreators||0,hotPostCount:source?.hotPosts?.length||0,crossPlatform:source?.crossPlatform||null};});return snapshot;}
