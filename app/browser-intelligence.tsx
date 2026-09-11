'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ExternalLink, ShieldCheck, X } from 'lucide-react';

const BRIDGE = 'http://127.0.0.1:43981';
const LOCAL_TIMEOUT_MS = 30_000;
const DEEP_SCAN_TIMEOUT_MS = 10 * 60_000;

type BridgeConfig = {
  enabled:boolean;
  intervalMinutes:number;
  scanXExplore:boolean;
  scanXHome:boolean;
  scanTikTokTrends:boolean;
  scanTikTokExplore:boolean;
  scrollPasses:number;
  maxFeedItems:number;
  inferredTopicSearches:number;
  maxTrendQueries:number;
  resultsPerQuery:number;
  xAccounts:string[];
  keywords:string[];
  scanXForYou?:boolean;
  scanTikTokForYou?:boolean;
  targetUniqueFeedItems?:number;
  maxFeedScanSeconds?:number;
  maxAdaptiveScrolls?:number;
  stalePassLimit?:number;
  searchScrollPasses?:number;
  deepResultsPerQuery?:number;
  sentinelAccountsPerScout?:number;
  sentinelAccountsPerDeep?:number;
};

type Evidence = {
  id:string;
  platform:'X'|'TikTok';
  author:string;
  url:string;
  content:string;
  published:number|null;
  views:number|null;
  likes:number|null;
  provenance:string;
  replies?:number|null;
  reposts?:number|null;
  bookmarks?:number|null;
  quotes?:number|null;
  comments?:number|null;
  shares?:number|null;
  saves?:number|null;
  soundId?:string|null;
  soundTitle?:string|null;
  soundAuthor?:string|null;
  mediaType?:string|null;
  quotedUrl?:string|null;
  coverUrl?:string|null;
  hashtags?:string[];
};

type RelatedContext = {key:string;title:string;relation:string;score:number;evidenceCount:number;authorCount:number;platforms:string[];evidenceIds:string[]};
type SoundSignal = {soundId:string;title:string;creators:number;overlap:number};
type InferredTopic = {
  topic:string;
  key:string;
  evidenceCount:number;
  authorCount:number;
  platforms:string[];
  oldestPublished:number|null;
  newestPublished:number|null;
  engagementEvidence:number;
  score:number;
  corroborated:boolean;
  evidenceIds:string[];
  aliases?:string[];
  feedPenetration?:number;
  feedPenetrationDelta?:number;
  feedPenetrationVelocity?:number;
  soundSignals?:SoundSignal[];
  relatedContexts?:RelatedContext[];
};

type FeedAudit = {passes?:number;uniqueObserved?:number;newToHistory?:number;noveltyPct?:number;elapsedMs?:number;stopReason?:string};
type ScanAudit = {
  mode?:string;
  sourceCounts?:Record<string,number>;
  feedAudits?:{x?:FeedAudit;tiktok?:FeedAudit};
  uniqueEvidence?:number;
  uniqueCreators?:number;
  forYouSampleSize?:number;
  inferredTopics?:number;
  acceleratingTopics?:number;
  risingFeedTopics?:number;
  repeatedTikTokSounds?:number;
  sentinelsScanned?:string[];
  errors?:number;
};
type ScanResult = {evidence:Evidence[];errors:string[];inferredTopics?:InferredTopic[];audit?:ScanAudit;at:number;config:BridgeConfig};
type Narrative = {id:string;title:string;stage:string;authors:number;firstSeen:number;lastSeen:number;platforms:string[]};
type StoredResult = {accepted?:number;rejected?:number;freshNarratives?:number;matchedNarratives?:number;freshCoins?:number;inferredNarratives?:number;relationshipsSaved?:number;error?:string};
type BridgeHealth = {config:BridgeConfig;version:number;scanner?:string;capabilities?:string[];running:boolean;pendingCount?:number;nextScheduledRun?:number|null;scanConnection?:string;lastError?:string|null;lastAudit?:ScanAudit|null};

const DEFAULT_CONFIG:BridgeConfig={
  enabled:true,
  intervalMinutes:10,
  scanXExplore:true,
  scanXHome:true,
  scanTikTokTrends:true,
  scanTikTokExplore:true,
  scrollPasses:4,
  maxFeedItems:40,
  inferredTopicSearches:4,
  maxTrendQueries:3,
  resultsPerQuery:6,
  xAccounts:[],
  keywords:[],
  scanXForYou:true,
  scanTikTokForYou:true,
  targetUniqueFeedItems:90,
  maxFeedScanSeconds:70,
  maxAdaptiveScrolls:14,
  stalePassLimit:2,
  searchScrollPasses:3,
  deepResultsPerQuery:14,
  sentinelAccountsPerScout:6,
  sentinelAccountsPerDeep:10,
};

async function local<T>(path:string,init?:RequestInit,timeoutMs=LOCAL_TIMEOUT_MS):Promise<T>{
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(BRIDGE+path,{...init,signal:controller.signal});
    const data=await response.json() as T&{error?:string};
    if(!response.ok)throw new Error(data.error||'Local browser bridge request failed.');
    return data;
  }catch(e){
    if(e instanceof DOMException&&e.name==='AbortError'){
      if(path==='/scan')throw new Error('The deep scan exceeded the web panel timeout. The local bridge may still be finishing; check Browser Sources before starting another scan.');
      throw new Error('The local browser bridge request timed out.');
    }
    throw e;
  }finally{window.clearTimeout(timer);}
}

async function saveEvidence(evidence:Evidence[],inferredTopics:InferredTopic[]=[]){
  const response=await fetch('/api/browser-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({evidence,inferredTopics})});
  const data=await response.json() as StoredResult;
  if(!response.ok)throw new Error(data.error||'Could not save browser evidence.');
  try{
    await fetch('/api/browser-rich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({evidence,inferredTopics})});
  }catch{
    // Core evidence is already safely stored; rich metadata can retry on the next observation.
  }
  return data;
}

async function fetchNarratives():Promise<Narrative[]>{
  const response=await fetch('/api/desk?action=narratives',{cache:'no-store'});
  const data=await response.json() as {cards?:Narrative[];error?:string};
  if(!response.ok)throw new Error(data.error||'Could not refresh narratives.');
  return data.cards||[];
}

function lines(value:string){return[...new Set(value.split(/[\n,]+/).map((x)=>x.trim()).filter(Boolean))];}
function sourceLabel(item:Evidence){
  const p=item.provenance;
  if(/X For You/i.test(p))return'X For You';
  if(/TikTok For You/i.test(p))return'TikTok For You';
  if(/candidate investigation/i.test(p))return item.platform==='X'?'X Investigation':'TikTok Investigation';
  if(/sentinel/i.test(p))return'X Sentinels';
  if(/X Explore/i.test(p))return'X Trend seeds';
  if(/TikTok Creative Center/i.test(p))return'TikTok Trend seeds';
  if(/X Latest search/i.test(p))return'X Search';
  if(/TikTok search/i.test(p))return'TikTok Search';
  return item.platform;
}
function metric(value:number|null|undefined,label:string){return Number.isFinite(value)?`${label} ${Number(value).toLocaleString()}`:'';}

export default function BrowserIntelligence(){
  const [open,setOpen]=useState(false);
  const [connected,setConnected]=useState(false);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [config,setConfig]=useState<BridgeConfig>(DEFAULT_CONFIG);
  const [accounts,setAccounts]=useState('');
  const [keywords,setKeywords]=useState('');
  const [lastScan,setLastScan]=useState<ScanResult|null>(null);
  const [narratives,setNarratives]=useState<Narrative[]>([]);
  const [health,setHealth]=useState<BridgeHealth|null>(null);
  const flushing=useRef(false);

  const evidenceByPlatform=useMemo(()=>({
    x:lastScan?.evidence.filter((item)=>item.platform==='X').length||0,
    tiktok:lastScan?.evidence.filter((item)=>item.platform==='TikTok').length||0,
  }),[lastScan]);

  const audit=useMemo(()=>{
    if(!lastScan)return null;
    const sourceCounts:Record<string,number>={};
    for(const item of lastScan.evidence){const key=sourceLabel(item);sourceCounts[key]=(sourceCounts[key]||0)+1;}
    const creators=new Set(lastScan.evidence.map((item)=>`${item.platform}:${item.author.toLowerCase()}`));
    const dated=lastScan.evidence.filter((item)=>item.published);
    const fresh24=dated.filter((item)=>(item.published||0)>=lastScan.at-86400000).length;
    const unknownAge=lastScan.evidence.length-dated.length;
    const topics=lastScan.inferredTopics?.length||0;
    const rising=lastScan.inferredTopics?.filter((topic)=>(topic.feedPenetrationVelocity||0)>0).length||0;
    let diagnosis='';
    if(!lastScan.evidence.length)diagnosis='No extractable X/TikTok evidence was collected. Confirm the dedicated Front Chrome profile is signed in.';
    else if(!topics)diagnosis=`Discovery worked (${lastScan.evidence.length} items), but no topic reached strict corroboration yet. Early Candidates can still contain useful pre-breakout signals.`;
    else diagnosis=`Discovery + investigation worked: ${lastScan.evidence.length} unique evidence items produced ${topics} corroborated narrative${topics===1?'':'s'}, with ${rising} gaining For You penetration.`;
    return{sourceCounts,uniqueCreators:creators.size,fresh24,unknownAge,topics,rising,diagnosis};
  },[lastScan]);

  async function flushPending(silent=true){
    if(flushing.current)return;
    flushing.current=true;
    try{
      const pending=await local<{evidence:Evidence[];count:number;lastTopics?:InferredTopic[]}>('/pending');
      if(!pending.evidence.length)return;
      const stored=await saveEvidence(pending.evidence,pending.lastTopics||[]);
      await local('/ack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:pending.evidence.map((row)=>row.id)})});
      setNarratives((await fetchNarratives()).slice(0,8));
      window.dispatchEvent(new CustomEvent('front-browser-evidence-saved'));
      if(!silent)setMessage(`Synced ${stored.accepted||0} background evidence record(s) and ${stored.inferredNarratives||0} inferred narrative(s) into Front.`);
    }catch(e){if(!silent)setError((e as Error).message);}finally{flushing.current=false;}
  }

  async function ping(silent=false){
    try{
      const status=await local<BridgeHealth>('/health');
      setConnected(true);
      setHealth(status);
      setConfig({...DEFAULT_CONFIG,...status.config});
      setAccounts((status.config?.xAccounts||[]).join('\n'));
      setKeywords((status.config?.keywords||[]).join('\n'));
      if(!silent)setMessage(`Local browser intelligence connected · bridge v${status.version}${status.scanner?` · ${status.scanner}`:''}${status.pendingCount?` · ${status.pendingCount} pending`:''}.`);
      void flushPending(true);
      return true;
    }catch{
      setConnected(false);
      if(!silent)setError('Local browser bridge is not running yet. Start browser-bridge/start.command on this Mac, then reconnect.');
      return false;
    }
  }

  useEffect(()=>{
    const kickoff=window.setTimeout(()=>{void ping(true);void flushPending(true);},0);
    const id=window.setInterval(()=>{void ping(true);void flushPending(true);},30000);
    return()=>{window.clearTimeout(kickoff);window.clearInterval(id);};
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleOpen(){const next=!open;setOpen(next);if(next)void ping(true);}

  async function saveConfig(){
    setBusy('config');setError('');setMessage('');
    try{
      const next={...config,xAccounts:lines(accounts).slice(0,30),keywords:lines(keywords)};
      const result=await local<{config:BridgeConfig}>('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
      setConfig({...DEFAULT_CONFIG,...result.config});
      setMessage(`Scan settings saved. Scout sweeps run every ${result.config.intervalMinutes} minutes while the bridge and Front Chrome are running.`);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  async function openLogin(){
    setBusy('login');setError('');setMessage('');
    try{
      const result=await local<{message:string}>('/open-login',{method:'POST'},45_000);
      setConnected(true);setMessage(result.message);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  async function scan(){
    setBusy('scan');setError('');
    setMessage('Deep investigation running: sampling X/TikTok For You, finding repeated narratives, then searching both platforms for corroboration.');
    try{
      const result=await local<ScanResult>('/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,mode:'deep',xAccounts:lines(accounts).slice(0,30),keywords:lines(keywords)})},DEEP_SCAN_TIMEOUT_MS);
      setLastScan(result);
      setMessage(`Collection finished: ${result.evidence.length} evidence record(s), ${result.inferredTopics?.length||0} topic(s). Saving evidence and candidates…`);
      const stored=await saveEvidence(result.evidence,result.inferredTopics||[]);
      setNarratives((await fetchNarratives()).slice(0,8));
      setConnected(true);
      window.dispatchEvent(new CustomEvent('front-browser-evidence-saved'));
      const warning=result.errors.length?` ${result.errors.length} source warning(s); details shown below.`:'';
      const promoted=stored.freshNarratives?` ${stored.freshNarratives} narrative${stored.freshNarratives===1?'':'s'} promoted.`:'';
      const coins=stored.freshCoins?` ${stored.freshCoins} related coin candidate${stored.freshCoins===1?'':'s'} stored.`:'';
      const early=!stored.freshNarratives&&result.evidence.length?' No strict narrative promoted yet; review Early Candidates.':'';
      setMessage(`Scan complete. Saved ${stored.accepted||0} evidence records. X ${evidenceByPlatform.x||result.evidence.filter((x)=>x.platform==='X').length} · TikTok ${evidenceByPlatform.tiktok||result.evidence.filter((x)=>x.platform==='TikTok').length}.${promoted}${coins}${early}${warning}`);
      void ping(true);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  return <>
    <button onClick={toggleOpen} aria-label="Open browser intelligence" style={{position:'fixed',left:20,bottom:20,zIndex:70,border:0,borderRadius:999,padding:'12px 16px',fontWeight:800,background:'#fff',color:'#111',boxShadow:'0 10px 30px #0005',cursor:'pointer'}}><Activity size={16} style={{display:'inline',verticalAlign:'-3px',marginRight:7}}/>Browser Sources</button>
    {open&&<aside style={{position:'fixed',left:20,bottom:76,zIndex:69,width:'min(600px,calc(100vw - 28px))',maxHeight:'84vh',overflow:'auto',background:'#101216',color:'#f5f5f5',border:'1px solid #ffffff22',borderRadius:18,padding:18,boxShadow:'0 24px 60px #0009'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}>
        <div><strong>For You narrative intelligence</strong><div style={{fontSize:12,opacity:.7}}>{connected?`● Bridge connected${health?.version?` · v${health.version}`:''}${health?.running?' · scanning':''}${health?.pendingCount?` · ${health.pendingCount} pending`:''}`:'○ Local bridge offline'}</div></div>
        <button onClick={()=>setOpen(false)} aria-label="Close" style={{background:'none',border:0,color:'inherit'}}><X/></button>
      </div>
      <p style={{fontSize:13,opacity:.78}}>X For You and TikTok For You are the primary discovery surfaces. Front adaptively samples new unique posts/videos, uses trend pages only as seeds, then deep-searches both platforms when a repeated candidate appears.</p>
      <div style={{padding:9,borderRadius:9,background:'#d5ff4810',fontSize:12,marginBottom:10}}>Best results: use the dedicated Front Chrome profile as a broad internet-culture observer. Avoid training it only on crypto; the goal is to see the meme before crypto Twitter does.</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button onClick={()=>void ping()} disabled={!!busy}>Reconnect</button>
        <button onClick={()=>void openLogin()} disabled={!!busy}>{busy==='login'?'Opening…':'Open X + TikTok login'}</button>
        <button onClick={()=>void scan()} disabled={!!busy||!connected}>{busy==='scan'?'Investigating…':'Run deep investigation'}</button>
        <button onClick={()=>void flushPending(false)} disabled={!!busy||!connected}>Sync background finds</button>
      </div>
      <hr style={{borderColor:'#ffffff18'}}/>
      <label style={{fontSize:12,fontWeight:700}}>Sentinel X accounts <span style={{opacity:.55,fontWeight:500}}>optional · max 30</span></label>
      <textarea value={accounts} onChange={(e)=>setAccounts(e.target.value)} rows={3} placeholder={'early_meme_account\nviral_clip_account\ninternet_culture_account'} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:10,borderRadius:9,border:'1px solid #ffffff22',background:'#171a20',color:'inherit'}}/>
      <small style={{display:'block',opacity:.6,marginTop:4}}>Front rotates a small subset each sweep and learns which sentinels historically contribute early useful evidence. These accounts no longer define discovery.</small>
      <label style={{fontSize:12,fontWeight:700,display:'block',marginTop:10}}>Narratives / keywords to hunt</label>
      <textarea value={keywords} onChange={(e)=>setKeywords(e.target.value)} rows={3} placeholder={'DeJean Love\nviral meme phrase\ncelebrity moment'} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:10,borderRadius:9,border:'1px solid #ffffff22',background:'#171a20',color:'inherit'}}/>
      <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,flexWrap:'wrap'}}>
        <label style={{fontSize:12}}>Scout every <input type="number" min={10} max={240} value={config.intervalMinutes} onChange={(e)=>setConfig({...config,intervalMinutes:Number(e.target.value)})} style={{width:52}}/> min</label>
        <label style={{fontSize:12}}>Unique feed target <input type="number" min={30} max={180} value={config.targetUniqueFeedItems??90} onChange={(e)=>setConfig({...config,targetUniqueFeedItems:Number(e.target.value)})} style={{width:55}}/></label>
        <label style={{fontSize:12}}>Feed time cap <input type="number" min={20} max={120} value={config.maxFeedScanSeconds??70} onChange={(e)=>setConfig({...config,maxFeedScanSeconds:Number(e.target.value)})} style={{width:48}}/>s</label>
        <label style={{fontSize:12}}>Max adaptive scrolls <input type="number" min={3} max={25} value={config.maxAdaptiveScrolls??14} onChange={(e)=>setConfig({...config,maxAdaptiveScrolls:Number(e.target.value)})} style={{width:45}}/></label>
        <label style={{fontSize:12}}>Search scrolls <input type="number" min={1} max={6} value={config.searchScrollPasses??3} onChange={(e)=>setConfig({...config,searchScrollPasses:Number(e.target.value)})} style={{width:42}}/></label>
        <label style={{fontSize:12}}>Deep results/query <input type="number" min={8} max={24} value={config.deepResultsPerQuery??14} onChange={(e)=>setConfig({...config,deepResultsPerQuery:Number(e.target.value)})} style={{width:42}}/></label>
        <label style={{fontSize:12}}>Expand topics <input type="number" min={1} max={10} value={config.inferredTopicSearches} onChange={(e)=>setConfig({...config,inferredTopicSearches:Number(e.target.value)})} style={{width:42}}/></label>
        <button onClick={()=>void saveConfig()} disabled={!!busy}>{busy==='config'?'Saving…':'Save scan settings'}</button>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:9,fontSize:12}}>
        <label><input type="checkbox" checked={config.scanXForYou!==false} onChange={(e)=>setConfig({...config,scanXForYou:e.target.checked})}/> X For You</label>
        <label><input type="checkbox" checked={config.scanTikTokForYou!==false} onChange={(e)=>setConfig({...config,scanTikTokForYou:e.target.checked})}/> TikTok For You</label>
        <label><input type="checkbox" checked={config.scanXExplore} onChange={(e)=>setConfig({...config,scanXExplore:e.target.checked})}/> X trend seeds</label>
        <label><input type="checkbox" checked={config.scanTikTokTrends} onChange={(e)=>setConfig({...config,scanTikTokTrends:e.target.checked})}/> TikTok trend seeds</label>
      </div>
      <small style={{display:'block',opacity:.65,marginTop:8}}>Adaptive scrolling stops when Front gets enough new unique content, sees mostly duplicates, hits the time cap, or reaches the scroll cap. Scheduled scout finds queue locally while this page is closed. Front never bypasses CAPTCHAs, login challenges, rate limits, or platform restrictions.</small>
      {health?.nextScheduledRun&&<small style={{display:'block',opacity:.65,marginTop:4}}>Next scout sweep: {new Date(health.nextScheduledRun).toLocaleTimeString()}</small>}
      {message&&<div style={{marginTop:12,padding:10,borderRadius:9,background:'#d5ff481a',fontSize:13}}>{message}</div>}
      {error&&<div style={{marginTop:12,padding:10,borderRadius:9,background:'#ff52521a',fontSize:13}}>{error}</div>}
      {lastScan&&audit&&<>
        <hr style={{borderColor:'#ffffff18'}}/>
        <strong>Scan audit</strong>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:6,marginTop:8}}>
          {[
            ['Evidence',lastScan.evidence.length],
            ['Creators',audit.uniqueCreators],
            ['For You sample',lastScan.audit?.forYouSampleSize??0],
            ['Rising topics',lastScan.audit?.risingFeedTopics??audit.rising],
          ].map(([label,value])=><div key={String(label)} style={{padding:7,border:'1px solid #ffffff18',borderRadius:8}}><div style={{fontSize:10,opacity:.55}}>{label}</div><b>{value}</b></div>)}
        </div>
        <div style={{fontSize:12,marginTop:8,padding:8,borderRadius:8,background:'#ffffff08'}}>{audit.diagnosis}</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:7}}>
          {Object.entries(audit.sourceCounts).map(([label,count])=><span key={label} style={{fontSize:11,padding:'3px 6px',borderRadius:999,background:'#ffffff10'}}>{label} {count}</span>)}
          {audit.unknownAge>0&&<span style={{fontSize:11,padding:'3px 6px',borderRadius:999,background:'#ffffff10'}}>Age unknown {audit.unknownAge}</span>}
          {(lastScan.audit?.repeatedTikTokSounds||0)>0&&<span style={{fontSize:11,padding:'3px 6px',borderRadius:999,background:'#ffffff10'}}>Repeated sounds {lastScan.audit?.repeatedTikTokSounds}</span>}
        </div>
        {(lastScan.audit?.feedAudits?.x||lastScan.audit?.feedAudits?.tiktok)&&<div style={{fontSize:11,opacity:.7,marginTop:7}}>
          {lastScan.audit?.feedAudits?.x&&<>X For You: {lastScan.audit.feedAudits.x.newToHistory??0} new · {lastScan.audit.feedAudits.x.noveltyPct??0}% novel · stopped on {lastScan.audit.feedAudits.x.stopReason}. </>}
          {lastScan.audit?.feedAudits?.tiktok&&<>TikTok For You: {lastScan.audit.feedAudits.tiktok.newToHistory??0} new · {lastScan.audit.feedAudits.tiktok.noveltyPct??0}% novel · stopped on {lastScan.audit.feedAudits.tiktok.stopReason}.</>}
        </div>}
        {lastScan.errors.map((value)=><div key={value} style={{fontSize:12,opacity:.72,marginTop:4}}>⚠ {value}</div>)}
        {(lastScan.inferredTopics||[]).slice(0,8).map((topic)=><div key={topic.key} style={{marginTop:8,padding:8,border:'1px solid #d5ff4833',borderRadius:9,fontSize:12}}>
          <b>{topic.topic}</b> · {topic.authorCount} creators · {topic.evidenceCount} posts/videos · {topic.platforms.join(' + ')}
          <div style={{opacity:.7}}>Momentum {topic.score.toFixed(1)} · For You penetration {(topic.feedPenetration??0).toFixed(2)}%{topic.feedPenetrationVelocity!=null?` · velocity ${topic.feedPenetrationVelocity>=0?'+':''}${topic.feedPenetrationVelocity.toFixed(2)} pts/hr`:''}</div>
          {(topic.aliases||[]).length>1&&<div style={{marginTop:4,opacity:.72}}>Aliases: {(topic.aliases||[]).slice(0,5).join(' · ')}</div>}
          {(topic.soundSignals||[]).length>0&&<div style={{marginTop:4,opacity:.82}}><b>TikTok sounds:</b> {(topic.soundSignals||[]).slice(0,3).map((sound)=>`${sound.title||sound.soundId} (${sound.creators} creators)`).join(' · ')}</div>}
          {(topic.relatedContexts||[]).length>0&&<div style={{marginTop:5,opacity:.82}}><b>Related context:</b> {(topic.relatedContexts||[]).slice(0,4).map((item)=>`${item.title} (${item.authorCount} creators)`).join(' · ')}</div>}
        </div>)}
        {lastScan.evidence.slice(0,10).map((item)=>{
          const metrics=[metric(item.views,'views'),metric(item.likes,'likes'),metric(item.reposts,'reposts'),metric(item.replies,'replies'),metric(item.quotes,'quotes'),metric(item.comments,'comments'),metric(item.shares,'shares'),metric(item.saves,'saves')].filter(Boolean);
          return <div key={item.id} style={{marginTop:9,padding:9,border:'1px solid #ffffff18',borderRadius:9}}>
            <div style={{fontSize:11,opacity:.65}}>{sourceLabel(item)} · {item.author}{item.published?` · ${new Date(item.published).toLocaleString()}`:''}</div>
            <div style={{fontSize:13,marginTop:3}}>{item.content.slice(0,220)}</div>
            {metrics.length>0&&<div style={{fontSize:11,opacity:.68,marginTop:4}}>{metrics.join(' · ')}</div>}
            {item.soundTitle&&<div style={{fontSize:11,opacity:.72,marginTop:3}}>Sound: {item.soundTitle}{item.soundAuthor?` · ${item.soundAuthor}`:''}</div>}
            <a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:12}}>Open evidence <ExternalLink size={11} style={{display:'inline'}}/></a>
          </div>;
        })}
      </>}
      {narratives.length>0&&<><hr style={{borderColor:'#ffffff18'}}/><strong>Detected narrative groups</strong>{narratives.map((item)=><div key={item.id} style={{marginTop:7,fontSize:13}}><b>{item.title}</b> · {item.stage} · {item.authors} account(s) · {item.platforms.join(' + ')}</div>)}</>}
      <div style={{marginTop:12,padding:10,borderRadius:9,background:'#ffffff0d',fontSize:12,display:'flex',gap:7}}><ShieldCheck size={15}/> X/TikTok cookies stay in ~/.front-browser-bridge/chrome-profile and are never uploaded to Front.</div>
    </aside>}
  </>;
}
