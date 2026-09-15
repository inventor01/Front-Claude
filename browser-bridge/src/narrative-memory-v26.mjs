const clean=(value,max=180)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalize=(value)=>clean(value,300).normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const creatorKey=(row)=>String(row?.author||'').replace(/^@/,'').trim().toLowerCase();
const evidenceTime=(row,now)=>{for(const value of [row?.published,row?.firstObserved,row?.lastObserved]){const n=Number(value);if(Number.isFinite(n)&&n>0)return n;}return now;};
const evidenceRole=(row)=>{const role=String(row?.role||row?.evidenceRole||row?.relationType||'top-level').toLowerCase();if(/reply|comment/.test(role))return'comment';if(/quote|repost/.test(role))return'quote';return'top-level';};
const roleWeight=(role)=>role==='comment'?.3:role==='quote'?.7:1;

export function narrativeMemoryWeight(ageMs){
  const h=Math.max(0,Number(ageMs)||0)/3600000;
  if(h<=6)return 1;
  if(h<=24)return .9;
  if(h<=72)return .7;
  if(h<=168)return .4;
  if(h<=336)return .15;
  return 0;
}

export function emptyNarrativeMemory(){return{version:26,updatedAt:null,narratives:{}};}

export function normalizeNarrativeMemory(value){
  if(!value||typeof value!=='object')return emptyNarrativeMemory();
  const narratives=value.narratives&&typeof value.narratives==='object'?value.narratives:{};
  return{version:26,updatedAt:Number(value.updatedAt)||null,narratives};
}

function safeRecord(raw,key,now){
  return{
    key,
    title:clean(raw?.title,140)||key,
    firstSeen:Number(raw?.firstSeen)||now,
    lastSeen:Number(raw?.lastSeen)||now,
    aliases:Array.isArray(raw?.aliases)?raw.aliases.map((x)=>clean(x,140)).filter(Boolean).slice(0,20):[],
    evidence:Array.isArray(raw?.evidence)?raw.evidence.slice(-250):[],
    scans:Array.isArray(raw?.scans)?raw.scans.slice(-60):[],
  };
}

export function updateNarrativeMemory(memoryInput,evidence=[],inferredTopics=[],{now=Date.now(),scanId=null}={}){
  const memory=normalizeNarrativeMemory(memoryInput);
  const narratives={...memory.narratives};
  const topicByKey=new Map((Array.isArray(inferredTopics)?inferredTopics:[]).map((topic)=>[normalize(topic?.semanticNarrativeKey||topic?.key||topic?.topic||''),topic]).filter(([key])=>key));
  for(const row of evidence){
    const key=normalize(row?.semanticNarrativeKey||'');
    const confidence=Number(row?.postUnderstandingConfidence||0);
    const subject=clean(row?.postSubject||row?.postEvent,140);
    if(!key||confidence<.5||!subject||!creatorKey(row))continue;
    const prior=safeRecord(narratives[key],key,now);
    const at=evidenceTime(row,now);
    const evidenceKey=`${row.platform||''}|${row.url||row.id||''}`;
    const existing=new Map(prior.evidence.map((item)=>[item.key,item]));
    const old=existing.get(evidenceKey);
    const role=evidenceRole(row);
    existing.set(evidenceKey,{
      key:evidenceKey,
      id:row.id||old?.id||null,
      platform:row.platform||old?.platform||null,
      creator:creatorKey(row)||old?.creator||null,
      role,
      parentId:row.parentId||row.parentEvidenceId||old?.parentId||null,
      at:Math.min(Number(old?.at)||at,at),
      lastSeen:Math.max(Number(old?.lastSeen)||at,Number(row?.lastObserved)||now),
      confidence:Math.max(Number(old?.confidence)||0,confidence),
    });
    const cutoff=now-45*24*3600000;
    const rows=[...existing.values()].filter((item)=>Number(item.lastSeen||item.at||0)>=cutoff).sort((a,b)=>Number(a.at||0)-Number(b.at||0)).slice(-250);
    const topic=topicByKey.get(key);
    const aliases=[...new Set([...prior.aliases,subject,clean(row?.postEvent,140),clean(topic?.topic,140),...(Array.isArray(topic?.aliases)?topic.aliases.map((x)=>clean(x,140)):[])].filter(Boolean))].slice(0,20);
    const scans=scanId?[...new Set([...prior.scans,String(scanId)])].slice(-60):prior.scans;
    narratives[key]={...prior,title:clean(topic?.topic||subject,140)||prior.title,firstSeen:Math.min(prior.firstSeen,at),lastSeen:Math.max(prior.lastSeen,Number(row?.lastObserved)||now),aliases,evidence:rows,scans};
  }
  return{version:26,updatedAt:now,narratives};
}

export function summarizeNarrativeMemory(record,now=Date.now()){
  const evidence=Array.isArray(record?.evidence)?record.evidence:[];
  const active=evidence.filter((item)=>narrativeMemoryWeight(now-Number(item.at||0))>0);
  const creatorWeights=new Map();
  const independentCreators=new Set();
  const platforms=new Set();
  const supportingCreators=new Set();
  let weightedSupport=0,recent6h=0,prior18h=0,commentSupport=0;
  for(const item of active){
    const age=Math.max(0,now-Number(item.at||0));
    const recency=narrativeMemoryWeight(age);
    const role=evidenceRole(item);
    const weight=recency*roleWeight(role);
    weightedSupport+=weight;
    if(item.creator){creatorWeights.set(item.creator,Math.max(creatorWeights.get(item.creator)||0,weight));supportingCreators.add(item.creator);if(role==='top-level')independentCreators.add(item.creator);}
    if(item.platform)platforms.add(item.platform);
    if(role==='comment')commentSupport+=weight;
    if(age<=6*3600000)recent6h+=weight;
    else if(age<=24*3600000)prior18h+=weight;
  }
  const weightedCreators=[...creatorWeights.values()].reduce((sum,value)=>sum+value,0);
  const acceleration=Number((recent6h-Math.min(recent6h,prior18h/3)).toFixed(2));
  return{
    evidenceCount:active.length,
    creatorCount:supportingCreators.size,
    independentCreatorCount:independentCreators.size,
    weightedCreators:Number(weightedCreators.toFixed(2)),
    weightedSupport:Number(weightedSupport.toFixed(2)),
    commentSupport:Number(commentSupport.toFixed(2)),
    platforms:[...platforms],
    recent6h:Number(recent6h.toFixed(2)),
    prior18h:Number(prior18h.toFixed(2)),
    acceleration,
    firstSeen:Number(record?.firstSeen)||null,
    lastSeen:Number(record?.lastSeen)||null,
    scansSeen:Array.isArray(record?.scans)?record.scans.length:0,
  };
}

export function memoryScanSignals(memoryInput,{now=Date.now(),currentEvidenceIds=[]}={}){
  const memory=normalizeNarrativeMemory(memoryInput);
  const currentIds=new Set(currentEvidenceIds);
  const out=[];
  for(const [key,record] of Object.entries(memory.narratives)){
    const summary=summarizeNarrativeMemory(record,now);
    if(summary.creatorCount<1||summary.weightedSupport<.15)continue;
    const evidenceIds=(record.evidence||[]).map((item)=>item.id).filter((id)=>id&&currentIds.has(id));
    if(currentIds.size&&evidenceIds.length===0)continue;
    let scanStatus='WATCH';
    if(summary.independentCreatorCount>=3&&summary.weightedCreators>=2.1&&(summary.platforms.length>=2||summary.acceleration>.5))scanStatus='RISING';
    else if(summary.independentCreatorCount>=2&&summary.weightedCreators>=1.4)scanStatus='EARLY';
    const signalScore=Math.max(1,Math.min(99,Math.round(summary.weightedCreators*18+summary.weightedSupport*7+(summary.platforms.length>=2?10:0)+Math.max(0,summary.acceleration)*6)));
    out.push({topic:clean(record.title,140)||key,key,tier:'pre-breakout',corroborated:false,evidenceCount:Math.max(evidenceIds.length,summary.evidenceCount),authorCount:summary.independentCreatorCount,platforms:summary.platforms,evidenceIds,score:signalScore,signalScore,scanStatus,signalSource:'memory',memory:summary,aliases:record.aliases||[]});
  }
  const rank={RISING:3,EARLY:2,WATCH:1};
  return out.sort((a,b)=>(rank[b.scanStatus]-rank[a.scanStatus])||b.signalScore-a.signalScore).slice(0,24);
}
