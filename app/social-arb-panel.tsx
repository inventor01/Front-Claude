'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, Building2, CheckCircle2, ExternalLink, RefreshCw, ScanSearch, ShoppingBag, Sparkles } from 'lucide-react';
import styles from './social-arb-panel.module.css';

const BRIDGE='http://127.0.0.1:43981';

export type SocialArbEvidence={
 id:string;platform:string;author:string;url:string;content:string;published:number|null;evidenceType?:'post'|'comment';parentUrl?:string|null;
};
export type SocialArbSignal={
 key:string;title:string;product?:string|null;brandCandidate?:string|null;companyName?:string|null;ticker?:string|null;relation?:string|null;
 direction?:'positive'|'negative'|'mixed'|'unknown'|string;materiality?:string|null;mappingStatus?:string;tickerVerified?:boolean;
 mappingConfidence?:number;score:number;status:'WATCH'|'EARLY'|'RISING'|'HIGH_SIGNAL'|string;authorCount:number;commenterCount?:number;independentVoiceCount?:number;evidenceCount:number;
 platforms:string[];behaviors:Record<string,number>;change?:{growthMultiple?:number|null;authorMultiple?:number|null;commentMultiple?:number|null;behaviorMultiple?:number|null;newToBaseline?:boolean};
 thesis?:string|null;evidence?:SocialArbEvidence[];observed?:number;informationGap?:{status?:string;score?:number|null;marketAwareness?:number|null;note?:string};
};
type Feed={signals:SocialArbSignal[];stats:{total:number;highSignal:number;rising:number;mapped:number;tickerVerified:number};methodology?:string;error?:string};
type SocialArbResearch={
 signalKey:string;researched?:number;materialityStatus?:string;awarenessStatus?:string;informationGapState?:string;filingCount?:number;financialNewsCount?:number;
 awareness?:{filings?:{evidence?:Array<{source:string;form?:string;filed?:string;url:string}>};financialNews?:{evidence?:Array<{source:string;title:string;url:string;published?:string|null}>}};
 informationGap?:{note?:string};materiality?:{note?:string};
};
type ResearchFeed={research:SocialArbResearch[];error?:string};
type SocialArbOutcome={
 researchId:string;signalKey:string;ticker:string;provider:string;captured:number;baselinePrice:number|null;baselineAt:number|null;baselineKind:string|null;status:string;
 horizons:Record<string,{status?:string;sessions?:number;date?:string;price?:number;return?:number;note?:string}>;note?:string|null;error?:string|null;
};
type OutcomeFeed={outcomes:SocialArbOutcome[];provider:{provider:string;configured:boolean;purpose?:string;license?:string};error?:string};

const behaviorNames:Record<string,string>={
 PURCHASED:'Bought',PURCHASE_INTENT:'Wants to buy',REPEAT_PURCHASE:'Repeat buying',SWITCHING:'Switching',STOCKOUT:'Stockout',
 ADOPTION:'Adoption',ABANDONMENT:'Abandonment',COMPLAINT:'Complaints',PRICE_RESISTANCE:'Price resistance',
};
const age=(value:number|undefined)=>{
 if(!value)return'';
 const minutes=Math.max(0,Math.round((Date.now()-value)/60000));
 if(minutes<60)return String(minutes)+'m ago';
 if(minutes<1440)return (minutes/60).toFixed(minutes<600?1:0)+'h ago';
 return String(Math.round(minutes/1440))+'d ago';
};
function changeLabel(signal:SocialArbSignal){
 if(signal.change?.newToBaseline)return'New vs baseline';
 const multiple=Number(signal.change?.growthMultiple);
 if(Number.isFinite(multiple)&&multiple>0)return multiple.toFixed(multiple<10?1:0)+'× vs baseline';
 return'Baseline learning';
}
function mappingLabel(signal:SocialArbSignal){
 if(signal.tickerVerified)return'Ticker verified';
 if(signal.ticker||signal.companyName)return'Company hypothesis';
 return'Needs company mapping';
}
function formatOutcomePrice(value:number|null){
 if(value==null)return 'awaiting provider';
 return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
}
function OutcomeStrip({outcome}:{outcome:SocialArbOutcome}){
 const horizons=['1','5','20','60'];
 return <div className={styles.outcome}>
  <div><span>Point-in-time journal</span><b>{outcome.status.replaceAll('-',' ')}</b></div>
  <div>
   <span>Baseline</span>
   <b>{formatOutcomePrice(outcome.baselinePrice)}</b>
   <small>{outcome.baselineKind?outcome.baselineKind.replaceAll('-',' '):''}</small>
  </div>
  {horizons.map((horizon)=>{
   const result=outcome.horizons?.[horizon];
   const measured=result?.status==='measured'&&Number.isFinite(Number(result.return));
   const pct=measured?Number(result.return)*100:null;
   const label=pct==null?'pending':(pct>=0?'+':'')+pct.toFixed(1)+'%';
   return <div key={horizon}>
    <span>{horizon} session{horizon==='1'?'':'s'}</span>
    <b>{label}</b>
    <small>{result?.date||''}</small>
   </div>;
  })}
 </div>;
}
function mergeSignals(persisted:SocialArbSignal[],live:SocialArbSignal[]){
 const map=new Map<string,SocialArbSignal>();
 for(const signal of persisted)map.set(signal.key,signal);
 for(const signal of live){
  const old=map.get(signal.key);
  map.set(signal.key,{...old,...signal,
   companyName:old?.companyName||signal.companyName||null,ticker:old?.ticker||signal.ticker||null,
   tickerVerified:old?.tickerVerified||signal.tickerVerified||false,mappingStatus:old?.mappingStatus||signal.mappingStatus,
   evidence:(signal.evidence?.length?signal.evidence:old?.evidence)||[],
  });
 }
 return[...map.values()].sort((a,b)=>Number(b.score||0)-Number(a.score||0)||Number(b.authorCount||0)-Number(a.authorCount||0));
}
export default function SocialArbPanel({liveSignals=[],refreshKey=0,onScanComplete}:{liveSignals?:SocialArbSignal[];refreshKey?:number;onScanComplete?:()=>void}){
 const [feed,setFeed]=useState<Feed|null>(null);
 const [research,setResearch]=useState<Record<string,SocialArbResearch>>({});
 const [outcomes,setOutcomes]=useState<Record<string,SocialArbOutcome>>({});
 const [marketProvider,setMarketProvider]=useState<{provider:string;configured:boolean}|null>(null);
 const [busy,setBusy]=useState('');
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');

 async function refreshResearch(){
  try{
   const response=await fetch('/api/social-arb/research',{cache:'no-store'});
   const data=await response.json() as ResearchFeed;
   if(!response.ok)throw new Error(data.error||'Could not load Social Arb research.');
   setResearch(Object.fromEntries((data.research||[]).map((item)=>[item.signalKey,item])));
  }catch(reason){setError((reason as Error).message);}
 }

 async function refreshOutcomes(){
  try{
   const response=await fetch('/api/social-arb/outcomes',{cache:'no-store'});
   const data=await response.json() as OutcomeFeed;
   if(!response.ok)throw new Error(data.error||'Could not load Social Arb outcomes.');
   setOutcomes(Object.fromEntries((data.outcomes||[]).map((item)=>[item.signalKey,item])));
   setMarketProvider(data.provider||null);
  }catch(reason){setError((reason as Error).message);}
 }

 async function researchSignal(signalKey:string){
  setBusy('research:'+signalKey);setError('');setMessage('Checking SEC filings and financial-media awareness for this candidate…');
  try{
   const response=await fetch('/api/social-arb/research',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signalKey})
   });
   const data=await response.json() as SocialArbResearch&{error?:string};
   if(!response.ok)throw new Error(data.error||'Candidate research failed.');
   setResearch((current)=>({...current,[signalKey]:data}));
   void refreshOutcomes();
   setMessage('Research check saved point-in-time · '+String(data.informationGapState||'unmeasured').replaceAll('-',' ')+'.');
  }catch(reason){setError((reason as Error).message);}
  finally{setBusy('');}
 }

 async function refresh(){
  setBusy((value)=>value||'refresh');setError('');
  try{
   const response=await fetch('/api/social-arb',{cache:'no-store'});
   const data=await response.json() as Feed;
   if(!response.ok)throw new Error(data.error||'Could not load Social Arb.');
   setFeed(data);
   void refreshResearch();
   void refreshOutcomes();
  }catch(reason){setError((reason as Error).message);}
  finally{setBusy((value)=>value==='refresh'?'':value);}
 }

 useEffect(()=>{
  let cancelled=false;
  void Promise.all([
   fetch('/api/social-arb',{cache:'no-store'}).then(async(response)=>{
    const data=await response.json() as Feed;
    if(!response.ok)throw new Error(data.error||'Could not load Social Arb.');
    return data;
   }),
   fetch('/api/social-arb/research',{cache:'no-store'}).then(async(response)=>{
    const data=await response.json() as ResearchFeed;
    if(!response.ok)throw new Error(data.error||'Could not load Social Arb research.');
    return data;
   }),
   fetch('/api/social-arb/outcomes',{cache:'no-store'}).then(async(response)=>{
    const data=await response.json() as OutcomeFeed;
    if(!response.ok)throw new Error(data.error||'Could not load Social Arb outcomes.');
    return data;
   }),
  ]).then(([signalsFeed,researchFeed,outcomeFeed])=>{
   if(cancelled)return;
   setFeed(signalsFeed);
   setResearch(Object.fromEntries((researchFeed.research||[]).map((item)=>[item.signalKey,item])));
   setOutcomes(Object.fromEntries((outcomeFeed.outcomes||[]).map((item)=>[item.signalKey,item])));
   setMarketProvider(outcomeFeed.provider||null);
  }).catch((reason)=>{if(!cancelled)setError((reason as Error).message);});
  return()=>{cancelled=true;};
 },[refreshKey]);

 async function scanWorld(){
  setBusy('scan');setError('');setMessage('Scanning broad social behavior. Front will look for real-world change first, then map products and companies.');
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),240000);
  try{
   const response=await fetch(BRIDGE+'/scan',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
    body:JSON.stringify({mode:'deep',scanXForYou:true,scanTikTokForYou:true,scanInstagram:true,targetUniqueFeedItems:90}),
   });
   const data=await response.json() as {socialArbSignals?:SocialArbSignal[];error?:string};
   if(!response.ok)throw new Error(data.error||'Social Arb scan failed.');
   const count=data.socialArbSignals?.length||0;
   setMessage('Scan complete · '+count+' world-change signal'+(count===1?'':'s')+' detected. Cloud sync will verify company identities next.');
   onScanComplete?.();
   window.setTimeout(()=>void refresh(),1200);
  }catch(reason){
   if(reason instanceof DOMException&&reason.name==='AbortError')setError('The deep Social Arb scan exceeded the panel timeout. The local scanner may still be finishing; live results will continue to appear above.');
   else setError((reason as Error).message);
  }finally{window.clearTimeout(timer);setBusy('');}
 }

 const signals=useMemo(()=>mergeSignals(feed?.signals||[],liveSignals||[]),[feed?.signals,liveSignals]);
 const stats={
  total:signals.length,
  highSignal:signals.filter((s)=>s.status==='HIGH_SIGNAL').length,
  rising:signals.filter((s)=>s.status==='RISING').length,
  mapped:signals.filter((s)=>Boolean(s.ticker||s.companyName)).length,
  tickerVerified:signals.filter((s)=>s.tickerVerified===true).length,
 };

 return <section className={styles.shell} aria-label="Front Social Arb research">
  <header className={styles.head}>
   <div>
    <div className={styles.eyebrow}>Front Social Arb · observational investing research</div>
    <h1>Watch the world before the ticker.</h1>
    <p>Front detects changes in ordinary consumer behavior first, traces them through products and brands to public companies, and keeps company ownership separate from verified ticker identity.</p>
   </div>
   <div className={styles.actions}>
    <button className={styles.button} onClick={()=>void refresh()} disabled={!!busy}><RefreshCw size={14}/>Refresh</button>
    <button className={styles.buttonPrimary} onClick={()=>void scanWorld()} disabled={!!busy}><ScanSearch size={15}/>{busy==='scan'?'Scanning world…':'Scan world now'}</button>
   </div>
  </header>

  {message&&<div className={styles.notice}>{message}</div>}
  {error&&<div className={styles.error}>{error}</div>}
  {marketProvider&&!marketProvider.configured&&<div className={styles.marketNotice}>Performance journal is ready, but Tiingo is not connected yet. Front will not invent or scrape a substitute price feed; connect a Tiingo API token before the live 7-day run to freeze exact research-time prices.</div>}

  <div className={styles.stats}>
   <div className={styles.stat}><span>World changes</span><strong>{stats.total}</strong><small>ranked social-behavior signals</small></div>
   <div className={styles.stat}><span>High signal</span><strong>{stats.highSignal}</strong><small>strongest change evidence</small></div>
   <div className={styles.stat}><span>Rising</span><strong>{stats.rising}</strong><small>multi-creator acceleration</small></div>
   <div className={styles.stat}><span>Company mapped</span><strong>{stats.mapped}</strong><small>hypothesis or verified</small></div>
   <div className={styles.stat}><span>SEC ticker verified</span><strong>{stats.tickerVerified}</strong><small>identity, not ownership proof</small></div>
  </div>

  <div className={styles.method}>
   <b>WORLD</b><ArrowRight size={12} className={styles.arrow}/><span>behavior change</span><ArrowRight size={12} className={styles.arrow}/>
   <b>PRODUCT</b><ArrowRight size={12} className={styles.arrow}/><span>brand</span><ArrowRight size={12} className={styles.arrow}/>
   <b>PUBLIC COMPANY</b><ArrowRight size={12} className={styles.arrow}/><span>verify</span><ArrowRight size={12} className={styles.arrow}/><b>INFORMATION GAP</b>
  </div>

  {signals.length?<div className={styles.list}>{signals.slice(0,60).map((signal,index)=>{
   const behaviors=Object.entries(signal.behaviors||{}).filter(([,count])=>Number(count)>0).sort((a,b)=>Number(b[1])-Number(a[1]));
   const evidence=(signal.evidence||[]).slice(0,5);
   const mapped=Boolean(signal.ticker||signal.companyName);
   const researchRow=research[signal.key];
   const outcome=outcomes[signal.key];
   const company=(signal.companyName||'company')+(signal.ticker?' ('+signal.ticker+')':'');
   return <article className={styles.card} key={signal.key}>
    <div className={styles.cardHead}>
     <span className={styles.rank}>{String(index+1).padStart(2,'0')}</span>
     <div className={styles.title}>
      <h2>{signal.title}</h2>
      <p>{changeLabel(signal)} · {signal.authorCount} creator{signal.authorCount===1?'':'s'}{Number(signal.commenterCount||0)>0?' + '+signal.commenterCount+' commenter'+(signal.commenterCount===1?'':'s'):''} · {signal.evidenceCount} observation{signal.evidenceCount===1?'':'s'}{signal.observed?' · '+age(signal.observed):''}</p>
      <div className={styles.badges}>
       <span className={signal.status==='HIGH_SIGNAL'||signal.status==='RISING'?styles.badgeHot:styles.badge}><Sparkles size={10}/>{signal.status}</span>
       <span className={styles.badge}>{signal.direction||'unknown'} demand</span>
       <span className={signal.tickerVerified?styles.badgeVerify:styles.badge}>{signal.tickerVerified?<CheckCircle2 size={10}/>:<Building2 size={10}/>} {mappingLabel(signal)}</span>
       {(signal.platforms||[]).map((platform)=><span className={styles.badge} key={platform}>{platform}</span>)}
      </div>
     </div>
     <div className={styles.score}><strong>{Math.round(Number(signal.score||0))}</strong><span>change score</span></div>
    </div>
    <div className={styles.bar}><span style={{width:String(Math.max(0,Math.min(100,Number(signal.score||0))))+'%'}}/></div>
    <div className={styles.grid}>
     <div className={styles.block}>
      <span className={styles.label}><Activity size={11}/> Observed behavior</span>
      {behaviors.length?<div className={styles.behaviors}>{behaviors.map(([key,count])=><span className={styles.behavior} key={key}>{behaviorNames[key]||key} <b>{count}</b></span>)}</div>:<span className={styles.muted}>No explicit purchase-language category yet; Front is tracking the underlying subject change.</span>}
     </div>
     <div className={styles.block}>
      <span className={styles.label}><ShoppingBag size={11}/> Product → company</span>
      <div className={styles.path}><b>{signal.product||signal.title}</b><ArrowRight size={11}/><span>{signal.brandCandidate||'brand unresolved'}</span><ArrowRight size={11}/><b>{mapped?company:'public company unresolved'}</b></div>
      {signal.thesis&&<p className={styles.thesis}>{signal.thesis}</p>}
      {signal.tickerVerified&&<p className={styles.thesis}>SEC confirms the ticker/company identity. The brand ownership or economic relationship still requires separate evidence unless explicitly verified.</p>}
     </div>
     <div className={styles.block}>
      <span className={styles.label}><Building2 size={11}/> Information gap</span>
      {researchRow?<>
       <b>{String(researchRow.informationGapState||'unmeasured').replaceAll('-',' ')}</b>
       <p className={styles.thesis}>{researchRow.informationGap?.note||'Point-in-time awareness check saved.'}</p>
       <div className={styles.researchMeta}><span>SEC filing matches <b>{researchRow.filingCount||0}</b></span><span>financial-media matches <b>{researchRow.financialNewsCount||0}</b></span></div>
       <span className={styles.badge}>materiality · {String(researchRow.materialityStatus||'unquantified').replaceAll('-',' ')}</span>
      </>:<>
       <b>Not measured yet</b>
       <p className={styles.thesis}>Social change alone is not enough. Check company filings and financial-media awareness before calling this an information imbalance.</p>
      </>}
      <button className={styles.researchButton} disabled={!signal.tickerVerified||!!busy} onClick={()=>void researchSignal(signal.key)}>{busy==='research:'+signal.key?'Researching…':researchRow?'Re-check gap':'Research gap'}</button>
     </div>
    </div>
    {outcome?<OutcomeStrip outcome={outcome}/>:null}
    {evidence.length?<div className={styles.evidence}>{evidence.map((item)=><a href={item.url} target="_blank" rel="noreferrer" key={item.id}><span>{item.platform}{item.evidenceType==='comment'?' comment':''} · @{item.author}</span><ExternalLink size={10}/></a>)}</div>:null}
    {researchRow&&(researchRow.awareness?.filings?.evidence?.length||researchRow.awareness?.financialNews?.evidence?.length)?<div className={styles.researchEvidence}>
     {(researchRow.awareness?.filings?.evidence||[]).slice(0,3).map((item,index)=><a href={item.url} target="_blank" rel="noreferrer" key={'sec-'+index}>SEC {item.form||'filing'} {item.filed||''}<ExternalLink size={10}/></a>)}
     {(researchRow.awareness?.financialNews?.evidence||[]).slice(0,3).map((item,index)=><a href={item.url} target="_blank" rel="noreferrer" key={'news-'+index}>{item.source||'Financial media'} · {item.title}<ExternalLink size={10}/></a>)}
    </div>:null}
   </article>;
  })}</div>:<div className={styles.empty}><b>No Social Arb baseline yet.</b>Run a broad scan. Front needs ordinary consumer/culture evidence before it can detect changes relative to its own history.</div>}
 </section>;
}
