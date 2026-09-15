const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalizeHandle=(value)=>String(value||'').replace(/^@/,'').trim().toLowerCase();
const clamp01=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;};
const uniq=(items=[],limit=20)=>[...new Set(items.filter(Boolean))].slice(0,limit);

function channelEntries(row={}){
  return [
    {channel:'caption',text:clean(row.content,2200),confidence:.72},
    {channel:'transcript',text:clean(row.transcript,2600),confidence:row.transcriptSource?.includes('text-track')?.92:.82},
    {channel:'visual',text:clean([row.contentSummary,row.contentEvent].filter(Boolean).join(' '),1800),confidence:clamp01(row.contentConfidence,.7)},
  ].filter((item)=>item.text);
}

export function extractOriginClaims(row={}){
  const claims=[];
  const seen=new Set();
  const add=(claim)=>{const key=`${claim.type}|${claim.value}|${claim.source}`;if(!claim.value||seen.has(key))return;seen.add(key);claims.push(claim);};
  for(const source of channelEntries(row)){
    const text=source.text;
    for(const match of text.matchAll(/\b(?:started|began|originated|came from|started over|first blew up|first appeared)(?:\s+out)?\s+(?:on\s+)?(tiktok|x|twitter|youtube|instagram|twitch|reddit|discord)\b/gi)){
      const value=String(match[1]||'').toLowerCase().replace('twitter','x');
      add({type:'origin-platform',value,source:source.channel,confidence:Number((source.confidence*.8).toFixed(2)),evidence:clean(match[0],180),claimState:'CLAIMED'});
    }
    for(const match of text.matchAll(/\b(?:original(?:ly)?(?:\s+(?:posted|uploaded|recorded|made))?|from|back in)\s+(20\d{2})\b/gi)){
      add({type:'origin-year',value:String(match[1]),source:source.channel,confidence:Number((source.confidence*.72).toFixed(2)),evidence:clean(match[0],180),claimState:'CLAIMED'});
    }
    for(const match of text.matchAll(/\b(?:original(?:\s+(?:post|video|clip))?(?:\s+(?:is|was|came from))?|source(?:\s+(?:is|was))?)\s+@([A-Za-z0-9_.]{2,40})\b/gi)){
      add({type:'origin-account',value:normalizeHandle(match[1]),source:source.channel,confidence:Number((source.confidence*.75).toFixed(2)),evidence:clean(match[0],180),claimState:'CLAIMED'});
    }
  }
  return claims.slice(0,12);
}

export function buildUnderstandingFrame(row={}){
  const channels=channelEntries(row);
  const postConfidence=clamp01(row.postUnderstandingConfidence,0);
  const visualConfidence=clamp01(row.contentConfidence,0);
  const transcriptPresent=Boolean(clean(row.transcript,20));
  const subject=clean(row.postSubject,180)||null;
  const event=clean(row.postEvent||row.contentEvent,220)||null;
  const semanticNarrativeKey=clean(row.semanticNarrativeKey,220)||null;
  const entities=uniq([...(Array.isArray(row.postEntities)?row.postEntities:[]),...(Array.isArray(row.contentEntities)?row.contentEntities:[])].map((value)=>clean(value,120)),16);
  const provenance={
    subject:subject?[row.postUnderstandingMethod==='semantic-model'?'semantic-model':'deterministic-context']:[],
    event:event?[row.postEvent?'semantic-model':'visual']:[],
    entities:entities.length?uniq([...(Array.isArray(row.postEntities)&&row.postEntities.length?['semantic-model']:[]),...(Array.isArray(row.contentEntities)&&row.contentEntities.length?['visual']:[])],4):[],
    transcript:transcriptPresent?[clean(row.transcriptSource,80)||'browser-caption']:[],
    caption:clean(row.content,20)?['platform-caption']:[],
    visual:clean(row.contentSummary,20)?['visual-model']:[],
  };
  const uncertainty=[];
  if(postConfidence&&postConfidence<.65)uncertainty.push('LOW_SEMANTIC_CONFIDENCE');
  if(!subject||!semanticNarrativeKey)uncertainty.push('INCOMPLETE_SEMANTIC_FRAME');
  if(transcriptPresent&&/caption|text-track|visible/i.test(String(row.transcriptSource||'')))uncertainty.push('PARTIAL_TRANSCRIPT_POSSIBLE');
  if(!row.published)uncertainty.push('PUBLISHED_TIME_UNKNOWN');
  const observations=channels.map((item)=>({channel:item.channel,confidence:item.confidence,text:clean(item.text,320)}));
  return {
    version:26,
    subject,
    event,
    entities,
    action:clean(row.postAction,140)||null,
    object:clean(row.postObject,180)||null,
    context:clean(row.postContext,220)||null,
    semanticNarrativeKey,
    confidence:{overall:postConfidence,semantic:postConfidence,visual:visualConfidence,transcript:transcriptPresent?(row.transcriptSource?.includes('text-track')?.92:.82):0},
    provenance,
    observations,
    originClaims:extractOriginClaims(row),
    uncertainty:uniq(uncertainty,12),
    claimState:'OBSERVED+INFERRED',
  };
}

export function attachUnderstandingFrame(row={}){
  return {...row,understandingFrame:buildUnderstandingFrame(row)};
}

export function detectNarrativeContradictions(rows=[]){
  const claims=[];
  for(const row of rows){
    const frame=row?.understandingFrame||buildUnderstandingFrame(row);
    for(const claim of frame.originClaims||[]){
      claims.push({...claim,creator:normalizeHandle(row.author),platform:row.platform||null,evidenceId:row.id||null});
    }
  }
  const byType=new Map();
  for(const claim of claims){
    const group=byType.get(claim.type)||new Map();
    const item=group.get(claim.value)||{value:claim.value,count:0,creators:new Set(),sources:new Set(),evidence:[]};
    item.count++;if(claim.creator)item.creators.add(claim.creator);if(claim.source)item.sources.add(claim.source);if(claim.evidence)item.evidence.push(claim.evidence);
    group.set(claim.value,item);byType.set(claim.type,group);
  }
  const contradictions=[];
  for(const [type,group] of byType){
    const values=[...group.values()].filter((item)=>item.count>0);
    if(values.length<2)continue;
    contradictions.push({type,status:'CONFLICTING',values:values.map((item)=>({value:item.value,count:item.count,creators:item.creators.size,sources:[...item.sources],evidence:uniq(item.evidence,3)}))});
  }
  return contradictions;
}

export function assessNarrativeClaims(rows=[]){
  const originClaims=rows.flatMap((row)=>{const frame=row?.understandingFrame||buildUnderstandingFrame(row);return(frame.originClaims||[]).map((claim)=>({...claim,evidenceId:row.id||null,creator:normalizeHandle(row.author)}));});
  const contradictions=detectNarrativeContradictions(rows);
  return {status:contradictions.length?'CONFLICTING':originClaims.length?'CLAIMED':'UNKNOWN',originClaims:originClaims.slice(0,24),contradictions};
}
