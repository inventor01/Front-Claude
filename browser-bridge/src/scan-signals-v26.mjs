import { isInternalSemanticLabel, preferSpecificSemanticLabel } from './semantic-label-guard-v29.mjs';

const clean=(value,max=160)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalize=(value)=>clean(value,1200).normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,value));
const STOP=new Set('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i you your we our they their he she his her not no yes just very really have has had do does did can could would should will may might about into over under after before more most some any all one two what when where who why how'.split(/\s+/));
const NOISE=new Set('original sound audio caption captions video videos photo photos image images post posts repost reposts reply replies comment comments share shares view views like likes follow follows new latest today tonight yesterday tomorrow update updates breaking news meme memes viral trend trends trending funny reaction reactions clip clips edit edits account accounts user users profile profiles people person guy guys girl girls man men woman women bro dude someone somebody anyone everybody thing things stuff something anything everything topic topics story stories market markets coin coins token tokens crypto solana tiktok twitter x fyp foryou'.split(/\s+/));
const terms=(value)=>normalize(value).split(' ').filter((word)=>word.length>=3&&!STOP.has(word)&&!NOISE.has(word)&&!isInternalSemanticLabel(word)&&!/^\d+$/.test(word));
const creatorKey=(row)=>String(row.author||'').replace(/^@/,'').trim().toLowerCase();
const displayLabel=(topic)=>preferSpecificSemanticLabel(topic?.topic,topic?.key);
const topicKey=(topic)=>normalize(preferSpecificSemanticLabel(topic?.key,topic?.topic));
const sourceText=(row)=>clean([row?.content,row?.transcript].filter(Boolean).join(' '),2400);

export function qualifiesScanSignal(topic={}){
  const label=displayLabel(topic);if(!label)return false;
  const evidenceCount=Math.max(0,Number(topic.evidenceCount||0));
  const authorCount=Math.max(0,Number(topic.authorCount||0));
  const words=clean(label,120).split(/\s+/).filter(Boolean);
  return evidenceCount>=2&&authorCount>=2&&topic.tier==='candidate'&&topic.corroborated===true&&!(words.length===1&&authorCount<3);
}

function statusFor(topic={}){
  if(qualifiesScanSignal(topic))return 'QUALIFIED';
  const creators=Math.max(0,Number(topic.authorCount||0));
  const posts=Math.max(0,Number(topic.evidenceCount||0));
  const platforms=new Set(topic.platforms||[]).size;
  const score=Math.max(0,Number(topic.signalScore??topic.score??0));
  if(creators>=2&&(platforms>=2||posts>=3)&&score>=55)return 'RISING';
  if(creators>=2)return 'EARLY';
  return 'WATCH';
}

function rawSignals(evidence=[]){
  const groups=new Map();
  for(const row of evidence){
    const unique=[...new Set(terms(sourceText(row)))].slice(0,8);
    if(unique.length<2)continue;
    for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){
      const pair=[unique[i],unique[j]].sort();
      const key=pair.join(' ');
      const group=groups.get(key)||{terms:pair,rows:[]};
      if(!group.rows.some((item)=>item.id===row.id))group.rows.push(row);
      groups.set(key,group);
    }
  }
  const out=[];
  for(const [key,group] of groups){
    const creators=new Set(group.rows.map(creatorKey).filter(Boolean));
    if(creators.size<2)continue;
    const platforms=[...new Set(group.rows.map((row)=>row.platform).filter(Boolean))];
    const evidenceIds=group.rows.map((row)=>row.id).filter(Boolean);
    const signalScore=clamp(25+Math.min(30,creators.size*10)+Math.min(20,group.rows.length*5)+(platforms.length>=2?10:0));
    const signal={topic:group.terms.join(' '),key:`raw ${key}`,tier:'pre-breakout',corroborated:false,evidenceCount:group.rows.length,authorCount:creators.size,platforms,evidenceIds,score:signalScore,signalScore,signalSource:'raw-repeat'};
    signal.scanStatus=statusFor(signal);out.push(signal);
  }
  return out;
}

export function buildScanSignals(evidence=[],inferredTopics=[],limit=24){
  const merged=new Map();
  for(const topic of inferredTopics){
    const key=topicKey(topic),label=displayLabel(topic);if(!key||!label)continue;
    const signal={...topic,topic:label,key,semanticLabelFallback:isInternalSemanticLabel(topic?.topic),signalScore:clamp(Math.round(Number(topic.score||0))),signalSource:'engine'};
    signal.scanStatus=statusFor(signal);merged.set(key,signal);
  }
  const semantic=new Map();
  for(const row of evidence){
    const confidence=Number(row.postUnderstandingConfidence||0);
    const subject=preferSpecificSemanticLabel(row.postSubject,row.postEvent);
    if(!subject||confidence<.5||terms(subject).length<1)continue;
    const rawKey=normalize(row.semanticNarrativeKey||'');
    const key=rawKey&&!isInternalSemanticLabel(rawKey)?rawKey:normalize(subject);
    if(!key||isInternalSemanticLabel(key))continue;
    const list=semantic.get(key)||[];list.push(row);semantic.set(key,list);
  }
  for(const [key,rows] of semantic){
    const creators=new Set(rows.map(creatorKey).filter(Boolean));
    const platforms=[...new Set(rows.map((row)=>row.platform).filter(Boolean))];
    const title=preferSpecificSemanticLabel(rows.map((row)=>preferSpecificSemanticLabel(row.postSubject,row.postEvent)).find(Boolean),key);
    if(!title)continue;
    const confidence=rows.reduce((sum,row)=>sum+Number(row.postUnderstandingConfidence||0),0)/Math.max(1,rows.length);
    const signalScore=clamp(Math.round(confidence*35+Math.min(25,creators.size*10)+Math.min(20,rows.length*5)+(platforms.length>=2?10:0)));
    const prior=merged.get(key);
    const label=prior?.semanticLabelFallback?title:preferSpecificSemanticLabel(prior?.topic,title);
    if(!label)continue;
    const signal={...prior,topic:label,key,tier:prior?.tier||'pre-breakout',corroborated:prior?.corroborated===true,evidenceCount:Math.max(Number(prior?.evidenceCount||0),rows.length),authorCount:Math.max(Number(prior?.authorCount||0),creators.size),platforms:[...new Set([...(prior?.platforms||[]),...platforms])],evidenceIds:[...new Set([...(prior?.evidenceIds||[]),...rows.map((row)=>row.id).filter(Boolean)])],score:Math.max(Number(prior?.score||0),signalScore),signalScore:Math.max(Number(prior?.signalScore||0),signalScore),signalSource:'semantic',semanticLabelFallback:false};
    signal.scanStatus=statusFor(signal);merged.set(key,signal);
  }
  for(const raw of rawSignals(evidence)){
    const fp=(raw.evidenceIds||[]).slice().sort().join('|');
    const matched=[...merged.values()].some((topic)=>(topic.evidenceIds||[]).slice().sort().join('|')===fp);
    if(!matched)merged.set(raw.key,raw);
  }
  const rank={QUALIFIED:4,RISING:3,EARLY:2,WATCH:1};
  const seen=new Set();
  return [...merged.values()]
    .filter((topic)=>Boolean(displayLabel(topic)))
    .sort((a,b)=>(rank[b.scanStatus||'WATCH']-rank[a.scanStatus||'WATCH'])||Number(b.signalScore||0)-Number(a.signalScore||0)||Number(b.authorCount||0)-Number(a.authorCount||0))
    .filter((topic)=>{
      const fp=(topic.evidenceIds||[]).slice().sort().join('|');
      if(!fp)return true;if(seen.has(fp))return false;seen.add(fp);return true;
    })
    .slice(0,Math.max(1,limit));
}

export function countScanSignals(signals=[]){
  return signals.reduce((counts,signal)=>{const key=signal.scanStatus||'WATCH';counts[key]=(counts[key]||0)+1;return counts;},{WATCH:0,EARLY:0,RISING:0,QUALIFIED:0});
}
