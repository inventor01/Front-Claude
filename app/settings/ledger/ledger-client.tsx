'use client';

import {useEffect,useState} from 'react';
import {ArrowLeft,RefreshCw,Square,Trash2} from 'lucide-react';
import styles from './ledger-client.module.css';

const BRIDGE='http://127.0.0.1:43981';

type Sample={platform?:string|null;author?:string|null;url?:string|null;mediaType?:string|null;provenance?:string|null;content?:string|null;contentConfidence?:number|null;views?:number|null;likes?:number|null};
type VisionScan={requested?:number;analyzed?:number;cached?:number;cachedFailures?:number;enriched?:number;failed?:number;skipped?:number;provider?:string|null;model?:string|null};
type ContentStatus={enabled?:boolean;provider?:string|null;model?:string|null;state?:string|null;cachedVideos?:number;successfulCachedVideos?:number;failedCachedVideos?:number;lastRun?:number|null;lastError?:string|null;lastStats?:VisionScan|null;latestSuccess?:{analyzedAt?:number|null;summary?:string|null;confidence?:number|null;frameCount?:number;modelFrameCount?:number;duration?:number;captureType?:string|null}|null;latestFailure?:{cachedAt?:number|null;error?:string|null}|null};
type Vision={enabled?:boolean;provider?:string|null;model?:string|null;visuallyUnderstood?:number;scan?:VisionScan|null;lastError?:string|null};
type ScanEntry={
  id:string;
  startedAt:number;
  completedAt?:number|null;
  durationMs?:number|null;
  status:string;
  phase?:string|null;
  scanConnection?:string|null;
  request?:{mode?:string;targetUniqueFeedItems?:number|null;keywordCount?:number;sentinelCount?:number;xForYou?:boolean;tiktokForYou?:boolean;xExplore?:boolean;tiktokTrends?:boolean};
  usableEvidence?:number;
  observed?:number;
  inferredTopics?:number;
  uniqueCreators?:number|null;
  sourceCounts?:Record<string,number>;
  platformCounts?:Record<string,number>;
  errors?:string[];
  fallback?:{triggered?:boolean;failed?:boolean;rawEvidence?:number;groundedEvidence?:number;diagnostics?:unknown}|null;
  vision?:Vision|null;
  contentUnderstanding?:ContentStatus|null;
  samples?:Sample[];
};
type Ledger={ok:boolean;version:number;current:ScanEntry|null;scans:ScanEntry[];retained:number};

type HealthVerdict={score:number;label:string;tone:'good'|'fair'|'bad';notes:string[];ratio:number|null};
type VideoVerdict={label:string;tone:'good'|'fair'|'bad'|'idle';detail:string};

function time(value?:number|null){return value?new Date(value).toLocaleString():'—';}
function duration(ms?:number|null){if(!ms)return'—';if(ms<1000)return`${ms} ms`;const sec=Math.round(ms/1000);return sec<60?`${sec}s`:`${Math.floor(sec/60)}m ${sec%60}s`;}
function counts(value?:Record<string,number>){const entries=Object.entries(value||{}).filter(([,n])=>Number(n)>0);return entries.length?entries.map(([k,n])=>`${k}: ${n}`).join(' · '):'None';}
function statusClass(status:string){return status==='complete'?styles.success:status==='running'?styles.running:status==='stopped'?styles.stopped:styles.warning;}
const n=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;

function scanHealth(scan:ScanEntry):HealthVerdict{
  const observed=n(scan.observed),usable=n(scan.usableEvidence),ratio=observed>0?Math.min(1,usable/observed):null;
  let score=100;
  const notes:string[]=[];
  if(scan.status==='failed'){score=Math.min(score,20);notes.push('Scan ended in failed state.');}
  else if(scan.status==='stopped'){score=Math.min(score,55);notes.push('Scan was manually stopped before full coverage.');}
  else if(scan.status==='zero'){score-=35;notes.push('Canonical scan finished with zero usable evidence.');}
  if(observed<=0){score-=40;notes.push('No posts were observed by the canonical scan/recovery ledger.');}
  else if(usable<=0){score-=35;notes.push(`${observed} post${observed===1?' was':'s were'} observed but none became usable evidence.`);}
  else if(ratio!==null&&ratio<.25){score-=18;notes.push(`Only ${Math.round(ratio*100)}% of observed posts became usable evidence.`);}
  else if(ratio!==null&&ratio<.5){score-=9;notes.push(`${Math.round(ratio*100)}% extraction yield is lower than ideal.`);}
  else if(ratio!==null){notes.push(`${Math.round(ratio*100)}% of observed posts became usable evidence.`);}
  const wantedX=scan.request?.xForYou!==false||scan.request?.xExplore!==false;
  const wantedTikTok=scan.request?.tiktokForYou!==false||scan.request?.tiktokTrends!==false;
  if(observed>0&&wantedX&&!n(scan.platformCounts?.X)){score-=10;notes.push('X was requested but contributed no usable evidence.');}
  if(observed>0&&wantedTikTok&&!n(scan.platformCounts?.TikTok)){score-=10;notes.push('TikTok was requested but contributed no usable evidence.');}
  if(scan.fallback?.failed){score-=15;notes.push('Media-first visual recovery failed.');}
  const errorCount=scan.errors?.length||0;
  if(errorCount){score-=Math.min(20,errorCount*5);notes.push(`${errorCount} scanner warning/error${errorCount===1?'':'s'} recorded.`);}
  const vision=videoHealth(scan.vision);
  if(vision.label==='FAILED'){score-=15;notes.push('Selected video understanding failed.');}
  else if(vision.label==='DEGRADED'){score-=7;notes.push('Video understanding only partially succeeded.');}
  score=Math.max(0,Math.min(100,Math.round(score)));
  const label=score>=85?'HEALTHY':score>=65?'FAIR':score>=40?'NEEDS ATTENTION':'BROKEN';
  return{score,label,tone:score>=85?'good':score>=65?'fair':'bad',notes,ratio};
}

function videoHealth(vision?:Vision|null):VideoVerdict{
  if(!vision?.enabled)return{label:'INACTIVE',tone:'idle',detail:'Video understanding was not enabled for this scan.'};
  const scan=vision.scan||{};
  const requested=n(scan.requested),analyzed=n(scan.analyzed),cached=n(scan.cached),cachedFailures=n(scan.cachedFailures),enriched=n(scan.enriched),failed=n(scan.failed),understood=n(vision.visuallyUnderstood);
  if(requested<=0&&understood<=0)return{label:'NOT EXERCISED',tone:'idle',detail:'No video candidate reached the content-understanding stage in this scan.'};
  if(enriched>0&&failed===0)return{label:'PASS',tone:'good',detail:`${requested} requested · ${analyzed} analyzed · ${cached} cached · ${enriched} enriched · 0 failed.`};
  if(enriched>0)return{label:'DEGRADED',tone:'fair',detail:`${enriched} video${enriched===1?'':'s'} understood, but ${failed} failed (${cachedFailures} cached failure${cachedFailures===1?'':'s'}).`};
  if(failed>0)return{label:'FAILED',tone:'bad',detail:`${requested} requested · ${analyzed} analyzed · ${failed} failed · ${understood} understood.`};
  if(cached>0&&understood>0)return{label:'PASS',tone:'good',detail:`${understood} video${understood===1?'':'s'} restored from successful cached analysis.`};
  return{label:'DEGRADED',tone:'fair',detail:`${requested} video candidate${requested===1?'':'s'} selected, but none produced grounded enrichment.`};
}

function contentHealth(status?:ContentStatus|null):VideoVerdict{
  if(!status?.enabled)return{label:'INACTIVE',tone:'idle',detail:'No content-understanding model is enabled.'};
  if(status.state==='healthy'||status.state==='cached-ready'){
    const success=status.latestSuccess;
    const proof=success?`${success.captureType||'capture'} · ${success.frameCount||0} frame(s) · confidence ${success.confidence==null?'—':Math.round(success.confidence*100)+'%'}`:`${status.successfulCachedVideos||0} successful cached analysis(es)`;
    return{label:status.state==='healthy'?'PASS':'CACHED READY',tone:'good',detail:proof};
  }
  if(status.state==='failed')return{label:'FAILED',tone:'bad',detail:status.lastError||status.latestFailure?.error||'Most recent content-understanding run failed.'};
  if(status.state==='degraded')return{label:'DEGRADED',tone:'fair',detail:status.lastError||'Some video analyses failed.'};
  return{label:'NOT EXERCISED',tone:'idle',detail:`${status.provider||'provider'} · ${status.model||'model'} is configured, but no successful video analysis is proven yet.`};
}

export default function LedgerClient(){
  const [ledger,setLedger]=useState<Ledger|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');

  async function refresh(silent=false){
    try{
      const response=await fetch(`${BRIDGE}/ledger`,{cache:'no-store'});
      const data=await response.json() as Ledger&{error?:string};
      if(!response.ok)throw new Error(data.error||'Could not read local scan ledger.');
      setLedger(data);setError('');
    }catch(e){if(!silent)setError((e as Error).message);}
  }
  async function stop(){
    setBusy('stop');
    try{const response=await fetch(`${BRIDGE}/stop`,{method:'POST'});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Could not stop scan.');await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy('');}
  }
  async function clear(){
    setBusy('clear');
    try{const response=await fetch(`${BRIDGE}/ledger/clear`,{method:'POST'});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'Could not clear ledger.');await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  useEffect(()=>{
    const kickoff=window.setTimeout(()=>{void refresh();},0);
    const timer=window.setInterval(()=>void refresh(true),2000);
    return()=>{window.clearTimeout(kickoff);window.clearInterval(timer);};
  },[]);

  const current=ledger?.current;
  const liveVision=contentHealth(current?.contentUnderstanding);
  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>FRONT · SCAN LEDGER</div><h1>What Front actually scanned</h1><p>Live and historical local scan diagnostics: coverage, extraction yield, visual recovery, Ollama activity, errors, and sample post URLs.</p></div>
      <a className={styles.back} href="/settings"><ArrowLeft size={15}/> Scanner settings</a>
    </header>

    {error&&<div className={styles.error}>{error}</div>}

    <section className={styles.toolbar}>
      <button onClick={()=>void refresh()} disabled={!!busy}><RefreshCw size={14}/> Refresh</button>
      <button className={styles.danger} onClick={()=>void stop()} disabled={!!busy||!current}><Square size={14}/> {busy==='stop'?'Stopping…':'Stop current scan'}</button>
      <button onClick={()=>void clear()} disabled={!!busy||!ledger?.scans.length}><Trash2 size={14}/> {busy==='clear'?'Clearing…':'Clear history'}</button>
      <span>{ledger?`${ledger.retained} completed scan${ledger.retained===1?'':'s'} retained`:'Connecting to local bridge…'}</span>
    </section>

    <section className={styles.liveCard}>
      <div className={styles.cardHead}><div><h2>Live scan</h2><p>Updates every 2 seconds while this page is open.</p></div><span className={current?statusClass(current.status):styles.idle}>{current?current.status:'idle'}</span></div>
      {current?<>
        <div className={styles.metrics}>
          <div><span>Phase</span><b>{current.phase||'starting'}</b></div>
          <div><span>Mode</span><b>{current.request?.mode||'deep'}</b></div>
          <div><span>Browser</span><b>{current.scanConnection||'checking'}</b></div>
          <div><span>Started</span><b>{time(current.startedAt)}</b></div>
        </div>
        <div className={styles.qaRow}><div data-tone={liveVision.tone}><span>Video QA</span><b>{liveVision.label}</b><small>{liveVision.detail}</small></div></div>
      </>:<div className={styles.empty}>No scan is running right now. Start a Deep Scan from Scanner Settings and this section will immediately show activity.</div>}
    </section>

    <section className={styles.history}>
      <div className={styles.sectionHead}><h2>Recent scans</h2><p>Newest first. Scan health measures collection/extraction health, not whether the internet produced a qualifying narrative.</p></div>
      {!ledger?.scans.length?<div className={styles.empty}>No completed scans recorded yet.</div>:ledger.scans.map((scan)=>{
        const health=scanHealth(scan),video=videoHealth(scan.vision);
        return <article className={styles.scanCard} key={scan.id}>
          <div className={styles.cardHead}><div><h3>{scan.request?.mode==='scout'?'Scout':'Deep'} scan · {time(scan.startedAt)}</h3><p>{duration(scan.durationMs)} · {scan.id}</p></div><span className={statusClass(scan.status)}>{scan.status}</span></div>
          <div className={styles.qaRow}>
            <div data-tone={health.tone}><span>Scan health</span><b>{health.score}/100 · {health.label}</b><small>{health.notes[0]||'No pipeline issues detected.'}</small></div>
            <div data-tone={video.tone}><span>Video QA</span><b>{video.label}</b><small>{video.detail}</small></div>
          </div>
          <div className={styles.metrics}>
            <div><span>Observed</span><b>{scan.observed??0}</b></div>
            <div><span>Usable evidence</span><b>{scan.usableEvidence??0}{health.ratio!==null?<small className={styles.metricSub}>{Math.round(health.ratio*100)}% yield</small>:null}</b></div>
            <div><span>Topics</span><b>{scan.inferredTopics??0}</b></div>
            <div><span>Creators</span><b>{scan.uniqueCreators??0}</b></div>
          </div>
          <div className={styles.detail}><b>Sources</b><span>{counts(scan.sourceCounts)}</span></div>
          <div className={styles.detail}><b>Platforms</b><span>{counts(scan.platformCounts)}</span></div>
          {scan.fallback?.triggered&&<div className={styles.detail}><b>Visual recovery</b><span>{scan.fallback.failed?'Failed':`Observed ${scan.fallback.rawEvidence||0}; grounded ${scan.fallback.groundedEvidence||0}`}</span></div>}
          {scan.vision&&<div className={styles.detail}><b>Video understanding</b><span>{scan.vision.enabled?`${scan.vision.provider||'provider'} · ${scan.vision.model||'model'} · understood ${scan.vision.visuallyUnderstood||0}`:'inactive'}{scan.vision.lastError?` · ${scan.vision.lastError}`:''}</span></div>}
          {!!health.notes.length&&<details className={styles.details}><summary>Why this scan scored {health.score}/100</summary><div className={styles.noteList}>{health.notes.map((item,i)=><p key={i}>{item}</p>)}</div></details>}
          {!!scan.errors?.length&&<details className={styles.details} open={(scan.usableEvidence||0)===0}><summary>{scan.errors.length} warning/error{scan.errors.length===1?'':'s'}</summary><div className={styles.errorList}>{scan.errors.map((item,i)=><p key={i}>{item}</p>)}</div></details>}
          {!!scan.samples?.length&&<details className={styles.details}><summary>{scan.samples.length} scanned evidence sample{scan.samples.length===1?'':'s'}</summary><div className={styles.samples}>{scan.samples.map((sample,i)=><div className={styles.sample} key={`${sample.url}-${i}`}><div><b>{sample.platform||'Post'}{sample.author?` · @${sample.author}`:''}{sample.mediaType?` · ${sample.mediaType}`:''}</b><small>{sample.provenance||'Local browser scan'}</small></div>{sample.content&&<p>{sample.content}</p>}{sample.url&&<a href={sample.url} target="_blank" rel="noreferrer">Open scanned post</a>}</div>)}</div></details>}
        </article>;
      })}
    </section>
  </main>;
}
