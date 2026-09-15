const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalizeHandle=(value)=>String(value||'').replace(/^@/,'').trim().toLowerCase();
const normalizeText=(value)=>clean(value,1200).normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}$#@]+/gu,' ').replace(/\s+/g,' ').trim();
const clamp01=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;};
const uniq=(items=[],limit=20)=>[...new Set(items.filter(Boolean))].slice(0,limit);
const STOP=new Set('the a an and or but if then than this that these those to of in on at for from with without is are was were be been being it its i me my you your we our they their he she his her not no yes just very really have has had do does did can could would should will may might about into over under after before more most some any all one two what when where who why how'.split(/\s+/));
const NOISE=new Set('video videos post posts clip clips viral trend trends trending meme memes update news breaking original sound audio tiktok twitter x fyp foryou people thing things'.split(/\s+/));

function channelEntries(row={}){
  return [
    {channel:'caption',text:clean(row.content,2200),confidence:.72},
    {channel:'transcript',text:clean(row.transcript,2600),confidence:row.transcriptSource?.includes('text-track')?.92:.82},
    {channel:'visual',text:clean([row.contentSummary,row.contentEvent].filter(Boolean).join(' '),1800),confidence:clamp01(row.contentConfidence,.7)},
  ].filter((item)=>item.text);
}

function fingerprintTerms(values=[]){
  const tokens=[];
  for(const value of values){
    for(const token of normalizeText(value).split(' ')){
      if(token.length<3||STOP.has(token)||NOISE.has(token)||/^\d+$/.test(token))continue;
      tokens.push(token);
    }
  }
  return [...new Set(tokens)].sort().slice(0,14);
}

export function eventFingerprintForFrame({subject,event,entities=[]}={}){
  const terms=fingerprintTerms([subject,event,...entities]);
  return terms.length>=2?terms.join(' '):null;
}

export function eventFingerprintSimilarity(a,b){
  const left=new Set(fingerprintTerms([a]));
  const right=new Set(fingerprintTerms([b]));
  if(!left.size||!right.size)return 0;
  const shared=[...left].filter((term)=>right.has(term)).length;
  return Number((shared/Math.max(left.size,right.size)).toFixed(3));
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
  const originClaims=extractOriginClaims(row);
  const eventFingerprint=eventFingerprintForFrame({subject,event,entities});
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
  if(row.mediaType==='video'&&!transcriptPresent)uncertainty.push('SPEECH_TRANSCRIPT_UNAVAILABLE');
  if(!row.published)uncertainty.push('PUBLISHED_TIME_UNKNOWN');
  const observations=channels.map((item)=>({channel:item.channel,confidence:item.confidence,text:clean(item.text,320)}));
  const evidenceBuckets={
    observed:observations,
    inferred:[
      ...(subject?[{field:'subject',value:subject,confidence:postConfidence,source:provenance.subject}]:[]),
      ...(event?[{field:'event',value:event,confidence:postConfidence||visualConfidence,source:provenance.event}]:[]),
      ...(semanticNarrativeKey?[{field:'semanticNarrativeKey',value:semanticNarrativeKey,confidence:postConfidence,source:['semantic-model']}]:[]),
    ],
    claimed:originClaims,
    verified:[],
  };
  return {
    version:26,
    subject,
    event,
    entities,
    action:clean(row.postAction,140)||null,
    object:clean(row.postObject,180)||null,
    context:clean(row.postContext,220)||null,
    semanticNarrativeKey,
    eventFingerprint,
    confidence:{overall:postConfidence,semantic:postConfidence,visual:visualConfidence,transcript:transcriptPresent?(row.transcriptSource?.includes('text-track')?.92:.82):0},
    provenance,
    observations,
    evidenceBuckets,
    originClaims,
    transcriptStatus:{present:transcriptPresent,source:clean(row.transcriptSource,80)||null,partial:transcriptPresent&&/caption|text-track|visible/i.test(String(row.transcriptSource||'')),needsFallback:row.mediaType==='video'&&!transcriptPresent},
    uncertainty:uniq(uncertainty,12),
    claimState:originClaims.length?'CLAIMED+INFERRED':'OBSERVED+INFERRED',
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
